-- Migration 016: Redesign spec_links from vehicle-level to run-level linking
--
-- Old schema linked one source vehicle per (target_vehicle_id, spec_type), so all
-- inherited runs from that vehicle shared the same color, scaling factor, and
-- default status. New schema links individual runs, giving per-run control over
-- all attributes. source_vehicle_id and spec_type are removed — both are
-- inferrable from the linked run record.

DROP TABLE IF EXISTS spec_links;

CREATE TABLE spec_links (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    source_run_id     bigint NOT NULL REFERENCES runs(id)     ON DELETE CASCADE,
    scaling_factor    numeric,
    notes             text,
    color             text,
    is_default        boolean NOT NULL DEFAULT false,
    created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (target_vehicle_id, source_run_id)
);

ALTER TABLE spec_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spec_links_select" ON spec_links
    FOR SELECT USING (true);

CREATE POLICY "spec_links_insert" ON spec_links
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contributor'))
    );

CREATE POLICY "spec_links_update" ON spec_links
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contributor'))
    );

CREATE POLICY "spec_links_delete" ON spec_links
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contributor'))
    );
