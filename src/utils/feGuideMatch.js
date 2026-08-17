/**
 * Finding the Fuel Economy Guide row that belongs to an EPA test group (#206).
 *
 * There is no key to join on. The guide's `#1 Smog Rating Test Group` matches
 * 1 of our 89 linked groups — our CSI importer stores the manufacturer's
 * Vehicle ID (`R2-159XR20AT`) where the guide carries the EPA smog test group
 * (`TRIVT00.0232`) — and it is not unique per configuration anyway. So the link
 * is a curator decision, and this exists to make that decision one click rather
 * than a search.
 *
 * Measured against the staged MY2025 rows and our 41 MY2025 linked groups:
 *
 *   • filtering by make alone still leaves ~19 candidates — too many to eyeball,
 *     which is what makes ranking load-bearing rather than a nicety
 *   • ranking by carline similarity put the correct row FIRST in all 41 cases,
 *     with no weak top matches
 *
 * Pure module: no data access, no React.
 */

/**
 * Make names for comparison.
 *
 * Ours are short (`Tesla`, `Lucid`); the guide's are corporate entities
 * (`Tesla Motors`, `Lucid USA Inc.`, `Volvo Cars of North America, LLC`). 13 of
 * our 16 makes match a division exactly and all 16 match once punctuation and
 * case are dropped and containment is allowed either way.
 */
export function normaliseMake(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Do these two name the same manufacturer? Containment either way. */
export function sameMake(a, b) {
    const x = normaliseMake(a);
    const y = normaliseMake(b);
    if (!x || !y) return false;
    return x === y || x.includes(y) || y.includes(x);
}

const tokens = (value) => String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * How alike two carlines are, 0 to 1.
 *
 * Token overlap over the longer name, which handles the two shapes that
 * actually occur: an exact restatement (`R1T Performance Dual Max (22in)`
 * against itself, 1.0) and ours being a shorter form of theirs (`Ioniq 5`
 * against `Ioniq 5 RWD`, 0.67).
 *
 * Deliberately not edit distance. These names differ by whole words — a trim,
 * a drive layout, a wheel size — not by characters, and edit distance rewards
 * strings that merely look similar (`iX3` and `iX1` are one character apart and
 * are different cars).
 */
export function carlineScore(ours, theirs) {
    const a = new Set(tokens(ours));
    const b = new Set(tokens(theirs));
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    return shared / Math.max(a.size, b.size);
}

/**
 * Rank staged guide rows as candidates for one test group.
 *
 * Filtered by make only. Model year ORDERS rather than excludes: a vehicle that
 * carries over spans two guide years, and our group's year need not be the year
 * that happens to be staged. Excluding on it told a 2026 Model Y group there
 * were "no staged rows for Tesla in 2026" while sixteen Tesla rows sat in the
 * 2025 guide — technically true and useless.
 *
 * Exact-year rows sort above the rest, and a cross-year row is never proposed
 * automatically (see bestFeCandidate) — EPA figures move between years, so
 * borrowing one is a decision the curator makes with the year in front of them.
 *
 * @param {Object} group    epa_test_groups row (make, model_year, epa_carline_name)
 * @param {Array}  feRows   staged epa_fe_guide rows
 * @returns {Array} candidates, best first, each { row, score, exactYear }
 */
export function rankFeCandidates(group, feRows = []) {
    if (!group) return [];
    const groupYear = Number(group.model_year);

    return feRows
        .filter(r => sameMake(group.make, r.division))
        .map(row => ({
            row,
            score: carlineScore(group.epa_carline_name, row.carline),
            exactYear: !groupYear || Number(row.model_year) === groupYear,
        }))
        // Exact year first, then score, then the shorter name. This orders the
        // LIST only — a tie at the top disqualifies a proposal entirely (see
        // bestFeCandidate), because picking between equals is arbitrary.
        .sort((a, b) => (b.exactYear - a.exactYear)
            || b.score - a.score
            || String(a.row.carline ?? '').length - String(b.row.carline ?? '').length);
}

/**
 * The single best candidate, or null when there is no basis to propose one.
 *
 * Two ways to decline, and the second was learned from the data:
 *
 * TOO WEAK. Below the floor the make matched but the car did not, and a group
 * would otherwise arrive pre-filled with a confident-looking wrong answer.
 *
 * WRONG YEAR. A cross-year row can be linked, but not without being looked at:
 * EPA figures move between years, so borrowing one is the curator's call.
 *
 * TIED. A clear winner means strictly better than the runner-up. Our
 * `epa_carline_name` is often just `Ioniq 5`, which scores identically against
 * `Ioniq 5 N`, `Ioniq 5 RWD` and every other variant — and those are 221 and
 * ~300 miles apart. Any tie-break there is arbitrary dressed as a judgement;
 * the first version picked the shortest name and proposed the 221-mile N for a
 * group that was almost certainly neither.
 *
 * A tie is information: it says our carline does not distinguish the variants,
 * so the curator has to. They get the ranked list instead.
 */
export const MATCH_FLOOR = 0.34;

export function bestFeCandidate(group, feRows = []) {
    const ranked = rankFeCandidates(group, feRows);
    const [top, next] = ranked;
    if (!top || top.score < MATCH_FLOOR) return null;
    if (!top.exactYear) return null;
    if (next && next.exactYear && Math.abs(next.score - top.score) < 1e-9) return null;
    return top;
}
