-- 092: the current class of the charger a charging test was taken on (composite curve, #313)
--
-- 076 recorded the charger's VOLTAGE class. This records its CURRENT, because on
-- one voltage class the chargers still differ by a fifth or more: a V3.5
-- Supercharger holds an R2 flat near 185-190 kW (about 500 A at 400 V) where
-- another stall lets it draw 225 kW (600 A and up). Teslas take about 650 A,
-- a Cybertruck over 700 A on the right Supercharger, and some Chinese cars more.
-- A curve flat at a charger's current limit that still rises slowly with pack
-- voltage is a CURRENT limit, which is what the composite's charger-limited
-- detection is already looking at.
--
-- Read by the composite curve (src/utils/compositeCurve.js). Tests are bucketed
-- by current class, null counted as DEFAULT_CHARGER_CURRENT_A (500 A, the owner's
-- call, 2026-10-26). The composite is split into one per class ONLY when a test on
-- a lower class is seen held back against the higher classes' tests, the same
-- charger-limited event the existing algorithm detects. With no such event, every
-- test stays in one composite whatever its class.
--
-- NULLABLE, following runs.preconditioned (073) and runs.charger_voltage_class
-- (076): null is "not recorded". The accepted values are a list in code
-- (CHARGER_CURRENT_CLASSES in src/utils/chargerCurrentClass.js: 350, 500, 600,
-- 700, shown as "700 A+"), so a new class needs no migration; the constraint
-- only rules out nonsense.
--
-- Written by whoever may write the run (the existing runs UPDATE policy),
-- through DataService.addRun and updateRun.
--
-- Additive and safe to run twice.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS charger_current_class_a smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_charger_current_class_check') THEN
    ALTER TABLE runs ADD CONSTRAINT runs_charger_current_class_check
      CHECK (charger_current_class_a IS NULL OR charger_current_class_a BETWEEN 100 AND 1500);
  END IF;
END $$;

COMMENT ON COLUMN runs.charger_current_class_a IS
  'Charging tests: the current class in amps (350, 500, 600, 700) of the charger used, or null for not recorded, which the composite reads as 500. See #313.';

-- A composite can now be split by current class as well (see above), so a
-- vehicle may hold several with the same voltage class. 077's index allowed one
-- per voltage class; this one allows one per voltage class AND current class.
-- COALESCE for the same reason as 077: a composite with no split has neither
-- key, and a NULL would never collide with itself. Composites built before this
-- migration have no chargerCurrentA and sit under 'all', exactly where they were.
DROP INDEX IF EXISTS runs_one_composite_per_class;
CREATE UNIQUE INDEX IF NOT EXISTS runs_one_composite_per_charger_class
  ON runs (vehicle_id, COALESCE(composite->>'chargerClassV', 'all'), COALESCE(composite->>'chargerCurrentA', 'all'))
  WHERE composite IS NOT NULL;
