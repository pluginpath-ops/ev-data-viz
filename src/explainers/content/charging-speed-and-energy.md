---
slug: charging-speed-and-energy
title: How does charging speed impact energy consumption?
related: [evbench-charging-energy, dc-fast-charging-loss, epa-battery-figures, heating-cooling-and-range]
status: DRAFT
---

## The short version

Here's the surprise: a slow charge takes more energy than a fast one. A 120 V wall outlet (Level 1) is the worst
case. A 240 V charger turned down below what the car can take does the same thing, just less.

The main reason is time. While a car charges, it keeps its charging computer, contactors, pumps and other electronics
on [[fact:charging-control-electronics-draw]]. Together they draw a few hundred watts, and that draw stays about the
same at any charging speed. So a 10-hour charge pays for 10 hours of it, and a 2-hour charge pays for 2. On a slow
charge, that draw becomes a much bigger share of the energy you buy [[fact:physics-fixed-draw-share]].

A few smaller things matter too: the voltage, one phase or three, short charges, and the weather. This page goes
through each one. For the numbers EVBench uses, see
[how EVBench calculates charging energy consumption](evbench-charging-energy).

## Where does the energy go?

Energy from the wall can go to five places before it moves the car:

- **The car staying awake.** The charging computer, the contactors that connect the pack, the 12 V system, and the
  coolant pumps and fans all run for the full charge. They draw about 100 to 300 W
  [[fact:charging-control-electronics-draw]]. This draw stays about the same in watts, and it is the main cost of a
  slow charge.
- **The onboard charger.** It changes the outlet's AC into DC for the battery. On current cars, the charger, the
  wiring and the battery together lose about 2 to 8%, not counting the car's own draw
  [[fact:adac-per-car-fixed-draw-fit]]. Each charger
  works best in a range, so more power is not always better: in a Danish test, two older cars' chargers did slightly
  worse at 3.7 kW than at 2.3 kW [[fact:onboard-charger-loss-dtu-2016]].
- **The wiring.** Every wire turns some current into heat. A 120 V outlet usually has the thinnest wire in the chain.
  A long run of 14-gauge wire at 12 A can lose more than 2%. A proper 240 V circuit loses less than 1%, and the
  charging cord adds a little more [[fact:physics-ac-cable-loss-share]].
- **The battery.** The cells turn a little energy into heat when they charge, and a little more when they discharge.
  At home charging rates, this is small [[fact:onboard-charger-loss-dtu-2016]].
- **Heating or cooling the battery.** In mild weather the pack needs neither [[fact:charging-control-electronics-draw]].
  In the cold, warming it can cost more than everything else together (see below).

For a real example, take the owner's Rivian R1T. Rivian splits each charge into three parts: energy to the pack,
battery heating, and the truck's own systems. Over 203 Level 2 charges in 2026, the systems used 140 to 150 W for
each hour of charging. When charging stopped, they used nothing, however long the truck stayed plugged in
[[fact:r1t-charging-systems-draw-roamer]]. Rivian measures this after the onboard charger, so the charger's own loss
of a few percent comes on top.

## Into the battery, or back out?

Before you compare numbers, check what each one measures. There are two common ways:

- **Into the battery:** energy from the wall against the energy that reaches the battery. Most studies on this page
  measure this.
- **Back out of the battery:** energy from the wall against the energy the battery gives back when you drive. EPA
  measures this [[fact:epa-charger-efficiency-is-ac]].

EPA's way is the one that matters for driving. It is also why MPGe looks worse than the car's own efficiency
display: MPGe includes the charging loss [[fact:epa-mpge-at-the-wall]].

The difference between the two is the battery's round trip. EPA's test of the 2011 Nissan Leaf shows both: about 87%
of the wall energy reached the pack, and 96 to 97% of that came back out. On EPA's basis, that is 84 to 85%
[[fact:leaf-2011-csi-charger-and-pack]]. The first-generation Chevrolet Volt came out at 80 to 82% on EPA's basis
[[fact:volt-2011-csi-charge-depleting]].

Idaho National Laboratory (INL) measured both on six cars from 2013 to 2015. It recharged each one at 240 V after a
range test. The chargers put 80 to 91% of the wall energy into the batteries, and the batteries gave most of it
back. On EPA's basis, the cars got 77 to 89% [[fact:inl-baseline-recharge-2013]]
[[fact:inl-baseline-recharge-2014-2015]]. The 2013 Leaf's 82 to 85% matches its EPA figure.

So a figure measured into the battery reads about 3 points higher than EPA's. That gap is about the same for a slow
charge and a fast one, so the studies still show how much worse a slow charge is.

## What makes a charge less efficient?

Five things, from the biggest to the smallest.

### A slower charge

This is the big one. A slower charge runs longer, so the car's own draw runs longer too. ADAC, Germany's auto club,
measured this on five current cars [[fact:ac-socket-vs-wallbox-adac-2026]]:

- **11 kW wallbox:** 5 to 7% lost.
- **Wallbox turned down to 4.1 kW:** 8 to 13% lost.
- **2.3 kW household socket:** 13 to 24% lost.

The 4.1 kW and 11 kW charges both used three phases. So the extra loss at 4.1 kW came from the lower power, not from
the phases.

How much each car draws varies a lot. Across ADAC's nine cars, it ran from 134 to 503 W
[[fact:adac-per-car-fixed-draw-fit]].

### A lower voltage

On 120 V, a charger draws twice the current for the same power. It also has to boost a lower voltage up to the
pack's. So you would expect it to do a little worse, and for most cars measured, it does. Six cars were tested on
both voltages at about the same power, and four of them lost 2 to 3 points more on 120 V
[[fact:onboard-charger-light-load]]:

- **2017 Chevrolet Bolt:** about 14.6% lost on 120 V at 1.44 kW, against 12.2% on 240 V. It also lost about ½ point
  more on 208 V than on 240 V from 3 to 7 kW [[fact:anl-charging-loss-fits-2020]].
- **2014 BMW i3:** about 2 points worse on 120 V [[fact:inl-steady-state-i3-2014]].
- **2012 and 2015 Nissan Leaf:** about 2 and 3 points worse on 120 V than on 208 V
  [[fact:inl-steady-state-leaf-2012]] [[fact:inl-steady-state-leaf-2015]].

Two cars went the other way:

- **2012 Chevrolet Volt:** its charger did a little better on 120 V than on 208 V
  [[fact:inl-steady-state-volt-2012]].
- **2015 Mercedes B-Class:** its charger's efficiency follows the current, not the voltage. So at the same power, it
  did about 5 points better on 120 V [[fact:inl-steady-state-b-class-2015]].

Here are INL's full curves for four of those cars. They show the slow-charge effect too: three of the four chargers
get worse as the power drops [[fact:inl-steady-state-i3-2014]] [[fact:inl-steady-state-leaf-2012]]
[[fact:inl-steady-state-leaf-2015]] [[fact:inl-steady-state-b-class-2015]].

::: figure inl-efficiency

So a higher voltage usually helps a little, but not always. Next to the car's own draw, it is a small effect.

### One phase instead of three

In Europe, Australia and New Zealand, a home wallbox can use three-phase power. ADAC's wallbox charges used three
phases, and its socket charges used one [[fact:ac-socket-vs-wallbox-adac-2026]]. Three-phase is very likely a little
more efficient:

- **In the wiring:** at the same power and wire size, three phases lose about a sixth of what one phase loses
  [[fact:physics-three-phase-cable-loss]]. But a proper 240 V circuit already loses less than 1%.
- **In the charger:** three-phase power flows steadily, not in pulses, which makes the charger's job easier. But many
  chargers just use three single-phase stages [[fact:onboard-charger-three-phase-designs]].

One test hints at the size. DTU's Renault Zoe got 49% on a single-phase 2.3 kW charge, and 63 to 65% on three phases
at 11 to 43 kW [[fact:onboard-charger-loss-dtu-2016]]. But the power changed too, so this does not separate the two.

For US drivers, this cuts both ways. ADAC's socket-to-wallbox gap mixes power with phases, so it may be a little too
big for a US single-phase 240 V charger. But a US outlet is 120 V, not 230 V, and most chargers lose 2 to 3 points
more on 120 V [[fact:onboard-charger-light-load]]. We can't say which effect wins.

### Short charges

Short charges lose the most. In a Vermont study, the gap between 120 V and 240 V more than doubled on charges under
4 kWh [[fact:ac-level1-vs-level2-sears-2014]]. That points to a cost paid once per charge: the car wakes up, checks
itself, and shuts down again.

On current cars, this cost looks small. ADAC found no real difference between adding 20% and 50% of the battery
[[fact:ac-socket-vs-wallbox-adac-2022]]. The R1T's systems used about 50 Wh per charge on top of their hourly draw,
about 20 minutes' worth [[fact:r1t-charging-systems-draw-roamer]].

### Cold and heat

A cold battery can't take a full charge until it is warm. So a car parked outside in winter uses energy to warm its
battery first. How much depends on the car: its heater, the size of its pack, and its insulation.

The R1T shows the pattern on 240 V. On cold nights, the truck used 1 to 5 kWh per charge to warm its battery. The
length of the charge made almost no difference: one 2-hour charge used 5.3 kWh, and one 10-hour charge used 5.2
[[fact:r1t-charging-systems-draw-roamer]]. So the warming is a burst. A heater runs hard for an hour or two, and
after that the heat from charging keeps the pack warm. From May to October, the warming used almost nothing. Over the
year, it was 1.5% of the energy.

A 120 V charge makes very little heat of its own. So the car may have to keep warming the pack for the full charge.
We have found no measurement of this.

The studies tell us little more. The Vermont study is the only one here that logged temperature, from 25 to 88 °F
[[fact:ac-level1-vs-level2-sears-2014]]:

- **Heat hurt Level 1.** Above 70 °F, Level 1 charges averaged 81.4%, against 83.8% overall.
- **Cool weather did not.** Below 50 °F, Level 1 averaged 83.0%, about the same as overall.
- **Level 2 did not change** with temperature anywhere in that range.
- **Real cold is untested.** There were too few charges below 40 °F to tell. But the lowest Level 1 results on its
  chart, down to about 49%, are in that colder range.

Heat costs a little too. The R1T's systems drew about 180 W from June to September, against about 135 W in winter. A
radiator fan is a likely cause [[fact:r1t-charging-systems-draw-roamer]]. ADAC kept its batteries at 20 to 30 °C, so
its results leave warming out [[fact:ac-socket-vs-wallbox-adac-2026]].

::: engineers
Cable loss as a share of power is I²R ÷ (V·I) = I·R ÷ V, with R the resistance out and back. House wiring, 50 ft: 14
AWG (R ≈ 0.25 Ω) at 12 A and 120 V is 2.5%; 6 AWG (R ≈ 0.04 Ω) at 48 A and 240 V is 0.8%. EVSE cord, 20 ft: 8 AWG
(R ≈ 0.025 Ω) at 12 A is 0.25%, 14 AWG (R ≈ 0.10 Ω) 1.0%; 6 AWG (R ≈ 0.016 Ω) at 48 A is 0.3%
[[fact:physics-ac-cable-loss-share]]. Measured whole, INL found a Level 1 EVSE 98% efficient and Level 2 above 99%
[[fact:evse-efficiency-inl]].

Balanced three-phase at the same power and wire size: each of three conductors carries I/3, so the loss is
3·(I/3)²R = I²R/3, against 2·I²R for a single phase, a sixth [[fact:physics-three-phase-cable-loss]].

A fixed draw P₀ as a share of the wall power P is P₀ ÷ P: 200 W is 13.9% of 1.44 kW and 1.7% of 11.5 kW
[[fact:physics-fixed-draw-share]].
:::
