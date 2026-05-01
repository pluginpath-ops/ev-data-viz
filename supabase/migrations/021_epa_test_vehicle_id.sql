-- Migration 021: EPA test group key fix
--
-- Background:
--   The original schema stored "Actual Tested Testgroup" (e.g. SRIVT00.0SEP)
--   as test_group_id. This is an EPA test-family ID shared by multiple vehicle
--   configurations (e.g. 20in and 22in wheel variants of the same model), which
--   caused the importer to collapse distinct configurations into one record.
--
--   The correct unique key per configuration is the EPA "Test Vehicle ID"
--   (e.g. R1S247XR20 / R1S247XR22). New imports use that value as test_group_id.
--   This migration adds epa_test_family_id to store the family ID separately.
--
-- For records imported before this fix, epa_test_family_id will be NULL
-- (they used the family ID as test_group_id, which cannot be reversed safely).

ALTER TABLE epa_test_groups
    ADD COLUMN IF NOT EXISTS epa_test_family_id text;

COMMENT ON COLUMN epa_test_groups.epa_test_family_id IS
    'EPA "Actual Tested Testgroup" — the certification family ID shared by '
    'multiple vehicle configurations. Populated by imports after migration 021. '
    'test_group_id now stores the more specific "Test Vehicle ID".';
