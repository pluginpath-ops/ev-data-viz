import { describe, it, expect } from 'vitest';
import {
    AXIS_LIMIT_CHARTS, NO_AXIS_LIMITS, AXIS_LIMIT_FIELDS, defaultAxisLimits, axisLimitsOf,
    withAxisLimit, withAxisLimits, encodeAxisLimits, decodeAxisLimits, hoursToMinutes, hasAxisLimits,
} from '../axisLimits';
import { ALL_CHART_MODES } from '../../constants/chartNav';

describe('every chart has decided whether it has axis limits (#478)', () => {
    it('each chart mode is in AXIS_LIMIT_CHARTS or NO_AXIS_LIMITS, and not both', () => {
        // A new chart fails here until someone says which, so "forgot the limits"
        // is a failing test and not a bug report.
        for (const mode of ALL_CHART_MODES) {
            const has = hasAxisLimits(mode);
            const hasnt = mode in NO_AXIS_LIMITS;
            expect(has !== hasnt, `${mode}: list it in exactly one of AXIS_LIMIT_CHARTS / NO_AXIS_LIMITS`).toBe(true);
        }
    });

    it('lists nothing that is not a chart, bar the one sub-tab with no mode', () => {
        for (const key of Object.keys(AXIS_LIMIT_CHARTS)) {
            if (key === 'epaexplorer') continue;   // Modeled Efficiency · All EVs: a sub-tab
            expect(ALL_CHART_MODES, key).toContain(key);
        }
        for (const mode of Object.keys(NO_AXIS_LIMITS)) expect(ALL_CHART_MODES, mode).toContain(mode);
    });

    it('gives every exception a reason', () => {
        for (const [mode, why] of Object.entries(NO_AXIS_LIMITS)) expect(why.length, mode).toBeGreaterThan(10);
    });
});

describe('defaults', () => {
    it('start the Y axis at zero for Charging Curves and Range & Efficiency, Auto elsewhere', () => {
        expect(defaultAxisLimits('charging').yMin).toBe(0);
        expect(defaultAxisLimits('range').yMin).toBe(0);
        for (const chart of ['roadtrip', 'perfcurve', 'epacurves', 'epaexplorer']) {
            expect(defaultAxisLimits(chart).yMin, chart).toBeNull();
        }
        for (const chart of Object.keys(AXIS_LIMIT_CHARTS)) {
            expect(Object.keys(defaultAxisLimits(chart)), chart).toEqual(AXIS_LIMIT_FIELDS);
        }
    });
});

describe('storing limits', () => {
    it('keeps only the charts that were set, and drops one put back to its defaults', () => {
        let store = {};
        store = withAxisLimit(store, 'range', 'yMax', 500);
        expect(Object.keys(store)).toEqual(['range']);
        store = withAxisLimit(store, 'roadtrip', 'xMin', 1);
        store = withAxisLimit(store, 'range', 'yMax', null);
        expect(Object.keys(store)).toEqual(['roadtrip']);
        expect(withAxisLimits(store, 'roadtrip', defaultAxisLimits('roadtrip'))).toEqual({});
    });

    it('a chart whose default is zero keeps an explicit Auto', () => {
        const store = withAxisLimit({}, 'charging', 'yMin', null);
        expect(axisLimitsOf(store, 'charging').yMin).toBeNull();
    });

    it('does not change the object it was given', () => {
        const store = { range: { ...defaultAxisLimits('range'), yMax: 5 } };
        const frozen = JSON.stringify(store);
        withAxisLimit(store, 'range', 'yMax', 9);
        expect(JSON.stringify(store)).toBe(frozen);
    });
});

describe('the packed parameter', () => {
    it.each(Object.keys(AXIS_LIMIT_CHARTS))('%s: encode -> decode returns what was set', (chart) => {
        const limits = { xMin: -5, xMax: 0.5, yMin: 1e-7, yMax: 1200, y2Min: null, y2Max: 33 };
        expect(decodeAxisLimits(encodeAxisLimits(limits, chart), chart)).toEqual(limits);
    });

    it('is empty when nothing differs from the defaults', () => {
        expect(encodeAxisLimits(defaultAxisLimits('range'), 'range')).toBe('');
        expect(decodeAxisLimits('', 'range')).toEqual(defaultAxisLimits('range'));
        expect(decodeAxisLimits(null, 'range')).toEqual(defaultAxisLimits('range'));
    });

    it('uses only characters a query string does not escape', () => {
        const packed = encodeAxisLimits({ ...defaultAxisLimits('roadtrip'), xMin: 1.5, yMax: -3, y2Min: null }, 'roadtrip');
        expect(new URLSearchParams({ ax: packed }).toString()).toBe(`ax=${packed}`);
    });

    it('reads y2n and y2x as themselves, not as y', () => {
        expect(decodeAxisLimits('y2n4_y2x9_yn1', 'roadtrip')).toMatchObject({ y2Min: 4, y2Max: 9, yMin: 1 });
    });
});

describe('time limits are typed in hours and plotted in minutes', () => {
    it('converts in one place and leaves Auto alone', () => {
        expect(hoursToMinutes(2.5)).toBe(150);
        expect(hoursToMinutes(0)).toBe(0);
        expect(hoursToMinutes(null)).toBeNull();
    });
});
