---
slug: wind-and-range-tests
title: How wind changes a range test
related: [epa-vs-real-world, reading-modeled-efficiency, road-load-and-efficiency]
linked_from: [wind speed and wind direction fields on the test form]
status: DRAFT
---

## The short version

It's tempting to think a wind evens out on a round trip: you lose something fighting it going out and get it
back coming home. It doesn't, and the reason is that drag isn't proportional to speed. It grows with the *square*
of your speed through the air, not over the ground [[fact:physics-aero-drag-airspeed]]. A headwind adds to that air
speed and a tailwind takes away from it, but because of the squaring, the headwind costs more than the tailwind
gives back.

Here is the smallest case worth working through. You drive 70 mph in a 10 mph wind, straight out and straight
back. Out, you meet the air at 80 mph. Back, at 60. Square those and average them and you get
(80² + 60²) ÷ 2 = 5000, which is the same as 70² + 10². Calm air would have been 70², or 4900
[[fact:physics-wind-roundtrip-no-cancel]]. That is about 2% more air to push through.

Drag is only part of what a car spends, so the effect on the battery is smaller. EVBench assumes 70% of the
energy at highway speed goes to the air [[fact:evbench-aero-fraction]], which turns that 2% into roughly
+1.4% energy for the round trip. Small, but the gaps between cars in a comparison are often just as small.

## What does the angle of the wind matter?

On a test that went out and back, or round a loop, almost nothing, and that is how EVBench treats it. The
car pointed in every direction at some point, so whichever way the wind blew, it was a headwind on one part and a
tailwind on another. EVBench charges the square of the air speed, and averaged over a round trip that
comes to the car's speed squared plus the wind's speed squared, whatever the angle: 5000 at 0°, 45° and
90° alike, against 4900 in calm air [[fact:evbench-wind-simplified-law]].

So for a round trip the angle carries no information, and the form asks you to leave it blank.

The angle does matter for a test that held one heading, like a long straight highway drive one way. There, a
tailwind helps, a headwind hurts, and a crosswind sits in between. EVBench calls the angle 0° for a pure
tailwind, 180° for a pure headwind, and 90° or 270° for a crosswind (measured from the direction the car is
travelling).

## How to record wind on a test

What you enter changes what the correction does:

- **Out-and-back or loop:** leave the angle blank. The correction assumes a round trip and charges the car's
  speed squared plus the wind's speed squared.
- **One heading held the whole way:** give the angle, 0° for a tailwind, 180° for a headwind, 90° or 270° for a
  crosswind.
- **No wind speed:** the test is treated as calm, whatever the angle says.

All three are EVBench's rule for its own correction [[fact:evbench-wind-entry-rules]]. If you only know the wind was
"about 10 mph" and the route doubled back on itself, that is enough: speed in, angle blank.

## Is a crosswind as bad as a headwind?

Not quite, and this is where the physics gets subtle. The model above counts the whole air speed. A stricter
view says that if the car's drag coefficient (how slippery its shape is) stays constant, only the part of the
air force pointing along the road slows the car down. A crosswind pushes mostly sideways and costs less.

On the same round trip, at 70 mph with a 10 mph wind, the strict version gives 5000 at 0°, about 4975 at 45°
and about 4950 at 90° [[fact:physics-wind-strict-along-road]]. A pure crosswind costs roughly half what a pure
head-and-tail wind does.

Real cars don't follow the strict version either, and they err on the expensive side. A car meeting the air at
an angle usually has a higher drag coefficient than one meeting it nose-on, because the flow around the body
stops hugging it [[fact:physics-drag-yaw]]. So the strict figure is a floor, and the truth lies above it by an
amount EVBench has no per-vehicle data for [[fact:evbench-no-yaw-data]].

That is why EVBench keeps the simpler law. It sits between the strict floor and what real cars do, and when it's
wrong, it's wrong toward the cost a wind really has.

Side by side, for a 70 mph round trip in a 10 mph wind (the mean of air speed squared; calm air is 4900):

| Wind angle | Strict physics | EVBench's law |
|---|---|---|
| 0° | 5000 | 5000 |
| 45° | 4975 | 5000 |
| 90° | 4950 | 5000 |

Real cars land above the strict column, by an unknown amount.

## How much is at stake?

For a round trip at 70 mph, the strict law's 0° and 90° results are about 0.7% of total energy apart at 10 mph
of wind, and about 1.6% apart at 15 mph [[fact:evbench-wind-angle-size]]. That is the most the simplified law can
hide by folding every angle into one figure, and it is the same order as the effect of the wind itself. So
the angle is a refinement. The wind speed is what matters, and a test with an honest speed and a blank
angle is better than a test with a guessed angle.

::: engineers
For a car travelling at speed v with wind speed w at angle θ (0° a tailwind), the air-relative speed
satisfies |V_rel|² = v² + w² − 2vw·cos θ. On a leg that is reversed, θ becomes θ + 180° and the cosine flips
sign, so the mean over the two legs is v² + w² [[fact:evbench-wind-simplified-law]]. This is the apparent-wind law
in `apparentAirspeed()` in `src/utils/epaDerivations.js`, applied to the aerodynamic share of road load only.

The stricter version with constant Cd charges the force component along the road, |V_rel|·(v − w·cos θ),
which per leg is smaller than |V_rel|² unless θ is 0° or 180° [[fact:physics-wind-strict-along-road]]. At 15 mph of
wind the round-trip means are 5125, 5068 and 5011 at 0°, 45° and 90°, against 4900 calm.

Neither includes yaw-dependent Cd [[fact:physics-drag-yaw]]. A per-vehicle curve would need wind-tunnel yaw sweeps, and
EVBench has none [[fact:evbench-no-yaw-data]]. The 70% aerodynamic share is the model's reference-speed
assumption, and the real figure varies with the car [[fact:evbench-aero-fraction]].
:::
