-- 094: the Guide's unadjusted kWh/100mi figures (EPA identity, layer 2).
--
-- EPA's Fuel Economy Guide lists every EV configuration twice, once in MPGe
-- and once in kWh/100mi. parseFeGuide keeps one row per configuration (the
-- MPGe one) and until now dropped the twin entirely. But the twin is usually
-- the more precise copy: across MY2022–2027, 1,723 of 2,576 unadjusted
-- figures print MPGe to 1 decimal and kWh/100mi to 4 (Blazer EV AWD: 145.9
-- MPGe, 23.1078 kWh/100mi).
--
-- kWh/100mi is the unit a test vehicle reproduces — 100 × AC recharge energy ÷
-- CD range — and at 4 decimals it tells sibling configurations apart that 1
-- decimal of MPGe cannot (the R1S's are 0.4% apart). guideTestedVia reads
-- these, falling back to the MPGe figures for a row imported before this.
--
-- Unconstrained numeric, so a stored value keeps the scale EPA printed; the
-- tolerance a match is held to follows that precision.
--
-- After applying: re-import each year's Guide CSV (Admin → EPA → Fuel Economy
-- Guide). The upsert is by natural key, so nothing else on the rows changes.

ALTER TABLE public.epa_fe_guide
    ADD COLUMN IF NOT EXISTS unadj_city_kwh_100mi numeric,
    ADD COLUMN IF NOT EXISTS unadj_hwy_kwh_100mi  numeric;

COMMENT ON COLUMN public.epa_fe_guide.unadj_city_kwh_100mi IS
    'Unadjusted city kWh/100mi from the Guide''s kWh/100mi line for this configuration, as printed. Usually more precise than unadj_city_mpge.';
COMMENT ON COLUMN public.epa_fe_guide.unadj_hwy_kwh_100mi IS
    'Unadjusted highway kWh/100mi from the Guide''s kWh/100mi line for this configuration, as printed. Usually more precise than unadj_hwy_mpge.';
