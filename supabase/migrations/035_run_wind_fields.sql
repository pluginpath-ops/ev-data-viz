-- Capture wind conditions on range runs, for future correction modeling
-- (see issue #139). Data capture only — no correction math yet.
--
--   avg_wind_speed_mph — average wind speed during the test
--   wind_direction_deg — direction RELATIVE TO the vehicle's direction of
--                        travel, 0-360°: 0° = pure tailwind (from behind),
--                        180° = pure headwind (from ahead), 90/270° = crosswind.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS avg_wind_speed_mph numeric;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS wind_direction_deg numeric;
