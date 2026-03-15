-- Migration 003: Add structured specs JSONB column to vehicles
--
-- Stores all vehicle specifications (predefined core fields + user-defined custom
-- fields per category) as a single JSONB blob. Nullable so all existing rows are
-- valid with specs = NULL until specs are entered for a vehicle.
--
-- No RLS changes needed: the existing vehicles UPDATE policy already gates writes
-- by user_id / role. The SELECT policy already controls read visibility.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS specs jsonb;

-- Example of the intended JSON structure (for documentation):
-- {
--   "pricing":      { "base_price_usd": 42990, "_custom": {} },
--   "powertrain":   { "motors": 2, "motor_type": "Permanent Magnet", "_custom": {} },
--   "compute":      { "cameras": 9, "_custom": {} },
--   "infotainment": { "android_auto": false, "carplay": true, "_custom": {} },
--   "dimensions":   { "weight_lbs": 4250, "_custom": {} },
--   "wheels":       { "wheel_size_in": 19, "tire_size": "255/45R19", "_custom": {} },
--   "suspension":   { "adaptive_damping": true, "_custom": {} },
--   "lighting":     { "adaptive_headlights": true, "_custom": {} },
--   "charging":     { "max_dc_kw": 250, "charge_port": "NACS", "_custom": {} },
--   "interior":     { "seating": 5, "_custom": {} }
-- }
