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
 * ── One phase is recognised by where it sits, not how long it is ────────────
 *
 * The last bag of a multi-cycle test is the exception to the exception, and it
 * needs `resolvePhaseTypes` rather than a distance to read it. See
 * `ssContinuation` below.
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
 * The final bag of a test that already drove a constant-speed section is that
 * section continued to depletion.
 *
 * J1634's multi-cycle test drives its constant-speed section in TWO blocks with
 * the dynamic cycles between them, and every such test in the corpus has the
 * same eight bags:
 *
 *     UDDS  HWY  UDDS  SS  UDDS  HWY  UDDS  [the rest of the SS run]
 *
 * `suggestPhaseType` types the fourth bag and misses the eighth, because it
 * asks how long a phase is and the eighth is however far the car got before the
 * pack ran out. Across 275 tests that is anywhere from 2.3 to 66 miles, so no
 * distance threshold separates it from a part-finished cycle — the two overlap
 * completely. Its POSITION does: it is the last bag, and the constant-speed
 * section is the last thing an MCT drives.
 *
 * ── The evidence that this is what it is ────────────────────────────────────
 *
 * The last bag's consumption sits within 5% of the SS bag's on 263 of those 275
 * tests (median ratio 1.009), and 27% ABOVE the same test's HWFET bags (median
 * 1.271). It is the same driving at the same speed, and it is nothing like a
 * highway cycle.
 *
 * That second figure is why position outranks distance here rather than
 * deferring to it. Six records have a last bag between 9.6 and 10.9 miles —
 * HWFET's length, by coincidence of where the pack gave out — and reading them
 * as HWFET puts constant-speed energy into the cycle average.
 *
 * ── Why it is worth typing at all ───────────────────────────────────────────
 *
 * Untyped, the bag is simply absent from the steady-state η, which is then
 * back-solved from the first block alone. Defensible — but only where the
 * second block is short. On a car whose second block ran past the 10x
 * threshold, `suggestPhaseType` already caught it and η came from both. So the
 * derivation was reading one block or two depending on how much charge was left
 * when the second one started, which is not a property anyone would choose to
 * condition it on (#264). The spread is small, roughly ±0.4%, and it is scatter
 * with no meaning.
 *
 * ── 'continuation', not 'inferred' ──────────────────────────────────────────
 *
 * Its own `typeSource`, because "N phases typed by distance" is a caveat a
 * curator is asked to go and check, and this is not a distance guess — it is
 * the test's structure. Counting it there would raise the caveat on every
 * multi-cycle record in the corpus, which is how a warning stops being read.
 */
function ssContinuation(resolved) {
    if (resolved.length < 2) return resolved;

    // By phase_index where the rows carry one, since nothing guarantees a
    // query returns an embedded list in order. Array order is the fallback for
    // a caller that selected the column list without it.
    const idx = resolved.map(p => num(p?.phase_index));
    const order = resolved.map((_, i) => i);
    if (idx.every(v => v != null)) order.sort((a, b) => idx[a] - idx[b]);

    const last = order[order.length - 1];

    // A curator who typed the last bag has the record in front of them, and
    // this is a rule about the usual shape of a test. Same precedence as
    // everywhere else in this module.
    if (resolved[last].typeSource === 'curated') return resolved;

    // "Continued" needs something to continue. Without an earlier SS phase this
    // is just the last bag of a test that never drove a constant speed.
    const continues = order.slice(0, -1).some(i => resolved[i].cycle === 'SS');
    if (!continues) return resolved;

    const out = resolved.slice();
    out[last] = { ...out[last], cycle: 'SS', typeSource: 'continuation' };
    return out;
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
 * @returns {Array} [{ ...phase, cycle,
 *                     typeSource: 'curated'|'inferred'|'continuation'|null }]
 */
export function resolvePhaseTypes(phases = []) {
    const distances = phases.map(p => p?.distance_mi);

    const resolved = phases.map((phase, i) => {
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

    return ssContinuation(resolved);
}
