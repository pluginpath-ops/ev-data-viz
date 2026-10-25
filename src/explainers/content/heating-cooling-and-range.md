---
slug: heating-cooling-and-range
title: How heating and cooling change a range test
related: [epa-vs-real-world, wind-and-range-tests, reading-modeled-efficiency, epa-drive-cycles]
linked_from: [Accessory Load slider on the correction target, test notes that say accessory load]
status: DRAFT
---

## The short version

A range test run at 20 °F and one run at 70 °F are not the same test, and a big part of the reason isn't the air.
Cold air is denser, which costs some drag [[fact:physics-air-density-drag]], but the heater draws from the same
pack that moves the car, and in AAA's tests it was the larger share of the loss [[fact:aaa-ev-range-hvac]]. In hot
weather the air conditioning does the same thing in the other direction. No test in EVBench records how much heating or cooling it used, so the correction
has to guess. This page is about what it guesses, why, and how far to trust it.

The guess is simple. EVBench assumes every test ran with a base accessory load of 300 W, which covers the lights,
electronics and a cabin that is holding itself at a comfortable temperature
[[fact:evbench-assumed-test-accessory-load]]. That is about right when it is 60 to 70 °F outside: most range tests
are run with the cabin at 68 to 72 °F [[fact:evbench-test-cabin-setpoint]], which a car manages on its own at about
65 °F. Outside that band the assumed load climbs in a straight line, 50 W for every °F colder than 60 and 70 W
for every °F hotter than 70 [[fact:evbench-accessory-load-curve]]. So a test at 20 °F is assumed to have run a
2,300 W heater alongside its base load, and one at 95 °F about 1,750 W of air conditioning on top of it.

## Why does a heater cost more miles on a slow day?

Because a heater draws power, not distance. A 2,000 W heater costs 2 kWh every hour whether the car is crawling or
cruising. At 70 mph that hour is 70 miles, so the heater costs about 29 Wh a mile. At 50 mph the same hour is
only 50 miles, and the same heater costs 40 Wh a mile [[fact:physics-accessory-energy-per-mile]].

That is why the effect is not a flat percentage and not the same on every test. A slow winter test, with a lot of
time per mile, pays more for its heater than a fast one. It is also why EVBench turns the watts into miles using
each test's own speed and its own energy use, not a fixed fraction of range. (Speed and wind work differently:
they change the *force* on the car, which grows with the square of speed [[fact:physics-aero-drag-speed-squared]].
The heater is a fixed cost per hour.) For how wind is handled, see [How wind changes a range test](wind-and-range-tests).

## What happens to a corrected figure

When a test is corrected to a common basis, EVBench takes out the accessory load the test is assumed to have
used, corrects what is left for speed, air density and wind as before, and puts back the load for the conditions
the reader asked for. Two worked cases, both for a test at 70 mph:

| The test | Corrected to | Air density alone | With the assumed load |
|---|---|---|---|
| 20 °F, 350 Wh/mi | 70 °F | +7.3% | +16.7% [[fact:evbench-accessory-worked-cold]] |
| 95 °F, 300 Wh/mi | 70 °F | −3.1% | +5.7% [[fact:evbench-accessory-worked-hot]] |

The hot case is the surprising one. Warm air is thinner [[fact:physics-air-density-drag]], which flatters a test, so air density alone would say
the car was helped by the weather and take about 3% off its range. But the car was also running its air
conditioning, and once that is allowed for the same test looks harder, not easier, than a 70 °F one.

The slider works the other way too. If a reader corrects a mild-weather test to 20 °F, the 2,300 W heater is
added back in, and the range drops accordingly. The Accessory Load slider on the correction target follows the
temperature slider until the reader moves it; after that it stays where they put it, and its "auto" button
hands it back.

A smaller change you may notice on every figure, even at 70 °F: the base load also counts per mile, so a 65 or 75
mph test brought to 70 mph moves about 0.2% differently than it did before, and an 80 mph test about 0.5%
[[fact:evbench-accessory-small-at-70]].

## What does EPA assume?

EPA runs five tests for the label, and only two of them involve the cabin. The city, highway and high-speed
tests run with no heating, ventilation or air conditioning at all. The hot test at 95 °F runs with the climate
control set to cool the cabin, and the cold test at 20 °F with it set to specific settings for heat and defrost
[[fact:epa-hvac-in-five-cycle-tests]]. (The five tests are laid out in
[The five test cycles](epa-drive-cycles).)

For the hot test we can say more, because the regulation is public. The air-conditioning cycle (SC03) runs at
95 °F, about 40% relative humidity and a heavy simulated sun, with the air conditioner at maximum, on recirculate,
the fan at its highest and the temperature at full cool, or 72 °F for an automatic system
[[fact:epa-sc03-conditions]]. That is a deliberately demanding setting, held for a short city-speed test. For the
cold test the exact heater and defrost settings are not given on EPA's page, and we did not find them elsewhere,
so we cannot say what load EPA's cold test assumes.

Most EV labels don't run either of those two tests. The range comes from the city and highway tests and a flat
adjustment for the things they leave out, air conditioning and cold among them
[[fact:epa-adjusted-for-real-world]] [[fact:epa-0-7-factor]], which is the subject of
[Why your highway range isn't the label](epa-vs-real-world).

An independent look at the same question comes from AAA, which put five electric cars through temperature-controlled
dynamometer tests in 2019. With the climate system in use, the average range fell by 41% at 20 °F and by 17% at
95 °F, compared with 75 °F [[fact:aaa-ev-range-hvac]]. That is one study of five cars, and one maker disputed
it, so it tells us the order of magnitude, not a number for any car.

## Where the assumption is weakest

EVBench uses one straight line for every car. That is a convenience, and a rough one:

- **Heat pump or resistive heater.** A heat pump moves two to three units of heat for each unit of electricity,
  where a resistive heater makes one, so for the same warmth it draws roughly a half to a third as much, until
  deep cold takes the advantage away [[fact:physics-heat-pump-vs-resistive]]. The line is one answer for both. A
  heat-pump car corrected from a cold day will be over-credited, and a resistive one under-credited.
- **Below freezing.** The error in the assumed load is comparable to the effect itself. A cold pack can also
  need conditioning, and tyres and regeneration behave differently; EVBench does not model any of that. EVBench lets
  you correct to 0 °F, and includes tests down to 0 °F in a composite, because you asked or because that is the
  data; it just does not claim the answer is precise.
- **Car size and shape.** A larger cabin and more glass take more to heat and cool. The slopes are a starting
  point rather than a fit, and the owner's own view is that the truth probably depends heavily on the vehicle.
  Checking the corrections against actual tests is a separate piece of work (#475).
- **Time stopped, soak and pull-down.** The line is a steady-state average for a moving car. EVBench does not model the pull-down of a hot-soaked
  cabin, which draws much more at first.
- **The reference table.** The accessory-load table behind the slider's ⓘ lists heat-pump, resistive, A/C,
  battery-conditioning and lighting draws by temperature [[fact:evbench-accessory-reference-table]]. Its figures
  have no source recorded yet, which is why this page is still a draft. The assumed line was read against the
  table, not derived from it.

## How to read a corrected cold figure

Treat a figure corrected from or to a cold or hot day as a better comparison than the uncorrected one, not as a
measurement. The direction will be right (a cold test was harder than a mild one), the size is a reasonable
estimate for an average car, and the exact value carries the uncertainty above. Where two cars were tested on
different days, the correction is the reason to compare them at all; where one car was tested twice, in summer and
winter, the gap between the two corrected figures is a fair measure of how well the line fits that car.

::: engineers
For a test with measured consumption C (Wh/mi) at speed v, an assumed accessory load P(T) at its outside
temperature T, aero-and-rolling re-pricing ratio s = L_target / L_test from the existing correction (speed, air
density and wind), and a target load P* at target speed v*:

    a_test = P(T) / v
    C_target = (C − a_test) · s + P* / v*
    k = C / C_target

and k multiplies efficiency and range, as every correction factor does. P(T) is the base 300 W plus
50 W/°F below 60 °F and 70 W/°F above 70 °F [[fact:evbench-accessory-load-curve]]; P* is the same function of the
target temperature unless the reader sets it. A mixed cycle's own average speed is used for v, since the heater
runs on whatever the car does; a test that recorded no energy is taken as 300 Wh/mi and its note says so. If the
assumed accessory share ever exceeds the test's whole consumption, the accessory term is skipped and the note
says so. The code is `src/utils/accessoryLoad.js`; the constants are Admin knobs.

In Modeled Efficiency the same load is applied to the curve as the difference between the target's load and the
standard conditions', added to the record's own accessory load, so an untouched chart draws exactly what it
always has. A corrected range-test point is priced at the load its own weather is assumed to have cost.
:::
