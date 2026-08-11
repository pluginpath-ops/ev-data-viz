import { describe, it, expect } from 'vitest';
import {
    minimumCommonSoc, alignmentExclusion, alignmentOffset, alignSeries,
    overExtrapolated, clampSoc, rampLength, trimRamp, extrapolationSlope,
    RAMP_MAX_TRIM, RAMP_TRIM_MIN_MINUTES,
} from '../socAlignment';

const pts = (...pairs) => pairs.map(([soc, time]) => ({ soc, time }));

describe('minimumCommonSoc', () => {
    it('takes the highest of the runs\' minima — the lowest point they all reach', () => {
        expect(minimumCommonSoc([
            pts([10, 0], [50, 20]),   // reaches down to 10
            pts([28, 0], [60, 15]),   // only down to 28
            pts([15, 0], [70, 30]),   // down to 15
        ])).toBe(28);
    });

    it('is the run that started highest, which a fixed 10% default would have dropped', () => {
        const series = [pts([8, 0], [80, 40]), pts([31, 0], [80, 25])];
        expect(minimumCommonSoc(series)).toBe(31);
        // At the old fixed default, the second run is fine but the alignment
        // throws away everything the first measured between 8% and 31%.
        expect(alignmentExclusion(series[1], 10)).toBeNull();
    });

    it('ignores a run with no usable data rather than giving up entirely', () => {
        expect(minimumCommonSoc([
            pts([20, 0], [60, 10]),
            pts([null, 5], [null, 9]),      // no SoC at all
            [],
        ])).toBe(20);
    });

    it('ignores points with no time — they cannot be aligned on a time axis', () => {
        expect(minimumCommonSoc([pts([5, null], [40, 0], [70, 12])])).toBe(40);
    });

    it('returns null when nothing is alignable', () => {
        expect(minimumCommonSoc([])).toBeNull();
        expect(minimumCommonSoc(null)).toBeNull();
        expect(minimumCommonSoc([[], pts([null, null])])).toBeNull();
    });

    it('handles a single run', () => {
        expect(minimumCommonSoc([pts([12, 0], [80, 30])])).toBe(12);
    });
});

describe('alignmentExclusion', () => {
    it('says nothing for a run that can align', () => {
        expect(alignmentExclusion(pts([10, 0], [50, 20]), 20)).toBeNull();
    });

    it('names the reason rather than returning a bare false', () => {
        expect(alignmentExclusion(pts([10, 0], [15, 20]), 30)).toBe('never reaches 30% SoC');
        expect(alignmentExclusion(pts([10, null], [50, null]), 20)).toBe('no time data');
        expect(alignmentExclusion(pts([null, 0], [null, 5]), 20)).toBe('no SoC data');
    });

    it('does not flag a run whose data has not loaded yet', () => {
        expect(alignmentExclusion([], 20)).toBeNull();
        expect(alignmentExclusion(null, 20)).toBeNull();
    });
});

describe('alignmentOffset', () => {
    it('returns the time the run first reached the threshold', () => {
        expect(alignmentOffset(pts([10, 0], [20, 6], [50, 25]), 20)).toBe(6);
    });

    it('returns 0 when the run already starts at the threshold', () => {
        expect(alignmentOffset(pts([25, 0], [60, 20]), 20)).toBe(0);
    });

    it('returns null when the threshold is never reached', () => {
        expect(alignmentOffset(pts([10, 0], [15, 5]), 40)).toBeNull();
    });

    it('skips an anchor point that has no time', () => {
        expect(alignmentOffset(pts([30, null], [35, 9]), 20)).toBe(9);
    });
});

describe('clampSoc', () => {
    it('keeps a sane percentage and rounds', () => {
        expect(clampSoc('12.6')).toBe(13);
        expect(clampSoc(150)).toBe(100);
        expect(clampSoc(-5)).toBe(0);
    });
    it('falls back when the input is not a number', () => {
        expect(clampSoc('')).toBe(10);
        expect(clampSoc('abc', 25)).toBe(25);
    });
});

describe('alignSeries', () => {
    const pts2 = (...pairs) => pairs.map(([soc, time]) => ({ soc, time }));

    it('interpolates the crossing rather than snapping to the next sample', () => {
        // The real failure: 5 coarse points, so the first sample at/above 10%
        // is 25% — the old behaviour drew this from t=0 as if it started at 10.
        const r = alignSeries(pts2([0, 0], [25, 10], [50, 20]), 10);
        expect(r.interpolated).toBe(true);
        expect(r.offset).toBeCloseTo(4, 6);            // 10/25 of the way from 0→10 min
        expect(r.points[0].soc).toBe(10);
        expect(r.points[0].time).toBeCloseTo(4, 6);
    });

    it('puts every run at the same SoC at t = 0', () => {
        const coarse = alignSeries(pts2([0, 0], [25, 10]), 10);
        const fine   = alignSeries(pts2([8, 0], [10, 2], [30, 9]), 10);
        expect(coarse.points[0].soc).toBe(10);
        expect(fine.points[0].soc).toBe(10);
        expect(coarse.points[0].time - coarse.offset).toBeCloseTo(0, 9);
        expect(fine.points[0].time - fine.offset).toBeCloseTo(0, 9);
    });

    it('extrapolates rather than interpolates a run that began above the threshold', () => {
        // Superseded by the back-extrapolation below: this used to be drawn
        // from 25% at t=0, which is the defect in a quieter form.
        const r = alignSeries(pts2([25, 0], [60, 20]), 10);
        expect(r.interpolated).toBe(false);
        expect(r.extrapolated).toBe(true);
        expect(r.points[0].soc).toBe(10);
    });

    it('does not interpolate when a sample sits exactly on the threshold', () => {
        const r = alignSeries(pts2([5, 0], [10, 6], [40, 20]), 10);
        expect(r.interpolated).toBe(false);
        expect(r.offset).toBe(6);
    });

    it('drops everything before the crossing', () => {
        const r = alignSeries(pts2([0, 0], [5, 3], [25, 10], [50, 20]), 10);
        expect(r.points.every(p => p.soc >= 10)).toBe(true);
    });

    it('returns null when the run never reaches the threshold, or has nothing usable', () => {
        expect(alignSeries(pts2([0, 0], [5, 9]), 10)).toBeNull();
        expect(alignSeries([], 10)).toBeNull();
        expect(alignSeries(null, 10)).toBeNull();
    });
});

describe('back-extrapolation below the first measured point', () => {
    const pts3 = (...pairs) => pairs.map(([soc, time]) => ({ soc, time }));

    it('extends a run that began above the threshold, rather than drawing it as if aligned', () => {
        // Begins at 25%, gaining 1% per minute. Reaching 20% is 5 min earlier.
        const r = alignSeries(pts3([25, 10], [35, 20], [45, 30]), 20);
        expect(r.extrapolated).toBe(true);
        expect(r.gap).toBe(5);
        expect(r.points[0].soc).toBe(20);
        expect(r.points[0].time).toBeCloseTo(5, 6);
        expect(r.offset).toBeCloseTo(5, 6);
    });

    it('marks the invented start so a chart can style it', () => {
        const r = alignSeries(pts3([25, 10], [35, 20]), 20);
        expect(r.points[0]._extrapolatedStart).toBe(true);
    });

    it('keeps every measured point — extrapolation adds, it does not replace', () => {
        const r = alignSeries(pts3([25, 10], [35, 20]), 20);
        expect(r.points.slice(1)).toHaveLength(2);
    });

    it('is silent within the limit and flagged beyond it', () => {
        const small = alignSeries(pts3([25, 10], [35, 20]), 21);   // 4 points of SoC
        const big   = alignSeries(pts3([25, 10], [35, 20]), 10);   // 15 points
        expect(overExtrapolated(small)).toBe(false);
        expect(overExtrapolated(big)).toBe(true);
        expect(big.gap).toBe(15);
    });

    it('never extrapolates a run that is not gaining charge', () => {
        // A discharge trace slopes the wrong way; projecting it backwards would
        // invent a rising curve out of a falling one.
        const r = alignSeries(pts3([60, 0], [40, 10], [25, 20]), 10);
        expect(r.extrapolated).toBeUndefined();
    });

    it('does not extrapolate when the data brackets the threshold — that is interpolation', () => {
        const r = alignSeries(pts3([5, 0], [25, 10]), 10);
        expect(r.interpolated).toBe(true);
        expect(r.extrapolated).toBeUndefined();
    });

    it('reports no gap for an unextrapolated alignment', () => {
        expect(overExtrapolated(alignSeries(pts3([5, 0], [25, 10]), 10))).toBe(false);
        expect(overExtrapolated(null)).toBe(false);
    });
});

describe('the opening ramp is kept out of the slope', () => {
    // A real R2 session, verbatim: 93 kW at the first sample, settled near 220
    // by the third. Whole-percent SoC, so the settled rate reads as an
    // alternating 3.33 / 5.0 sawtooth and only a multi-point span recovers it.
    const R2 = [
        { time: 0.1, soc: 10, chargeRate: 93 },
        { time: 0.5, soc: 11, chargeRate: 195 },
        { time: 0.9, soc: 12, chargeRate: 214 },
        { time: 1.2, soc: 13, chargeRate: 215 },
        { time: 1.4, soc: 14, chargeRate: 216 },
        { time: 1.7, soc: 15, chargeRate: 217 },
        { time: 1.9, soc: 16, chargeRate: 218 },
        { time: 2.2, soc: 17, chargeRate: 219 },
        { time: 2.5, soc: 18, chargeRate: 219 },
        { time: 2.7, soc: 19, chargeRate: 220 },
    ];

    it('counts the handshake points as ramp and the settled ones as not', () => {
        expect(rampLength(R2)).toBe(2);
    });

    it('measures the rate the car actually charges at, not the plug warming up', () => {
        const { socPerMin, trimmed } = extrapolationSlope(R2);
        expect(trimmed).toBe(2);
        // From 12% at t=0.9 to 15% at t=1.7 — 3.75 %/min, against the 2.5 %/min
        // the first segment alone would have claimed.
        expect(socPerMin).toBeCloseTo(3.75, 6);
    });

    it('takes the ramp out when the projection reaches back a long way', () => {
        const r = alignSeries(R2, 4);
        expect(r.extrapolated).toBe(true);
        expect(r.rampTrimmed).toBe(2);
        expect(r.back).toBeGreaterThan(RAMP_TRIM_MIN_MINUTES);
        // From the first SETTLED point — 12% at t=0.9 — back 8 points of SoC at
        // 3.75 %/min. Left ramped it reaches 6 points at 2.73 %/min from t=0.1,
        // which lands t=0 nearly a minute earlier.
        expect(r.back).toBeCloseTo(2.133, 3);
        expect(r.points[0].time).toBeCloseTo(-1.233, 3);
        expect(alignSeries(R2.slice(2), 4).points[0].time).toBeCloseTo(-1.233, 3);
    });

    it('leaves the ramp alone when the projection barely reaches at all', () => {
        // 11% is one point of SoC below the R2's first sample: well under a
        // minute, so the correction is worth less than the samples it costs.
        const r = alignSeries(R2, 9);
        expect(r.extrapolated).toBe(true);
        expect(r.back).toBeLessThan(RAMP_TRIM_MIN_MINUTES);
        expect(r.rampTrimmed).toBe(0);
        expect(r.points[1].chargeRate).toBe(93);
    });

    it('takes the ramp off the plot when it takes it out of the slope', () => {
        // Leaving those samples visible inside the projected span would put a
        // measured 93 kW on top of a line asserting 220.
        const r = alignSeries(R2, 4);
        expect(r.points.slice(1)).toHaveLength(R2.length - 2);
        expect(r.points.map(p => p.chargeRate)).not.toContain(93);
        expect(r.points[1].chargeRate).toBe(214);
    });

    it('gives the invented start a SoC and a time and nothing else', () => {
        // Inheriting the first point's channels put a measured 93 kW at a
        // moment the run never recorded, drawn flat across the invented minute
        // — a number the estimate itself contradicts.
        const r = alignSeries(R2, 4);
        expect(r.points[0]).toEqual({ soc: 4, time: expect.any(Number), _extrapolatedStart: true });
    });

    it('never trims for a start inside the data, however ramped the opening', () => {
        // A curve that begins inside its own data leans on no slope at all, so
        // there is nothing for trimming to protect.
        const between = alignSeries(R2, 14.5);       // between two samples
        expect(between.interpolated).toBe(true);
        expect(between.rampTrimmed).toBeUndefined();

        const exact = alignSeries(R2, 15);           // straight onto a sample
        expect(exact.interpolated).toBe(false);
        expect(exact.extrapolated).toBeUndefined();
        expect(exact.rampTrimmed).toBeUndefined();
    });

    it('interpolates the other channels for a start INSIDE the data', () => {
        // Interior, so a charge rate partway between two real samples is a
        // reading of the data rather than an invention.
        const r = alignSeries([
            { time: 0, soc: 10, chargeRate: 200 },
            { time: 2, soc: 20, chargeRate: 100 },
        ], 15);
        expect(r.interpolated).toBe(true);
        expect(r.points[0].chargeRate).toBeCloseTo(150, 6);
    });

    it('leaves the automatic threshold on the measured minimum', () => {
        // The threshold should land on a SoC the run reported reaching. Pushing
        // it to 12% would trim on behalf of a run that then keeps its ramp.
        expect(minimumCommonSoc([R2])).toBe(10);
    });

    it('measures a slope with the ramp in when asked to', () => {
        expect(extrapolationSlope(R2, { skipRamp: false }).trimmed).toBe(0);
        // 10% at t=0.1 to 13% at t=1.2 — the 3-point span still applies, which
        // is why this is 2.73 rather than the first segment's raw 2.5.
        expect(extrapolationSlope(R2, { skipRamp: false }).socPerMin).toBeCloseTo(3 / 1.1, 6);
        expect(extrapolationSlope(R2).socPerMin).toBeCloseTo(3.75, 6);
    });

    it('is idempotent — settled data has no ramp to find', () => {
        const once = trimRamp(R2);
        expect(once).toHaveLength(R2.length - 2);
        expect(trimRamp(once)).toHaveLength(once.length);
    });

    it('leaves a series alone when there is no ramp to trim', () => {
        const flat = pts([25, 0], [30, 5]);
        expect(trimRamp(flat)).toBe(flat);
        expect(trimRamp(null)).toEqual([]);
    });

    it('trims nothing from a run whose power is already tapering', () => {
        // Starts high and falls away: the first point IS the plateau.
        const taper = [
            { time: 0, soc: 55, chargeRate: 120 },
            { time: 5, soc: 62, chargeRate: 95 },
            { time: 10, soc: 68, chargeRate: 70 },
        ];
        expect(rampLength(taper)).toBe(0);
        expect(extrapolationSlope(taper).trimmed).toBe(0);
    });

    it('trims nothing when power was never logged', () => {
        // The SoC slope alone cannot tell a ramp from coarse sampling, and
        // guessing would penalise every run that simply logs sparsely.
        expect(rampLength(pts([25, 0], [26, 1], [40, 10]))).toBe(0);
    });

    it('refuses to trim so far that there is nothing left to measure', () => {
        const stub = [
            { time: 0, soc: 10, chargeRate: 20 },
            { time: 1, soc: 12, chargeRate: 400 },
        ];
        expect(rampLength(stub)).toBe(0);
        expect(extrapolationSlope(stub).socPerMin).toBeCloseTo(2, 6);
    });

    it('never trims more than the cap, however long power keeps climbing', () => {
        const climbing = Array.from({ length: 10 }, (_, i) => ({
            time: i, soc: 10 + i, chargeRate: 20 + i * 20,
        }));
        expect(rampLength(climbing)).toBe(RAMP_MAX_TRIM);
    });

    it('returns no slope for a trace that is not gaining', () => {
        expect(extrapolationSlope(pts([60, 0], [40, 10]))).toBeNull();
        expect(extrapolationSlope([{ soc: 10, time: 0 }])).toBeNull();
        expect(extrapolationSlope(null)).toBeNull();
    });
});
