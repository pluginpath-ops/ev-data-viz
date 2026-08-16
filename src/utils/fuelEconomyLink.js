/**
 * Deep links into fueleconomy.gov's search, to get a curator close to the
 * published label figures (#206).
 *
 * The label range and label MPGe are the one part of the methodology diagram
 * with no ingest path: the certification records carry what the lab measured,
 * not what ended up on the window sticker. Those come from fueleconomy.gov and
 * are entered by hand — so the least this can do is remove the navigation.
 *
 * ⚠ FRAGILE BY NATURE. PowerSearch.do is an internal endpoint of somebody
 * else's site, undocumented and free to change without notice. It is used here
 * only to prefill a search a human then reads; nothing is parsed, nothing is
 * stored, and a broken link costs a curator one manual search rather than
 * corrupting data. Do not build ingest on top of it.
 *
 * Verified against the live site on 2026-08-16: year+make+baseModel for the
 * 2027 Rivian R2 returns both configurations with their range and MPGe, and
 * the 20" AT row reads 307 mi / 99 MPGe combined — matching our fixture.
 */

const BASE = 'https://www.fueleconomy.gov/feg/PowerSearch.do';

/**
 * The first four-digit year in a value, or null.
 *
 * `vehicles.year` is free text and frequently a span — "2025-2026" — because a
 * vehicle here is a trim that carried over. The search takes one year, so this
 * takes the first: a carried-over trim is listed under both, and starting at
 * the earlier one never lands on a year that does not exist.
 *
 * Without this the link silently failed to render for every multi-year vehicle,
 * which on the live database is most of them.
 */
export function parseSearchYear(value) {
    const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : null;
}

/**
 * A search URL for one vehicle.
 *
 * `model` is optional and omitted when absent, which widens the search to every
 * model that make built that year. That is the deliberate failure mode: a
 * too-broad list costs a click, whereas a `baseModel` that does not match
 * exactly returns nothing at all and looks like the vehicle is missing.
 *
 * @param {Object} v
 * @param {number|string} v.year  a year or a span such as "2025-2026"
 * @param {string} v.make
 * @param {string} [v.model]  base model only — "R2", not "R2 Performance AWD"
 * @returns {string|null} url, or null when year and make are not both known
 */
export function fuelEconomySearchUrl({ year, make, model } = {}) {
    const yr = parseSearchYear(year);
    const mk = String(make ?? '').trim();
    if (!yr || !mk) return null;

    // Order matches the working example so the URL stays diffable against it.
    const params = [
        ['action', 'noform'],
        ['path', '1'],
        ['year1', yr],
        ['year2', yr],
        ['make', mk],
    ];

    const md = String(model ?? '').trim();
    if (md) params.push(['baseModel', md]);

    params.push(['srchtyp', 'ymm'], ['pageno', '1'], ['rowLimit', '50']);

    return `${BASE}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/**
 * Best-guess base model for a vehicle, for the link above.
 *
 * Prefers the curated `model` field, which is already the base name we want
 * ("R2", "Ioniq 6", "Model Y"). Falls back to nothing rather than to the EPA
 * carline: a carline is the full configuration string — "Ioniq 6 Long range
 * RWD (18'' Wheels)" — and slicing a base model out of it is guesswork that
 * fails silently by returning an empty result page.
 */
export function baseModelFor(vehicle) {
    const model = String(vehicle?.model ?? '').trim();
    return model || null;
}
