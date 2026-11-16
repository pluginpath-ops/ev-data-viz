# Green NCAP import — plan

Green NCAP (greenncap.com, run with Euro NCAP) tests European cars in the lab
and on the road and publishes each car's results sheet. EVBench wants two
things from it: the **BAB130 motorway test**, to set beside third-party
highway range tests, and the **measured charger efficiency** (AC energy from
the grid against measured net battery capacity — EPA's basis).

Agreed with the owner 2026-11-15. Built so far: the downloader and parser
(this PR). Everything below "To build" is not built.

## What Green NCAP publishes

- `www.greenncap.com/assessments/` lists every car in one table (238 cars, 77
  electric on 2026-11-15). Each row carries `data-year`, `data-make`,
  `data-model`, `data-engine` and a link to the car's page.
- A car's page links a **results sheet** (`.ods`) and a datasheet PDF. File
  names do not follow the page's name, so the downloader reads the links off
  the page.
- Three sheet layouts, all read by label:

| Years | Results sheet | Battery figures | Test rows |
|---|---|---|---|
| 2020–21 | `RESULTS` | none | WLTC+ cold (14 °C), −7 °C, warm; BAB130; PEMS+ road, short trip, eco, heavy load |
| 2022–24 | `RESULTS` | recharged + net capacity on the first lab row | as above, cold start at 23 °C |
| 2025– | `TEST_RESULTS` | on the WLTP type-approval row | WLTP, WLTC+ warm, CAT cold, CAT warm, BAB130, On-Road, Short Urban; plus a `Fast_charging` sheet |

Facts that shape the import:

- **Range is computed, not driven.** "Driving Range" = measured net battery
  capacity ÷ the test's from-battery consumption (EV9 BAB130: 95.37 kWh ÷
  30.72 kWh/100 km = 310.5 km).
- **BAB130** runs at 23 °C (±5 °C) on a chassis dynamometer. After an
  unmeasured warm-up, two identical 270 s phases are measured and averaged.
  Each holds 130 km/h with three dips to 110 km/h and an 80→130 km/h
  restart, every acceleration at full throttle (kick-down). It is an
  aggressive mixed cycle, not a steady speed. Battery-electric cars start it at
  no more than 90% SoC. Source: *GNT BAB Motorway Test Procedure v3.0.0*
  (June 2025), saved in `LocalDev/explainers/Reference Docs/`.
- **BAB130 average speed is 124.9 km/h (77.6 mph)**, from the procedure's
  speed table. The measured phases cover 9.37 km each; the procedure rounds
  this to 10 km. That is the target trace. A real car takes a few
  seconds to make the 80→130 km/h step, so it runs a little slower.
- **Grid to battery output** = net capacity ÷ recharged energy — the same
  ratio as EPA's DC energy ÷ AC recharge in `deriveChargerEfficiency`. The
  sheet does not give the AC charging rate.
- The **fast-charging curve** (2025 on) is SoC, time and power every ~4 s,
  roughly 7% to 85%.
- Green NCAP gives no model year. The reference number gives the test year
  (`25-KIA-0229`); VIN position 10 often gives a model year, but European
  makers need not fill it, so it is a matching hint only.

## Decisions (owner, 2026-11-15)

1. **A Green NCAP record per car, plus one BAB130 range test made from it.**
   The record keeps every row as published, linked to a vehicle the way an
   EPA Certification is. The range test is derived from the record and
   rebuilt on re-import; it is never edited by hand.
2. **Charger efficiency: EPA first, then Green NCAP, then the 0.885 assumed.**
   Its basis reads Green NCAP.
3. **Fast-charging curves become charging tests**, source Green NCAP, and join
   composites like any other test.
4. **Matching: a review file, then SQL.** A script proposes a vehicle per
   car; the owner confirms each; SQL runs against the local mirror first.

## To build

In order; each a PR.

1. **Matching review file — built.** `node scripts/matchGreenNcap.mjs` reads
   the manifest (all 77 cars, sheet or not) and `parsed.json`, takes the
   live vehicles (or `--vehicles <file>`), and writes
   `LocalDev/green-ncap/matches.csv`. Each car gets a proposed vehicle,
   matched on brand and model, then ranked by drive, battery (usable within
   5%, else gross) and year (VIN model year, else test year), plus the whole
   trim named in the variant. Each is graded **match**, **check** (the doubt
   is in `reason`) or **none**. In `confirm`, the owner writes `y`, a
   different vehicle id, or `n`; a rerun keeps it. An EU-only pack or trim
   stays `check` or `none` rather than being forced onto a US vehicle.
2. **Migration: the record.** `green_ncap_assessments` (one row per car:
   slug, reference, make/model/variant as printed, test year, VIN, declared
   figures, measured recharged + net capacity, grid to battery, source URLs,
   `vehicle_id` nullable) and `green_ncap_results` (one row per test row:
   key, label, group, temperature, the four consumption/range figures). Read
   by all, written by curators, like `epa_certifications`. Local mirror first.
3. **Import.** Confirmed matches + parsed JSON → upsert by slug. Writes the
   BAB130 range test: `kind 'range'`, `source 'Green NCAP'`, `source_url` the
   car's page, `start_soc 100`, `end_soc 0`, `energy_kwh` the net capacity,
   `distance_miles` the computed range, `temperature_f 73.4`,
   `speed_basis 'mixed'`, `speed_mph 77.6` (the trace average). Being mixed, the composite range leaves it out — it
   is a quoted test, not an aggregated one.
4. **Charger efficiency fallback** in the vehicle figures, with the basis.
5. **DC curves as charging tests**, points from `fastCharging.points`.
6. **Show the record** on the vehicle's page (owner's visual sign-off).

## Open

- **Terms of reuse.** The publication-guidelines page did not render as text
  from a script; the owner reads it before any import goes live.
- **Is 77.6 mph the right `speed_mph`?** It is the target trace's average; a
  real car runs a little slower. The range test should still say "mixed", so
  nothing reads it as a steady 77.6.
- **What a fast-charging test's power is measured at** (charger or port) —
  decides whether it is comparable with the other charging tests.
