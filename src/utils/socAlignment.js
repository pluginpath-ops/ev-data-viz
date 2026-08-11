/**
 * Aligning charging curves on a common starting SoC.
 *
 * With time on the X axis every run starts at zero, which compares nothing: a
 * session beginning at 8% SoC and one beginning at 30% are not the same
 * measurement seen from the same place. Aligning them means finding the moment
 * each run first reaches a shared SoC and treating that as t=0, so the curves
 * answer "from the same state of charge, who gains fastest".
 *
 * Pure module — no React, no chart library.
 */

/**
 * The lowest SoC that EVERY run actually reaches: the highest of their minima.
 *
 * This is the best possible alignment point for a set of runs, because any
 * lower and some run has no data there, and any higher throws away measurement
 * the runs share. A fixed default — 10% for a long time here — silently drops
 * every run that started above it, which is the failure this replaces.
 *
 * Runs with no usable SoC data are ignored rather than forcing the answer to
 * null: one unusable run should not prevent the others from being aligned.
 *
 * @param {Array<Array<{soc:number|null, time:number|null}>>} series
 * @returns {number|null} SoC in percent, or null if nothing is alignable
 */
export function minimumCommonSoc(series) {
    let highestMin = null;

    for (const points of series ?? []) {
        if (!points?.length) continue;
        let runMin = null;
        for (const p of points) {
            if (p?.soc == null || p?.time == null) continue;
            if (runMin == null || p.soc < runMin) runMin = p.soc;
        }
        if (runMin == null) continue;                 // nothing usable in this run
        if (highestMin == null || runMin > highestMin) highestMin = runMin;
    }
    return highestMin;
}

/**
 * Why a run cannot take part in an alignment, or null if it can.
 *
 * Returns a reason rather than a boolean because the chart has to SAY why a
 * curve is missing. A run silently absent from a comparison is worse than one
 * shown with a caveat: the reader cannot miss what they were never told about.
 */
export function alignmentExclusion(points, thresholdSoc) {
    if (!points?.length) return null;                 // not loaded yet — do not flag prematurely
    if (!points.some(p => p.time != null)) return 'no time data';
    if (!points.some(p => p.soc != null)) return 'no SoC data';
    if (!points.some(p => p.soc != null && p.soc >= thresholdSoc)) {
        return `never reaches ${thresholdSoc}% SoC`;
    }
    return null;
}

/**
 * The time to subtract from a run so its curve starts at `thresholdSoc`.
 *
 * Zero means the run began at or below the threshold and nothing is trimmed;
 * null means it cannot be aligned at all.
 */
export function alignmentOffset(points, thresholdSoc) {
    if (!points?.length) return null;
    const anchor = points.find(p => p.soc != null && p.soc >= thresholdSoc && p.time != null);
    return anchor ? anchor.time : null;
}

/**
 * A run's points shifted so the threshold SoC sits at t = 0, with the crossing
 * INTERPOLATED rather than snapped to the next sample.
 *
 * Snapping was the old behaviour and it quietly broke the alignment it promised.
 * One real run carries five points — 0%, 25%, 50%, … — so its "10% anchor" was
 * the sample at 25%, and it was drawn from t=0 alongside runs that genuinely
 * started at 10%. The curves shared an origin and not a state of charge, which
 * is the comparison this is for.
 *
 * Interpolating between the two samples that bracket the threshold puts every
 * run at exactly the same SoC at t = 0. This stays strictly INSIDE the measured
 * data — it is not the below-the-floor extrapolation of #195 item 4, and needs
 * no estimate marking.
 *
 * Returns null when the run cannot be aligned at all.
 */
export function alignSeries(points, thresholdSoc) {
    if (!points?.length) return null;
    const usable = points.filter(p => p.soc != null && p.time != null);
    if (!usable.length) return null;

    const idx = points.findIndex(p => p.soc != null && p.soc >= thresholdSoc && p.time != null);
    if (idx === -1) return null;

    const at = points[idx];
    const before = [...points.slice(0, idx)].reverse()
        .find(p => p.soc != null && p.time != null && p.soc < thresholdSoc);

    if (at.soc === thresholdSoc) {
        return { offset: at.time, points: points.slice(idx), interpolated: false };
    }

    // No bracketing sample means the run BEGAN above the threshold. Aligning it
    // as-is would repeat the defect this replaces in a quieter form: it would
    // sit at t=0 showing 25% beside runs showing 10%. Extend it backwards
    // instead, on the slope of its own first two points.
    //
    // This is EXTRAPOLATION, not interpolation — it invents SoC the run never
    // visited — so the caller is told how far it reached beyond the data, and
    // anything past EXTRAPOLATION_SOC_LIMIT is worth saying out loud.
    if (!before) {
        const first  = usable[0];
        const second = usable.find(p => p.time > first.time && p.soc !== first.soc);
        if (!second) return { offset: at.time, points: points.slice(idx), interpolated: false };

        const socPerMin = (second.soc - first.soc) / (second.time - first.time);
        if (!Number.isFinite(socPerMin) || socPerMin <= 0) {
            return { offset: at.time, points: points.slice(idx), interpolated: false };
        }

        const gap  = first.soc - thresholdSoc;              // SoC being invented
        const back = gap / socPerMin;                        // minutes before the data
        const start = {
            ...first,
            soc: thresholdSoc,
            time: first.time - back,
            _extrapolatedStart: true,
        };
        return {
            offset: start.time,
            points: [start, ...points],
            interpolated: false,
            extrapolated: true,
            gap,
        };
    }

    const span = at.soc - before.soc;
    const frac = span > 0 ? (thresholdSoc - before.soc) / span : 0;
    const crossTime = before.time + (at.time - before.time) * frac;

    // A synthetic point AT the threshold, so the curve literally begins there.
    const start = { ...before, soc: thresholdSoc, time: crossTime, _interpolatedStart: true };
    return { offset: crossTime, points: [start, ...points.slice(idx)], interpolated: true };
}

/**
 * How far below its own data a run may be extended before the chart says so.
 *
 * Charging power is roughly flat at low SoC, so a short backward projection is
 * defensible; a long one is a guess wearing a measurement's clothes. Five
 * points of SoC is the curator's call, and the number is here rather than
 * inline so it can move without hunting.
 */
export const EXTRAPOLATION_SOC_LIMIT = 5;

/** Whether an aligned run stretched further past its data than we are happy with. */
export const overExtrapolated = (aligned) =>
    !!aligned?.extrapolated && aligned.gap > EXTRAPOLATION_SOC_LIMIT;

/** Clamp a user-typed threshold to a usable percentage. */
export function clampSoc(value, fallback = 10) {
    // An emptied field is not 0%. Number('') is 0 and finite, so testing
    // Number.isFinite alone would turn a cleared input into "align at 0%",
    // which silently changes every curve on the chart.
    if (value === '' || value == null) return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(100, Math.max(0, Math.round(n)));
}
