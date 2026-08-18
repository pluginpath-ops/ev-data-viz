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

// ── Check 2: computed range against the record's OWN stated range ───────────

/**
 * Rounding slack when comparing our recomputed range to the record's stated one.
 *
 * These are the same quantity computed the same way from the same test, so they
 * should agree to a fraction of a percent, not merely be close. The R2 agrees to
 * better than 0.1%. 1% is generous.
 */
export const RANGE_AGREEMENT_TOLERANCE = 0.01;

/**
 * Recompute each cycle's unadjusted range and compare it to what the
 * certification record itself reports.
 *
 * **This is the strongest check available**, and it should have been the first.
 * The MPGe comparison needs a linked Fuel Economy Guide row, so it only covers
 * curated vehicles and it compares against a different document. This compares
 * a record against itself: EPA states `Charge Depleting Range (Calculated)` and
 * `…Highway (Calculated)`, we recompute both from the phase bags, and any
 * disagreement is unambiguously our phase data. No link, no second source, and
 * it works on every imported group.
 *
 * It is the epic's validation gate #1 — "recompute from bags, must match
 * reported" — and it localises a fault to one cycle. The Model Y Performance
 * record states a 412.88 mi highway range; we derived ~378 from its bags, and
 * that 8% gap was diagnosed only after working backwards from MPGe.
 *
 * ⚠ `cd_range_combined_calc` is the CITY range on an MCT record despite its
 * name — see epaRecordFromGroup. Passing it as the highway figure would compare
 * two different cycles and report a fault in a correct record.
 *
 * @param {Object} model   output of buildMethodologyModel
 * @param {Object} stated  { cityMi, hwyMi } from cd_range_combined_calc / cd_range_hwy_calc
 */
export function checkStatedRanges(model, stated = {}) {
    const out = { cycles: [], worst: null, checked: false };
    if (!model?.cycles) return out;

    const pairs = [
        ['city', 'City', num(stated.cityMi)],
        ['hwy',  'Highway', num(stated.hwyMi)],
    ];

    for (const [key, label, statedMi] of pairs) {
        const ours = num(model.cycles[key]?.rangeUnadjMi);
        if (ours == null || statedMi == null || statedMi <= 0) continue;

        const deltaFraction = (ours - statedMi) / statedMi;
        out.cycles.push({
            cycle: key,
            label,
            ours,
            stated: statedMi,
            deltaFraction,
            deltaPct: deltaFraction * 100,
            status: Math.abs(deltaFraction) <= RANGE_AGREEMENT_TOLERANCE ? 'agrees' : 'disagrees',
        });
    }

    if (!out.cycles.length) return out;
    out.checked = true;
    out.worst = out.cycles.some(c => c.status === 'disagrees') ? 'disagrees' : 'agrees';
    return out;
}

// ── Check 3: the regulatory invariant ───────────────────────────────────────

/** Slack in miles: the label is published as a whole number. */
export const LABEL_INVARIANT_TOLERANCE_MI = 1;

/**
 * A manufacturer may label at or below the computed range, never above.
 *
 * This is a hard regulatory invariant rather than a quality signal, so a
 * violation is not "these numbers disagree" — it is proof that our computed
 * range is too low, because the alternative is that EPA certified an illegal
 * label. It catches a class the MPGe check cannot: a derivation can be wrong in
 * a way that still reconciles with published efficiency.
 *
 * The ARITHMETIC blend is used deliberately, and it is the conservative choice:
 * the arithmetic mean is always ≥ the harmonic, so if even that sits below the
 * label the invariant is violated on any blend. Testing the smaller one would
 * flag records that are merely blended the other way.
 */
export function checkLabelInvariant(model, { bagsReconcile = null } = {}) {
    const computedMi = num(model?.combinedMi);
    const labeledMi  = num(model?.labeledMi);
    const none = {
        checked: false, violated: false, computedMi: null, labeledMi: null,
        shortfallMi: 0, cause: null, impliedAdjustment: null,
    };
    if (computedMi == null || labeledMi == null || computedMi <= 0 || labeledMi <= 0) return none;

    const shortfallMi = labeledMi - computedMi;
    const violated = shortfallMi > LABEL_INVARIANT_TOLERANCE_MI;

    // Which of the two inputs is too low, decided by evidence rather than
    // guessed. The computed range is (unadjusted range x adjustment factor), so
    // a label above it means one of the pair is wrong -- and the bag check
    // already settles the first: if the recomputed ranges reproduce what the
    // record itself states, the unadjusted side is right and the factor is not.
    //
    // A live record makes the case. Its bags reconcile to 0.01% and its label
    // still exceeds the computed range by 3 mi, because we applied the flat
    // 0.700 to a vehicle EPA adjusted by 0.7048. Reporting "this derivation is
    // too low" there would send a curator to phase data that is already correct.
    const adjustment = num(model?.adjustment);
    const impliedAdjustment = (violated && adjustment > 0 && computedMi > 0)
        ? (labeledMi * adjustment) / computedMi
        : null;

    return {
        checked: true,
        violated,
        computedMi,
        labeledMi,
        shortfallMi,
        // 'adjustment' | 'phases' | null when there is no bag evidence either way
        cause: !violated ? null : (bagsReconcile === true ? 'adjustment'
            : bagsReconcile === false ? 'phases' : null),
        impliedAdjustment,
    };
}
