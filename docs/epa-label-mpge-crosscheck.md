# Label-MPGe cross-check & missing-DC fallback (deferred)

**Status:** documented, **not implemented**. Desired approach: *cross-check + missing-DC fallback*.

## Idea
CSI PDFs report a per-cycle **"Manufacturer Fuel Economy"** (e.g. Ford F-150
Lightning: ~89.9 MPGe highway, ~111.2 city). Use it to (a) validate our DC-side
η back-solve, and (b) provide a fallback η when the PDF has no DC energy.

## What that figure actually is (verified)
- **AC-side (wall-to-wheel), unadjusted.** Cross-checked on the Tesla: reported
  157.03 MPGe ↔ the comment's unadjusted DC figure 191.47 Wh/mi (≈176 MPGe DC)
  × ~0.89 charger eff = 157. So it's the *raw test* value, **not** the
  window-sticker adjusted number — using it does NOT re-introduce the adjustment
  derate that caused the original η bug.
- **Unit-ambiguous per OEM** — same trap as `RND_ADJ_FE`. Rivian reports it as
  **kWh/100mi** (≈26 for a UDDS bag), Ford/Tesla as **MPGe** (89.9 / 157). Any
  use needs magnitude-based normalization (≥~60 ⇒ MPGe, else kWh/100mi).

## The catch: AC vs DC
Our back-solve is **DC** (battery-out); this figure is **AC** (wall). They differ
by the charger efficiency, so a comparison needs that bridge:
- **DC available** (Rivian/Lucid/Tesla-synth) → pure cross-check:
  `reported_AC_MPGe ≈ 3370.5 / (our_DC_HWFET ÷ charger_eff)`. Flag divergence.
  No new assumptions; validates parse + coefficients (would also have caught the
  Porsche inflated-C case).
- **DC missing** (Ford) → fallback:
  `reported highway MPGe → AC consumption → ÷ assumed charger_eff → DC
  consumption → back-solve η`. Turns the flat default η into a label-grounded
  estimate. Adds ONE assumption (charger eff); must be tagged
  `estimated-from-label` (below `measured`) and never override a real DC-measured η.

## Storage consideration
The per-cycle "Manufacturer Fuel Economy" (unadjusted AC MPGe, city + highway)
doesn't cleanly map onto existing fields:
- `label_combined_mpge` / `label_hwy_mpge` are populated from the CSV
  `RND_ADJ_FE` path and are conceptually the *combined/highway label* values.
- The CSI per-cycle figures are a distinct provenance (unadjusted, AC, per cycle).

→ Likely needs **new field(s)**, e.g. `mfr_fe_city_mpge` / `mfr_fe_hwy_mpge` (or a
small `mfr_fuel_economy` jsonb), captured by the CSI parser, so the cross-check
and fallback have a clean source without overloading the label fields.

## Decision
Defer. When built: do **cross-check + missing-DC fallback**, with the new
storage field, magnitude unit-normalization, and clear provenance tagging.

## Related (shipped alongside this note)
Charger-efficiency assumed default lowered **0.90 → 0.88** — observed CSI charger
efficiencies cluster ~0.87–0.89 (only one OEM hit 0.90). See
`ASSUMED_CHARGER_EFF` in `src/utils/epaDerivations.js`.
