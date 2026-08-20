-- Migration 056: separate a CSI's certification identity from its carryover source
--
-- Background:
--   A CSI report has TWO identities when the certification carries vehicles over
--   from a previous model year, and the importer was reading the wrong one.
--
--   Volvo's CSI-VVVXT00.0ZVG is the case that surfaced it:
--
--     page 1  Test Group                        VVVXT00.0ZVG   ← the certification
--     page 1  Model Year                        2027           ← the certification
--     per-cfg Original Test Group Name          TVVXT00.0ZVG   ← where the EDVs came from
--     per-cfg Original Test Vehicle Model Year  2026           ← where the EDVs came from
--
--   The parser took model_year and epa_test_family_id from the per-config
--   "Original …" fields, so a MY2027 certification was stored as MY2026. That is
--   worse than a missing value: the Fuel Economy Guide picker scores a group
--   against guide rows of the same year as `exactYear`, so a mislabelled group
--   matched MY2026 rows and `bestFeCandidate` auto-proposed one, with no
--   off-year warning. For this vehicle the MY2026 row reads UCity 128.1 while
--   the CSI's own numbers derive to 135.1 — a confident, wrong link.
--
--   It is invisible on non-carryover certifications, where the two model years
--   are the same value. Only carryover certifications diverge.
--
--   The certification test group is also the joinable one: the guide's
--   "#1 Smog Rating Test Group" carries VVVXT00.0ZVG, not TVVXT00.0ZVG.
--
-- The "Original …" values are still worth keeping — they say which model year's
-- lab work these results actually are, which matters when comparing a group
-- against test data — so they move to their own columns rather than being lost.

ALTER TABLE epa_test_groups
    ADD COLUMN IF NOT EXISTS carryover_test_group_id text,
    ADD COLUMN IF NOT EXISTS carryover_model_year    integer;

COMMENT ON COLUMN epa_test_groups.carryover_test_group_id IS
    'CSI "Original Test Group Name" — the test group the emission data vehicles '
    'were carried over FROM. NULL when the certification did not carry over. '
    'Provenance only: epa_test_family_id holds the certification''s own test group.';

COMMENT ON COLUMN epa_test_groups.carryover_model_year IS
    'CSI "Original Test Vehicle Model Year" — the model year the emission data '
    'vehicles were originally tested under. Differs from model_year only on a '
    'carryover certification. Provenance only; model_year is the certification''s.';

COMMENT ON COLUMN epa_test_groups.epa_test_family_id IS
    'The certification test group (CSI page 1 "Test Group", e.g. VVVXT00.0ZVG) — '
    'the family ID shared by multiple vehicle configurations, and the value the '
    'Fuel Economy Guide carries as "#1 Smog Rating Test Group". test_group_id '
    'stores the more specific "Test Vehicle ID". Imports before migration 056 '
    'may hold the carryover source group instead; see carryover_test_group_id.';
