/**
 * Finding the Fuel Economy Guide's columns when EPA renames them (#214).
 *
 * EPA owns these headers and does change them between years. Across the six
 * guides on hand (MY22-MY27) 154 headers are identical every year and the rest
 * drift in one way: spacing, case and punctuation (`Fuel 2` became `Fuel2`,
 * `(PHEVs only)` became `(PHEV only)`, a double space went), plus the odd real
 * relabel (`Trans Lockup` became `Lockup Torque Converter`). None of the
 * columns the importer reads has moved yet, so the first two defences here are
 * cheap and the third is a message, not a guess.
 *
 * Pure module: header names in, a resolution out.
 *
 *   1. EXACT          the name the parser knows.
 *   2. ALIAS          a past name listed in COLUMN_ALIASES.
 *   3. NORMALISED     the same name apart from case, spacing and punctuation.
 *   4. SUGGESTED      only when a REQUIRED column is still missing: the closest
 *                     header in the file, named so a human can decide. Never
 *                     applied, because a wrong pairing imports a plausible
 *                     column of the wrong figures, which is worse than refusing.
 */

/**
 * Known past names per column: `{ 'Current Name': ['Older Name', ...] }`.
 *
 * Empty today, on purpose: comparing every guide on hand found no rename of a
 * column the importer reads, and inventing aliases for renames nobody has seen
 * would be guessing at the problem. When a guide year fails to parse, its
 * failure is the specification: add the old name here and it is handled
 * without a release of logic.
 */
export const COLUMN_ALIASES = {};

/** Case, spacing and punctuation removed: `Fuel 2` and `Fuel2` are one name. */
export const normalizeHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Edit distance; headers are short, so the plain two-row version is fine. */
function distance(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

/** 1 = identical once normalised, 0 = nothing in common. */
export function headerSimilarity(a, b) {
    const x = normalizeHeader(a);
    const y = normalizeHeader(b);
    const longest = Math.max(x.length, y.length);
    return longest === 0 ? 0 : 1 - distance(x, y) / longest;
}

/** Below this a suggestion is more likely noise than a rename. */
export const SUGGESTION_MIN_SIMILARITY = 0.75;

/**
 * Match each column the parser wants to a header in the file.
 *
 * @param {string[]} headers   the file's headers, as read
 * @param {string[]} wanted    the names the parser reads
 * @param {Object}   [aliases] canonical name -> past names
 * @returns {{ found: Object, renamed: Array<{ column, header, how }>, missing: string[] }}
 *   `found` maps each wanted column that has a header to that header; `renamed`
 *   lists the ones found under a different name; `missing` the rest.
 */
export function resolveColumns(headers, wanted, aliases = COLUMN_ALIASES) {
    const have = new Set(headers);
    const byNormal = new Map();
    for (const h of headers) {
        const n = normalizeHeader(h);
        if (!byNormal.has(n)) byNormal.set(n, h);
    }

    const found = {};
    const renamed = [];
    const missing = [];
    for (const column of wanted) {
        if (have.has(column)) { found[column] = column; continue; }

        const alias = (aliases[column] ?? []).find(a => have.has(a));
        if (alias) {
            found[column] = alias;
            renamed.push({ column, header: alias, how: 'alias' });
            continue;
        }
        const normalised = byNormal.get(normalizeHeader(column));
        if (normalised) {
            found[column] = normalised;
            renamed.push({ column, header: normalised, how: 'normalised' });
            continue;
        }
        missing.push(column);
    }
    return { found, renamed, missing };
}

/**
 * For columns still missing, the closest header in the file that nothing else
 * claimed. A suggestion for the human; the parser does not act on it.
 *
 * @returns {Array<{ column: string, closest: string, similarity: number }>}
 *   only those clearing SUGGESTION_MIN_SIMILARITY
 */
export function suggestColumns(missing, headers, claimed = []) {
    const taken = new Set(claimed);
    const candidates = headers.filter(h => h && !taken.has(h));
    const out = [];
    for (const column of missing) {
        let best = null;
        for (const h of candidates) {
            const similarity = headerSimilarity(column, h);
            if (!best || similarity > best.similarity) best = { column, closest: h, similarity };
        }
        if (best && best.similarity >= SUGGESTION_MIN_SIMILARITY) {
            out.push({ ...best, similarity: Math.round(best.similarity * 100) / 100 });
        }
    }
    return out;
}
