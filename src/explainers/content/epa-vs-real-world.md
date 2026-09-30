---
slug: epa-vs-real-world
title: Why your highway range isn't the label
related: [epa-drive-cycles, reading-modeled-efficiency, epa-battery-figures]
linked_from: [methodology callout on the vehicle EPA section, Modeled Efficiency overlay help]
status: DRAFT
---

## The short version

You get a new EV and head out on the highway, and the range is well short of the number on the sticker.
Nothing is broken, and the label isn't a lie either. It answers a different question from the one you're
asking.

The label comes from a lab. The car sits on a dynamometer (a treadmill for cars) and is driven over two
standard drive cycles, one "city" and one "highway", until the battery runs flat
[[fact:epa-ev-range-test-depletion]]. Neither cycle goes faster than 60 mph, and the highway one averages
48 mph [[fact:epa-cycle-udds]] [[fact:epa-cycle-hwfet]]. The results are then marked down to allow for things the
lab didn't do: air conditioning, cold weather, and fast, aggressive driving
[[fact:epa-adjusted-for-real-world]]. The most common way to do that is a flat 30% off
[[fact:epa-0-7-factor]]. Finally, city and highway are blended 55/45 into the one "combined" range on the
sticker [[fact:epa-55-45-weighting]].

So the sticker is mostly a city number, built from driving slower than you do on the interstate. Then it is
shaved by a blanket factor that is the same for a brick-shaped truck and a slippery sedan.

::: figure label-pipeline The label, built step by step: two lab cycles → range for each → ×0.7 → the 55/45 blend → the sticker. The same diagram as the vehicle EPA section's methodology card, drawn for one real car.

::: held
Owner: add color here. A real example would carry this, e.g. a car whose label is X, whose EVBench
70 mph test got Y, and where the difference comes from. The R2 20" is a good candidate: it has a measured
5-cycle factor (0.7051), so it's one of the few where the markdown isn't just 0.7.
:::

## Why speed matters so much

Most of what an EV spends at highway speed goes into pushing air. Aerodynamic drag grows with the *square*
of speed, so going from 60 to 75 mph takes about 56% more force, and nearly twice the power
[[fact:physics-aero-drag-speed-squared]]. A test that tops out at 60 mph can't show you that, and a 30%
markdown doesn't know how much drag your car has.

That cuts both ways. The flat factor treats every car the same, so:
- a car with low drag loses less at 75 mph than the factor assumes, and can beat its label on the highway
- a tall, blunt car loses more, and will usually fall short
- a car that's very efficient in town gets a big city number that no amount of highway driving will get
  near

::: figure speed-vs-label A car's efficiency against speed, with the two lab cycles' average speeds marked at 20 and 48 mph and the 65–75 mph band where people actually cruise.

## So what should I compare my drive against?

Not the label. That goes for all of its numbers, the city and highway ones as well as the combined
figure, adjusted or not. Every one of them comes from those slow, variable-speed cycles.

A fairer comparison:
- **A steady-speed estimate for your car**, built from the same lab data. That's what the
  [Modeled Efficiency chart](reading-modeled-efficiency) does: it turns a car's certification data into
  efficiency and range at each speed. It's only as good as the road-load figures the maker filed, and those can be
  off [[fact:epa-road-load-manufacturer]].
- **Someone else's real highway test** at a known speed and temperature. EVBench's range tests are
  logged that way, and the Modeled Efficiency chart can lay them over the curve.
- **Your own conditions.** Temperature, wind, elevation and speed all move the number more than most
  people expect.

::: held
Lab idea: "Label vs your drive". Pick a car and a cruising speed and temperature. The page shows the label
range, the modeled range at those conditions, and any EVBench test near them. It would reuse the Modeled
Efficiency model. The explainers boundary blocks importing it today, so this needs a decision (widen the
allow-list for the model's pure utils?).
:::

## Digging deeper

Each step of the label has its own story:
- [Reading the window sticker](epa-label-basics): MPGe, kWh/100 mi, and what "combined" means
- [The five test cycles](epa-drive-cycles): what each one drives, and what it stands in for
- [How an EV is actually tested](epa-test-procedures): driving to empty, and energy out against energy back in
- [From lab result to label](epa-label-adjustment): the ×0.7, and the other ways a maker can get there
- [Certifications, configurations and guide rows](epa-certification-records): why EVBench's EPA data
  never lines up one to one

::: engineers
The markdown is applied to range and to fuel economy alike. Multiplying range by 0.7 is the same thing as
dividing energy use by 0.7 [[fact:epa-0-7-factor]]. There are other routes: a derived 5-cycle regression,
or actually running the extra hot, cold and high-speed cycles [[fact:epa-cycle-us06]] [[fact:epa-cycle-sc03]]
[[fact:epa-cycle-cold-ftp]]. Where a maker runs the extra cycles, the factor is measured for that car rather
than assumed. The details are in [From lab result to label](epa-label-adjustment).
:::
