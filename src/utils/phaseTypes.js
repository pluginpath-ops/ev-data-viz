/**
 * Inferring an EPA test phase's cycle type from its distance.
 *
 * A certification record numbers its phases and reports each one's distance and
 * energy, but does not always say which cycle produced it. `phase_type` is a
 * curator field, and it is unset on most imported phases — which matters more
 * than it sounds, because every downstream reading of a test starts by
 * separating UDDS phases from HWY ones. A phase with no type is invisible to
 * the methodology model: not wrong, simply absent, taking its energy with it.
 *
 * The distances are diagnostic. Each cycle is a fixed trace driven to
 * completion, so a phase is 10.26 mi or 7.45 mi to within a rounding of the
 * dyno's report — these are not free-running measurements that could land
 * anywhere. A steady-state depletion bag is the exception and is recognised by
 * being an order of magnitude longer than its neighbours rather than by any
 * fixed length.
 *
 * ── Suggests, never asserts ─────────────────────────────────────────────────
 *
 * Returns null rather than guessing when nothing matches confidently, and a
 * curator's explicit choice always wins over this. A wrong type is worse than
 * an absent one: an HWY phase misread as UDDS moves real energy into the wrong
 * cycle and both derived ranges come out plausible and wrong.
 *
 * Extracted from TestPhaseEditor (#222). It lived in a component, which meant
 * the only way to reuse it was to import React — so the group-to-record adapter
 * could not reach the one piece of logic that knows what a phase is.
 */
import { HWFET_MI, UDDS_MI, CYCLE_DIST_TOL } from '../constants/epa';

/** How many times its shortest neighbour a phase must be to read as steady-state. */
export const SS_NEIGHBOUR_MULTIPLE = 10;

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

/**
 * @param {number} distanceMi        this phase's distance
 * @param {number[]} otherDistances  distances of the test's other phases
 * @returns {'SS'|'HWY'|'UDDS'|null}
 */
export function suggestPhaseType(distanceMi, otherDistances = []) {
    const d = num(distanceMi);
    if (d == null || d <= 0) return null;

    // SS first: a depletion bag far longer than its shortest neighbour. Checked
    // before the fixed distances because a long steady-state run has no
    // characteristic length and could otherwise coincide with one.
    const others = otherDistances.map(num).filter(x => x != null && x > 0);
    if (others.length && d >= SS_NEIGHBOUR_MULTIPLE * Math.min(...others)) return 'SS';

    if (Math.abs(d - HWFET_MI) <= CYCLE_DIST_TOL) return 'HWY';
    if (Math.abs(d - UDDS_MI)  <= CYCLE_DIST_TOL) return 'UDDS';
    return null;
}

/**
 * Each phase's type, preferring what the curator recorded and falling back to
 * the suggestion.
 *
 * The fallback is what lets a model be built from a test nobody has typed by
 * hand yet, and `typeSource` is why it is safe to do so: a reading derived from
 * inferred types is not the same claim as one from curated types, and the UI
 * has to be able to say which it is.
 *
 * @param {Array} phases  [{ phase_index, phase_type, distance_mi }]
 * @returns {Array} [{ ...phase, cycle, typeSource: 'curated'|'inferred'|null }]
 */
export function resolvePhaseTypes(phases = []) {
    const distances = phases.map(p => p?.distance_mi);

    return phases.map((phase, i) => {
        const curated = phase?.phase_type ?? null;
        if (curated) return { ...phase, cycle: curated, typeSource: 'curated' };

        const others = distances.filter((_, j) => j !== i);
        const inferred = suggestPhaseType(phase?.distance_mi, others);
        return {
            ...phase,
            cycle: inferred,
            typeSource: inferred ? 'inferred' : null,
        };
    });
}
