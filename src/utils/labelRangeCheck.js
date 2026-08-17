/**
 * Does the EPA label range agree with the vehicle's spec range? (#206)
 *
 * The two should normally match — `vehicle.range` is captured as "EPA Range" in
 * the spec schema, and `epa_test_groups.label_range_published` is that same
 * window-sticker figure arriving by a different route. When they disagree by a
 * lot, something is wrong: the wrong test group is linked, or one of them was
 * mistyped.
 *
 * ── Why this flags rather than ties ──────────────────────────────────────────
 *
 * The fields are deliberately NOT bound together. One vehicle trim legitimately
 * maps to several EPA configurations — a wheel and tyre change, a carry-over
 * model year — and those differ by a few miles with neither figure being wrong.
 * Nothing about that difference matters for charging or range comparison, so
 * forcing them equal would destroy real information to satisfy a checkbox.
 *
 * So this reports, and lets the curator judge. The delta is returned alongside
 * the verdict for exactly that reason: a threshold is a prompt to look, not an
 * answer.
 */

import { LABEL_RANGE_TOLERANCE_PCT } from '../constants/epa';

/**
 * Compare the two, when both exist.
 *
 * @param {number|string|null} labelMi  epa_test_groups.label_range_published
 * @param {number|string|null} specMi   vehicle.range
 * @param {number} [tolerancePct]       percentage gap treated as agreement
 * @returns {{ labelMi, specMi, deltaMi, deltaPct, mismatch }|null}
 *          null when either side is missing or unusable — nothing to compare is
 *          not the same as a disagreement, and must not read as one.
 */
export function labelRangeCheck(labelMi, specMi, tolerancePct = LABEL_RANGE_TOLERANCE_PCT) {
    const label = Number(labelMi);
    const spec  = Number(specMi);
    if (!(label > 0) || !(spec > 0)) return null;

    const deltaMi  = label - spec;
    // Against the spec range, which is the curated figure this is checking the
    // EPA record against.
    const deltaPct = (deltaMi / spec) * 100;

    return {
        labelMi: label,
        specMi: spec,
        deltaMi,
        deltaPct,
        mismatch: Math.abs(deltaPct) > tolerancePct,
    };
}

/** One line a curator can act on, or null when there is nothing to say. */
export function labelRangeCheckNote(check) {
    if (!check?.mismatch) return null;
    const { specMi, deltaMi, deltaPct } = check;
    const dir = deltaMi > 0 ? 'above' : 'below';
    return `Specs list ${specMi} mi — this is ${Math.abs(deltaMi).toFixed(0)} mi `
         + `(${Math.abs(deltaPct).toFixed(1)}%) ${dir} it. One trim can map to several EPA `
         + `configurations, so a small gap is normal; a large one usually means the wrong `
         + `test group is linked.`;
}
