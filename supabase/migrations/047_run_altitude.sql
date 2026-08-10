-- ─────────────────────────────────────────────────────────────────────────────
-- 047: altitude on runs and sessions, plus a catch-up for elevation gain.
--
-- Two distinct quantities, easily confused because both are measured in feet:
--
--   altitude_ft        the elevation the test was RUN AT. Drives air density,
--                      hence aero drag. A flat loop at 5,000 ft has no
--                      elevation gain and a ~9% consumption benefit.
--
--   elevation_gain_ft  the NET CLIMB over the route. Drives potential energy.
--                      A sea-level route over a pass has no density effect and
--                      a real energy cost.
--
-- Neither substitutes for the other, and correcting a test to standard
-- conditions needs both.
--
-- elevation_gain_ft is a CATCH-UP. The application has written, edited and
-- consumed that column for some time (DataService.addRun, the run form,
-- correctMeasuredConsumption via gradeEnergyKwh100mi) but it appears in no
-- migration — it was added out of band. This is a no-op against the live
-- database and repairs a deploy built from these files, where every run save
-- would otherwise fail on a missing column.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE runs ADD COLUMN IF NOT EXISTS elevation_gain_ft numeric;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS altitude_ft       numeric;

-- The session-level reading, exactly as temperature_f already works here: a
-- side-by-side round one loop shares an altitude, and entering it once is the
-- point of sessions. A run's own value stays authoritative for its row.
ALTER TABLE test_sessions ADD COLUMN IF NOT EXISTS altitude_ft numeric;

COMMENT ON COLUMN runs.altitude_ft IS
    'Mean elevation the test was run at (ft). Drives air density for aero correction. Distinct from elevation_gain_ft, which is net climb over the route.';
COMMENT ON COLUMN runs.elevation_gain_ft IS
    'Net elevation change over the route (ft); + = net climb. Drives the potential-energy term. Distinct from altitude_ft.';
COMMENT ON COLUMN test_sessions.altitude_ft IS
    'Session-level altitude (ft), the default for runs in this session that do not state their own.';
