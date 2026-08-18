/**
 * Checking our derivation against EPA's own published figures (#222).
 *
 * The methodology model has been validated against exactly one vehicle. The R2
 * reproduces EPA's unadjusted MPGe to 0.009% city and 0.034% highway, which is
 * strong evidence the chain is right — cold-start energy-share weighting and the
 * DC-to-AC charging correction both — but it is evidence about one car, checked
 * by hand, once.
 *
 * Every linked configuration now carries the same comparison values, promoted
 * from the Fuel Economy Guide. So the check that validated the R2 can run on all
 * of them, on every render, and say which ones do not reconcile.
 *
 * ── Why the UNADJUSTED figure, and not the label ────────────────────────────
 *
 * The adjusted MPGe embeds the adjustment factor. Comparing it would test the
 * factor and the derivation together, and pass whenever their errors cancelled —
 * which is not hypothetical: a wrong factor and a wrong efficiency pull the same
 * number in opposite directions. The unadjusted figure is upstream of the
 * factor, so a mismatch there is unambiguously ours.
 *
 * ── What a mismatch actually means ──────────────────────────────────────────
 *
 * MPGe is wall-to-wheels. An MCT record reports DC-side energy, so the model
 * divides by the charging efficiency to reach the wall — which makes this check
 * largely a check ON that efficiency. Two groups for the same car currently
 * derive 76.8% and 83.7%; at most one can be right, and a ~9% error in η moves
 * MPGe by ~9%. That is the size of discrepancy this is built to surface.
 *
 * Pure: model and published figures in, findings out. No data access, no React.
 */

/**
 * Agreement bands, as fractions.
 *
 * EPA publishes unadjusted MPGe to one decimal, so at ~150 MPGe the quantisation
 * alone is ~0.1%. Anything inside 1% is therefore exact for our purposes — the
 * R2 lands at 0.03%. Beyond 5% the difference is larger than any plausible
 * accumulation of rounding and something is genuinely wrong.
 */
export const AGREEMENT_TOLERANCE = 0.01;
export const DIVERGENCE_TOLERANCE = 0.05;

/** Curator-facing wording per status. */
export const CHECK_STATUS_LABELS = {
    agrees:    'matches EPA',
    close:     'near EPA',
    disagrees: 'disagrees with EPA',
};

/**
 * What to go and look at, by the shape of the discrepancy rather than its size.
 * See shapeOf — the two cases have different causes and different fixes.
 */
export const CHECK_SHAPE_ADVICE = {
    systematic:
        'Both cycles are off by the same proportion, which points at the charging efficiency — it applies to both alike.',
    'cycle-specific':
        'Only one cycle is off. No wall-side quantity does that, so look at that cycle’s phases: one missing, mistyped, or carrying the wrong distance.',
};

const num = (v) => {
    // null and '' must not become 0. Number(null) is 0 and 0 is finite, so an
    // MPGe the model could not compute would arrive as a real zero and report a
    // -100% disagreement against EPA rather than "nothing to check".
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

function statusFor(deltaFraction) {
    const d = Math.abs(deltaFraction);
    if (d <= AGREEMENT_TOLERANCE) return 'agrees';
    if (d <= DIVERGENCE_TOLERANCE) return 'close';
    return 'disagrees';
}

/**
 * Whether a discrepancy moves both cycles together or only one.
 *
 * This is the difference between two quite different faults, and the live data
 * shows both. Charging efficiency is wall-side: it divides every cycle's
 * consumption alike, so getting it wrong shifts city and highway by the same
 * proportion in the same direction. Two of the three linked Model Y
 * configurations do exactly that — +1.03/+1.06% and +3.44/+4.02%.
 *
 * The third is exact on city (-0.03%) and 8.4% low on highway. No wall-side
 * quantity can do that. A single cycle out of step means that cycle's phases —
 * a missing HWY bag, one filed under the wrong type, a wrong distance.
 *
 * Saying "usually the charging efficiency" for both would send someone to check
 * the one thing that cannot produce the second case.
 *
 * @returns {'systematic'|'cycle-specific'|null}
 */
function shapeOf(cycles) {
    if (cycles.length < 2) return null;
    const [a, b] = cycles;
    const agreeing = cycles.filter(c => c.status === 'agrees').length;

    // One cycle lands and another does not: nothing applied to both can explain it.
    if (agreeing === 1) return 'cycle-specific';

    const sameDirection = Math.sign(a.deltaFraction) === Math.sign(b.deltaFraction);
    const similarSize = Math.abs(Math.abs(a.deltaFraction) - Math.abs(b.deltaFraction))
        <= AGREEMENT_TOLERANCE;
    return (sameDirection && similarSize) ? 'systematic' : 'cycle-specific';
}

/**
 * Compare computed unadjusted MPGe against EPA's published figures.
 *
 * @param {Object} model      output of buildMethodologyModel
 * @param {Object} published  { city, hwy } — the group's unadj_*_mpge columns
 * @returns {{ cycles: Array, worst: string|null, checked: boolean }}
 *          `checked` is false when there is nothing to compare against, which is
 *          NOT a pass — a group with no linked guide row is unverified, and the
 *          UI must not present it as agreeing.
 */
export function checkUnadjustedMpge(model, published = {}) {
    const out = { cycles: [], worst: null, checked: false, shape: null };
    if (!model?.cycles) return out;

    const pairs = [
        ['city', 'City', num(published.city)],
        ['hwy',  'Highway', num(published.hwy)],
    ];

    for (const [key, label, epaValue] of pairs) {
        const ours = num(model.cycles[key]?.mpgeUnadj);
        // Both sides required. A missing published figure means unverified, not
        // agreed; a missing computed one means the model could not get there.
        if (ours == null || epaValue == null || epaValue <= 0) continue;

        const deltaFraction = (ours - epaValue) / epaValue;
        out.cycles.push({
            cycle: key,
            label,
            ours,
            epa: epaValue,
            deltaFraction,
            deltaPct: deltaFraction * 100,
            status: statusFor(deltaFraction),
        });
    }

    if (!out.cycles.length) return out;
    out.checked = true;
    out.shape = shapeOf(out.cycles);

    // The worst of the two governs: a model that nails city and misses highway
    // by 9% is not a model that agrees.
    const rank = { agrees: 0, close: 1, disagrees: 2 };
    out.worst = out.cycles.reduce(
        (worst, c) => (rank[c.status] > rank[worst] ? c.status : worst),
        'agrees',
    );
    return out;
}
