---
slug: wall-outlet-charging-loss
title: Why does a 120 V wall outlet lose more?
related: [dc-fast-charging-loss, epa-battery-figures, epa-test-procedures, heating-cooling-and-range]
linked_from: [Cost & Time › Home Charger footnote, Your Driving's charging-losses line]
status: DRAFT
---

## The short version

Plug a car into an ordinary 120 V wall outlet, Level 1 charging, and less of what you pay for ends up in the battery
than on a 240 V Level 2 charger. The reason is mostly not the outlet itself. While a car charges, it keeps its
charging computer, contactors, pumps and other electronics awake, and those draw about the same few hundred watts
whether 1.4 kW or 11 kW is flowing in [[fact:charging-control-electronics-draw]]. On a slow outlet that draw is a
bigger share of the power, and it runs for many more hours.

The measurements agree on the direction, and less on the size. A 2013 study of four cars in Vermont found Level 1
put 83.8% of the energy into the battery and Level 2 89.4% [[fact:ac-level1-vs-level2-sears-2014]]. ADAC's 2026 test
of five current cars on a European 230 V socket lost about twice as much as on a wallbox, a median of 14.2% against
6.9% [[fact:ac-socket-vs-wallbox-adac-2026]]. EVBench assumes a 120 V outlet gets **80%** to the pack, for a car that
gets 88.5% on 240 V [[fact:evbench-wall-outlet-charger-eff]]. That was a round figure, picked before anyone looked at
the data. The data, it turns out, does not settle on a better one: depending on the source, it points anywhere from
about 76% to 83%.

## Where does the energy go?

Charging from a wall outlet loses energy in a few places, and they do not all scale the same way:

- **The car staying awake.** The charging computer, the contactors that connect the pack, the 12 V system and any
  cooling pump or fan run for the whole session. ADAC puts the control electronics alone at 100 to 300 W
  [[fact:charging-control-electronics-draw]]. This part is roughly fixed in watts, so it is the one that punishes a
  slow charge.
- **The onboard charger.** The car turns the outlet's alternating current into the direct current the battery
  stores. Like most power electronics, it is least efficient far below its rated power, and on 120 V it draws more
  current for the same power than on 240 V [[fact:onboard-charger-light-load]]. A Level 1 charge does both at once.
- **The wiring.** Every wire turns some current into heat, and a thin 120 V branch circuit loses a bigger share than
  a heavy 240 V one built for a charger [[fact:physics-ac-cable-loss-share]].
- **The battery.** At home-charging power it loses little, and a gentle charge usually needs no heating or cooling
  of the pack [[fact:charging-control-electronics-draw]]. That changes in the cold, below.

The fixed draw is the big one, and it is easy to see why with numbers.

## A worked example

Take a car whose electronics draw 210 W while it charges and whose onboard charger loses another 5% of the power,
the figures that best fit ADAC's measurements [[fact:ac-loss-fixed-plus-proportional-fit]]. This is a model, not a
measurement of any one car.

- On a **120 V, 12 A** outlet, 1.44 kW comes in. The 210 W is about 15% of that, and with the charger's 5% the car
  loses about 20%, so 80% reaches the pack [[fact:physics-fixed-draw-share]].
- On a **240 V, 48 A** charger, 11.5 kW comes in. The same 210 W is under 2%, so the car loses about 7% and 93% reaches
  the pack.

Now add 40 kWh to the battery. The outlet takes about 35 hours, and the electronics burn about 7.3 kWh over that time.
The 240 V charger takes under four hours, and the electronics burn under 1 kWh. Same car, same few hundred watts,
nine times as long [[fact:physics-fixed-draw-share]].

The wiring adds to this. Fifty feet of the 14-gauge wire a 120 V outlet circuit often uses loses about 2.5% at 12 A;
fifty feet of the 6-gauge wire a 48 A charger needs loses under 1% [[fact:physics-ac-cable-loss-share]]. A long or
old run to a garage outlet can lose more [[fact:charging-control-electronics-draw]].

## What do the measurements say?

There is less published data on this than you might think, and the studies differ in method, era and country.

| Study | Slow charging | Faster charging | Slow ÷ faster |
|---|---|---|---|
| Sears et al., 4 cars, Vermont, 2013 | 83.8% (120 V) | 89.4% (240 V) | 0.94 |
| Same, charges under 4 kWh | 74.2% | 87.2% | 0.85 |
| ADAC, 5 cars, 2026, median | 85.8% (230 V, 2.3 kW) | 93.1% (11 kW) | 0.92 |
| ADAC fit, extended to 1.44 kW (model) | 80% | 93% (11.5 kW) | 0.86 |
| Tessie, Tesla owners' app (round figures) | ~70% (120 V) | ~90% (240 V) | 0.78 |

Sources: [[fact:ac-level1-vs-level2-sears-2014]], [[fact:ac-socket-vs-wallbox-adac-2026]],
[[fact:ac-loss-fixed-plus-proportional-fit]], [[fact:tessie-level1-level2-figures]].

A few things stand out. Every source finds the slower charge loses more. Short charges are hit hardest, because the
car spends a larger part of the session waking up and settling down: under 4 kWh, the 120 V gap in the Vermont study
more than doubled [[fact:ac-level1-vs-level2-sears-2014]]. One car can be far worse than the rest: Mercedes' CLA lost
24.2% on ADAC's socket, where the other four lost 12.7 to 15.3%, because its charger takes only 8 A from the socket
[[fact:ac-socket-vs-wallbox-adac-2026]]. And older cars could be much worse again: a 2016 Danish test of three early
EVs found onboard-charger losses of 15 to 40% [[fact:onboard-charger-loss-dtu-2016]].

None of these is a US car on a US 120 V outlet measured with today's equipment. The Vermont cars are from 2013, the ADAC
socket gives 2.3 kW rather than 1.4 kW, and the Tessie figures come with no method at all. That is why EVBench does not
claim a sharper number than a round one.

## Cold makes it worse

In the Vermont study, Level 2's advantage grew below 50 °F [[fact:ac-level1-vs-level2-sears-2014]]. A cold battery
needs warming before it will take a full charge, and that heat comes off the same 1.4 kW. On a slow outlet, the
heater can take a large part of the power for a long time. ADAC kept its batteries at 20 to 30 °C to leave this out
[[fact:ac-socket-vs-wallbox-adac-2026]], so its figures are a warm-weather best case. Cost & Time says so where it
warns about warming the battery in winter; the [heating and cooling explainer](heating-cooling-and-range) covers the
driving side.

## What does EVBench do with it?

The 240 V figure comes first. EPA measures a car's charging loss on a Level 2 recharge and puts it into the label
[[fact:epa-mpge-at-the-wall]]; where a car's certification lets us derive it, EVBench uses that, and where it does not,
the 2025 median of 88.5% [[fact:epa-charger-efficiency-is-ac]].

For a 120 V outlet, Cost & Time › Home Charger makes two assumptions [[fact:evbench-wall-outlet-charger-eff]]:

- **A car at 88.5% on 240 V gets 80% on 120 V.** This was a round figure, chosen when Cost & Time was built, with no
  measurement behind it.
- **Every car scales the same way.** A car's own 240 V figure is multiplied by 0.80 ÷ 0.885, about 0.90, so a car EPA
  measured at 91% gets about 82%. The thinking was that the same charger and battery do the work on either outlet.

What does the evidence say about the first? Applied to 88.5%, the Vermont ratio gives 83%, ADAC's socket against its
wallbox 82%, and ADAC's fit extended to a US outlet's 1.44 kW 76%; Tessie's round figures give about 70%. The two
direct measurements sit a little above 80%, but neither is a current car on a US 120 V outlet. The one that tries to
account for the lower power, the fit, sits below it, and it is a model. So 80% is not contradicted, but it is not
confirmed either. It is the round figure EVBench started with, and the evidence does not point to a better one.

And the second? ADAC's five cars let us test it: if a car's wallbox figure told you its socket figure, scaling would
beat a single number for every car. It doesn't. Scaling by a ratio, subtracting a fixed gap, and ignoring the car
altogether all miss by an average of 2.6 points, and all three miss the Mercedes CLA by 10
[[fact:adac-per-car-scaling-check]]. The cars' wallbox figures span only 5.1 to 7.0%, while their socket figures span
12.7 to 24.2%: what sets the slow-charge loss is mostly the car's own fixed draw and how its charger copes at low
power, and the 240 V figure barely shows either. Five cars is a small test, and the scaling does no harm, but it adds
no accuracy we can show.

What would settle both is the measurement nobody has published: current cars on a US 120 V outlet, metered at the
wall, alongside the same cars on 240 V, warm and cold.

## What we could not establish

- A measurement of current cars on a US 120 V outlet, logged at the wall and at the pack. The best US study is from
  2013.
- Each car's own fixed draw while charging. It is the biggest part of the 120 V loss and almost no maker publishes it.
- Whether a car's 240 V figure predicts its 120 V figure at all. Five cars say not much.
- How much a 120 V input, rather than ADAC's 230 V, lowers the onboard charger's own efficiency.
- How much winter adds on a 120 V outlet. The one study that looked at temperature only says the gap grows.

::: held
Owner: code left alone (steer 2026-11-12: change it only if the evidence supports a value). The evidence spans
76–83% for a car at 88.5% (Tessie lower) and does not pick a better value than 0.80; the per-car scaling neither
helps nor hurts on ADAC's five cars. Worth having: an
EVBench test on a 120 V outlet with a wall meter and the car's own added-energy figure, warm and cold, which would
replace the extended ADAC fit. The full Sears et al. paper (IEEE, paywalled) and the DTU paper (behind a bot check)
were read only as abstracts.
:::

::: engineers
Model the loss on an AC charge as a fixed draw plus a share of the power. With P the power at the wall, P₀ the fixed
draw (electronics, pumps, contactors) and k the proportional loss (onboard charger conversion, wiring, battery):

    η(P) = 1 − P₀ / P − k

Through ADAC's medians, (2.3 kW, 14.2%) and (11 kW, 6.9%), P₀ ≈ 0.212 kW and k ≈ 0.050. It predicts 10.1% at 4.1 kW
against a measured 9.4%, then η(1.44) ≈ 0.803 and η(11.52) ≈ 0.932 [[fact:ac-loss-fixed-plus-proportional-fit]]. Two
caveats: k is likely higher at 120 V input than at 230 V, and ADAC's 10–90% window leaves out balancing near full,
which EPA's recharge includes.

Cable loss as a share of power is I²R ÷ (V·I) = I·R ÷ V. For 50 ft of 14 AWG out and back (R ≈ 0.25 Ω) at 12 A and
120 V, that is 2.5%; for 6 AWG (R ≈ 0.04 Ω) at 48 A and 240 V, 0.8% [[fact:physics-ac-cable-loss-share]].

EVBench's home efficiency on 120 V is η_home = η_240 × η_outlet ÷ η_site, with η_outlet = `WALL_OUTLET_CHARGER_EFF`
(0.80, `src/constants/costToDrive.js`) and η_site = `ASSUMED_CHARGER_EFF` (0.885, `src/constants/epa.js`), in
`costToDriveVehicle` (`src/utils/costToDrive.js`) [[fact:evbench-wall-outlet-charger-eff]]. A ratio rather than a fixed
gap: across the real range of η_240 they differ by under half a point. On ADAC's five cars, predicting the socket
efficiency from the wallbox one as η_w × 0.922 (the median ratio), as η_w − 0.073 (the median gap), or as a flat 0.858
gives mean absolute errors of 2.62, 2.64 and 2.62 points [[fact:adac-per-car-scaling-check]].
:::
