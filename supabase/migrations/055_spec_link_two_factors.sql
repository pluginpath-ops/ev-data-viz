-- Two independent knobs on an inherited test (#185).
--
-- One factor could not say what it meant. A range test carries BOTH a distance
-- and an energy, and which of them you scale is the whole physical claim:
--
--   scale distance only          → range moves, efficiency moves with it
--   scale distance AND energy    → range moves, efficiency unchanged
--
-- The first is "same battery, different efficiency" (aero, tyres, drivetrain).
-- The second is "same efficiency, different battery". Both are real, they are
-- not the same edit, and a trim can differ in both at once — so one column
-- cannot express it.
--
-- Worse, the single column had drifted into meaning DIFFERENT things by kind:
-- efficiency on a range link (distance scaled, energy untouched) and capacity
-- on a charging link (kWh and kW scaled together). Same column, two meanings,
-- selected by a join to runs.kind.
--
-- The split, with capacity `c` and efficiency `e`:
--
--   distance-like  (distance_miles, range_value)              × c × e
--   energy/power   (energy_kwh, charge_energy_kwh, charge_rate) × c
--
-- which gives efficiency′ = (distance × c × e) / (energy × c) = efficiency × e.
-- `c` cancels exactly — that is what makes these two independent knobs rather
-- than merely two numbers, and it means neither reader needs to branch on kind.
-- The product c × e is the total range ratio, which is what the EPA-ratio
-- helper computes and why it must be divided by c before it fills `e`.
--
-- The rename is the other half. `scaling_factor` said nothing about WHICH
-- scaling once there were two, and it already held the efficiency knob: every
-- link in the wild scales distance alone. Migrations 041 and 052 settled this
-- same argument (youtube_url → source_url, url + charging_url → source_url) —
-- a name that lies about its contents is worse than a verbose one. RENAME
-- preserves the stored values, so existing links keep their exact meaning and
-- a null capacity_factor reads as 1.

ALTER TABLE spec_links RENAME COLUMN scaling_factor TO efficiency_factor;

ALTER TABLE spec_links ADD COLUMN IF NOT EXISTS capacity_factor numeric;
