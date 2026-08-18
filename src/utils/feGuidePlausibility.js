/**
 * Sanity checks on a Fuel Economy Guide row's published range figures (#222).
 *
 * The guide is EPA's own data and is mostly clean, so this is deliberately not
 * a validator — it is a detector for the one shape of corruption the file has
 * actually shown, sized from the file itself.
 *
 * ── What went wrong, and what caught it ──────────────────────────────────────
 *
 * `Cadillac LYRIQ AWD` 2025 is published as city 530 mi, highway 26 mi. The 26
 * is garbage, and it passes every check the importer had: present, numeric,
 * positive, and inside the natural key. Anything reading it would produce a
 * confident wrong answer.
 *
 * The obvious check does NOT catch it. "Combined must sit between city and
 * highway" is satisfied — 303 is between 26 and 530 — and across all six guide
 * years it fires on 0 of 1140 rows. It is kept anyway, because it guards a
 * different corruption (a bad COMBINED against two good cycles) and costs one
 * comparison. But it is not what found this.
 *
 * The highway/city RATIO is. Measured across MY22-MY27:
 *
 *     n = 1140    p1 = 0.764    median = 0.884    p99 = 1.117
 *     real spread, excluding the bad row: 0.718 … 1.230
 *     the bad row: 0.049
 *
 * A clean singleton, two orders of magnitude below the next lowest value. The
 * bounds below sit ~30% outside the widest genuine observation, so the gate has
 * to be badly wrong before it touches real data — which matters, because EVs do
 * legitimately vary here: regen favours city, aero favours highway, and a
 * slippery sedan can beat its own city figure (the Polestar 3 at 1.23).
 *
 * ── Flag, never drop ─────────────────────────────────────────────────────────
 *
 * These rows are EPA's published record. Dropping one hides a fact about the
 * source; a curator seeing "this row's highway figure is implausible" can
 * decide, and can still link it deliberately. Silently vanishing rows are how
 * the 2022 import lost 86 good ones.
 *
 * Pure: numbers in, flags out. Takes explicit values rather than a row, so the
 * parser (camelCase) and the UI (snake_case columns) can both call it without
 * either learning the other's shape.
 */

/**
 * Widest genuine highway/city range ratio, plus ~30% headroom either side.
 * Observed real range across six guide years is 0.718-1.230.
 */
export const HWY_CITY_RATIO_MIN = 0.5;
export const HWY_CITY_RATIO_MAX = 1.6;

/** Rounding slack, in miles, when testing that combined sits between the cycles. */
const BRACKET_TOLERANCE_MI = 1;

/**
 * @param {Object} figures
 * @param {number|null} figures.cityMi  published city range
 * @param {number|null} figures.hwyMi   published highway range
 * @param {number|null} figures.combMi  published combined range
 * @returns {string[]} flag codes, empty when nothing is suspect
 */
export function rangePlausibility({ cityMi, hwyMi, combMi } = {}) {
    const flags = [];
    const city = Number(cityMi), hwy = Number(hwyMi), comb = Number(combMi);
    const has = v => Number.isFinite(v) && v > 0;

    if (has(city) && has(hwy)) {
        const ratio = hwy / city;
        if (ratio < HWY_CITY_RATIO_MIN || ratio > HWY_CITY_RATIO_MAX) {
            flags.push('hwy-city-ratio');
        }
    }

    // Guards a bad COMBINED against two good cycles. Fires on nothing in the
    // current data — see the header; that is a statement about today's file,
    // not a reason to stop checking.
    if (has(city) && has(hwy) && has(comb)) {
        const lo = Math.min(city, hwy) - BRACKET_TOLERANCE_MI;
        const hi = Math.max(city, hwy) + BRACKET_TOLERANCE_MI;
        if (comb < lo || comb > hi) flags.push('combined-outside-cycles');
    }

    return flags;
}

/** Curator-facing wording for each flag. */
export const PLAUSIBILITY_MESSAGES = {
    'hwy-city-ratio':
        'Highway and city ranges are implausibly far apart — one of them is likely wrong in EPA\'s file.',
    'combined-outside-cycles':
        'Combined range sits outside both cycle ranges, which cannot happen if all three are correct.',
};
