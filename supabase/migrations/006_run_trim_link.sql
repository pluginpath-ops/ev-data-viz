-- Link runs to a specific trim configuration, and add EPA range to trims.
ALTER TABLE runs  ADD COLUMN IF NOT EXISTS trim_id         bigint REFERENCES trims(id) ON DELETE SET NULL;
ALTER TABLE trims ADD COLUMN IF NOT EXISTS epa_range_miles numeric;
