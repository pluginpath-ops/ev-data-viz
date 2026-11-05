---
slug: dc-fast-charging-loss
title: How much energy does DC fast charging lose?
related: [epa-battery-figures, epa-test-procedures, 400v-vs-800v, epa-vs-real-world]
linked_from: [Cost/100 mi, fast column, DC fast charging loss knob in Admin → Model Constants]
status: DRAFT
---

## The short version

The efficiency on a window sticker is measured on a 240 V Level 2 charger. EPA recharges the car and counts every
kWh that goes in, losses included [[fact:epa-mpge-at-the-wall]]. That is exactly what you pay for at home, so it is
the right number for a home cost. It is the wrong one for a fast-charging stop. A DC fast charger sends direct
current to the car's port, which bypasses the car's own onboard charger, so the loss EPA measured is not the loss a
fast charge pays. That loss, from the outlet to the pack's output, has a median of about 11.5% across the 174 model
year 2025 certification records we could derive it from, with the middle half between 10.6% and 12.8%
[[fact:epa-charger-efficiency-is-ac]].

A fast charge still loses energy, just somewhere else and in a different amount. The charger's own conversion
is the first place, but it is on the station's side of the meter, and you are billed for what the charger delivers,
not what it drew from the grid [[fact:dc-fast-billing-at-the-port]]. What is left is the car: cooling the pack,
heating it, running the pumps and electronics while it charges, and the small share of every charge that the
battery itself turns into heat. EVBench assumes a DC fast session loses **9%** of the energy you are billed for
between the port and the pack's output, and uses that, and nothing about AC, to price the Cost/100 mi, fast column.
This page is how we got to 9%, and how little it can tell you about any one car.

## Where does the energy go?

Some of it is easy to find, and one part is not.

- **The station.** In ADAC's 2026 test of fast charging, the chargers' own conversion lost about 3%
  [[fact:dc-fast-station-conversion-loss]]. You do not pay for it.
- **The car's cooling, heating and electronics.** This is what the car spends getting energy to the battery.
  ADAC measured 1 to 6% with the pack preconditioned and 6 to 10% in a 0 °C test where it was not
  [[fact:dc-fast-car-side-loss]]. A single Model 3 on a slow charger lost about 10% from 7% to 57%, most of it
  while the thermal system worked below 20% [[fact:dc-fast-model3-station-vs-car]], and two Rivian R1S videos show
  2 to 3% [[fact:dc-fast-single-video-readings]]. Some cars report the split themselves, Rivian and BMW among them
  [[fact:car-reports-charging-energy-breakdown]].
- **The battery itself.** Current through the cells makes resistive heat, on the way in and again on the way out
  [[fact:physics-cell-heat-scales-with-current-squared]]. None of the measurements above stop to count it, and we did not find a published one that does for a whole pack at fast-charging
  rates. It is a real part of the cost, because the energy you can later drive on is what comes out of the pack, not
  what went into it.

That last part is why a measurement at the battery undercounts, and why EVBench does not stop there.

## How did we measure it?

The cleanest way to count all of it at once is to charge a car, then drive it back to where it started, and compare.
Out of Spec Testing's "10% challenge" videos do exactly that: charge for 15 minutes from about 10%, then drive until
the state of charge falls back to 10%. The pack holds the same energy at both ends, so whatever the charger put in
and the trip meter did not get back was lost on the way, between the port and the pack's output (the direct current
the inverter draws). That is the same stretch EPA's DC ÷ AC ratio covers for an AC recharge, so the two are comparable
[[fact:epa-charger-efficiency-is-ac]]. It also includes the preconditioning a car does on its way to a charger, which a
measurement at the charger would miss [[fact:dc-fast-round-trip-pairs]].

| Car | Charger added | Drive used | Lost |
|---|---|---|---|
| Audi e-tron (2019) | 35.4 kWh | 33.3 kWh | 6.0% |
| Kia EV6 | 48.8 kWh | 45.6 kWh | 6.6% |
| Rivian R1S (Gen 1) | 44.9 kWh | 41.4 kWh | 7.7% |
| Volkswagen ID.4 | 26.2 kWh | 24.0 kWh | 8.4% |
| Rivian R1T (max pack) | 47.2 kWh | 42.8 kWh | 9.3% |
| BMW iX3 50 | 64.3 kWh | 57.6 kWh | 10.4% |
| Porsche Cayenne Electric | 80.3 kWh | 71.0 kWh | 11.6% |
| Rivian R1T (large pack) | 49.6 kWh | 43.6 kWh | 12.0% |
| Rivian R2 | 48.1 kWh | 42.0 kWh | 12.7% |

Nine tests, 6.0 to 12.7% lost, a mean of 9.4% and a median of 9.3% [[fact:dc-fast-round-trip-pairs]]. A full 0 to 100%
charge and drive-down in a pair of other videos agrees, at about 8.7% [[fact:dc-fast-single-video-readings]]. These
figures are the owner's reading of each video; the drive's consumption is the car's trip-meter or mi/kWh readout, so
each is good to a few percent at best, and the Rivian R2's displayed figure rounds to a whole kWh. They are context
for a decision, not a calibration.

## Why one number for every car?

Because the spread is bigger than anything we can explain from what the videos record. Rivian alone runs from 7.7%
to 12.7%, and the two R1Ts, whose readings are tight, differ by almost three points. The Cayenne held 350 kW for much of its
session and lost 11.6%, between two Rivians, which is not what a story about power alone would predict. What the videos
do not log, the ambient temperature, the starting state of charge and the charger's actual power curve, are things that
could move a car's thermal load, so we cannot separate "this car loses more" from "that was a colder day"
[[fact:dc-fast-round-trip-pairs]]. Rather than fit a value to each platform from nine unlogged videos, EVBench uses
one for all of them: 9%, the round number at the centre. It is a knob in Admin → Model Constants, so it can move.

A 15-minute stop starting from low charge may also be the hard case, with the heating a stop needs paid up front, so a
longer stop, 10 to 80%, could lose a smaller share. That is a guess; we have not seen the data that would show it. The test that would answer it is a 10 to 80% charge with a range test of the same car
alongside, comparing what was added to about 70% of the range it drove.

## What does the table do with it?

The Cost/100 mi, fast column does three things. It starts from the label's efficiency, which is measured on a Level 2 charger. It
takes the AC charging loss back out, using the certification's own measured figure where EPA recorded one and an assumed
88.5%, the median above, where it did not [[fact:epa-charger-efficiency-is-ac]]. It then adds the 9% that a fast session loses [[fact:dc-fast-round-trip-pairs]], and prices that at the fast-charging price you set. As a
worked example (arithmetic, not a measurement): a car whose label says 3.0 miles per kWh on a Level 2 charger would need
3.0 ÷ 0.885 = 3.39 miles per kWh at the pack, and about 3.08 miles per kWh at the port after a 9% loss. At 50¢ per kWh
that is $16.21 per 100 miles. The old basis, which carried the AC loss into a DC session, said $16.67. The home figure
is unchanged: a home charger does run the onboard charger, and its loss is the one EPA measured.

## What we could not establish

- A measured figure for the pack's own loss at fast-charging rates. The round trip includes it, but does not split it
  from the rest.
- Any pattern by maker or by platform, for the reasons above.
- A figure for a typical stop. Every test here is a 15-minute stop from low charge, with the temperature unrecorded.
- Whether the videos' figures carry readout errors we cannot see. Each was read by hand from the footage.

::: held
Owner: looking for 10–80% charging tests with a reliable paired (same-vehicle) range test, to compare the energy
added to 70% of the range driven. When some turn up, add them to `dc-fast-round-trip-pairs` and see whether the
mean moves. Also open: a per-vehicle value where a pair exists (not built; this page argues against fitting
platforms from unlogged videos), and the INL AVTA DC-charger efficiency tests, which the research could not read.
:::

::: engineers
Let η_label be the label's efficiency on a Level 2 charger (mi/kWh), η_AC the AC charging efficiency (the cert's total DC energy ÷
AC recharge energy where measured or pinned, else the assumed 0.885 [[fact:epa-charger-efficiency-is-ac]]), L the DC
fast charging loss, and p the DC fast price (per kWh). With no label, the battery-side efficiency η_b is range ÷
battery instead.

    η_b      = η_label / η_AC
    cost/100 = 100 · p / (η_b · (1 − L))

The home column stays on the label's basis, cost/100 = 100 · p / η_label. L is the fraction of the billed energy lost between
the port and the pack's DC output. For a paired test with energy E_added at the charger and E_used on the drive, ending
at the SoC it started from, L = 1 − E_used / E_added. A mi/kWh readout read to ±0.05 at about 2.5 mi/kWh moves
E_used by about 2%; the SoC threshold's 1% resolution moves it by a further 1 to 1.5 kWh on a 25 to 30 kWh charge. The code is
`calc.costPer100Fast` in `src/utils/vehicleTable.js`, the default is `DC_FAST_LOSS` in `src/constants/epa.js`, and the
knob is in Admin → Model Constants.
:::
