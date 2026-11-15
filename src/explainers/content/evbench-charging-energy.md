---
slug: evbench-charging-energy
title: How does EVBench calculate charging energy consumption?
related: [charging-speed-and-energy, dc-fast-charging-loss, epa-battery-figures, heating-cooling-and-range]
linked_from: [Cost & Time › Home Charger footnote, Your Driving's charging-losses line]
status: DRAFT
---

## The short version

Why a slower charge takes more energy is on its own page:
[how charging speed impacts energy consumption](charging-speed-and-energy).

That makes charging loss primarily a matter of time spent charging, not voltage or current. EVBench now prices it that way: each car starts from the best available data: 
its own EPA charger efficiency at its fastest home charging.  From there, the simulation adds a fixed 200W cost for every extra hour a slower charge
takes [[fact:evbench-charging-loss-by-rate]]. 

For a car EPA measured at 87% with a 32 A onboard charger:

- **240 V at 32 A**, the car's own top rate: 87.0%, EPA's figure.
- **240 V at 16 A**: 84.4%.
- **120 V at 12 A**: 75.7%.

In the cold there is a second cost: the car warms its battery before (and during) the charge.  As of writing this, EVBench adds a very rough guess for
that too.  This is a rough approximation, modeled off the observed 1-4kWh of battery warming energy used across numerous winter charging sessions by the owners R1T. [[fact:evbench-battery-warming]].

## What does EVBench do with it?

Cost & Time › Home Charger prices home charging in two steps.

**The charger efficiency at your charger** [[fact:evbench-charging-loss-by-rate]]:

- It starts from the car's own EPA charger efficiency, measured on a Level 2 recharge [[fact:epa-mpge-at-the-wall]],
  or 88.5%, the median of 2025's certifications, where a car has none [[fact:epa-charger-efficiency-is-ac]]. That
  figure belongs to the car's fastest home charging: its onboard charger's maximum, or 11.5 kW if we do not know it.
- Below that, each extra hour per kWh costs a fixed 200 W.

For our example car, 87% at 32 A (7.68 kW), adding 10 kWh to the battery:

| Charger | Charger efficiency | Bought at the wall | Hours |
|---|---|---|---|
| 240 V, 32 A | 87.0% | 11.5 kWh | 1.5 |
| 240 V, 16 A | 84.4% | 11.8 kWh | 3.1 |
| 120 V, 12 A | 75.7% | 13.2 kWh | 9.2 |

A charger faster than the car's own makes no difference: the car takes what its onboard charger can.

**Battery warming below 40 °F**, as above, once for each night the charger runs [[fact:evbench-battery-warming]].

EVBench used to change only a 120 V outlet, to 80% for a car at 88.5%, a round figure chosen before anyone looked at
the data. Against ADAC's cars that missed by about 6 points on average, against 2 for the new rule
[[fact:adac-rate-rule-tested]].

Below 40 °F, EVBench adds an amount to each home charge in proportion to the usable pack and to how far below 40 °F
it is: 4 kWh for a 100 kWh pack at 20 °F, bought through the charger efficiency. The rate is a guess, loosely fitted
to the R1T, and the same for every car until there is something better [[fact:evbench-battery-warming]]. The
[heating and cooling explainer](heating-cooling-and-range) covers the driving side.

## How big is the fixed draw?

Fit each of ADAC's nine cars on its own and the fixed draw ranges from 134 W for the 2022 ID.3 to 503 W for the CLA,
with a median of 218 W [[fact:adac-per-car-fixed-draw-fit]]. The Vermont cars come out near 120 W
[[fact:adac-rate-rule-tested]]. Argonne's fits, followed down to no power at all, start at about 150 W for the 2017
Bolt, 218 W for the i3 and 80 W for the 2012 Leaf [[fact:anl-charging-loss-fits-2020]]. That figure holds the
charger's own loss at no load as well, so the draw itself is a little lower. Older cars from traditional makers may
simply draw less, as the Volt, Leaf and Bolt suggest. The R1T's systems, measured after its charger, took about 150 W
[[fact:r1t-charging-systems-draw-roamer]], which is a floor for that truck, not the whole of it.

EVBench uses 200 W for every car [[fact:evbench-charging-loss-by-rate]]. It fits ADAC's cars about as well as the
best single value does, 2.0 points of average miss against 1.96 at the best fit of 215 W
[[fact:adac-rate-rule-tested]].

Why not a different value for each car? It would be better, if we knew them. The obvious shortcut, guessing a car's
fixed draw from its EPA efficiency, does not work: a car's loss at full power is mostly its charger's conversion,
which says little about what it draws standing still. The ID.3 lost the most of ADAC's cars at 11 kW and has the
smallest fixed draw [[fact:adac-per-car-fixed-draw-fit]]. Nor does size seem to matter: the CLA, an efficient sedan,
draws the most.

What a single value costs depends on how far below the car's top rate you charge. For a car that can take 11.5 kW,
the spread of ADAC's cars puts the penalty at 240 V and 32 A anywhere from about ½ to 2 points, and on a 120 V outlet
from about 8 to 30 [[fact:adac-per-car-fixed-draw-fit]]. So on a wall outlet, treat EVBench's figure as typical, and
expect your own car to differ, possibly by a lot.

## What do the measurements say?

Unfortunately, finding controlled studies on the topic is a bit challenging, and the studies differ in method, era and country.

| Study | Slow charging | Faster charging | Slow ÷ faster |
|---|---|---|---|
| Sears et al., 2 Volts and 2 Leafs, Vermont, 2013 | 83.8% (120 V) | 89.4% (240 V) | 0.94 |
| Same, charges under 4 kWh | 74.2% | 87.2% | 0.85 |
| Same, charges of 8 kWh and up (read from its chart) | ~86% | ~88% | ~0.98 |
| ADAC, 4 cars, 2022, median | 85.6% (230 V single-phase, 2.3 kW) | 91.7% (three-phase, 11 kW) | 0.93 |
| ADAC, 5 cars, 2026, median | 85.8% (230 V single-phase, 2.3 kW) | 93.1% (three-phase, 11 kW) | 0.92 |
| DTU, Nissan Leaf, 2016 (the car's own reading) | 85% (230 V, 2.3 kW) | 90% (230 V, 3.7 kW) | 0.94 |
| Same, Peugeot iOn | 70% | 69% | 1.01 |
| Argonne, 2017 Chevrolet Bolt, 2020 (from its fit) | 85.4% (120 V, 1.44 kW) | 92.7% (240 V, 7.2 kW) | 0.92 |
| Same, 2014 BMW i3 | 77.2% (208 V, 1.2 kW) | 89.8% (208 V, 6 kW) | 0.86 |
| Same, 2012 Nissan Leaf | 81.5% (208 V, 1.25 kW) | 85.8% (208 V, 3.77 kW) | 0.95 |
| Tessie, Tesla owners' app (round figures) | ~70% (120 V) | ~90% (240 V) | 0.78 |

All of these count energy into the battery.

Sources: [[fact:ac-level1-vs-level2-sears-2014]], [[fact:ac-socket-vs-wallbox-adac-2022]],
[[fact:ac-socket-vs-wallbox-adac-2026]], [[fact:dtu-2016-car-reported-efficiency]],
[[fact:anl-charging-loss-fits-2020]], [[fact:tessie-level1-level2-figures]].

ADAC's two rounds are the best data there is: nine current cars, each measured on a socket and a wallbox, several of
them at a turned-down wallbox in between. Here they are, one chart per study, then the Vermont results and a placeholder for the owner's R1T, against
the time it takes to draw each kWh from the wall. On that axis a fixed draw is a straight line, and EVBench's rule
draws every car as a line of the same slope through its own fastest result [[fact:adac-rate-rule-tested]].

::: figure outlet-loss

Most cars sit close to their lines, which is the point: one fixed draw, plus each car's own fast result, predicts
their slower charges to about 2 points on average [[fact:adac-rate-rule-tested]]. Two cars sit well above theirs.
Mercedes' CLA lost 24.2% on the socket, because its charger takes only 8 A from it, and the 2022 Zoe lost the same
[[fact:ac-socket-vs-wallbox-adac-2026]] [[fact:ac-socket-vs-wallbox-adac-2022]]. Those cars draw two to two and a half
times the rule's 200 W [[fact:adac-per-car-fixed-draw-fit]].

The older Vermont cars go the other way. On full-size charges, those 2013 Volts and Leafs lost only 2 or 3 points more
on 120 V than on 240 V, and their headline gap of 5.6 points comes mostly from short charges
[[fact:ac-level1-vs-level2-sears-2014]]. On the last chart their full-size charges sit well below the rule's line and their
short charges above it. Taken together they behave as if their fixed draw was about 120 W, and on them EVBench's rule
does a little worse than its old one did [[fact:adac-rate-rule-tested]].

DTU's figures are measured the way ADAC measures, but read from each car's own data, which DTU itself trusted least.
The Leaf lands close to its line; the iOn, whose charger lost about 30% at either setting, does not follow the trend at
all [[fact:dtu-2016-car-reported-efficiency]].

Argonne National Laboratory metered a 2017 Bolt, a 2014 i3 and a 2012 Leaf at the plug and at the battery, counting
the car's own draw while charging as loss, which is ADAC's basis, and fitted a curve to each
[[fact:anl-charging-loss-fits-2020]]. The i3 sits right on its line. The Bolt and the Leaf sit well below theirs,
about 4 and 6 points at their slowest, so both behave as if they draw much less than 200 W.

INL's steady-state sheets are a different thing: the onboard charger alone, held at a constant current, with nothing
for the rest of the car awake while it charges [[fact:inl-steady-state-volt-2012]] [[fact:inl-steady-state-leaf-2012]]
[[fact:inl-steady-state-i3-2014]] [[fact:inl-steady-state-leaf-2015]] [[fact:inl-steady-state-b-class-2015]].
They sit well below the rule's lines, as they should. What they show is that the charger itself also gets worse as the
power falls, before any fixed draw is added: by about 4 points on the 2012 Volt and Leaf from their best down to their
slowest 120 V setting, 10 on the i3, 14 on the B-Class and 29 on the 2015 Leaf, for which INL's advice was to use Level 2
"whenever possible".

None of these is a current car on a US 120 V outlet. ADAC's slowest charge is 2.3 kW at 230 V, against 1.44 kW at
120 V, and the newest car measured on 120 V is the 2017 Bolt, so EVBench's 120 V figures are the lines carried a
little past the data.

## What we could not establish

- A measurement of current cars on a US 120 V outlet, metered at the wall and at the pack, warm and cold. ADAC's
  slowest charge is 2.3 kW at 230 V, and the newest car measured on 120 V is a 2017 Bolt.
- Each car's own fixed draw while charging. It is the biggest part of a slow charge's loss and almost no maker
  publishes it. Nine cars span 134 to 503 W.
- How much battery warming costs, car by car, and whether on a 120 V outlet it keeps running for the whole charge.
- How much a 120 V input lowers a *current* car's onboard charger efficiency at the same power. Four of six older
  cars lost 2 to 3 points more; two did better [[fact:onboard-charger-light-load]].
- Whether three-phase charging beats single-phase at the same power, inside the car.
- The battery's round trip on current cars. The 2011 Leaf's was 96 to 97%; we have no newer figure.

::: held
Owner, 2026-11-15: the rule replaced WALL_OUTLET_CHARGER_EFF. Fixed draw ~200 W for every car (evidence: ADAC per-car
fit 134–503 W, median 218; best single value 215 W; Sears cars ~120 W; R1T systems 146 W after the charger). Battery
warming as a pack-size × degrees-below-40 °F term with placeholder values and a per-car factor of 1. This page
describes code on branch feature/charging-loss-by-rate (commit 6bf5541); merge that before this page ships, and
re-add this page's ExplainerLink to the Home Charger and Your Driving footnotes when the two branches meet (both edit
them). Not in the ledger by the owner's choice: the owner's own 120 V charge at about 20 °F, which added about 2 kWh
in 24 hours, the rest to warming and overhead. Owner's reading, 2026-11-15: higher voltage helps the charger at the
same power, about 2 points at 120 V against 240 V and about ½ point at 208 V against 240 V (i3, Bolt); now four cars
for (Bolt, i3, 2012 and 2015 Leaf) and two against (Volt, B-Class), all read from the owner's copies (avt.inl.gov
refuses this machine, and the Internet Archive now refuses it too). The rule still leaves voltage out; whether to add
a 120 V penalty on top of the time cost is open. Owner's expectation: fixed draws of 100–125 W for older cars from
traditional makers; Argonne's fits (Bolt ~150 W, 2012 Leaf 80 W, i3 218 W, each including no-load charger loss) lean
that way for GM and Nissan. A per-maker fixed draw is a possible next step, not built. INL's charger-only figures are
in the ledger and the chart as context (owner, 2026-11-15), not as whole-charge efficiencies. Not read: the My Nissan
Leaf forum's 2012 Leaf lab test (rank D). Owner data from other
Rivians and a fleet request to Roamer are pending. Worth having: an EVBench test on a 120 V outlet with a wall meter
and the car's own added-energy figure, warm and cold.
:::

::: engineers
Model the loss on an AC charge as a fixed draw plus a share of the power. With P the power at the wall, P₀ the fixed
draw and k the proportional loss (charger conversion, wiring, battery):

    loss(P) = P₀ / P + k

EVBench anchors each car at its EPA figure η_ref at P_ref, its onboard charger's maximum (11.5 kW if unknown), and
uses one P₀ for every car, so k = (1 − η_ref) − P₀ / P_ref and

    η(P) = η_ref − P₀ · (1/P − 1/P_ref),   P = min(charger kW, P_ref),   P₀ = 0.20 kW

For the example car, η(1.44) = 0.870 − 0.20 × (0.694 − 0.130) = 0.757 [[fact:evbench-charging-loss-by-rate]].
Battery warming per charge is E_warm = 0.002 × f_car × E_usable × max(0, 40 − T °F) kWh, bought as E_warm ÷ η(P),
with f_car = 1 [[fact:evbench-battery-warming]].

Per-car fits through ADAC's socket (2.3 kW) and 11 kW results, both rounds: P₀ from 134 to 503 W, k from 2.3 to
7.8%; the correlation between a car's 11 kW loss and its P₀ is about 0.19 [[fact:adac-per-car-fixed-draw-fit]].
Tested by predicting every slower result from the same car's fast one: with P₀ = 200 W the mean absolute error is
1.79 points on ADAC 2026 (11 cases), 2.38 on ADAC 2022 (7) and 4.91 on Sears (3), against 6.03, 6.36 and 4.69 for the
old 120 V rule. Fitting P₀ on two sources and predicting the third gives 185 W (ADAC 2026 held out, 2.0 points), 210 W
(ADAC 2022, 2.4) and 215 W (Sears, 5.1) [[fact:adac-rate-rule-tested]]. Caveats: the studies are wall to battery
input, where EPA's η is wall to battery output; ADAC's socket is single-phase and its other charges three-phase, so k
absorbs any three-phase gain; and ADAC's 10–90% window leaves out balancing near full, which EPA's recharge includes.

Cable loss as a share of power is I²R ÷ (V·I) = I·R ÷ V, with R the resistance out and back. House wiring, 50 ft: 14
AWG (R ≈ 0.25 Ω) at 12 A and 120 V is 2.5%; 6 AWG (R ≈ 0.04 Ω) at 48 A and 240 V is 0.8%. EVSE cord, 20 ft: 8 AWG
(R ≈ 0.025 Ω) at 12 A is 0.25%, 14 AWG (R ≈ 0.10 Ω) 1.0%; 6 AWG (R ≈ 0.016 Ω) at 48 A is 0.3%
[[fact:physics-ac-cable-loss-share]]. Measured whole, INL found a Level 1 EVSE 98% efficient and Level 2 above 99%
[[fact:evse-efficiency-inl]]. Balanced three-phase at the same power and wire size: each of three conductors carries
I/3, so the loss is 3·(I/3)²R = I²R/3 against 2·I²R for a single phase, a sixth [[fact:physics-three-phase-cable-loss]].
:::
