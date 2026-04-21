-- Migration 011: Spec links — run inheritance between vehicles
--
-- A spec_link lets a target vehicle inherit range tests or charging curves
-- from a source vehicle, with an optional uniform scaling factor applied to
-- range data (run-level distance_miles + individual range_value data points).
-- Intended use: share a tested vehicle's data with closely related trims/years.
--
-- Resolution order (application layer):
--   1. Target vehicle has its own runs of the given spec_type → use those
--   2. No own runs + link exists → inherit source runs, mark is_estimated = true
--   3. Link has scaling_factor → multiply range_value & distance_miles by factor
--   4. Link is manually removed when real data arrives for the target

CREATE TABLE spec_links (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    target_vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    spec_type         text   NOT NULL CHECK (spec_type IN ('range_test', 'charging_curve')),
    scaling_factor    numeric        CHECK (scaling_factor > 0),  -- NULL means 1.0 (no scaling)
    notes             text,
    created_by        uuid   REFERENCES auth.users(id),
    created_at        timestamptz DEFAULT now(),

    -- A target vehicle can only inherit a given spec type from one source at a time
    UNIQUE (target_vehicle_id, spec_type),
    -- Prevent self-referential links
    CHECK  (source_vehicle_id != target_vehicle_id)
);

ALTER TABLE spec_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read spec_links"
    ON spec_links FOR SELECT USING (true);

CREATE POLICY "Contributors can insert spec_links"
    ON spec_links FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Contributors can delete spec_links"
    ON spec_links FOR DELETE
    USING (current_user_role() IN ('admin', 'contributor'));
