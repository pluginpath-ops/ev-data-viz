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
of five current cars lost about twice as much on a single-phase European 230 V socket as on a three-phase wallbox, a
median of 14.2% against 6.9% [[fact:ac-socket-vs-wallbox-adac-2026]]. Both count what goes *into* the battery, while
EPA's figure, and EVBench's, count what comes back *out*, so their levels are not EVBench's; the trend with power is
what carries over. EVBench assumes a 120 V outlet gets **80%** to the pack, for a car that gets 88.5% on 240 V
[[fact:evbench-wall-outlet-charger-eff]]. That was a round figure, picked before anyone looked at the data. The data,
it turns out, does not settle on a better one: depending on the source, it points anywhere from about 76% to 86%.

## Where does the energy go?

Charging from a wall outlet loses energy in a few places, and they do not all scale the same way:

- **The car staying awake.** The charging computer, the contactors that connect the pack, the 12 V system and any
  cooling pump or fan run for the whole session. ADAC puts the control electronics alone at 100 to 300 W
  [[fact:charging-control-electronics-draw]]. This part is roughly fixed in watts, so it is the one that punishes a
  slow charge.
- **The onboard charger.** The car turns the outlet's alternating current into the direct current the battery
  stores. On 120 V it has to draw twice the current for the same power and boost a lower voltage up to the pack's,
  so it should do a little worse than on 240 V [[fact:onboard-charger-light-load]]. "A little" is what was measured:
  Idaho National Laboratory found the Chevrolet Volt's charger 90.6% efficient on 120 V and 91.7% on 208 V, about a
  point apart [[fact:volt-onboard-charger-inl-2012]]. More power is not always better for the charger itself, though:
  each is tuned to a range, and in a Danish test two older cars' chargers did slightly worse at 3.7 kW than at
  2.3 kW [[fact:onboard-charger-loss-dtu-2016]]. The trend with power comes mostly from the fixed draw.
- **The wiring.** Every wire turns some current into heat. The house circuit to a 120 V outlet is usually the thinnest
  wire in the chain; the charging cord adds a little more [[fact:physics-ac-cable-loss-share]].
- **The battery.** At home-charging power it loses little, and a gentle charge usually needs no heating or cooling
  of the pack [[fact:charging-control-electronics-draw]]. That changes in the cold, below.

The fixed draw is the big one, and it is easy to see why with numbers.

## A worked example

Take a car whose electronics draw 210 W while it charges and whose onboard charger loses another 5% of the power,
the figures that best fit ADAC's measurements [[fact:ac-loss-fixed-plus-proportional-fit]]. This is a model, not a
measurement of any one car, and like ADAC it counts energy into the battery, not what the battery gives back.

- On a **120 V, 12 A** outlet, 1.44 kW comes in. The 210 W is about 15% of that, and with the charger's 5% the car
  loses about 20%, so 80% goes into the pack [[fact:physics-fixed-draw-share]].
- On a **240 V, 48 A** charger, 11.5 kW comes in. The same 210 W is under 2%, so the car loses about 7% and 93% goes
  into the pack.

That 80% is not the same 80% EVBench uses, which counts what comes back out of the battery; it only happens to match.
The useful part is the gap between the two lines.

Now add 40 kWh to the battery. The outlet takes about 35 hours, and the electronics burn about 7.3 kWh over that time.
The 240 V charger takes under four hours, and the electronics burn under 1 kWh. Same car, same few hundred watts,
nine times as long [[fact:physics-fixed-draw-share]].

The wiring adds to this, in two parts. Both are arithmetic, for wire lengths and sizes we picked as typical
[[fact:physics-ac-cable-loss-share]]:

- **The house wiring.** Fifty feet of 14-gauge wire, common on a 120 V outlet circuit, loses about 36 W at 12 A, or
  2.5%. Fifty feet of the 6-gauge wire a 48 A charger needs loses about 91 W at 11.5 kW, under 1%. A long or old run
  to a garage outlet can lose more [[fact:charging-control-electronics-draw]].
- **The charging cord** (the EVSE). Twenty feet of 8-gauge cord at 12 A loses under 4 W, about 0.25%, and 6-gauge at
  48 A about 36 W, 0.3%: next to nothing either way. If a portable cord uses lighter wire, say 14-gauge, it is still
  about 1%. Measured whole, with its electronics, INL found a Level 1 EVSE 98% efficient and Level 2 EVSE above 99%
  [[fact:evse-efficiency-inl]], so the box at the end of the cord loses more than the cable does.

So on 120 V the house wiring is worth a couple of points, the EVSE one or two, the onboard charger's lower input
voltage about one, and the fixed draw the rest.

## What do the measurements say?

There is less published data on this than you might think, and the studies differ in method, era and country. Two
differences matter when you read them against EVBench's figures:

- **Where they measure.** Every study here counts the energy that goes into the battery
  [[fact:ac-level1-vs-level2-sears-2014]] [[fact:ac-socket-vs-wallbox-adac-2026]]. EPA's charging figure, the one
  EVBench starts from, is the energy the battery gives back while driving, divided by what came from the wall
  [[fact:epa-charger-efficiency-is-ac]]. The difference is the battery's own loss, heat in the cells going in and coming
  out. On the way in, at home-charging power, it is small: DTU measured a Peugeot iOn's pack at 0.38 Ω, about 7 W of
  heat on a 2.3 kW charge, or 0.3% [[fact:onboard-charger-loss-dtu-2016]]. Cell heat grows with the square of the
  current [[fact:physics-cell-heat-scales-with-current-squared]], so that part barely differs between 120 V and 240 V.
  Most of the battery's loss is spent on the way out, while driving, the same whichever outlet charged it; we have no
  measurement of that. It brings every figure in the table down by some amount on EVBench's basis, but hardly changes
  the slow-against-fast comparison.
- **Phases and voltage.** ADAC's socket is single-phase 230 V; its 4.1 kW, 11 kW and 22 kW charges were all
  three-phase [[fact:ac-socket-vs-wallbox-adac-2026]]. So ADAC's socket-to-wallbox gap mixes power with phase count,
  and a US 240 V charger is single-phase. A US outlet is also 120 V, not 230 V, which probably costs the onboard
  charger a little more [[fact:volt-onboard-charger-inl-2012]]. The first makes ADAC's gap a little too big for the US,
  the second a little too small, and we cannot say which wins.

So compare the trend, slow against fast, more than the levels.

| Study | Slow charging | Faster charging | Slow ÷ faster |
|---|---|---|---|
| Sears et al., 2 Volts and 2 Leafs, Vermont, 2013 | 83.8% (120 V) | 89.4% (240 V) | 0.94 |
| Same, charges under 4 kWh | 74.2% | 87.2% | 0.85 |
| Same, charges of 8 kWh and up (read from its chart) | ~86% | ~88% | ~0.98 |
| ADAC, 5 cars, 2026, median | 85.8% (230 V single-phase, 2.3 kW) | 93.1% (three-phase, 11 kW) | 0.92 |
| ADAC fit, extended to 1.44 kW (model) | 80% | 93% (11.5 kW) | 0.86 |
| Tessie, Tesla owners' app (round figures) | ~70% (120 V) | ~90% (240 V) | 0.78 |

All of these count energy into the battery.

Sources: [[fact:ac-level1-vs-level2-sears-2014]], [[fact:ac-socket-vs-wallbox-adac-2026]],
[[fact:ac-loss-fixed-plus-proportional-fit]], [[fact:tessie-level1-level2-figures]].

The same results on one chart, against the time it takes to draw each kWh from the wall. On that axis the fixed draw
becomes a straight line: its slope is the car's fixed draw, and its height at zero the charger's own share
[[fact:ac-loss-fixed-plus-proportional-fit]].

::: figure outlet-loss

A few things stand out. Every source finds the slower charge loses more. Short charges are hit hardest, because the
car spends a larger part of the session waking up and settling down: under 4 kWh, the 120 V gap in the Vermont study
more than doubled [[fact:ac-level1-vs-level2-sears-2014]]. That is a second cost on top of the fixed draw, paid once per
charge rather than once per hour, and it matters most for top-ups.

The reverse holds too. On the Vermont study's chart, charges of 8 kWh and more cluster near 86% on Level 1 and 88% on
Level 2, a gap of only 2 or 3 points [[fact:ac-level1-vs-level2-sears-2014]]. Its headline gap of 5.6 points comes
mostly from short charges. On a full overnight charge, those 2013 Volts and Leafs lost little more on 120 V than on
240 V, which points to a small fixed draw in those cars. ADAC's current cars behave as if theirs is several times
larger [[fact:ac-loss-fixed-plus-proportional-fit]]. We cannot tell whether that is the cars, or the two studies'
methods. One car can be far worse than the rest: Mercedes' CLA lost
24.2% on ADAC's socket, where the other four lost 12.7 to 15.3%, because its charger takes only 8 A from the socket
[[fact:ac-socket-vs-wallbox-adac-2026]]. And older cars could be much worse again: a 2016 Danish test of three early
EVs measured their chargers alone at 49 to 77% efficient [[fact:onboard-charger-loss-dtu-2016]]. It is left off the
chart because it measures something different: it leaves out the fixed draw, and covers only the slow last 20% of a
charge.

None of these is a US car on a US 120 V outlet measured with today's equipment. The Vermont cars are from 2013, the ADAC
socket gives 2.3 kW at 230 V rather than 1.4 kW at 120 V, and the Tessie figures come with no method at all. That is why EVBench does not
claim a sharper number than a round one.

## What about temperature?

Less is known than you might expect. The Vermont study is the only one here that logged temperature, from 25 to
88 °F [[fact:ac-level1-vs-level2-sears-2014]]:

- **Heat hurt Level 1.** Above 70 °F, Level 1 charges averaged 81.4%, against 83.8% overall.
- **Cool weather did not.** Below 50 °F, Level 1 averaged 83.0%, about the same as overall. Level 2 read slightly
  higher, 90.6%, which is why the abstract says the gap grew in the cold.
- **Level 2 did not change** with temperature anywhere in that range.
- **Real cold is untested.** There were too few charges below 40 °F to say anything, though the lowest single Level 1
  results on its chart, down to about 49%, sit in that colder range.

Physics says a cold battery should cost more: it may need warming before it will take a full charge, and on a slow
outlet that heat comes out of the same 1.4 kW. The Vermont data neither confirms nor rules that out. ADAC kept its
batteries at 20 to 30 °C to leave it out [[fact:ac-socket-vs-wallbox-adac-2026]]. Cost & Time warns about warming the
battery in winter, from the owner's experience rather than a measurement; the
[heating and cooling explainer](heating-cooling-and-range) covers the driving side.

## Does three-phase do better?

In Europe, Australia and New Zealand, a home wallbox can use three-phase power, and every ADAC charge but the socket
was three-phase [[fact:ac-socket-vs-wallbox-adac-2026]]. It is very likely a little more efficient, for two reasons.
In the wiring, three phases at the same power over the same wire lose about a sixth of what a single phase does,
because each wire carries a third of the current [[fact:physics-three-phase-cable-loss]]; but a proper 240 V circuit
already loses under 1%, so that is a fraction of a point. Inside the car, three-phase power flows steadily instead of
pulsing twice a cycle, which eases the charger's work, though many chargers simply run three single-phase stages at a
third of the power each [[fact:onboard-charger-three-phase-designs]]. DTU explains its Renault Zoe the same way: on
three phases at 400 V the charger steps the voltage down to the pack, while on one phase at 230 V it loses more in
the rectifier and has to boost it up. Its Zoe was 49% efficient on a single-phase 2.3 kW charge and 63 to 65% on
three-phase 11 to 43 kW [[fact:onboard-charger-loss-dtu-2016]], though power changed along with the phases. The same
reasoning says 240 V should beat 120 V a little [[fact:onboard-charger-light-load]]. We have still found no
measurement of one car at the same power on one phase and on three.

What ADAC's figures do show is that power matters more than phase count. At 4.1 kW, three-phase like the wallbox,
its cars still lost 8.0 to 12.8%, against 5.1 to 7.0% at 11 kW [[fact:ac-socket-vs-wallbox-adac-2026]]. Same phases,
less power, more loss: that is the fixed draw again.

## What does EVBench do with it?

The 240 V figure comes first. EPA measures a car's charging loss on a Level 2 recharge and puts it into the label
[[fact:epa-mpge-at-the-wall]]; where a car's certification lets us derive it, EVBench uses that, and where it does not,
the 2025 median of 88.5% [[fact:epa-charger-efficiency-is-ac]].

For a 120 V outlet, Cost & Time › Home Charger makes two assumptions [[fact:evbench-wall-outlet-charger-eff]]:

- **A car at 88.5% on 240 V gets 80% on 120 V.** This was a round figure, chosen when Cost & Time was built, with no
  measurement behind it.
- **Every car scales the same way.** A car's own 240 V figure is multiplied by 0.80 ÷ 0.885, about 0.90, so a car EPA
  measured at 91% gets about 82%. The thinking was that the same charger and battery do the work on either outlet.

What does the evidence say about the first? Because the studies measure into the battery and EVBench out of it, the
fair use of them is as ratios, slow over fast, applied to 88.5%. That way the Vermont study's full-size charges give
86% and all its charges 83%, ADAC's socket against its wallbox 82%, and ADAC's fit extended to a US outlet's 1.44 kW
76%; Tessie's round figures give about 70%.
If a slow charge loses a little less inside the battery, each of these is a touch low on EVBench's basis. The two
direct measurements sit above 80%, but neither is a current car on a US 120 V outlet, and half the Vermont cars were
Volts, whose Level 2 tops out at 3.3 kW [[fact:volt-onboard-charger-inl-2012]], which narrows their gap. The one that tries to
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
- How much a 120 V input lowers a current car's onboard charger efficiency. The one measurement is a 2012 Volt, about
  a point, and it changes power and voltage together.
- Whether three-phase charging beats single-phase at the same power, inside the car. DTU's Zoe suggests it does, with
  power changing too.
- The battery's loss on the way out, while driving. On the way in it is small (0.3% on one older car); every study
  here measured in, and EPA measures out.
- How much real cold adds on a 120 V outlet. The one study that logged temperature had too few charges below 40 °F;
  above 70 °F, Level 1 lost more.

::: held
Owner: code left alone (steer 2026-11-12: change it only if the evidence supports a value). The evidence spans
76–86% for a car at 88.5% (Tessie lower), and splits by era: 2013 Volts and Leafs on full charges near 86%, ADAC's
current cars extended to 120 V near 76% and does not pick a better value than 0.80; the per-car scaling neither
helps nor hurts on ADAC's five cars. Worth having: an
EVBench test on a 120 V outlet with a wall meter and the car's own added-energy figure, warm and cold, which would
replace the extended ADAC fit. The Sears et al. and DTU papers were read in full from the owner's copies (LocalDev/explainers/Reference Docs/). The temperature question was asked of the owner; the Vermont study is the only
logged data found.
:::

::: engineers
Model the loss on an AC charge as a fixed draw plus a share of the power. With P the power at the wall, P₀ the fixed
draw (electronics, pumps, contactors) and k the proportional loss (onboard charger conversion, wiring, battery):

    η(P) = 1 − P₀ / P − k

Through ADAC's medians, (2.3 kW, 14.2%) and (11 kW, 6.9%), P₀ ≈ 0.212 kW and k ≈ 0.050. It predicts 10.1% at 4.1 kW
against a measured 9.4%, then η(1.44) ≈ 0.803 and η(11.52) ≈ 0.932 [[fact:ac-loss-fixed-plus-proportional-fit]].
Caveats: η here is wall to battery input, where EPA's is wall to battery output, so the battery's own loss sits outside
it; the 2.3 kW point is single-phase and the others three-phase, so k absorbs any three-phase gain; k is likely higher
at 120 V input than at 230 V; and ADAC's 10–90% window leaves out balancing near full, which EPA's recharge includes.

Cable loss as a share of power is I²R ÷ (V·I) = I·R ÷ V, with R the resistance out and back. House wiring, 50 ft: 14
AWG (R ≈ 0.25 Ω) at 12 A and 120 V is 2.5%; 6 AWG (R ≈ 0.04 Ω) at 48 A and 240 V is 0.8%. EVSE cord, 20 ft: 8 AWG
(R ≈ 0.025 Ω) at 12 A is 0.25%, 14 AWG (R ≈ 0.10 Ω) 1.0%; 6 AWG (R ≈ 0.016 Ω) at 48 A is 0.3%
[[fact:physics-ac-cable-loss-share]]. Balanced three-phase at the same power and wire size: each of three conductors
carries I/3, so the loss is 3·(I/3)²R = I²R/3 against 2·I²R for a single phase, a sixth
[[fact:physics-three-phase-cable-loss]].

EVBench's home efficiency on 120 V is η_home = η_240 × η_outlet ÷ η_site, with η_outlet = `WALL_OUTLET_CHARGER_EFF`
(0.80, `src/constants/costToDrive.js`) and η_site = `ASSUMED_CHARGER_EFF` (0.885, `src/constants/epa.js`), in
`costToDriveVehicle` (`src/utils/costToDrive.js`) [[fact:evbench-wall-outlet-charger-eff]]. A ratio rather than a fixed
gap: across the real range of η_240 they differ by under half a point. On ADAC's five cars, predicting the socket
efficiency from the wallbox one as η_w × 0.922 (the median ratio), as η_w − 0.073 (the median gap), or as a flat 0.858
gives mean absolute errors of 2.62, 2.64 and 2.62 points [[fact:adac-per-car-scaling-check]].
:::
