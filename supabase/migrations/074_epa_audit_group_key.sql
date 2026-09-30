-- Migration 074: key the EPA audit trail by group, not by child row id
--
-- Background:
--   epa_field_audit.row_id is the stringified primary key of the edited row.
--   For a group that is the test_group_id and it is stable. For a coefficient
--   set, test or phase it is a bigint identity, and the CSI importer used to
--   clean-replace those rows — deleting and re-inserting them — so every
--   re-import minted new ids. getEpaAuditForGroup found a group's history by
--   matching the group's id plus the CURRENT child ids, so after a re-import the
--   history of every child edit was still in the table and never matched again.
--   Insert-only means nothing was lost; it simply became invisible.
--
-- The fix has two halves, and this is the schema half:
--   * test_group_id on every audit row, so the history of a group is one
--     equality and does not depend on which child ids happen to exist today.
--   * row_key, the child's STABLE identity (coefficient category, EPA test
--     number, test number + phase index), so an entry still says which test or
--     phase it was about after the id it was written against is gone.
--
-- The importer half (update-in-place by these same natural keys, so ids survive
-- a re-import at all) is in DataService.importEpaGroupFull and
-- utils/epaImportMerge.js.
--
-- No foreign key on test_group_id: the audit is immutable history and must
-- outlive the group it describes, which a cascade would defeat.
--
-- Backfill only reaches rows whose child still exists. Rows already orphaned by
-- an earlier re-import have no child to join to and stay null — which is why
-- this is worth applying BEFORE the next bulk import rather than after.
--
-- Idempotent: safe to run twice.

ALTER TABLE epa_field_audit
    ADD COLUMN IF NOT EXISTS test_group_id text,
    ADD COLUMN IF NOT EXISTS row_key       text;

COMMENT ON COLUMN epa_field_audit.test_group_id IS
    'The EPA test group this edit belongs to — the group itself, or the group '
    'that owned the coefficient set, test or phase. Lets a group''s history be '
    'read without knowing its child row ids, which change on re-import.';
COMMENT ON COLUMN epa_field_audit.row_key IS
    'Stable identity of the edited child row, for display once row_id is dead: '
    'coefficient category, EPA test number, or "<test number> #<phase index>". '
    'NULL for a group-level edit.';

-- Groups: the row id IS the group id.
UPDATE epa_field_audit
   SET test_group_id = row_id
 WHERE table_name = 'epa_test_groups' AND test_group_id IS NULL;

-- Coefficient sets.
UPDATE epa_field_audit a
   SET test_group_id = c.test_group_id,
       row_key       = c.category
  FROM epa_coefficient_sets c
 WHERE a.table_name = 'epa_coefficient_sets'
   AND a.test_group_id IS NULL
   AND a.row_id = c.id::text;

-- Tests.
UPDATE epa_field_audit a
   SET test_group_id = t.test_group_id,
       row_key       = t.test_number
  FROM epa_tests t
 WHERE a.table_name = 'epa_tests'
   AND a.test_group_id IS NULL
   AND a.row_id = t.id::text;

-- Phases (through their test).
UPDATE epa_field_audit a
   SET test_group_id = t.test_group_id,
       row_key       = COALESCE(t.test_number, '?') || ' #' || p.phase_index
  FROM epa_test_phases p
  JOIN epa_tests t ON t.id = p.test_id
 WHERE a.table_name = 'epa_test_phases'
   AND a.test_group_id IS NULL
   AND a.row_id = p.id::text;

CREATE INDEX IF NOT EXISTS idx_epa_audit_group
    ON epa_field_audit (test_group_id, edited_at DESC);
