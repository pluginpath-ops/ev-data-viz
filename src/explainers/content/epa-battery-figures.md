---
slug: epa-battery-figures
title: What EPA says about the battery
related: [epa-vs-real-world, reading-modeled-efficiency, 400v-vs-800v]
linked_from: [Browse Pack and Voltage columns, curve capacity badges, Certification Statistics]
status: DRAFT
---

## The short version

"How big is the battery?" sounds like it should have one answer. EPA's data gives you at least two, and
neither is quite the number people mean:
- **The pack as built (gross).** The Fuel Economy Guide lists a voltage and an amp-hour capacity for each
  pack. Multiplied together, they give roughly the nameplate energy [[fact:epa-gross-pack-v-ah]].
- **What the car actually used (usable).** The lab drives the car until it stops, and measures the energy
  that came out of the battery on the way [[fact:epa-mct-sequence]]. That's the energy you can really drive
  on, and it's a few percent smaller [[fact:evbench-usable-vs-gross]].

Why the gap? Makers keep a buffer at the top and bottom of the pack that you can't use, which protects the
cells and leaves some margin after the gauge reads zero [[fact:pack-buffers]].

::: held
Owner: add color on buffers. Who publishes gross and who publishes usable, and why marketing leans on the
bigger number. The buffer explanation needs a ledger fact (accepted?) before it can stay as stated.
:::

::: figure gross-vs-usable One pack drawn as a bar: gross energy, the buffers at top and bottom, and the usable energy the lab measured, with the Fuel Economy Guide and certification figures labeled where they sit.

## Why this matters for range

Range is usable energy divided by energy per mile. If you use the gross figure you'll overestimate range
by the size of the buffer. That's why EVBench's [Modeled Efficiency chart](reading-modeled-efficiency)
prefers the usable energy from the car's own test, and marks a curve whose range axis had to fall back on
the gross figure.

## Pack voltage: read it with care

The guide also lists a pack voltage, and it's tempting to use it to sort cars into "400V" and "800V". Be
careful. A pack's voltage swings a long way between empty and full [[fact:gm-ultium-80s-pack]], and the guide doesn't record one
consistent point on that swing. Some makers file the full-charge voltage and others something lower
[[fact:epa-voltage-points-differ]]. It's fine for telling the classes apart, but not for comparing two cars
within a class. The [400 V vs 800 V explainer](400v-vs-800v) covers why the voltage matters in the first
place.

## Charging losses are in the label

EPA's MPGe and kWh/100 mi are measured *at the wall*. The test recharges the car from an ordinary AC
outlet with its own charger, and the energy that goes into that recharge, losses included, is what gets
counted [[fact:epa-mpge-at-the-wall]]. That's what you pay for at home, so it's the right number for cost.
It isn't the energy the battery delivered to the motors, which is smaller.

::: held
Owner: worth a worked example. The same car's kWh/100 mi from the wall and from the battery, and what the
difference is in dollars per year. The R2 is one of the few records with both sides reported (85.5%).
Needs a ledger fact.
:::

::: engineers
From the certification records, charging efficiency is DC energy discharged ÷ AC energy to recharge, and
only when both are reported (the Multi-Cycle Test records DC throughout [[fact:epa-mct-sequence]]). The
MPGe conversion is 33.7 kWh per gallon [[fact:epa-mpge-33-7]]. EVBench's usable ÷ gross distribution is on
EPA › Certification Statistics. Ratios above 1 are dropped there, because a pack can't deliver more than
it holds.
:::
