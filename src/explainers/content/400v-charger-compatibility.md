---
slug: 400v-charger-compatibility
title: How 800 V cars use 400 V chargers
related: [400v-vs-800v, heat-generation]
linked_from: [spec hint dc_400v_charging, spec hint max_dc_400v_kw, platform page "How 400 V support works →"]
status: DRAFT
---

## The short version

A DC fast charger can only push current into a pack whose voltage sits
inside the charger's output range. A modern unit such as the ABB Terra 360
reaches 920 V [[fact:abb-terra360-ratings]], but many chargers still in
service stop far lower. Makers design around them: Lucid built the
Gravity's boost for chargers of about 500 V [[fact:lucid-gravity-400v-method]],
and Mercedes needs a converter before the CLA can use 400 V chargers at all
[[fact:mercedes-cla-400v-method]].

In the US, those lower-voltage chargers are mainly older 50 kW units and
Tesla Superchargers before V4 [[fact:older-chargers-500v]].

So every 800 V car has to answer one question: **what happens on a 400 V
charger?** There are four answers, and they differ a lot in how fast the
car charges there.

| Method | How it works | What limits power on a 400 V charger | Example |
|---|---|---|---|
| Native | The pack is 400 V class | The charger | Most 400 V cars |
| DC booster | A separate converter steps the charger's voltage up to the pack's | The converter's rating | 2025+ Taycan, 150 kW [[fact:taycan-2025-booster]]; Lucid Air, 50 kW [[fact:lucid-air-400v]]; Mercedes CLA with its converter [[fact:mercedes-cla-400v-method]] |
| Motor boost | The drive inverter and motor windings act as the step-up converter | The drive unit's current rating | E-GMP [[fact:egmp-motor-boost]]; Lucid Gravity, up to 225 kW [[fact:lucid-gravity-400v-method]] [[fact:lucid-gravity-400v-kw]] |
| Split pack | Switches split the pack into two halves, charged side by side at half the voltage | Charger current × half-pack voltage | Audi Q6 e-tron (PPE), up to 135 kW [[fact:audi-ppe-bank-charging]]; Cybertruck, which switches its halves with one DPDT contactor [[fact:cybertruck-400v-method]] |
| None | The car cannot charge there | — | A Mercedes CLA built without the converter [[fact:mercedes-cla-400v-method]] |

## Why a split pack can fall behind a booster

A split pack needs no converter. Instead, it charges both halves side by
side, so the charger sees only half the pack's voltage. Power is voltage
times current, and the charger's current is capped. So the power is capped
at about the charger's current times half the pack voltage
[[fact:physics-split-pack-power]].

That is why it matters how high the pack's voltage is. Take an ABB Terra
360, whose current peaks at 500 A [[fact:abb-terra360-ratings]]. Halves at
300 V give at most 150 kW. Halves at 450 V give up to 225 kW. Audi's
figure for the Q6 e-tron is 135 kW [[fact:audi-ppe-bank-charging]].

Current ratings vary a lot from one charger to the next
[[fact:dc-cable-current-ratings]]. For a sense of scale: a Tesla V3 post
is labelled 350 A continuous [[fact:tesla-v3-cable-current]], which would
hold 350 V halves to about 120 kW. V3 posts do boost above that label
[[fact:tesla-v3-boost-current]], so treat this as the floor, not the
answer.

Try it: pick a charger and a pack, and see where each method runs out.

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

## The Gravity: slower peak, same cell heat budget

Lucid rates the Gravity at up to 400 kW on 1000 V chargers
[[fact:lucid-gravity-peak-kw]] and up to 225 kW sustained on 500 V ones,
including Tesla V3 Superchargers [[fact:lucid-gravity-400v-kw]].

The boost converter delivers power at the pack's own voltage, 810–926 V
depending on the figure quoted [[fact:lucid-gravity-voltage]]. So at 225 kW, each cell carries a little
over half the current it would at 400 kW. Heat in the cells goes with the
square of current, so it drops to about a third
[[fact:physics-cell-heat-scales-with-current-squared]]. The car can hold
its peak longer before heat forces a taper. *Model, not measurement.* The
overlay below compares it with the Gravity's charging tests in EVBench.

::: tests 23,81 See it in the Gravity's own charging tests: one on a 1000 V charger, one on a Supercharger, overlaid by state of charge.

---

::: held
- **BMW iX3, split pack.** BMW says only that a "switching matrix" lets it
  charge from 400 V stations [[fact:bmw-ix3-400v-capable]]. "Split" appears
  only in secondary press (`bmw-ix3-400v-method`). Once confirmed, the iX3
  is the strong split-pack example: 698.9 V gives ~350 V halves.
- **Cybertruck kW.** Its split pack is now sourced; the 250/325 kW
  figures are still secondary (`cybertruck-kw-by-charger`).
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
