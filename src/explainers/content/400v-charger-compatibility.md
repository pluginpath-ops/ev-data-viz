---
slug: 400v-charger-compatibility
title: How 800 V cars use 400 V chargers
related: [400v-vs-800v, heat-generation]
linked_from: [spec hint dc_400v_charging, spec hint max_dc_400v_kw, platform page "How 400 V support works →"]
status: DRAFT
---

## The short version

A DC fast charger can only push power into a pack whose voltage is within
the charger's output range. Most EVs have batteries in the "400V" class and 
can easily be charged directly with any DC fast charger. But increasingly, EVs are 
entering the "800V" class [[fact:epa-800v-share-by-year]] [for a variety of reasons](400v-vs-800v). The voltage 
of these batteries is too high to be charged directly on older, lower-voltage chargers
including Tesla Superchargers (before V4) and many older 50 kW units [[fact:older-chargers-500v]]. 
Some cars simply can't: the Mercedes CLA launched unable to use a 400 V charger at
all, and only gained one with a factory-fitted converter [[fact:mercedes-cla-400v-method]].

Manufacturers' compatibility with lower-voltage chargers falls into 5 categories:

| Method | How it works | What limits power on a 400 V charger | Example |
|---|---|---|---|
| Native | Pack is 400 V class | The charger | Most 400 V cars |
| DC booster | A separate converter steps the charger's voltage up to the pack's | The converter's rating | 2025+ Taycan, 150 kW [[fact:taycan-2025-booster]]; Lucid Air, 50 kW [[fact:lucid-air-400v]]; Mercedes CLA with its converter [[fact:mercedes-cla-400v-method]] |
| Motor boost | The drive inverter and motor windings act as the step-up converter | The drive unit's current rating | E-GMP [[fact:egmp-motor-boost]]; Lucid Gravity, up to 225 kW [[fact:lucid-gravity-400v-method]] [[fact:lucid-gravity-400v-kw]] |
| Split pack | Switches split the pack into two halves, charged in parallel with half the voltage | Charger current × half-pack voltage | Audi Q6 e-tron (PPE), up to 135 kW [[fact:audi-ppe-bank-charging]]; Cybertruck, which switches its halves with one DPDT contactor [[fact:cybertruck-400v-method]] |
| None | Cannot charge there | — | A Mercedes CLA built without the converter [[fact:mercedes-cla-400v-method]] |

## Why do manufacturers use 800V?
Higher voltage allows faster charging (and discharging) given current/amperage limitations.  

Power is voltage times current, and the charger's current is capped, so at the same current a
higher-voltage pack takes more power [[fact:physics-current-for-power]].
That is why it matters how high the pack's voltage is. 

For a more in-depth explainer, refer to [the 400 V vs 800 V explainer](400v-vs-800v).

Even within the 400V class, voltage still matters.  Take an ABB Terra
360, whose current peaks at 500 A [[fact:abb-terra360-ratings]]. Battery systems presenting
at 300 V will receive at most 150 kW. Batteries at 450 V can charge at up to 225 kW
[[fact:physics-current-for-power]].


## Tradeoffs in compatibility approaches

The most common strategy for lower power and cheaper EVs is to simply 
use a 400V class pack.  These allow the vehicle to leverage more established
electronics and have broad DCFC compatibility [[fact:400v-pack-cheaper-established]].

For 800V class vehicles, the approach depends on several factors [[fact:800v-compat-tradeoffs]]:
- Total battery system voltage and design
- Feasibility to design the inverter and motor to handle voltage conversion
- Acceptable cost impacts

A split pack needs no converter: a set of contactors reconfigures the battery between one
series string and two halves in parallel. The Cybertruck does it with a single DPDT contactor
[[fact:cybertruck-400v-method]]. In effect the charger sees only half the pack's voltage, so
its power is capped at about the charger's current times half the pack voltage
[[fact:physics-split-pack-power]]. The cost moves into the architecture instead:
- The battery must be arranged in logical modules that can be evenly split
- The system must support continued operation at half the typical voltage [[fact:physics-split-pack-half-bus]]

Current ratings vary a lot from one charger to the next
[[fact:dc-cable-current-ratings]]. For a sense of scale: a Tesla V3 post
is labelled 350 A continuous [[fact:tesla-v3-cable-current]], this limits a 
350 V effective battery (700 V native) to about 120 kW. V3 posts do boost above that label
[[fact:tesla-v3-boost-current]] for a short period, depending on weather and equipment conditions.

Try it: pick a charger and a pack, and see where each method works best.

::: lab split-pack

::: engineers
- Split pack: P_400 ≈ min(P_chg, I_chg,max × V_pack/2). The half-pack
  voltage rises through the session, so a current-limited split pack
  *gains* power with SoC until the cells' own taper takes over.
- Booster (dedicated or motor): P_in = min(P_chg, V_in × I_chg,max,
  P_converter), where V_in is the voltage the booster draws at. The pack
  side receives η × P_in at full pack voltage.
- Lucid argues for motor boost over pack splitting on voltage: it charges
  with "the highest voltage that a charging station is capable of
  outputting" [[fact:lucid-gravity-400v-method]]. In EVBench's experience
  that is at most about 450 V from a 500 V charger [[fact:booster-input-voltage]].
- So on the same charger current, whichever sees the higher voltage wins:
  the booster's input voltage against the half-pack voltage
  [[fact:physics-split-pack-power]]. With boosters near 450 V, a booster
  clearly beats halves as low as the Silverado's ~300 V, while halves near
  425–465 V, like the Taycan's or the Gravity's, match or beat it before
  the booster's own rating even comes in.
- The losses land in different places. A booster's are in the converter,
  or in the inverter and windings for motor boost, so it heats the drive
  unit. A split pack's are in extra contactors and in balancing two halves.

:::

## When lower power may not mean significantly longer charging

Charging batteries is a complex process that is managed by the Battery Management System (BMS).
This system has a complex algorithm to optimize battery charging based on a variety of factors
including voltage, temperature, current.  When a cell is reaching its maximum safe temperature, 
the charging speed must be reduced to prevent battery degradation or damage.

In the case of fast charging, many vehicles "ride" the line of maximum thermal input for a portion
of the charging curve.  If charging is limited, it is possible that the peak charging speed can
be maintained longer [[fact:bms-rides-thermal-limit]].


Take the case of the Lucid Gravity that is rated at up to 400 kW on 1000 V chargers
[[fact:lucid-gravity-peak-kw]] and up to 225 kW sustained on 500 V ones,
including Tesla V3 Superchargers [[fact:lucid-gravity-400v-kw]].

The motor boost converter delivers power at the pack's own voltage, 810–926 V
 [[fact:lucid-gravity-voltage]]. So at 225 kW, each cell carries a little
over half the current it would at 400 kW. Heat in the cells goes with the
square of current, so it drops to about a third
[[fact:physics-cell-heat-scales-with-current-squared]]. The car can hold
its peak longer before heat forces a taper. *Model, not measurement.*

EVBench's own tests bear it out: the Gravity took 24.5 minutes from 10 to 80 % at a 418 kW
peak on a 1000 V charger, and 28.6 minutes at a 210 kW peak on a Supercharger, about 17 %
longer on half the peak power [[fact:gravity-10-80-by-charger]].

::: tests 23,81 x=time y=soc Lucid Gravity charging tests: On a 1000 V charger & on a V3.5 Supercharger

---

::: held
- **BMW iX3, split pack.** BMW says only that a "switching matrix" lets it
  charge from 400 V stations [[fact:bmw-ix3-400v-capable]]. "Split" appears
  only in secondary press (`bmw-ix3-400v-method`). Once confirmed, the iX3
  is the strong split-pack example: 698.9 V gives ~350 V halves.
- **Cybertruck on a V3 cabinet.** Its split pack, 325 kW on V4 posts and
  500 kW on a V4 cabinet are all sourced now. What is still observed only is
  why V4 posts lifted it (`v4-post-lifts-v3-cabinet`).
- **GM Ultium trucks.** They may be the reverse case: 400 V packs that
  series-connect to take 800 V (`gm-ultium-series-switch`). They are left
  out of the table until GM says how they work.
- **V3 context is flagged, not load-bearing.** The 350 A label and the
  boost figures are observed by EVBench; the ~500 V ceiling is accepted.
  The opening's premise rests on Lucid's and Mercedes' own statements. A
  Tesla document for any of them would upgrade it.
- **E-GMP 80 → 150 kW by year** (`egmp-400v-kw-by-year`).
- **Cost ranking** split < motor boost < dedicated booster: no source, so
  it would only appear as a parts-count argument.
- **Gravity tests.** The page now links runs 23 and 81. Run 81's source
  field reads "asdf" and it has no URL, and no run records its charger
  class, so the link says which is which only by the runs' names. Fix the
  record before the page drops Draft.
:::
