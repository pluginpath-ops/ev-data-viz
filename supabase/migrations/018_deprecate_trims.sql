-- Vehicle = Trim: each vehicle record now represents a specific configuration.
-- Trim sub-records are no longer needed; their data lives in the vehicle's own
-- spec fields (wheels.wheel_size_in, wheels.tire_size, vehicle.range, etc.).

ALTER TABLE runs DROP COLUMN IF EXISTS trim_id;
DROP TABLE IF EXISTS vehicle_trims CASCADE;
