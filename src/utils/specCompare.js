/**
 * What a row of the compare table says about itself (#277).
 *
 * Pure, and out of the view, because these are the three questions the table's
 * controls ask — does this row differ, is it empty, which cell is best — and
 * every one of them has an edge case that a browser check will not reliably
 * catch. Two of the three bugs found in this row already were exactly that
 * shape: `Number(null)` is 0, and a formatted string is not a number.
 *
 * A "row" here is just the list of raw recorded values, in column order. Raw,
 * not formatted: `differs` has to compare what was recorded, or two figures
 * that print the same would read as agreement.
 */

/** Not every vehicle recorded the same thing. */
export function rowDiffers(values) {
    const first = values[0] ?? null;
    return values.some(v => (v ?? null) !== first);
}

/** Nobody recorded anything. */
export function rowIsEmpty(values) {
    return values.every(v => v == null);
}

/**
 * Every index that wins the row, given which way is an improvement.
 *
 * ── A tie marks BOTH ────────────────────────────────────────────────────────
 *
 * It marked neither at first, on the reasoning that washing three of four cells
 * says "these three beat that one" — which is true, and is also what a
 * three-way tie for best means. Two cars at 400 kW are joint best, and hiding
 * that to avoid a crowded row answers the reader's question with silence.
 *
 * ── But everyone tying marks NOTHING ────────────────────────────────────────
 *
 * When every vehicle records the same value there is no winner to point at, and
 * washing the whole row says nothing at all.
 *
 * ── And an unrecorded cell never competes ───────────────────────────────────
 *
 * `Number(null)` is 0, not NaN. Left alone, a blank entered every `lower` row
 * as a zero: two blanks tied at 0 and the row was silently skipped, and with
 * exactly one blank, "not recorded" would have WON. Every `higher` row was
 * immune by luck, since 0 never wins a maximum — which is why this looked like
 * it worked.
 *
 * @param {Array<*>} values  raw values, column order
 * @param {'lower'|'higher'|undefined} better
 * @returns {Set<number>} winning indices; empty when the row has no answer
 */
export function bestIndices(values, better) {
    const none = new Set();
    if (better !== 'lower' && better !== 'higher') return none;

    const nums = values.map(v => (v == null || v === '' ? NaN : Number(v)));
    const valid = nums.filter(Number.isFinite);
    // One figure is not a comparison.
    if (valid.length < 2) return none;

    const target = better === 'lower' ? Math.min(...valid) : Math.max(...valid);
    if (valid.every(n => n === target)) return none;

    return new Set(nums.flatMap((n, i) => (n === target ? [i] : [])));
}

/**
 * A row label with its unit removed, when the VALUE is going to carry one.
 *
 * The schema writes "Horsepower (hp)", and `formatSpecValue` renders "338 hp"
 * — so the unit was on screen twice on every row that converts. Worse, the
 * label is a fixed string and the value is not: in metric the cell reads
 * "252 kW" under a label still insisting on "(hp)". The label was not
 * redundant there, it was wrong.
 *
 * Only for fields with a `unitGroup`, because only those produce a converted,
 * unit-bearing value. "Max DC Charge Rate (kW)" has no unitGroup — its cell is
 * a bare "400" and the label is the only place the unit appears, so it keeps
 * it. Same for "Charge Time 10→80% (min)".
 *
 * The schema keeps its own labels untouched: the spec EDIT form needs the unit
 * in the label, because there the input is raw and the label is what tells you
 * what to type.
 */
export function labelWithoutUnit(label, unitGroup) {
    if (!unitGroup) return label;
    // Only a trailing parenthetical, so "0–60 mph (sec) — claimed" — which has
    // no unitGroup anyway — could never lose the qualifier that follows it.
    return label.replace(/\s*\([^()]*\)\s*$/, '');
}
