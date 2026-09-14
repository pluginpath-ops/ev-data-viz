-- ============================================================
-- Migration 066: Data Checks skips (#321)
--
-- Additive. One table. Nothing dropped, nothing rewritten.
--
-- ── Why a skip has to be recorded ───────────────────────────────────────────
--
-- Admin → Data Checks lists every vehicle that disagrees with its own sources.
-- Some findings are correct as they stand: an R2 whose Usable and Gross really
-- are the same figure, a trim whose inherited curb weight is right. Without a
-- record of that judgement they return on every visit, the list never shrinks,
-- and a curator cannot tell a new finding from one already dismissed. That is
-- migration 058's argument for the Fuel Economy Guide link sweep, applied to
-- findings — and like a 058 skip, this is not a deletion and not a fix: the
-- finding stays visible under "Show skipped".
--
-- ── Why a fingerprint ───────────────────────────────────────────────────────
--
-- A skip is a judgement about particular VALUES. `fingerprint` stores them —
-- the finding's evidence as stable JSON, e.g. {"labels":[311],"range":337} —
-- and the panel treats a skip as current only while they still match. When an
-- import or an edit changes them the finding comes back, marked as skipped
-- before, because the judgement was about numbers that are no longer there.
--
-- Limits are deliberately NOT in the fingerprint. Moving a limit changes which
-- findings are shown, not the facts a skip was about.
--
-- ── Why a table, not columns ────────────────────────────────────────────────
--
-- 058 put the skip on the row being judged. A finding is not a row: it is a
-- (vehicle, check) pair computed at read time, and one vehicle can carry a
-- dozen of them.
--
-- `check_key` is free text with no CHECK constraint, so adding a check in
-- src/utils/dataChecks.js needs no migration, and a skip left behind by a check
-- that no longer exists is inert.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS data_check_skips (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id  bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    check_key   text   NOT NULL,
    fingerprint text   NOT NULL,
    note        text,
    skipped_by  uuid   DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
    skipped_at  timestamptz NOT NULL DEFAULT now(),
    -- One judgement per finding. Skipping again replaces it, with the values
    -- as they are now.
    UNIQUE (vehicle_id, check_key)
);

COMMENT ON TABLE data_check_skips IS
    'A curator''s decision that a Data Checks finding is correct as it stands (#321). Holds only while the finding''s values match `fingerprint`.';
COMMENT ON COLUMN data_check_skips.check_key IS
    'The check''s key in src/utils/dataChecks.js DATA_CHECKS, e.g. range-vs-label. Free text on purpose: a new check needs no migration.';
COMMENT ON COLUMN data_check_skips.fingerprint IS
    'The values the finding was judged on, as stable JSON. When they change, the skip no longer applies and the finding returns.';
COMMENT ON COLUMN data_check_skips.note IS
    'Why it was skipped, in the curator''s words. Optional.';

ALTER TABLE data_check_skips ENABLE ROW LEVEL SECURITY;

-- Curators decide and curators read, the same line every EPA curation table
-- draws. CREATE POLICY has no IF NOT EXISTS, so each is dropped first: running
-- 057 twice against a local cluster showed a second application aborts.
DROP POLICY IF EXISTS "Curators read data_check_skips" ON data_check_skips;
CREATE POLICY "Curators read data_check_skips"
    ON data_check_skips FOR SELECT
    USING (current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Curators insert data_check_skips" ON data_check_skips;
CREATE POLICY "Curators insert data_check_skips"
    ON data_check_skips FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

-- An upsert re-skipping a finding is an UPDATE on conflict, so this is needed
-- for "skip again" to work at all, not only for editing a note.
DROP POLICY IF EXISTS "Curators update data_check_skips" ON data_check_skips;
CREATE POLICY "Curators update data_check_skips"
    ON data_check_skips FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'))
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

DROP POLICY IF EXISTS "Curators delete data_check_skips" ON data_check_skips;
CREATE POLICY "Curators delete data_check_skips"
    ON data_check_skips FOR DELETE
    USING (current_user_role() IN ('admin', 'contributor'));

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- 1. The table exists, empty, with RLS on — expect 0 and true:
--
--      SELECT count(*) FROM data_check_skips;
--      SELECT relrowsecurity FROM pg_class WHERE relname = 'data_check_skips';
--
-- 2. Four policies — expect 4:
--
--      SELECT count(*) FROM pg_policies WHERE tablename = 'data_check_skips';
--
-- 3. One judgement per finding — the second insert should fail on the unique
--    constraint (run as a curator; roll back afterwards):
--
--      BEGIN;
--      INSERT INTO data_check_skips (vehicle_id, check_key, fingerprint)
--          SELECT id, 'range-vs-label', '{}' FROM vehicles LIMIT 1;
--      INSERT INTO data_check_skips (vehicle_id, check_key, fingerprint)
--          SELECT id, 'range-vs-label', '{}' FROM vehicles LIMIT 1;
--      ROLLBACK;
