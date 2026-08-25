-- Migration 060: charge-depleting ranges belong to a TEST, not to a group (#227)
--
-- Background:
--   `cd_range_combined_calc` and `cd_range_hwy_calc` live on epa_test_groups,
--   and the CSI importer set them from whichever procedure-77 test it saw
--   FIRST:
--
--       const pref = tests.find(t => t.procedure_code === 77) || …
--
--   A group can legitimately hold more than one multi-cycle test. The Rivian R2
--   21" was run at two laboratories — FEV Michigan and Ann Arbor — and both are
--   valid. Mercedes' MY2027 CLA 350 holds two a month apart, reading
--   461.373/450.544 and 475.482/460.354.
--
--   But the derivation does not use the first test, it uses the most RECENT.
--   So the bag check recomputed ranges from one test's phases and compared them
--   against the other test's stated figures, and reported a disagreement that
--   was really two laboratories. That check is otherwise the strongest tool
--   here — it compares a record against itself and needs no external source —
--   so a false positive on exactly the groups that need careful reading is the
--   worst place to have one.
--
-- ADDED, not moved. The issue left this open and the group-level pair is worth
-- keeping: it is the headline figure for a group, it is what the Fuel Economy
-- Guide comparison is stated against, and moving it would break every existing
-- reader for no gain. The per-test columns are the precise ones; the group's
-- remain the summary.
--
-- The CSI states these per test and the parser has always read them — it then
-- deleted them, because there was nowhere to put them. Values arrive on
-- re-import; existing rows stay NULL and the readers fall back to the group's
-- figure, which is exactly what they used before.

ALTER TABLE epa_tests
    ADD COLUMN IF NOT EXISTS cd_range_combined_calc numeric(8,3),
    ADD COLUMN IF NOT EXISTS cd_range_hwy_calc      numeric(8,3);

COMMENT ON COLUMN epa_tests.cd_range_combined_calc IS
    'CSI "Charge Depleting Range (Calculated miles)" for THIS test. On a '
    'multi-cycle test this is the city/combined range; on a single-cycle test '
    'it is the range for whichever cycle the procedure drove. NULL on rows '
    'imported before migration 060 — readers fall back to the group figure.';

COMMENT ON COLUMN epa_tests.cd_range_hwy_calc IS
    'CSI "Charge Depleting Range Highway (Calculated miles)" for THIS test. '
    'NULL on rows imported before migration 060, and legitimately NULL on a '
    'single-cycle test that drove only the UDDS.';

COMMENT ON COLUMN epa_test_groups.cd_range_combined_calc IS
    'The group''s headline charge-depleting range, from the first procedure-77 '
    'test at import. When a group holds more than one, the derivation may use a '
    'DIFFERENT test — compare against epa_tests.cd_range_combined_calc for that '
    'test rather than this one. See migration 060.';

COMMENT ON COLUMN epa_test_groups.cd_range_hwy_calc IS
    'As above — the group''s headline highway range. Per-test figures live on '
    'epa_tests.cd_range_hwy_calc.';
