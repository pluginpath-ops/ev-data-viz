-- ─────────────────────────────────────────────────────────────────────────────
-- 101: wind speed and elevation gain on test sessions.
--
-- Side-by-side tests share a loop and a day, so they share these too. Like
-- temperature_f and altitude_ft (044, 047), they are the session-level
-- reading: entered once, copied down to the session's tests from the session
-- form, and read as a fallback where a test states none. A test's own value
-- stays authoritative for its row.
--
-- Wind DIRECTION stays per test: it is relative to the heading driven.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS wind_speed_mph    numeric;
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS elevation_gain_ft numeric;
