---
slug: epa-test-procedures
title: How an EV is actually tested
related: [epa-drive-cycles, epa-vs-real-world, reading-modeled-efficiency, epa-battery-figures]
linked_from: [test phase editor on the vehicle EPA section, preferred test picker]
status: DRAFT
---

## Why this matters

Every number on an EV's window sticker comes out of one long day (or two) on a dynamometer. How that day
is put together decides more than you'd think. It decides which measurements exist for a car at all, and
one of them, a long steady cruise at close to highway speed, is the best clue EPA's data holds to how the
car will do on a road trip. It never makes it onto the label.

## Driving to empty: three routes

A gas car runs each [drive cycle](epa-drive-cycles) once and the lab measures the fuel. An EV has to be
driven *until the battery is flat* to find its range [[fact:epa-ev-range-test-depletion]]. In EPA's
certification records that run takes one of three routes:

1. **The Multi-Cycle Test**, all in one run: a city cycle to warm up, then highway, city, a long steady
   stretch, city, highway, city, and a final steady stretch until the car can't keep up
   [[fact:epa-mct-sequence]] [[fact:evbench-mct-phase-lengths]].
2. **City to empty:** the city cycle, repeated until the battery is depleted.
3. **Highway to empty:** the highway cycle, repeated until the battery is depleted
   [[fact:epa-single-cycle-routes]].

::: lab test-routes

## Why most makers run the Multi-Cycle Test

Look at the city lane. Take a typical car from EPA's records and ask it to drive the city cycle, stop, go,
stop, go, at an average under 20 mph, until the battery is flat. It would cover about 440 miles
[[fact:evbench-same-car-to-empty]], and it would take something like 22 hours
[[fact:evbench-test-durations]]. The lane is drawn to scale on purpose. At that length the detail of each
cycle disappears into texture, which is a fair picture of how monotonous that day would be for whoever
is driving.

The Multi-Cycle Test gets the same city and highway numbers from just two laps of each. It burns off the
rest of the battery on the steady stretches, which cover a median 84% of its distance and 88% of its
energy [[fact:mct-steady-share]], and it finishes in about 6 hours [[fact:evbench-test-durations]]. It's no
surprise that 89% of the certification groups in EVBench's database report it [[fact:evbench-test-route-shares]].

::: held
Owner: add color. As batteries got bigger, running each cycle to empty got longer and longer; the
multi-cycle test is the fix. Worth sourcing when it arrived (SAE J1634, 2012 revision, per EPA's 2017
summary) and whether anyone still does a true 20-hour city run.
:::

## What EPA's records show

EVBench holds a copy of EPA's certification test records, which is where the lab's distances and the
figures below come from. They describe what's in EVBench's database today, not every EV ever certified,
and today that's mostly the current crop: 262 of the 297 certification groups with a range test are model
year 2026 [[fact:evbench-test-route-shares]].
- **The route:** 265 of 297 report the Multi-Cycle Test, and 32 report single-cycle tests, led by Tesla
  (9), Mercedes-Benz (5), BMW (5) and Hyundai (4) [[fact:evbench-test-route-shares]].
- **The order never varies.** All 273 complete Multi-Cycle Tests run city, highway, city, steady, city,
  highway, city, steady [[fact:evbench-mct-phase-lengths]].
- **The first steady stretch is the big one:** a median 237.5 miles, from as short as 81 to as long as
  405. The last one, to empty, runs a median 30 [[fact:evbench-mct-phase-lengths]].
- **Total distance:** a median of about 318 miles, from 134 to 489 [[fact:evbench-mct-phase-lengths]]
  [[fact:evbench-test-durations]].
- **Time on the dynamometer,** estimated from those distances: a median of about 6 hours, from 3.2 to 8.7
  [[fact:evbench-test-durations]].

The single-cycle records are the odd ones out. For recent long-range cars, each city and highway pair
carries exactly the same energy figures, down to the last decimal, which two separate runs to empty
never would. The F-150 Lightning's pair shares one 152.974 kWh recharge
[[fact:evbench-single-cycle-records]]. They read more like one run reported twice than like two very long
days, which is why the lab's lanes 2 and 3 are a what-if rather than a record.

::: held
The durations are estimates: distance ÷ each cycle's average speed, with the steady stretches at 65 mph
and no pauses. The records hold distances, not times. An earlier draft put a 31-hour city run on a Lucid
Air from its single-cycle record's "distance"; withdrawn, because that field looks like a calculated
range, not miles driven.
:::

## The steady stretches: the most useful part nobody sees

Those steady stretches are driven at 65 mph [[fact:j1634-css-65mph]], and they turn out to be the most
useful part of the whole test for anyone who drives on a highway. They aren't on the label, but they're a
real, measured, steady cruise at close to real highway speed. EVBench's
[Modeled Efficiency chart](reading-modeled-efficiency) uses them for exactly that. A car tested on the
single-cycle routes never drives one, which is why its modeled curve has to borrow a correction from other
cars.

## Energy out, and energy back in

Two measurements come out of the run:
- **Energy out of the battery (DC):** measured throughout the test, for each stretch separately
  [[fact:epa-mct-sequence]].
- **Energy back in from the wall (AC):** the car is recharged afterwards from an ordinary outlet with its
  own charger, and that's what the label is built on, charging losses included
  [[fact:epa-mpge-at-the-wall]].

The gap between the two is the car's charging loss, which is covered in
[what EPA says about the battery](epa-battery-figures).

::: held
Owner: add color. Candidates, all already known to EVBench's curator tools:
- Why the stretches are called "bags" (the emissions-test heritage).
- The same car tested at two labs, both valid, and disagreeing.
- Recharge energy copied verbatim across a pair of single-cycle tests, so matching values aren't two
  independent readings.
Each needs a ledger fact first.
:::

::: engineers
In EPA's records the Multi-Cycle Test is procedure 77, city to empty is 81, and highway to empty is 84
[[fact:epa-single-cycle-routes]]. A Multi-Cycle Test's city and highway consumption aren't measured
directly at the wall. They're worked out from the one recharge, the DC energy and the distance of each
cycle [[fact:epa-mct-sequence]].
:::
