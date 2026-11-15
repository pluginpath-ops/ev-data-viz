---
slug: charging-speed-and-energy
title: How does charging speed impact energy consumption?
related: [evbench-charging-energy, dc-fast-charging-loss, epa-battery-figures, heating-cooling-and-range]
status: DRAFT
---

## The short version

Possibly counter-intuitively, charging an EV slowly takes more energy. A 120 V wall outlet, Level 1 charging, is
the extreme case, but the same thing happens on a 240 V charger turned down below what the car can take. The reason
is driven primarily by the onboard systems that must run while a car charges. The vehicle keeps its charging computer, contactors, coolant pumps and other
electronics awake during the entire charging process [[fact:charging-control-electronics-draw]].  These systems tend to draw a few hundred watts regardless of the charging speed.  This means if charging takes 10 hours instead of 2 hours, the vehicle is forced to consume signficiantly more energy on things that are not going into the battery. The slower the charge, the bigger share of the overall power consumed during that charging session [[fact:physics-fixed-draw-share]].

How EVBench turns this into a figure for each car is on its own page:
[how EVBench calculates charging energy consumption](evbench-charging-energy).

## Where does the energy go?

Charging from a wall outlet loses energy in a few places:

- **The car staying awake.** The charging computer, the contactors that connect the pack, the 12 V system and any
  cooling pumps and/or fan run for the whole charge. Typically 100 to 300 W [[fact:charging-control-electronics-draw]]. 
  This part is roughly fixed in watts, and is the factor that penalizes a slower charge.
- **The onboard charger.** Turns the outlet's AC into DC for the battery. 
  On 120 V it has to draw twice the current for the same power and boost a lower voltage up to the pack's,
  typically returning slightly worse efficincy on 120V than on 240V [[fact:onboard-charger-light-load]]. 
  More power is not always better
  for the charger itself, though: each is tuned to a range, and in a Danish test two older cars' chargers did
  slightly worse at 3.7 kW than at 2.3 kW [[fact:onboard-charger-loss-dtu-2016]].
- **The wiring.** Every wire turns some current into heat. The house circuit to a 120 V outlet is usually significantly thinner wire than 
  any other part in the EV charging chain, and a long run of 14 gauge copper can lose over 1% to heat in the wire.  Increasing voltage to 240V drops the impact this has. The the charging cord adds a little more, though typically negligible at low currents [[fact:physics-ac-cable-loss-share]].
- **The battery.** Some energy turns to heat in the battery cells going in, and more coming back out. At L1 and L2 charging rates, this is minimal [[fact:onboard-charger-loss-dtu-2016]], and in mild weather the pack needs no heating or
  cooling [[fact:charging-control-electronics-draw]].

As a real world case, data pulled from the owners Rivian splits the energy of each charge session into what reached the pack,
battery heating, and what the truck's electrical systems used. Over 203 Level 2 charges in 2026, the systems side
consistently required 140-150 W for every hour the truck was actively charging, and nothing once charging stopped, however long it stayed plugged
in [[fact:r1t-charging-systems-draw-roamer]]. That figure is measured **after** the onboard charger, so the charger's own
operating losses (estimated to be ~5%) should be added on top of it.

## Into the battery, or back out?

Before comparing 3rd party tested figures, it is important to understand how each is measured. The studies below measure energy from the outlet or EVSE 
to what goes *into* the battery. 

Conversely, what the EPA, and so EVBench cares about, is the energy required to *drive*.  This means we use the energy *out* of the battery. 
The way this is captures is to divid what the battery output during the EPA testing cycles by the AC Recharge event energy, as measured from the wall
[[fact:epa-charger-efficiency-is-ac]]. As a reminder, this is what the EPA MPGe figure is based off of, and why MPGe is typically lower than the reported efficciency of the vehicle while driving, because it includes losses observed while charging.

Interestingly, the EPA certification sheet for the 2011 Nissan Leaf shows us both. About 87% of the wall energy reached the pack, and 96
to 97% of that came back out, so on EPA's modern basis the Leaf charged at about 84 to 85%
[[fact:leaf-2011-csi-charger-and-pack]]. With these older cars, a figure measured *into* the battery can be expected to read about 3 points higher than the figures we see on the EPA cycle. The first-generation Chevrolet Volt, recharged at 240 V, came out lower, at 80 to 82% on EPA's basis
[[fact:volt-2011-csi-charge-depleting]].

Idaho National Laboratory's tests of four 2013 plug-ins measured both as well, recharging each at 240 V after a range
test. The Leaf, Focus Electric, Fusion Energi and Volt put 81 to 91% of the charging station's output into their
batteries, and their batteries gave back mostly 95 to 98% of it, so on EPA's basis they landed at 77 to 89%
[[fact:inl-baseline-recharge-2013]]. That is the same few points again, and the Leaf's 82 to 85% matches its EPA
certification. Its later tests of a 2014 BMW i3 and a 2015 Mercedes B-Class landed at 84 to 87% and 80 to 85% on
EPA's basis [[fact:inl-baseline-recharge-2014-2015]].

Because the offset is about the same whichever charger filled the battery, it hardly changes a slow-against-fast
comparison. That is what carries over from the studies.

## Does 240 V beat 120 V at the same power?

On 120 V a charger draws twice the current for the same power, and has to boost a lower voltage up to the pack's,
so you would expect it to do a little worse. For most cars that have been measured, it does. Six cars have been
tested on both at about the same power, and four of them lost 2 to 3 points more on 120 V
[[fact:onboard-charger-light-load]]:

- **2017 Bolt:** about 14.6% lost on 120 V at 1.44 kW, against 12.2% on 240 V. It also lost about ½ point more on
  208 V than on 240 V from 3 to 7 kW [[fact:anl-charging-loss-fits-2020]].
- **2014 i3:** about 2 points worse on 120 V [[fact:inl-steady-state-i3-2014]].
- **2012 and 2015 Leaf:** about 2 and 3 points worse on 120 V than on 208 V
  [[fact:inl-steady-state-leaf-2012]] [[fact:inl-steady-state-leaf-2015]].

Two cars go the other way. The 2012 Volt's charger read a little better on 120 V than on 208 V
[[fact:inl-steady-state-volt-2012]], and the B-Class's efficiency follows current rather than voltage, so at the
same power its 120 V setting read about 5 points better [[fact:inl-steady-state-b-class-2015]].

So higher voltage usually helps the charger a little, but not always, and it is small beside the fixed draw. EVBench's
rule leaves it out: it prices a slow charge by time alone.

## Does three-phase do better?

In Europe, Australia and New Zealand, a home wallbox can use three-phase power, and every ADAC charge but the socket
was three-phase [[fact:ac-socket-vs-wallbox-adac-2026]]. It is very likely a little more efficient. In the wiring,
three phases at the same power over the same wire lose about a sixth of what a single phase does
[[fact:physics-three-phase-cable-loss]], though a proper 240 V circuit already loses under 1%. Inside the car,
three-phase power flows steadily instead of pulsing twice a cycle, which eases the charger's work, though many
chargers simply run three single-phase stages [[fact:onboard-charger-three-phase-designs]]. DTU's Renault Zoe was 49%
efficient on a single-phase 2.3 kW charge and 63 to 65% on three-phase 11 to 43 kW, though power changed along with
the phases [[fact:onboard-charger-loss-dtu-2016]].

What ADAC's figures do show is that power matters more than phase count. At 4.1 kW, three-phase like the wallbox, its
cars still lost 8.0 to 12.8%, against 5.1 to 7.0% at 11 kW [[fact:ac-socket-vs-wallbox-adac-2026]]. Same phases, less
power, more loss: that is the fixed draw again. ADAC's socket-to-wallbox gap mixes power with phase count, which may
make it a little too big for a US single-phase 240 V charger, while a US outlet's 120 V costs most chargers measured
2 to 3 points more than 240 V at the same power [[fact:onboard-charger-light-load]]. We cannot say which wins.

## Is there a cost per charge?

Short charges lose the most: under 4 kWh, the 120 V gap in the Vermont study more than doubled
[[fact:ac-level1-vs-level2-sears-2014]]. That suggests a cost paid once per charge, waking the car up and settling it
down, on top of the cost per hour. For current cars it looks small. ADAC found that adding 20% or 50% of the battery
made no meaningful difference to its losses [[fact:ac-socket-vs-wallbox-adac-2022]], and the R1T's systems used about
50 Wh per charge beyond their hourly draw, about 20 minutes' worth [[fact:r1t-charging-systems-draw-roamer]]. EVBench
leaves it out.

## What about the cold?

A cold battery will not take a full charge until it is warm, so a car parked outside in winter spends energy warming
it first. How much varies a great deal from car to car, with the heater, the pack's size and its insulation.

The R1T shows the shape of it on 240 V. On cold nights the truck spent 1 to 5 kWh warming its battery per charge, and
how long the charge ran barely mattered: one 2-hour charge took 5.3 kWh, one 10-hour charge 5.2
[[fact:r1t-charging-systems-draw-roamer]]. So it is a burst, a heater running hard for an hour or two, after which the
charging itself keeps the pack warm. From May to October it took almost nothing, and over the year it was 1.5% of
the energy. On a 120 V outlet the charging adds almost no heat of its own, so the car may have to keep warming the
pack for as long as it charges; we have found no measurement of that.

The studies tell us little more. The Vermont study is the only one here that logged temperature, from 25 to 88 °F
[[fact:ac-level1-vs-level2-sears-2014]]:

- **Heat hurt Level 1.** Above 70 °F, Level 1 charges averaged 81.4%, against 83.8% overall.
- **Cool weather did not.** Below 50 °F, Level 1 averaged 83.0%, about the same as overall.
- **Level 2 did not change** with temperature anywhere in that range.
- **Real cold is untested.** There were too few charges below 40 °F to say anything, though the lowest single Level 1
  results on its chart, down to about 49%, sit in that colder range.

ADAC kept its batteries at 20 to 30 °C to leave warming out [[fact:ac-socket-vs-wallbox-adac-2026]]. Warm weather may
add a little too: the R1T's systems drew about 180 W from June to September against about 135 W in winter, perhaps a
radiator fan [[fact:r1t-charging-systems-draw-roamer]].
