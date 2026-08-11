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

    for (const raw of series ?? []) {
        if (!raw?.length) continue;
        // Ramp points are dropped here too, so the automatic threshold lands
        // where every run has SETTLED data. Choosing it from the untrimmed
        // minimum would pick a SoC one of the runs only reaches while its
        // charger is still negotiating, and then extrapolate to get back to it.
        const points = trimRamp(raw);
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
export function alignSeries(raw, thresholdSoc) {
    if (!raw?.length) return null;

    // The opening ramp comes off before anything else, so it is out of the
    // slope, out of the interpolation, and off the chart — see trimRamp.
    const points = trimRamp(raw);
    const rampTrimmed = raw.length - points.length;

    const usable = points.filter(p => p.soc != null && p.time != null);
    if (!usable.length) return null;

    const idx = points.findIndex(p => p.soc != null && p.soc >= thresholdSoc && p.time != null);
    if (idx === -1) return null;

    const at = points[idx];
    const before = [...points.slice(0, idx)].reverse()
        .find(p => p.soc != null && p.time != null && p.soc < thresholdSoc);

    if (at.soc === thresholdSoc) {
        return { offset: at.time, points: points.slice(idx), interpolated: false, rampTrimmed };
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
        const first = usable[0];
        const slope = extrapolationSlope(usable);
        if (!slope) return { offset: at.time, points: points.slice(idx), interpolated: false, rampTrimmed };

        const gap  = first.soc - thresholdSoc;               // SoC being invented
        const back = gap / slope.socPerMin;                  // minutes before the data
        // ONLY when and at what SoC — nothing else. Carrying the first point's
        // other channels forward would put a measured charge rate, range and
        // temperature at a moment the run never recorded, and they would be
        // wrong in a way that reads as data: the old version inherited the
        // ramp's 93 kW and drew it flat across the invented minute, so a chart
        // of charge rate opened on a number the estimate itself contradicts.
        // The plotting path drops null-y points, so each channel simply begins
        // at its first real sample.
        const start = { soc: thresholdSoc, time: first.time - back, _extrapolatedStart: true };
        return {
            offset: start.time,
            points: [start, ...points],
            interpolated: false,
            extrapolated: true,
            gap,
            rampTrimmed,
        };
    }

    const span = at.soc - before.soc;
    const frac = span > 0 ? (thresholdSoc - before.soc) / span : 0;
    const crossTime = before.time + (at.time - before.time) * frac;

    // A synthetic point AT the threshold, so the curve literally begins there.
    // Here the other channels ARE carried, interpolated the same way and by the
    // same fraction — this sits between two real samples, so a charge rate
    // partway between them is a reading of the data rather than an invention.
    const start = {
        ...interpolateChannels(before, at, frac),
        soc: thresholdSoc,
        time: crossTime,
        _interpolatedStart: true,
    };
    return { offset: crossTime, points: [start, ...points.slice(idx)], interpolated: true, rampTrimmed };
}

/** Every numeric channel the two samples share, read at `frac` between them. */
function interpolateChannels(before, at, frac) {
    const out = {};
    for (const [key, a] of Object.entries(before)) {
        const b = at?.[key];
        out[key] = (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b))
            ? a + (b - a) * frac
            : a;
    }
    return out;
}

/* ── The opening ramp ───────────────────────────────────────────────────────
 *
 * A charging session does not begin at the car's capability. The charger and
 * the BMS negotiate upward — voltage, then current — until one of them is at
 * its limit, which takes something under a minute. A real R2 session opens at
 * 93 kW, is at 195 kW twenty-four seconds later, and settles near 220:
 *
 *     t=0.1  10%   93 kW      ← handshake, not capability
 *     t=0.5  11%  195 kW      ← still climbing
 *     t=0.9  12%  214 kW      ← settled
 *     t=1.4  14%  216 kW
 *
 * Those points are true — the car really was at 10% drawing 93 kW — but they
 * describe the plug, not the car. Reading a slope across them says the R2 gains
 * 2.5 %/min when it gains 3.9, and back-projecting on that invented an extra
 * 0.8 minutes of fabricated slowness before its data even started.
 *
 * So when a chart aligns runs to a common SoC, the ramp comes off first: out of
 * the slope, out of the interpolation, and off the plot. Nothing is deleted —
 * the data is untouched and raw time shows every sample — but a comparison of
 * how fast cars charge should not open with a minute of handshake, and it is
 * unfair besides, since it only penalises the runs whose logging happened to
 * start at plug-in.
 */

/** Share of the opening plateau below which a point is still ramping up. */
export const RAMP_PLATEAU_FRACTION = 0.9;

/** Never treat more than this many leading points as ramp. A run whose power
 *  climbs for its whole opening is tapering oddly or badly logged; trimming it
 *  wholesale would be a bigger guess than the one being avoided. */
export const RAMP_MAX_TRIM = 3;

const LEAD_WINDOW_POINTS = 10;   // what counts as "the opening"
const SLOPE_SPAN_SOC     = 3;    // measure the rate over at least this much SoC

/**
 * How many leading points are still ramping up.
 *
 * Uses recorded power when there is any, because the ramp is a fact about power
 * and reads directly: below `RAMP_PLATEAU_FRACTION` of the opening plateau is
 * still climbing. A tapering run — power highest at its first point — trims
 * nothing, which is the behaviour that matters for a run that starts high.
 *
 * Falls back to nothing when power was not logged. The SoC slope alone cannot
 * tell a ramp from coarse sampling: this data is quantised to whole percent, so
 * the settled R2 alternates 3.33 and 5.0 %/min, and any rule sensitive enough
 * to catch a real ramp would also catch that sawtooth.
 */
export function rampLength(points) {
    const window = (points ?? []).slice(0, LEAD_WINDOW_POINTS);
    const powers = window.map(p => p?.chargeRate);
    if (!powers.some(w => w != null && Number.isFinite(w) && w > 0)) return 0;

    const plateau = Math.max(...powers.filter(w => w != null && Number.isFinite(w)));
    if (!(plateau > 0)) return 0;

    let n = 0;
    while (n < window.length && n < RAMP_MAX_TRIM) {
        const w = powers[n];
        if (w == null || !Number.isFinite(w)) break;
        if (w >= plateau * RAMP_PLATEAU_FRACTION) break;
        n++;
    }
    // Leaving nothing to measure a slope with is worse than keeping the ramp.
    return Math.min(n, Math.max(0, (points?.length ?? 0) - 2));
}

/**
 * A run's points with its opening ramp removed.
 *
 * Virtual, not destructive: this is what alignment computes and plots from, and
 * nothing is written back. "Raw test time" bypasses it entirely and shows every
 * sample the logger recorded.
 *
 * Idempotent — trimming settled data finds no ramp — so it is safe to apply on
 * a series that has already been through it.
 */
export function trimRamp(points) {
    if (!points?.length) return points ?? [];
    const usable = points.filter(p => p?.soc != null && p?.time != null);
    const n = rampLength(usable);
    if (!n) return points;

    // Map the count back onto the original array, which may carry samples with
    // no SoC or time between the usable ones.
    const firstSettled = usable[n];
    const cut = points.indexOf(firstSettled);
    return cut > 0 ? points.slice(cut) : points;
}

/**
 * The rate to extend a run backwards at, in % SoC per minute.
 *
 * Measured after the ramp, and over at least `SLOPE_SPAN_SOC` of SoC — a single
 * segment of whole-percent data is 1% wide, so its rate carries the sampling
 * interval's error rather than the car's behaviour.
 *
 * Returns null when no positive rate can be measured. A flat or falling trace is
 * not a slow charge, it is a discharge or a stall, and running it backwards
 * would draw a rising curve out of a falling one.
 */
export function extrapolationSlope(points) {
    const usable = (points ?? []).filter(p => p?.soc != null && p?.time != null);
    if (usable.length < 2) return null;

    const trimmed = rampLength(usable);
    const from = usable[trimmed];
    if (!from) return null;

    const to = usable.slice(trimmed + 1).find(p => p.soc - from.soc >= SLOPE_SPAN_SOC)
        ?? usable[usable.length - 1];

    const dt = to.time - from.time;
    const ds = to.soc - from.soc;
    if (!(dt > 0) || !(ds > 0)) return null;

    const socPerMin = ds / dt;
    return Number.isFinite(socPerMin) && socPerMin > 0 ? { socPerMin, trimmed } : null;
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
