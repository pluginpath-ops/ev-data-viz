---
slug: reading-modeled-efficiency
title: Reading the Modeled Efficiency chart
related: [epa-vs-real-world, road-load-and-efficiency, epa-battery-figures]
linked_from: [Modeled Efficiency "About this chart" (#370), curve tier legend, viewing conditions]
status: DRAFT
---

## The short version

The question most people actually have is "how far will this car go at 75 mph?", and the
[EPA label can't answer it](epa-vs-real-world). Real highway tests can, but only for the handful of cars
someone has tested, at whatever speed and temperature they happened to drive.

Modeled Efficiency fills the gap. Every EV certified for sale in the US goes through lab tests that record
how hard the car is to push along the road and how much energy it used doing it
[[fact:epa-road-load-coastdown]] [[fact:epa-mct-sequence]]. From those two things
EVBench draws a curve of efficiency (and range) against speed, for any certified car, whether or not anyone
has road-tested it.

It's a **model, not a measurement**, and it helps to know which parts are which:
- **The shape of the curve comes from the car's "road load"**, which is how much it resists rolling and
  pushing air. The maker measures it and reports it to EPA [[fact:epa-road-load-coastdown]]
  [[fact:epa-road-load-manufacturer]]. It's the best number available, but it isn't beyond question
  (more on that below).
- **The height of the curve depends on how efficient the drivetrain is.** For most cars that's
  back-solved from their own lab test. For some it has to be estimated, and the chart tells you which.
- **The range axis needs the battery's usable energy.** Some records don't have it (see
  [what EPA says about the battery](epa-battery-figures)).

::: figure modeled-curve-anatomy One car's curve, annotated: road load gives the shape, efficiency (η) sets the height, usable energy turns it into range. Mark 65–75 mph.

## Where to find it

There are two versions of the same chart:
- **EPA › Modeled Efficiency**: any EPA certification record, whether or not the car is in EVBench. Good for
  "how does this compare with that" across the whole market.
- **EPA › Selected vehicles › Modeled Efficiency**: the same curves for the vehicles you've selected, with
  EVBench's own range tests laid over them.

## How much should I trust each curve?

Every curve's shape is the car's own certified road load. What varies is the energy behind it, and the
legend marks each curve with how it got there:

| Tier | Efficiency (η) from | Usable energy from | How to read it |
|---|---|---|---|
| Full test cycle | The car's own steady 65 mph test sections | Its own test, driven to empty | The best the model gets. Both halves are the car's own. |
| Corrected | Its highway cycle, scaled to a cruise basis | Its own test | Close. The correction is borrowed from other cars [[fact:evbench-hwfet-to-cruise-eta]]. |
| Estimated | A fleet default | The Fuel Economy Guide's gross pack | The shape is still real. Height and range are rough. |
| No range | A fleet default | None | Consumption only, no range axis. |

::: held
Owner: add color on why the "full test cycle" tier is the one to lean on. It is the only tier where the
efficiency was measured at the same kind of steady cruise the curve plots. The why is in
road-load-and-efficiency.
:::

## Whose numbers are these?

One more caveat applies to every tier: the road load itself comes from the manufacturer. The maker chooses
how to measure it (on a track, in a wind tunnel, or even by modeling) and is responsible for getting it
right [[fact:epa-road-load-manufacturer]]. EPA can check production cars, but its audit only flags a road
load that's too *low*, making the car look easier to push than it really is. A maker that reports a
road load *higher* than the real one only hurts its own label, and the audit isn't built to catch that
[[fact:epa-road-load-manufacturer]].

In practice the filed numbers can hold up very well. State of Charge's 70 mph range test of a 2025 Taycan
4 Cross Turismo came in at about 3.1 mi/kWh, and on the chart it sits almost exactly on the car's modeled
curve [[fact:taycan-4ct-matches-model]]. Still, when a real test lands well off a curve, the road load is
one of the suspects, along with the test's conditions.

::: modeled 69 y=mi_kwh The 2025 Taycan 4 Cross Turismo's modeled efficiency against speed, with State of Charge's 70 mph test corrected to the same conditions. It sits almost exactly on the line.

::: held
Owner: add color, and more examples as they're checked. To look for road load that's off: EVBench already
flags records whose corrected η lands above 1, which would mean the filed road load is higher than the
real one. The list of cars that flag catches could be its own finding.
:::

## Changing the conditions

The curve starts at standard lab conditions: sea level, mild temperature, no wind, flat road. The
viewing conditions let you move it:
- **Elevation and temperature** change air density, and with it aerodynamic drag. At 5,000 ft the air is
  about 14% thinner, and 20 °F air is about 11% denser than 75 °F air
  [[fact:physics-air-density-drag]]. These change air density *only*. They don't model a cold battery or
  cabin heat, and those are usually the bigger winter hit.
- **Accessory load** covers heat, A/C, battery conditioning and the lights. It matters most at low speed,
  where the car is slow to cover a mile and the draw keeps running.
- **Wind** changes the speed of the air over the car, so a headwind acts like driving faster.
- **Elevation gain or loss** adds a one-off cost for a net climb over a route. It gives back only part of a
  net descent, because regen doesn't recover everything. It's usually left at 0 for round trips.

::: figure conditions-sweep One curve at standard conditions, then at 5,000 ft, at 20 °F with heat on, and into a 15 mph headwind. Four lines on one chart.

::: held
Lab idea: the conditions panel, standalone. Sliders for speed, temperature, wind and accessory load on one
preset car, with the range readout. It's close to what the chart already does, so the question is whether
the explainer version should be simpler (fewer knobs, one car) rather than duplicate it.
:::

## Laying real tests over the curve

On the selected-vehicles chart, EVBench's range tests for that car can be drawn on top of its curve:
- **Corrected** points are adjusted to the chart's current conditions (temperature, wind, elevation) so they
  compare like for like with the curve.
- **Uncorrected** points are exactly as recorded. They're not a fair comparison when the conditions
  differ, but they're the real data.

When a real test lands well off the curve, that's interesting rather than wrong. It could be the model's
assumptions, the test's conditions, or something about that particular car.

::: held
Owner: a good real example goes here, e.g. a car where the corrected points sit right on the curve, and
one where they don't, and why.
:::

## Digging deeper

How the curve is actually built, and why EVBench solves for efficiency at 65 mph rather than from the
highway cycle, is in [Road load and drivetrain efficiency](road-load-and-efficiency).

::: engineers
At each speed *v*, the road-load force is F = A + B·v + C·v², from the car's certification record. Battery
power is F·v ÷ η plus a constant accessory draw, and range is usable energy ÷ energy per mile. The viewing
conditions scale the C (aerodynamic) term by air density and apparent airspeed. The grade setting adds
m·g·Δh over the distance, with a fixed recovery fraction on descents.
:::
