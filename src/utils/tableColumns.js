/**
 * What the sortable tables share, whatever their rows are (#235, #315).
 *
 * The FE Guide table reads a figure straight off a row (`row[col.key]`); the
 * vehicle table keeps them under `row.values`. Everything below takes a
 * `valueOf(row, col)` so both tables get one answer for "how does a blank
 * sort" and "how short may a real bar be", rather than two answers that drift.
 */

/** Absent is null, undefined or an empty string. Zero is a value. */
export const isBlank = (v) => v == null || v === '';

/**
 * Sort rows by one column. Nulls last in both directions: they are absences,
 * not low values, and floating them to the top of an ascending sort would bury
 * the answer under rows that have none. Text compares numerically where it
 * holds numbers, so "R2" sorts before "R10".
 */
export function sortByColumn(rows, col, dir, valueOf) {
    const sign = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
        const av = valueOf(a, col);
        const bv = valueOf(b, col);
        const aBlank = isBlank(av);
        const bBlank = isBlank(bv);
        if (aBlank && bBlank) return 0;
        if (aBlank) return 1;
        if (bBlank) return -1;
        if (col.numeric) return sign * (Number(av) - Number(bv));
        return sign * String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
}

/**
 * The largest value behind each bar, keyed by scale.
 *
 * Computed over the FILTERED rows, so filtering to pickups scales against the
 * longest-range pickup rather than collapsing every bar to a third because a
 * Lucid Air exists off screen. Columns that declare the same scale share one
 * maximum, so city and highway range bars are comparable with each other.
 *
 * Zero-based by design: a bar is a share of the largest value, which is what
 * makes "about 60% filled" mean 330 of 545 miles.
 */
export function barMaximaOf(rows, columns, valueOf, scaleOf) {
    const maxima = {};
    for (const col of columns) {
        if (!col?.bar) continue;
        const scale = scaleOf(col);
        let max = maxima[scale] ?? 0;
        for (const row of rows) {
            const v = valueOf(row, col);
            if (isBlank(v)) continue;
            const n = Number(v);
            if (Number.isFinite(n) && n > max) max = n;
        }
        maxima[scale] = max;
    }
    return maxima;
}

/**
 * The smallest bar a real value may draw.
 *
 * Below this a measurement renders as an empty track, which is what an ABSENT
 * value looks like, and the difference between "short" and "not measured" is
 * the one a bar column has to keep.
 */
export const BAR_MIN_PCT = 4;

/** A value's share of its scale's maximum, 0 to 100, or null for no bar. */
export function barPercentOf(value, max) {
    // Number(null) is 0 and 0 is finite, so an absent value would draw an
    // empty bar, which reads as a measured zero rather than as no data.
    if (isBlank(value)) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || !(max > 0)) return null;
    return Math.max(BAR_MIN_PCT, Math.min(100, (n / max) * 100));
}

/**
 * Move column `from` to sit before or after column `to`, keeping every other
 * column in order. Shared by the column picker's list and the table's own
 * headers, which are two handles on the same ordered list.
 *
 * The side is explicit because "put it where the target is" cannot move a
 * column one place to the right: taking `a` out of [a, b, c] and splicing it
 * back in at `b` puts it straight back in front of `b`.
 *
 * The fixed column (the row label) neither moves nor has anything placed in
 * front of it. Returns the same array when nothing changes, so a caller can
 * skip a state update on a drop that went nowhere.
 */
export function moveColumn(visible, from, to, side, fixedKey) {
    if (from === to || from === fixedKey || !visible.includes(from)) return visible;
    if (to === fixedKey && side === 'before') return visible;
    const next = visible.filter(k => k !== from);
    const at = next.indexOf(to);
    if (at < 0) return visible;
    next.splice(side === 'after' ? at + 1 : at, 0, from);
    return next.every((k, i) => k === visible[i]) ? visible : next;
}
