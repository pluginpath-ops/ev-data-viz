-- Separate charging "energy added" from driving "energy consumed".
--
-- Historically a single runs.energy_kwh column was overloaded: it meant
-- "energy added" for charging runs and "energy consumed" for range runs. On a
-- combined charging+range run the two collide, so a new column splits them.
--
--   energy_kwh         → energy consumed (driving / range)   [unchanged meaning]
--   charge_energy_kwh  → energy added (charger-side, charging)

ALTER TABLE runs ADD COLUMN IF NOT EXISTS charge_energy_kwh numeric;

-- Backfill: pure-charging runs (charging, not range) stored their "energy
-- added" in energy_kwh. Move it to the new column and clear energy_kwh (which
-- now means consumed only). Combined runs are left as-is: energy_kwh is treated
-- as consumed going forward and charge_energy_kwh starts null for re-entry.
UPDATE runs
   SET charge_energy_kwh = energy_kwh,
       energy_kwh        = NULL
 WHERE has_charging = true
   AND has_range     = false
   AND energy_kwh IS NOT NULL;
