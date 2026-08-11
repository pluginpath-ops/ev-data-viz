import { describe, it, expect } from 'vitest';
import { minimumCommonSoc, alignmentExclusion, alignmentOffset, alignSeries, overExtrapolated, clampSoc } from '../socAlignment';

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
