# EPA curve adjustment — issue & proposed (deferred) tool

**Status:** documented, **not implemented** (decision: keep faithful-to-EPA for now).

## The issue

The EPA steady-state efficiency/range curve is built from the manufacturer's
submitted road-load coefficients (Target A/B/C) plus the back-solved drivetrain
efficiency η. η is anchored to the **measured HWFET point (~48 mph)**, so the
curve passes through real test data at that speed. Above the anchor the curve's
shape is governed almost entirely by **C** (the aerodynamic, v² term).

Some OEMs appear to submit **conservative road-load coefficients** — inflating
the curve at highway speeds so it reads pessimistically vs. real-world testing,
even though it matches the EPA *rated* range (which is derived from the same
coefficients).

### Worked example — Porsche Taycan Turbo GT (`CSI-TPRXV00.0ETT`)
- η = 84.1% (measured, in-band) — **not** the problem.
- Useable battery ~97 kWh — **not** the problem.
- Target C = **0.024449**, ~**2× a comparable sedan** (Tesla Model 3 ≈ 0.0122),
  despite the Taycan's excellent aero (Cd ~0.22).
- Tell: Porsche reuses the **same A/B/C for the cold test**, where other OEMs run
  *higher* cold coefficients — implying the base set is already conservative.

Resulting curve (useable 97 kWh):

| Speed | As submitted | If C halved (≈physical) | Real-world (~InsideEVs) |
|------:|-------------:|------------------------:|------------------------:|
| 70 mph | 2.44 mi/kWh → 236 mi | 2.76 mi/kWh → 268 mi | ~3.0 mi/kWh |

So the high-speed pessimism is almost entirely the inflated **C**.

### Why it's not a bug
- η absorbs any *uniform* scaling of A/B/C (the curve only depends on the ratio
  F(70)/F(48.3)); only **C relative to A/B** changes the high-speed shape.
- The curve faithfully reflects EPA's submitted road-load. The gap to reality is
  the manufacturer's conservatism, not a modeling error. The same coefficients
  drive EPA's own rated range, which is why our curve and the EPA rating agree
  while both understate real-world.

## Why we are NOT auto-adjusting or editing Target C
- Target A/B/C are **authoritative EPA source-of-truth**. Editing C in the
  curator form overwrites it (recoverable only via the audit trail) — we don't
  want to mutate submitted data as a matter of course.
- There's no second measured steady-state point in the CSI to re-fit from, so we
  can't automatically know the "true" C.

## Proposed tool (deferred): non-destructive real-world anchor
A curator-judgment adjustment layer that **preserves the EPA coefficients**:

- Curator enters one **real-world observation** — consumption at a speed
  (default 70 mph), e.g. "3.0 mi/kWh @ 70".
- Solve the **aero (C) adjustment factor** that makes the steady-state curve pass
  through *both* the EPA HWFET point *and* the real-world point. (Re-derive η with
  the adjusted C so the measured ~48 mph anchor stays exact — you only correct the
  high-speed shape, not the validated level.)
- Store as a **separate factor** (e.g. `aero_adjust`, default 1.0) — Target C is
  never touched; clearing it reverts to pure EPA. Flagged + audited.

Mechanically this is the same plot-time C-scale as the existing **altitude
adjustment**, but persisted and grounded in a real data point rather than
arbitrary fudging. C is the correct/sufficient lever because the curve is already
pinned at the measured ~48 mph point, so the EPA HWFET test is the first anchor
and the curator's real-world figure is the second — two points uniquely determine
the adjustment.

### Alternatives considered
- **Raw aero multiplier** (`× factor` by judgment) — quicker, but not tied to a
  measurement.
- **Editing Target C directly** — rejected (destroys source-of-truth).

## Decision
Leave the curve faithful-to-EPA for now; revisit this tool if/when correcting
real-world pessimism becomes a priority. This note captures the analysis and the
proposed design so it can be picked up later.
