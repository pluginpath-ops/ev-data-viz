-- 073: whether the battery was preconditioned for a charging test (#352)
--
-- A cold pack charges slowly, so a charging curve means little without knowing
-- whether the car warmed its battery on the way to the charger. The vehicle's
-- spec says what the car CAN do (specs.charging.preconditioning: None, Manual,
-- Automatic, Both); this says what happened on this one test.
--
-- NULLABLE, and the three values are three answers:
--   true    the battery was preconditioned
--   false   it was not
--   null    not recorded -- every test until someone says
-- "Not preconditioned" and "nobody wrote it down" must never be collapsed, so
-- there is no default.
--
-- Shown beneath a tested charge time in the vehicle table and in the test peek
-- (src/utils/testDetails.js). Written by whoever may write the run (the
-- existing runs UPDATE policy), through DataService.addRun and updateRun.
--
-- Additive and safe to run twice.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS preconditioned boolean;

COMMENT ON COLUMN runs.preconditioned IS
  'Whether the battery was preconditioned for this charging test: true, false, or null for not recorded. See #352.';
