-- ============================================================
-- Migration 029: EPA curator refactor — Part 4 (audit trail)
--
-- Cross-cutting requirement: every imported field is editable, with an
-- audit trail (who, when, prior value, source citation). This is the
-- history log; the current override state lives in each table's
-- `overrides` jsonb column for fast rendering.
--
-- Polymorphic: row_id is text so it covers epa_test_groups (text PK)
-- and the bigint-keyed children (stringified). Records are immutable —
-- insert-only, no update/delete.
-- ============================================================

CREATE TABLE epa_field_audit (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name      text NOT NULL,   -- 'epa_test_groups' | 'epa_coefficient_sets' | 'epa_tests' | 'epa_test_phases'
    row_id          text NOT NULL,   -- stringified PK of the edited row
    field           text NOT NULL,
    prior_value     text,
    new_value       text,
    source_citation text,            -- where the new value came from (sheet, PDF page, …)
    edited_by       uuid REFERENCES auth.users(id),
    edited_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_epa_audit_row ON epa_field_audit(table_name, row_id);
CREATE INDEX idx_epa_audit_edited_at ON epa_field_audit(edited_at DESC);

ALTER TABLE epa_field_audit ENABLE ROW LEVEL SECURITY;

-- Curators can read the trail and append to it. No updates or deletes
-- (immutable history) — absence of those policies denies them under RLS.
CREATE POLICY "Curators read epa_field_audit"
    ON epa_field_audit FOR SELECT
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators insert epa_field_audit"
    ON epa_field_audit FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));
