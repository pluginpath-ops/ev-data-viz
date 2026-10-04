/**
 * Does a Fuel Economy Guide row contradict itself? (#222)
 *
 * A row can pass every presence check and still be garbage: the 2025 Cadillac
 * LYRIQ AWD is staged with city 530 and highway 26. It is non-null, numeric and
 * positive, so nothing that tests for a value notices, and any derivation that
 * reads it is quietly poisoned. These test the relationships the figures must
 * satisfy instead.
 *
 * FLAG, never drop: the row is EPA's, and a curator should see that it looks
 * wrong rather than have it vanish. Pure; the caller decides where to show it.
 */

/** The fleet's real highway:city spread is about 0.6-1.3; outside is suspect. */
export const HWY_CITY_RATIO_MIN = 0.6;
export const HWY_CITY_RATIO_MAX = 1.3;

/** Rounding in the label: combined may sit this far outside the two it blends. */
const ROUNDING = 1.5;

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function checkPair(flags, kind, unit, city, hwy, comb) {
    if (city == null || hwy == null) return;
    const ratio = hwy / city;
    if (ratio < HWY_CITY_RATIO_MIN || ratio > HWY_CITY_RATIO_MAX) {
        flags.push({
            kind: `${kind}-ratio`,
            text: `The provided highway ${kind} (${hwy} ${unit}) to city ${kind} (${city} ${unit}) ratio is not plausible at ${ratio.toFixed(2)}. `
                + `The typical range in the data set is from ${HWY_CITY_RATIO_MIN} to ${HWY_CITY_RATIO_MAX}.`,
        });
    }
    if (comb != null) {
        const lo = Math.min(city, hwy) - ROUNDING;
        const hi = Math.max(city, hwy) + ROUNDING;
        if (comb < lo || comb > hi) {
            flags.push({
                kind: `${kind}-combined`,
                text: `The provided combined ${kind} (${comb} ${unit}) is not plausible: it falls outside the city (${city} ${unit}) and highway (${hwy} ${unit}) figures it should sit between.`,
            });
        }
    }
}

/** @returns {Array<{ kind: string, text: string }>} empty when the row is consistent */
export function guidePlausibilityFlags(row) {
    const flags = [];
    if (!row) return flags;
    checkPair(flags, 'range', 'mi',
        num(row.label_city_range_mi), num(row.label_hwy_range_mi), num(row.label_comb_range_mi));
    checkPair(flags, 'MPGe', 'MPGe',
        num(row.label_city_mpge), num(row.label_hwy_mpge), num(row.label_comb_mpge));
    return flags;
}
