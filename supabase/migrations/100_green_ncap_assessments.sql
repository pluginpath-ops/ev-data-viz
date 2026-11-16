-- 100: Green NCAP assessments and their tests (docs/green-ncap-plan.md, step 2)
--
-- Additive. Nothing reads these tables yet; the import (step 3) fills them.
--
-- ── The model ───────────────────────────────────────────────────────────────
--
-- A Green NCAP assessment is one car Green NCAP tested, with its results
-- sheet. It is kept as published and linked to an EVBench vehicle the way an
-- EPA Certification is. The owner confirms the link (LocalDev/green-ncap/
-- matches.csv); it is never guessed.
--
--   green_ncap_assessments  one row per car, keyed by Green NCAP's page slug
--   green_ncap_tests        one row per row of its results table
--                           ("BAB130 Motorway", "WLTC+ Warm"), as printed
--   runs.green_ncap_assessment_id
--                           the tests EVBench makes from an assessment: the
--                           BAB130 range test and, from 2025, the DC
--                           fast-charging curve as a charging test. At most one
--                           of each kind. They are rebuilt on every import and
--                           never edited by hand; deleting the assessment
--                           deletes them.
--
-- Only what Green NCAP prints is stored: metric units, its labels. Miles and
-- Wh/mi are worked out when read. A test's "Driving Range" is computed by Green
-- NCAP (net battery ÷ that test's from-battery consumption), not driven.
--
-- Safe to run twice.

BEGIN;

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.green_ncap_assessments (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug                 text    NOT NULL UNIQUE,
    reference            text,
    make                 text    NOT NULL,
    model                text    NOT NULL,
    variant              text,
    layout               text    NOT NULL CHECK (layout IN ('2020', '2022', '2025')),
    test_year            integer,
    vin                  text,
    vin_model_year       integer,
    drivetrain           text,
    declared_usable_kwh  numeric,
    wltp_range_km        numeric,
    recharged_kwh        numeric,
    net_battery_kwh      numeric,
    grid_to_battery      numeric CHECK (grid_to_battery IS NULL OR grid_to_battery BETWEEN 0.5 AND 1),
    published            jsonb   NOT NULL DEFAULT '{}'::jsonb,
    page_url             text,
    sheet_url            text,
    datasheet_url        text,
    rated_on             text,
    fetched_at           timestamptz,
    vehicle_id           bigint  REFERENCES public.vehicles(id) ON DELETE SET NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.green_ncap_assessments IS
    'One car Green NCAP tested, kept as published; vehicle_id is the owner-confirmed EVBench vehicle (docs/green-ncap-plan.md).';
COMMENT ON COLUMN public.green_ncap_assessments.slug IS
    'Green NCAP''s page slug (greenncap.com/assessments/<slug>/). The import upserts on it.';
COMMENT ON COLUMN public.green_ncap_assessments.reference IS
    'Green NCAP Test Reference Number ("25-KIA-0229"); its first two digits are the test year.';
COMMENT ON COLUMN public.green_ncap_assessments.layout IS
    'Which results-sheet layout it came from: 2020 (no battery figures), 2022, or 2025 (adds the fast-charging curve).';
COMMENT ON COLUMN public.green_ncap_assessments.vin_model_year IS
    'Model year from VIN position 10, only when it lands near the test year. European makers need not fill it.';
COMMENT ON COLUMN public.green_ncap_assessments.recharged_kwh IS
    'AC energy from the grid to recharge the battery from empty.';
COMMENT ON COLUMN public.green_ncap_assessments.net_battery_kwh IS
    'Measured energy out of the battery, empty to full.';
COMMENT ON COLUMN public.green_ncap_assessments.grid_to_battery IS
    'Net battery ÷ recharged: charger efficiency on EPA''s basis. The fallback after EPA''s own (plan, step 4).';
COMMENT ON COLUMN public.green_ncap_assessments.published IS
    'The rest of the sheet''s identity block as published (power, torque, tyres, mass, WLTP consumption): kept, not read.';

CREATE TABLE IF NOT EXISTS public.green_ncap_tests (
    id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assessment_id             bigint  NOT NULL REFERENCES public.green_ncap_assessments(id) ON DELETE CASCADE,
    position                  integer NOT NULL,
    key                       text,
    label                     text    NOT NULL,
    on_road                   boolean NOT NULL DEFAULT false,
    rated                     boolean NOT NULL DEFAULT true,
    temp_c                    numeric,
    from_grid_kwh_100km       numeric,
    from_battery_kwh_100km    numeric,
    board_computer_kwh_100km  numeric,
    range_km                  numeric,
    UNIQUE (assessment_id, position)
);

COMMENT ON TABLE public.green_ncap_tests IS
    'One Green NCAP test: a row of an assessment''s results table, named as printed. Never a "run".';
COMMENT ON COLUMN public.green_ncap_tests.position IS
    'Row order in the sheet, from 0.';
COMMENT ON COLUMN public.green_ncap_tests.key IS
    'Stable code name across sheet layouts (bab130, wltc_warm, on_road …; parseGreenNcapSheet.js). Null for a row the parser did not know. Code only, not UI text.';
COMMENT ON COLUMN public.green_ncap_tests.on_road IS
    'Driven on the road (true) or on the lab''s dynamometer (false).';
COMMENT ON COLUMN public.green_ncap_tests.rated IS
    'False for rows Green NCAP prints but does not score ("not rated", repeats, averages).';
COMMENT ON COLUMN public.green_ncap_tests.range_km IS
    'Green NCAP''s "Driving Range": computed, net battery ÷ from-battery consumption, not driven to empty.';

CREATE INDEX IF NOT EXISTS idx_green_ncap_assessments_vehicle ON public.green_ncap_assessments (vehicle_id)
    WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_green_ncap_tests_key ON public.green_ncap_tests (key);

-- ── The tests EVBench makes from an assessment ──────────────────────────────

ALTER TABLE public.runs
    ADD COLUMN IF NOT EXISTS green_ncap_assessment_id bigint
        REFERENCES public.green_ncap_assessments(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.runs.green_ncap_assessment_id IS
    'Made from this Green NCAP assessment by the import: the BAB130 range test, or the DC fast-charging curve. Rebuilt on re-import; not edited by hand.';

CREATE UNIQUE INDEX IF NOT EXISTS runs_one_per_green_ncap_kind
    ON public.runs (green_ncap_assessment_id, kind) WHERE green_ncap_assessment_id IS NOT NULL;

-- ── Access: the epa_certifications policies ─────────────────────────────────

ALTER TABLE public.green_ncap_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.green_ncap_tests       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read green_ncap_assessments"     ON public.green_ncap_assessments;
DROP POLICY IF EXISTS "Curators insert green_ncap_assessments" ON public.green_ncap_assessments;
DROP POLICY IF EXISTS "Curators update green_ncap_assessments" ON public.green_ncap_assessments;
DROP POLICY IF EXISTS "Admins delete green_ncap_assessments"   ON public.green_ncap_assessments;
CREATE POLICY "Public read green_ncap_assessments"     ON public.green_ncap_assessments FOR SELECT USING (true);
CREATE POLICY "Curators insert green_ncap_assessments" ON public.green_ncap_assessments FOR INSERT
    WITH CHECK (current_user_role() = ANY (ARRAY['admin', 'contributor']));
CREATE POLICY "Curators update green_ncap_assessments" ON public.green_ncap_assessments FOR UPDATE
    USING (current_user_role() = ANY (ARRAY['admin', 'contributor']));
CREATE POLICY "Admins delete green_ncap_assessments"   ON public.green_ncap_assessments FOR DELETE
    USING (current_user_role() = 'admin');

-- A re-import replaces an assessment's rows, so curators may delete tests.
DROP POLICY IF EXISTS "Public read green_ncap_tests"     ON public.green_ncap_tests;
DROP POLICY IF EXISTS "Curators insert green_ncap_tests" ON public.green_ncap_tests;
DROP POLICY IF EXISTS "Curators update green_ncap_tests" ON public.green_ncap_tests;
DROP POLICY IF EXISTS "Curators delete green_ncap_tests" ON public.green_ncap_tests;
CREATE POLICY "Public read green_ncap_tests"     ON public.green_ncap_tests FOR SELECT USING (true);
CREATE POLICY "Curators insert green_ncap_tests" ON public.green_ncap_tests FOR INSERT
    WITH CHECK (current_user_role() = ANY (ARRAY['admin', 'contributor']));
CREATE POLICY "Curators update green_ncap_tests" ON public.green_ncap_tests FOR UPDATE
    USING (current_user_role() = ANY (ARRAY['admin', 'contributor']));
CREATE POLICY "Curators delete green_ncap_tests" ON public.green_ncap_tests FOR DELETE
    USING (current_user_role() = ANY (ARRAY['admin', 'contributor']));

-- Supabase's default privileges grant these; a database restored without them
-- (scripts/localdb.sh) needs the grant spelled out. Harmless where it exists.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.green_ncap_assessments, public.green_ncap_tests
    TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Tables present and empty (expect 0, 0):
--   SELECT (SELECT count(*) FROM green_ncap_assessments), (SELECT count(*) FROM green_ncap_tests);
-- The runs column exists (expect 1):
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name = 'runs' AND column_name = 'green_ncap_assessment_id';
