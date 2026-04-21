-- Migration 012: Allow contributors to update spec_links
--
-- Required to support inline editing of scaling_factor without a remove + re-add.
-- The earlier addSpecLink workaround (delete-then-insert) is kept in place so that
-- re-adding a removed link still works without this policy — but the UPDATE path
-- is now the preferred route for scaling_factor edits.

CREATE POLICY "Contributors can update spec_links"
    ON spec_links FOR UPDATE
    USING      (current_user_role() IN ('admin', 'contributor'))
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));
