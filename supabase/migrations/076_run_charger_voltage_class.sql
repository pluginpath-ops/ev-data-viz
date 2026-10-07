-- 076: the voltage class of the charger a charging test was taken on (#366 layer 1, #313)
--
-- A charger can only pull a curve down. An 800 V car on a 400 V-class charger
-- (a Tesla V3 Supercharger, say) sits flat at a fraction of what it draws on
-- its own class: the iX3 holds ~185 kW on one and ~390 kW on the other, and
-- the two agree only once the car's own taper takes over. Without knowing which
-- charger a test used, nothing can tell that curve from a slow car.
--
-- Read by the composite curve (src/utils/compositeCurve.js): a test recorded on
-- a LOWER class than the car's is a different condition, not a worse
-- measurement — it is kept out of the car's composite and forms one of its own
-- when there are enough. Where this is null the composite infers a charger
-- limit from the curve's shape instead.
--
-- NULLABLE, following runs.preconditioned (073): null is "not recorded", which
-- is every test until someone says. The values are VOLTAGE_CLASSES
-- (src/utils/platforms.js), the same 400 | 800 a platform carries.
--
-- Written by whoever may write the run (the existing runs UPDATE policy),
-- through DataService.addRun and updateRun.
--
-- Additive and safe to run twice.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS charger_voltage_class smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_charger_voltage_class_check') THEN
    ALTER TABLE runs ADD CONSTRAINT runs_charger_voltage_class_check
      CHECK (charger_voltage_class IS NULL OR charger_voltage_class IN (400, 800));
  END IF;
END $$;

COMMENT ON COLUMN runs.charger_voltage_class IS
  'Charging tests: the voltage class (400 or 800) of the charger used, or null for not recorded. See #366, #313.';
