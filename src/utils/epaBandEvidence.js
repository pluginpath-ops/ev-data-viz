/**
 * What the corpus says a sanity band should be.
 *
 * `ETA_BAND`, `CHARGER_EFF_BAND` and `PACK_KWH_BAND` decide whether a derived
 * figure is flagged as out of band on every EPA card, and every one of them was
 * set by hand. They are reasonable guesses — but they are guesses, and the
 * records they judge are now numerous enough to say what the real spread is.
 *
 * This computes that spread and puts it beside the knob, rather than baking a
 * number into the constants. Two reasons for that shape:
 *
 *   • THE CORPUS MOVES. A band derived from 65 charger efficiencies today is
 *     wrong once the next import lands. A figure printed next to the control is
 *     re-read every time someone opens the panel; a literal in a constants file
 *     is re-read never.
 *   • IT STAYS A JUDGEMENT. A band is a curation decision about how much of a
 *     tail to call suspect, and the data cannot make that decision. Showing the
 *     observed p5/p95 next to the current bound informs the choice without
 *     making it — which is the same reason the bands are knobs rather than
 *     derived values in the first place.
 *
 * COSTS NOTHING WHERE IT MATTERS. Nothing here runs on a vehicle card. It is
 * read once, in the Admin knob panel, on the same corpus fetch the statistics
 * view already performs — a page whose whole purpose is the aggregate.
 *
 * Pure module: no data access, no React.
 */

import { certObservations, certMeasureByKey } from './epaCertStats';
import { quantile } from './epaGuideStats';

/**
 * Which measured quantity each band is judging.
 *
 * The mapping is the whole point and it has to be exact: a band shown against
 * the wrong distribution is worse than no distribution, because it looks like
 * evidence.
 */
export const BAND_EVIDENCE = {
    ETA_BAND:         { measure: 'eta',         label: 'Drivetrain η' },
    CHARGER_EFF_BAND: { measure: 'charger_eff', label: 'Charger efficiency' },
    PACK_KWH_BAND:    { measure: 'usable_kwh',  label: 'Usable energy' },
};

/**
 * The observed spread of one banded quantity, or null when too little is known.
 *
 * Excludes values that were assumed rather than measured — `CERT_MEASURES`
 * marks those with `assumedIsNotData`, and a band derived partly from its own
 * default would be circular. So `n` here is the measured count, not the group
 * count, and both are reported: "median 0.87 (n=61 of 204)" says something a
 * bare median does not.
 */
export const BAND_EVIDENCE_MIN_N = 20;

export function bandEvidence(observations, bandKey) {
    const spec = BAND_EVIDENCE[bandKey];
    if (!spec) return null;

    const measure = certMeasureByKey(spec.measure);
    const values = (observations ?? [])
        .map(o => o?.[spec.measure])
        .filter(v => typeof v === 'number' && Number.isFinite(v))
        .sort((a, b) => a - b);

    const total = (observations ?? []).length;
    // Below this the quantiles are describing a handful of cars, and a band set
    // from them would be narrower than the truth in a way nothing would reveal.
    if (values.length < BAND_EVIDENCE_MIN_N) {
        return { measure: spec.measure, label: spec.label, n: values.length, total, enough: false };
    }

    return {
        measure: spec.measure,
        label: spec.label,
        n: values.length,
        total,
        enough: true,
        min:    values[0],
        p5:     quantile(values, 0.05),
        median: quantile(values, 0.5),
        p95:    quantile(values, 0.95),
        max:    values[values.length - 1],
        digits: measure?.digits ?? 3,
        unit:   measure?.unit ?? '',
    };
}

/**
 * How the current band sits against what was observed.
 *
 * Named rather than left to the reader, because the useful question is not
 * "what are the numbers" but "is this bound doing what I think":
 *
 *   'tight'  the band excludes real records — measured values fall outside it,
 *            so the flag fires on data rather than on faults
 *   'loose'  the band is wider than anything observed at either end, so it
 *            cannot fire and is not checking anything
 *   'fits'   the band contains the p5-p95 body and clips the tails
 */
export function bandVerdict(band, evidence) {
    if (!evidence?.enough || !Array.isArray(band) || band.length !== 2) return null;
    const [lo, hi] = band;

    const excludes = evidence.p5 < lo || evidence.p95 > hi;
    if (excludes) {
        return { key: 'tight', text: 'excludes measured records — this flags data, not faults' };
    }
    // Both bounds outside the full observed range means nothing can ever trip it.
    if (lo < evidence.min && hi > evidence.max) {
        return { key: 'loose', text: 'wider than every record observed — nothing can trip it' };
    }
    return { key: 'fits', text: 'contains the p5–p95 body and clips the tails' };
}

/** Convenience: evidence for every band, from one pass over the groups. */
export function allBandEvidence(groups, brandIndex) {
    const observations = certObservations(groups ?? [], brandIndex);
    return Object.fromEntries(
        Object.keys(BAND_EVIDENCE).map(k => [k, bandEvidence(observations, k)]),
    );
}
