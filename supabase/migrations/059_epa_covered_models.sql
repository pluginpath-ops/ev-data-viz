-- ============================================================
-- Migration 059: what a certificate actually covers (#250, for #238)
--
-- Additive. One table, one column. Nothing dropped, nothing rewritten.
--
-- ── The page we never read ──────────────────────────────────────────────────
--
-- `parseEpaCsiPdf` reads the Emission Data Vehicle Information page and stops
-- there. Every CSI PDF also carries a "Models Covered by this Certificate"
-- table — 13 of 13 of the files on hand, 202 rows between them — and it holds
-- the fact the linking sweep keeps needing.
--
-- The page we do read gives ONE name for a whole certificate:
-- `Lucid Air Touring AWD`. The covered-models table gives the enumerated list
-- of configurations that certificate covers, and those names match Fuel Economy
-- Guide carlines almost verbatim:
--
--     covered model : 730 - R1T Performance Dual Max (20in)
--     guide carline :       R1T Performance Dual Max (20in)
--
-- which turns the sweep's hardest cases from a similarity score into a lookup.
--
-- ── And the free text, which is sometimes the only answer ───────────────────
--
-- `Manufacturer Test Vehicle Comments` appears in all 13 files, one to ten per
-- certificate, and has never been captured. It is unstructured and varies by
-- manufacturer, which is exactly why it is stored as text and read by a person
-- rather than parsed:
--
--   Volvo  "Tested on 20 inch tire, covering 22 inch tire as worst case …
--           Test is performed with performance SW, as worst case"
--   BMW    "vi_DA01672_00_FEDV_iX3 50 xDrive (20'' Summer Tires)_A_ETW-5500 …"
--   Tesla  "This is 2024 Model Y Long Range AWD-I; Front Motor Power - 83 kW …"
--
-- The Volvo line is the whole answer to a case the table cannot settle: its
-- covered models name only 21-inch wheels, yet the test covers 20 and 22 inch,
-- and one test covers both the Performance and non-Performance variants.
-- ============================================================

BEGIN;

-- ── 1. Covered models ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS epa_covered_models (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    test_group_id text NOT NULL REFERENCES epa_test_groups(test_group_id) ON DELETE CASCADE,

    -- EPA's own index for the configuration, e.g. 297. Text because it is an
    -- identifier and nothing is ever computed from it.
    carline_number text,
    -- Verbatim, wheels and all: `EX90 Twin Motor (21 inch Wheels)`. This is the
    -- string that gets matched against a guide carline, so it is never cleaned.
    carline_name   text NOT NULL,

    division             text,
    -- A configuration is listed once per region, so `Federal` and
    -- `California + CAA Section 177 states` are two rows for one car.
    certification_region text,
    drive_system         text,
    transmission_type    text,
    gears                integer,

    created_at timestamptz DEFAULT now()
);

-- ── Uniqueness, with NULLS NOT DISTINCT and it matters ──────────────────────
--
-- Same configuration, same region, once.
--
-- A plain UNIQUE would not enforce that. `certification_region` is nullable —
-- the parser leaves it null when a row's region column is absent or unread —
-- and in Postgres NULL is not equal to NULL, so a plain constraint lets two
-- otherwise identical rows both insert. Verified: two rows with the same
-- (test_group_id, carline_name, NULL) were accepted.
--
-- Migration 053 hit the same trap from the other side and solved it by making
-- `model_type_index` NOT NULL, noting that "a NULL here would defeat the
-- constraint, since Postgres treats NULLs as distinct". That is not open here —
-- an absent region is a real state, and inventing a sentinel to stand for it
-- would put a fake value in a column people read.
--
-- NULLS NOT DISTINCT says the intended thing directly: for uniqueness, treat
-- null as a value. Postgres 15+, and production is 17.6.
--
-- Added separately rather than inline so re-running the migration can replace a
-- constraint created by an earlier version of this file.
ALTER TABLE epa_covered_models
    DROP CONSTRAINT IF EXISTS epa_covered_models_test_group_id_carline_name_certification_key;
ALTER TABLE epa_covered_models
    DROP CONSTRAINT IF EXISTS epa_covered_models_unique_config;
ALTER TABLE epa_covered_models
    ADD CONSTRAINT epa_covered_models_unique_config
    UNIQUE NULLS NOT DISTINCT (test_group_id, carline_name, certification_region);

COMMENT ON TABLE epa_covered_models IS
    'The "Models Covered by this Certificate" table from a CSI PDF — every configuration one certification covers, with the wheel or tyre variant where the manufacturer states it (#250).';

CREATE INDEX IF NOT EXISTS idx_covered_models_group ON epa_covered_models (test_group_id);
-- Matching goes name-first, case-insensitively, from any certificate.
CREATE INDEX IF NOT EXISTS idx_covered_models_name  ON epa_covered_models (lower(btrim(carline_name)));

ALTER TABLE epa_covered_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read covered models"          ON epa_covered_models;
DROP POLICY IF EXISTS "Contributors insert covered models"  ON epa_covered_models;
DROP POLICY IF EXISTS "Contributors update covered models"  ON epa_covered_models;
DROP POLICY IF EXISTS "Admins delete covered models"        ON epa_covered_models;

CREATE POLICY "Public read covered models"
    ON epa_covered_models FOR SELECT USING (true);
CREATE POLICY "Contributors insert covered models"
    ON epa_covered_models FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));
CREATE POLICY "Contributors update covered models"
    ON epa_covered_models FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));
CREATE POLICY "Admins delete covered models"
    ON epa_covered_models FOR DELETE
    USING (current_user_role() = 'admin');


-- ── 2. The manufacturer's own note on the tested vehicle ─────────────────────
--
-- On the test, not the group: a certificate carries one per test and they
-- differ. Volvo's two tests describe different worst-case coverage.
ALTER TABLE epa_tests
    ADD COLUMN IF NOT EXISTS mfr_test_vehicle_comments text;

COMMENT ON COLUMN epa_tests.mfr_test_vehicle_comments IS
    'Free text from the CSI "Manufacturer Test Vehicle Comments" field. Unstructured and manufacturer-specific — often the only statement of which wheel or software variant a test represents (#250).';

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- Nothing lands until the CSI PDFs are re-imported; the table was never read
-- before, so existing groups have no covered models.
--
-- 1. A null region no longer defeats the constraint — the second insert must
--    fail with a unique violation:
--
--      INSERT INTO epa_covered_models (test_group_id, carline_name, certification_region)
--      SELECT test_group_id, 'DUPE', NULL FROM epa_test_groups LIMIT 1;
--      -- run it twice; the second must raise
--
-- 2. The table and column exist:
--
--      SELECT count(*) FROM epa_covered_models;                     -- expect 0
--      SELECT count(*) FROM information_schema.columns
--       WHERE table_name='epa_tests' AND column_name='mfr_test_vehicle_comments';
--
-- 2. After re-importing, the Volvo certificate should hold 4 configurations
--    across 2 regions, and its tests should carry the tyre note:
--
--      SELECT carline_number, carline_name, certification_region
--        FROM epa_covered_models WHERE test_group_id = 'VVVXT00.0ZVG'
--       ORDER BY carline_number, certification_region;
--
--      SELECT left(mfr_test_vehicle_comments, 60) FROM epa_tests
--       WHERE test_group_id = 'VVVXT00.0ZVG';
