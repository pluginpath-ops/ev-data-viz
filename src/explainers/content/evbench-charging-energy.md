---
slug: evbench-charging-energy
title: How does EVBench calculate charging energy consumption?
related: [charging-speed-and-energy, dc-fast-charging-loss, epa-battery-figures, heating-cooling-and-range]
linked_from: [Cost & Time › Charging Speeds footnote, Your Driving's charging-losses line]
status: DRAFT
---

## The short version

To calculate home charging times and costs, EVBench needs to know how much of the energy from the wall the vehicle can use to drive. EVBench calls this the charger efficiency, though it includes losses from other systems. EVBench works it out in two steps
[[fact:evbench-charging-loss-by-rate]]:

- **Start from EPA's figure.** EPA measures each car's charging on a Level 2 charger [[fact:epa-mpge-at-the-wall]].
  EVBench uses that figure for the car's fastest AC charging.
- **Add a fixed draw for a slower charge.** For each extra hour the charge takes, EVBench adds 200 W. That is the car running electronics and pumps while it charges.

In the cold, EVBench adds a second cost for warming the battery, scaled by battery size and temperature. For now, this is a rough guess, erring on the low side, as we have yet to find a reliable metric across vehicles and temperatures [[fact:evbench-battery-warming]].

The physics and logic of why slower charging takes more energy is on its own page:
[how charging speed impacts energy consumption](charging-speed-and-energy).

## How does the calculation work?

**Step 1: Estimate the chargeing efficiency** [[fact:evbench-charging-loss-by-rate]].

- EVBench starts from the car's own EPA chargeing efficiency. If a car has none, EVBench uses 88.5%, the median of
  2025's EPA certifications [[fact:epa-charger-efficiency-is-ac]].
- That figure applies at the car's fastest home charging: its onboard charger's maximum. If we don't know the
  maximum, EVBench uses 11.5 kW.
- Below that rate, a fixed 200 W is added for the marginal increase in charging time.

For our median car (88.5% at 48 A, or 11.5 kW), adding 10 kWh to the battery:

| Power | Charger | Charger efficiency | Energy from the wall | Time |
|---|---|---|---|---|
| 11.5kW | 240 V, 48 A | 88.5% | 11.3 kWh | 1.0 hrs |
| 5.8kW | 240 V, 24 A | 86.8% | 11.5 kWh | 2.0 hrs |
| 1.4kW | 120 V, 12 A | 76.3% | 13.1 kWh | 9.1 hrs |

A charger faster than the car's own makes no difference - time and efficiency is capped by the maximum charging speed of the vehicle.

**Step 2: battery warming below 40 °F** [[fact:evbench-battery-warming]]. EVBench adds energy to each night's charge.
The amount grows with the usable pack and with how far below 40 °F it is: 4 kWh for a 100 kWh pack at 20 °F. That
energy also goes through the charger, as heating is typically on the battery side of the electrical systems. It pays only
the charger's conversion loss, though, not the fixed draw: the pumps and electronics end up as heat in the car, which is
what warming wants.
It runs first, at the charger's power, so it uses up part of the night: a home charger can only deliver so much while
you are plugged in, and on a 120 V outlet in hard cold the warming can take most of it [[fact:evbench-battery-warming]].
A cold car warms its battery for a fast charge too, so the day's first fast stop pays for the same amount, at the fast
price. The actual heating rate is a guess, loosely based on several winter charging essions on the owner's R1T, extrapolated to 
every car. The [heating and cooling explainer](heating-cooling-and-range) covers the driving side.


## What does the rule leave out?

The charging losses are simplified to one factor: *time*. 

It leaves out three smaller things:

- **The voltage.** Most onboard chargers lose 2 to 3 points more on 120 V than on 240 V at the same power (but not all)
  [[fact:onboard-charger-light-load]].
- **A "startup" penalty per charge.** On current cars it looks small [[fact:ac-socket-vs-wallbox-adac-2022]].
- **A different static load for each car.** EVBench uses a fixed 200 W for all vehicles.

### Why one draw for every car?

A load for each car would be better, if we knew them. Measured cars can vary widely:

- **ADAC's nine current cars:** 134 W for the 2022 VW ID.3 up to 503 W for the Mercedes CLA, with a median of 218 W
  [[fact:adac-per-car-fixed-draw-fit]].
- **Older cars draw less.** The Vermont study's 2013 Volts and Leafs suggest about 120 W
  [[fact:adac-rate-rule-tested]]. Argonne's figures give about 150 W for a 2017 Bolt and 80 W for a 2012 Leaf, but
  218 W for a 2014 BMW i3 [[fact:anl-charging-loss-fits-2020]]. Those include the charger's own loss at no load, so
  the real draw is a little lower.
- **The owner's R1T:** about 150 W, measured after the charger [[fact:r1t-charging-systems-draw-roamer]], with the effective load being a few percent more due to AC-DC converter losses.

200 W was chosen as a fixed estimate.  It matches the i3 test, is close to the Bolt and R1T, and fits ADAC's data as well as any single value, missing by 2.0 points on average.  While 215 W is most precise (misses by 1.96), it is clearly over-fitting to limited data [[fact:adac-rate-rule-tested]].

### Why not estimate each car's draw from its EPA figure?

We tried, and it doesn't work - there's no way to separate the various loads. At full power, most of a car's
loss is its charger's conversion, which tells you little about its draw. The ID.3 lost the most of ADAC's cars at
11 kW, but it has the smallest draw (flattest line) [[fact:adac-per-car-fixed-draw-fit]].

This fixed value means errors grow at extreme slow rates. For a car that can take
11.5 kW, ADAC's spread of cars puts the error at about 0.5 to 2 points on 240 V at 32 A. On a 120 V outlet, it is about
8 to 30 points [[fact:adac-per-car-fixed-draw-fit]]. So on a wall outlet, treat EVBench's figure as typical, but
expect your own car to differ, perhaps by a lot.

## How well does it fit?

Controlled studies are hard to find, and the ones we have differ in method, era and country. All of these count
energy into the battery (as opposed to what we use, energy *out*):

| Study | Slow charging | Faster charging | Slow ÷ faster |
|---|---|---|---|
| Sears et al., 2 Volts and 2 Leafs, Vermont, 2013 | 83.8% (120 V) | 89.4% (240 V) | 0.94 |
| Sears et al., charges under 4 kWh | 74.2% | 87.2% | 0.85 |
| Sears et al., charges of 8 kWh and up (read from its chart) | ~86% | ~88% | ~0.98 |
| ADAC, 4 cars, 2022, median | 85.6% (230 V single-phase, 2.3 kW) | 91.7% (three-phase, 11 kW) | 0.93 |
| ADAC, 5 cars, 2026, median | 85.8% (230 V single-phase, 2.3 kW) | 93.1% (three-phase, 11 kW) | 0.92 |
| DTU, Nissan Leaf, 2016 | 85% (230 V, 2.3 kW) | 90% (230 V, 3.7 kW) | 0.94 |
| DTU, Peugeot iOn | 70% | 69% | 1.01 |
| Argonne, 2017 Chevrolet Bolt, 2020 | 85.4% (120 V, 1.44 kW) | 92.7% (240 V, 7.2 kW) | 0.92 |
| Argonne, 2014 BMW i3 | 77.2% (208 V, 1.2 kW) | 89.8% (208 V, 6 kW) | 0.86 |
| Argonne, 2012 Nissan Leaf | 81.5% (208 V, 1.25 kW) | 85.8% (208 V, 3.77 kW) | 0.95 |

Sources: [[fact:ac-level1-vs-level2-sears-2014]], [[fact:ac-socket-vs-wallbox-adac-2022]],
[[fact:ac-socket-vs-wallbox-adac-2026]], [[fact:dtu-2016-car-reported-efficiency]],
[[fact:anl-charging-loss-fits-2020]].

The charts below show each study against the time it takes to draw 1 kWh from the wall. The further left, the faster the charging. 
On this scale, a fixed draw (our 200W) creates a straight, increasing line. 
For each vehicle, a line is drawn from the fastest charge, using the 200W rule for visual comparison to the measured data.
[[fact:adac-rate-rule-tested]]. If a car's results sit on its line, the rule predicts it well.

::: figure outlet-loss

Here's what the charts show:

- **Most modern EVs sit close to their lines (by design).** One fixed draw, plus each car's own fast result, predicts its
  slower charges to about 2 points on average [[fact:adac-rate-rule-tested]].
- **Two cars are much less efficient.** The Mercedes CLA lost 24.2% on the socket. The 2022 Renault Zoe lost the same [[fact:ac-socket-vs-wallbox-adac-2026]]
  [[fact:ac-socket-vs-wallbox-adac-2022]]. Those cars draw two to two and a half times the rule's 200 W
  [[fact:adac-per-car-fixed-draw-fit]].
- **Older GM and Nissan cars are more efficient.** The Vermont Volts and Leafs, on full-size charges, sit well below
  the line [[fact:ac-level1-vs-level2-sears-2014]]. So do Argonne's 2017 Bolt and 2012 Leaf, by about 4 and 6 points
  at their slowest. The 2014 i3 sits right on its line [[fact:anl-charging-loss-fits-2020]].
- **INL's charger-only figures sit below all the lines,** as they should. They leave out the car's own draw, which
  the rule adds [[fact:inl-steady-state-volt-2012]] [[fact:inl-steady-state-i3-2014]].

Unfortunately, none of the quality data found to date is a current car on a US 120 V outlet. ADAC's slowest charge is 2.3 kW at 230 V, against 1.44 kW at
120 V, and the newest car measured on 120 V is the 2017 Bolt. So EVBench's 120 V figures carry the lines a little
past the data.

## Checks against other measurements

We didn't use these to set the rule. We use them to check it:

- **Car and Driver's long-term Model 3:** 95% on 240 V, and at best 85% on 120 V
  [[fact:car-and-driver-model-3-level1-level2-2021]]. Starting from 95%, the rule gives about 83% at 1.44 kW, 1 to 2
  points below their best. Their low of 60%, in very cold weather, is battery warming, which EVBench adds separately.
- **Tessie, a Tesla app:** about 70% on 120 V and 90% on 240 V, in round figures from the car's own readings
  [[fact:tessie-level1-level2-figures]]. Starting from 90%, the rule gives about 78%. Tessie doesn't say how it
  measures, so we can't tell why it reads 8 points lower.
- **The owner's Rivian, coming soon:** Steady state electronics load typically measure 150W, which ends up about 45W more efficient than the rule.

## Where the data comes from

- **ADAC, 2022 and 2026.** Germany's auto club measured 9 current cars at the wall and against the battery's
  stored energy. It charged each on a 230 V socket and an 11 kW wallbox, and some on a 4.4kW limtied wallbox. It
  kept the batteries at 20 to 30 °C. This is the best data on current cars, and the rule's 200 W is anchored to it
  [[fact:ac-socket-vs-wallbox-adac-2022]] [[fact:ac-socket-vs-wallbox-adac-2026]].
- **Sears et al., Vermont, 2013.** It logged 114 home charges on two Volts and two Leafs, on 120 V (1.44kW) and 240 V (3.3kW). 
  It is the only study here that logged temperature and charge size. [[fact:ac-level1-vs-level2-sears-2014]].
- **DTU, 2016.** The Technical University of Denmark measured three older cars' chargers on its own meters
  [[fact:onboard-charger-loss-dtu-2016]]. It also read what reached the battery from each car's own data, against a
  wall meter. DTU trusted the car's own figures least [[fact:dtu-2016-car-reported-efficiency]].
- **Argonne National Laboratory, 2020.** It measured a 2017 Bolt, a 2014 i3 and a 2012 Leaf at the plug and at the
  battery, at *many* charging rates, and fitted a curve to each. Like ADAC, it counts the car's own draw as loss. Only
  the Bolt was tested on both 120 V and 240 V [[fact:anl-charging-loss-fits-2020]].
- **INL steady-state sheets, 2015.** Idaho National Laboratory measured the onboard charger alone, at a fixed
  current, on five cars. These figures leave out the rest of the car's draw. They show that the charger *also* gets
  less efficient at low power, before any draw is added: by about 4 points on the 2012 Volt and Leaf, 10 on the i3, 14 on
  the B-Class and 29 on the 2015 Leaf [[fact:inl-steady-state-volt-2012]] [[fact:inl-steady-state-leaf-2012]]
  [[fact:inl-steady-state-i3-2014]] [[fact:inl-steady-state-leaf-2015]] [[fact:inl-steady-state-b-class-2015]].
- **INL baseline tests, 2013 to 2015.** INL recharged six cars at 240 V after range tests and measured energy both
  into and back out of the battery. They show the gap between the two ways of measuring
  [[fact:inl-baseline-recharge-2013]] [[fact:inl-baseline-recharge-2014-2015]].
- **Car and Driver, 2021.** One long-term Model 3. The article gives no method
  [[fact:car-and-driver-model-3-level1-level2-2021]].
- **Tessie.** A Tesla app that logs charging from the car's own readings. It gives round figures and no method
  [[fact:tessie-level1-level2-figures]].
- **The owner's R1T.** Rivian's own breakdown of 203 charges, measured after the charger. It shows the size of the
  draw and the cost of the cold, but not the charger's loss [[fact:r1t-charging-systems-draw-roamer]].

## What we could not establish

- **Current cars on a US 120 V outlet,** metered at the wall and at the pack, warm and cold. ADAC's slowest charge is
  2.3 kW at 230 V, and the newest car measured on 120 V is a 2017 Bolt.
- **Each car's own draw while it charges.** The biggest component of a slow charge's loss, and we can't establish a per-vehicle baseline.
- **How much battery warming consumes,** car by car, and how long it needs to run for slower charges.
- **How much 120 V impacts a charger**. Four cars lost 2 to 3 points using 120 V, but two cars showed slightly better performance on 120V vs 240V for a given power [[fact:onboard-charger-light-load]].
- **The battery's round trip losses on current cars.** The 2011 Leaf shows 96 to 97%. We have no newer figure.

::: held
Owner, 2026-11-15: the rule replaced WALL_OUTLET_CHARGER_EFF. Fixed draw ~200 W for every car (evidence: ADAC per-car
fit 134–503 W, median 218; best single value 215 W; Sears cars ~120 W; R1T systems 146 W after the charger). Battery
warming as a pack-size × degrees-below-40 °F term with placeholder values and a per-car factor of 1. The rule is on
main (PR #580, merged). Owner, 2026-11-16: the page was split in two (this one and charging-speed-and-energy); the
Charging Speeds and Your Driving footnotes keep #580's text and link here. Not in the ledger by the owner's choice: the
owner's own 120 V charge at about 20 °F, which added about 2 kWh in 24 hours, the rest to warming and overhead.
Owner's reading, 2026-11-15: higher voltage helps the charger at the same power (four cars for, two against); the
rule still leaves voltage out, and whether to add a 120 V penalty on top of the time cost is open. Owner's
expectation: fixed draws of 100–125 W for older cars from traditional makers; Argonne's fits lean that way for GM and
Nissan. A per-maker fixed draw is a possible next step, not built. Car and Driver, Tessie and owner forum tests are
checks, not inputs (owner, 2026-11-16). Not read: the My Nissan Leaf forum's 2012 Leaf lab test (rank D). Owner data
from other Rivians and a fleet request to Roamer are pending. Worth having: an EVBench test on a 120 V outlet with a
wall meter and the car's own added-energy figure, warm and cold.
:::

::: engineers
Model the loss on an AC charge as a fixed draw plus a share of the power. With P the power at the wall, P₀ the fixed
draw and k the proportional loss (charger conversion, wiring, battery):

    loss(P) = P₀ / P + k

EVBench anchors each car at its EPA figure η_ref at P_ref, its onboard charger's maximum (11.5 kW if unknown), and
uses one P₀ for every car, so k = (1 − η_ref) − P₀ / P_ref and

    η(P) = η_ref − P₀ · (1/P − 1/P_ref),   P = min(charger kW, P_ref),   P₀ = 0.20 kW

For the example car, η(1.44) = 0.870 − 0.20 × (0.694 − 0.130) = 0.757 [[fact:evbench-charging-loss-by-rate]].
Battery warming per charge is E_warm = 0.002 × f_car × E_usable × max(0, 40 − T °F) kWh, bought as E_warm ÷ η_warm,
with f_car = 1 and η_warm = η_ref + P₀ / P_ref, the same at any P [[fact:evbench-battery-warming]]. A night buys at most P × h, the hours plugged in; warming comes out of
that first, and the rest charges the pack: ΔE_pack ≤ (P × h − E_warm ÷ η_warm) × η(P).

Per-car fits through ADAC's socket (2.3 kW) and 11 kW results, both rounds: P₀ from 134 to 503 W, k from 2.3 to
7.8%; the correlation between a car's 11 kW loss and its P₀ is about 0.19 [[fact:adac-per-car-fixed-draw-fit]].
Tested by predicting every slower result from the same car's fast one: with P₀ = 200 W the mean absolute error is
1.79 points on ADAC 2026 (11 cases), 2.38 on ADAC 2022 (7) and 4.91 on Sears (3), against 6.03, 6.36 and 4.69 for the
old 120 V rule. Fitting P₀ on two sources and predicting the third gives 185 W (ADAC 2026 held out, 2.0 points), 210 W
(ADAC 2022, 2.4) and 215 W (Sears, 5.1) [[fact:adac-rate-rule-tested]]. Caveats: the studies are wall to battery
input, where EPA's η is wall to battery output; ADAC's socket is single-phase and its other charges three-phase, so k
absorbs any three-phase gain; and ADAC's 10–90% window leaves out balancing near full, which EPA's recharge includes.
:::
