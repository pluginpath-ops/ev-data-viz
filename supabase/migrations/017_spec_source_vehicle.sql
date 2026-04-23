-- Add optional spec inheritance source: a vehicle can declare that its specs
-- should fall back to another vehicle's specs for any field left blank.
-- Handled entirely in the app layer; this column just persists the selection.

ALTER TABLE vehicles
    ADD COLUMN IF NOT EXISTS spec_source_vehicle_id bigint
        REFERENCES vehicles(id) ON DELETE SET NULL;
