-- ============================================================
-- Migration 095: a vehicle links to its EPA Label (EPA identity, layer 3)
--
-- Additive. One table, one column. Nothing dropped.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
--
-- A vehicle was linked straight to EPA test vehicles (epa_vehicle_mappings),
-- and each test vehicle's certification to a Guide row. That puts the
-- curator's judgement in the wrong place: whether a test vehicle is the car is
-- a question of lab data a curator cannot read, while whether a Guide row is
-- the car — its carline, its wheels, its year — is exactly what a curator CAN
-- judge. Owner, 2026-10-31: link the vehicle to its Guide row (its EPA Label),
-- and link the test vehicles through it.
--
-- Which test vehicles stand behind a Guide row is worked out from their tests
-- (utils/guideTestedVia.js — "Tested via"): one that reproduces the figures
-- exactly or within rounding, or two or three the row is a blend of. Linking a
-- row links those, and the nearest of a blend's members is the one that stands
-- for the vehicle (owner, 2026-10-31). An untested row links none: the nearest
-- tested trim is a suggestion, never assumed.
--
-- ── The shape ───────────────────────────────────────────────────────────────
--
--   vehicle_guide_rows                 the curator's link: vehicle → Guide row
--   epa_vehicle_mappings.via_guide_row_id
--                                      the Guide row a configuration came in
--                                      through; null for one linked by hand.
--                                      Unlinking the row removes what it
--                                      brought and nothing else.
--
-- Which configuration stands for the vehicle stays where it was
-- (epa_vehicle_mappings.is_primary, 067). A Guide row has no primary of its own:
-- what a vehicle reads is a test vehicle's figures, so the choice lives there.
--
-- ── Applying it ─────────────────────────────────────────────────────────────
--
-- After 093 and 094. Safe before the app change: nothing reads the table until
-- it ships, and getVehicles() reads the mapping with a wildcard. Then run
-- Admin → Data Checks → EPA Label links, which links each vehicle to the Guide
-- rows its configurations point at and removes the configurations those rows'
-- Tested via contradicts. Safe to run twice.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS vehicle_guide_rows (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id      bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    fe_guide_row_id bigint NOT NULL REFERENCES epa_fe_guide(id) ON DELETE CASCADE,
    created_by      uuid REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (vehicle_id, fe_guide_row_id)
);

COMMENT ON TABLE vehicle_guide_rows IS
    'A vehicle''s EPA Label: the Fuel Economy Guide rows a curator judged to be this car. Its EPA test vehicles are linked through them, by Tested via (095).';

CREATE INDEX IF NOT EXISTS idx_vehicle_guide_rows_row ON vehicle_guide_rows(fe_guide_row_id);

ALTER TABLE vehicle_guide_rows ENABLE ROW LEVEL SECURITY;

-- The same gates as epa_vehicle_mappings: anyone reads, curators link, admins
-- delete.
DROP POLICY IF EXISTS "Public read vehicle_guide_rows" ON vehicle_guide_rows;
CREATE POLICY "Public read vehicle_guide_rows" ON vehicle_guide_rows
    FOR SELECT USING (true);
DROP POLICY IF EXISTS "Curators insert vehicle_guide_rows" ON vehicle_guide_rows;
CREATE POLICY "Curators insert vehicle_guide_rows" ON vehicle_guide_rows
    FOR INSERT WITH CHECK (current_user_role() = ANY (ARRAY['admin', 'contributor']));
DROP POLICY IF EXISTS "Admins delete vehicle_guide_rows" ON vehicle_guide_rows;
CREATE POLICY "Admins delete vehicle_guide_rows" ON vehicle_guide_rows
    FOR DELETE USING (current_user_role() = 'admin');

GRANT SELECT ON vehicle_guide_rows TO anon, authenticated;
GRANT INSERT, DELETE ON vehicle_guide_rows TO authenticated;

ALTER TABLE epa_vehicle_mappings
    ADD COLUMN IF NOT EXISTS via_guide_row_id bigint REFERENCES epa_fe_guide(id) ON DELETE SET NULL;

COMMENT ON COLUMN epa_vehicle_mappings.via_guide_row_id IS
    'The Guide row whose Tested via linked this configuration (095); null when a curator linked the test vehicle by hand.';

COMMIT;
