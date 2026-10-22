import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    parseChartUrl, buildChartParams,
    RANGE_CHART_TYPES, DEFAULT_RANGE_CHART_TYPE, DEFAULT_EFFICIENCY_UNIT, DEFAULT_COMPARE_ORIENTATION,
} from '../chartUrlState';
import { DEFAULT_READER_MODE, DEFAULT_CORRECTION_TARGET } from '../correctionSettings';

const baseConfig = () => ({
    xAxis: 'soc', yAxis: 'chargeRate', y2Axis: null, selectedRuns: [],
    alignRaw: false, raceThreshold: null,
    xMin: null, xMax: null, yMin: 0, yMax: null, y2Min: null, y2Max: null,
    showLine: true, showPoints: false,
    compositeSpread: true, addedSpread: false,
    specsField: null, scatterXField: null, scatterYField: null,
    rangeChartType: DEFAULT_RANGE_CHART_TYPE, effUnit: DEFAULT_EFFICIENCY_UNIT,
    correctionMode: DEFAULT_READER_MODE, correctionTarget: DEFAULT_CORRECTION_TARGET,
});
const baseState = (over = {}) => ({
    view: 'efficiency', chartMode: 'charging',
    chartConfig: baseConfig(), selectedVehicles: [], vehicles: [],
    compareConfig: { xMinutes: 15, mMiles: 150, startSoc: 10, orientation: DEFAULT_COMPARE_ORIENTATION, selected: [] },
    roadTripConfig: {}, epaConfig: {}, pairings: {},
    ...over,
});
const build = over => buildChartParams(baseState(over)).toString();

describe('an untouched chart keeps a short link', () => {
    it('writes the tab and the axes, and none of the new keys', () => {
        const q = new URLSearchParams(build({ selectedVehicles: [3] }));
        expect([...q.keys()].sort()).toEqual(['tab', 'v', 'x', 'y']);
        for (const mode of ['range', 'compare', 'specs']) {
            const keys = [...new URLSearchParams(build({ chartMode: mode, selectedVehicles: [3] })).keys()];
            for (const k of ['rc', 'eff', 'cmp_o', 'cmp_sel', 'sf', 'r']) expect(keys).not.toContain(k);
        }
    });
});

describe('the plotted tests are pinned for charging and for range', () => {
    const vehicles = [{ id: 3, runs: [{ id: 11 }, { id: 12 }] }, { id: 4, runs: [{ id: 21 }] }];
    const config = { ...baseConfig(), selectedRuns: [11, 21] };

    it.each(['charging', 'range'])('%s writes r= and leaves v= to the vehicles r= does not cover', (chartMode) => {
        const q = new URLSearchParams(build({ chartMode, chartConfig: config, vehicles, selectedVehicles: [3, 4, 5] }));
        expect(q.get('r')).toBe('11,21');
        expect(q.get('v')).toBe('5');
    });

    it('every other mode writes the whole selection in v= and no r=', () => {
        const q = new URLSearchParams(build({ chartMode: 'compare', chartConfig: config, vehicles, selectedVehicles: [3, 4] }));
        expect(q.has('r')).toBe(false);
        expect(q.get('v')).toBe('3,4');
    });

    it('reads r= back as ids, and v= beside it', () => {
        const { chart } = parseChartUrl('tab=efficiency&m=range&r=11,21&v=5');
        expect(chart.runIds).toEqual([11, 21]);
        expect(chart.vehicleIds).toEqual([5]);
        expect(chart.chartMode).toBe('range');
    });
});

describe('Range & Efficiency', () => {
    it('round-trips its chart type and efficiency unit', () => {
        const chartConfig = { ...baseConfig(), rangeChartType: 'eff-speed-line', effUnit: 'wh_mi' };
        const q = build({ chartMode: 'range', chartConfig });
        expect(q).toContain('rc=eff-speed-line');
        expect(q).toContain('eff=wh_mi');
        const { chart } = parseChartUrl(q);
        expect(chart.rangeChartType).toBe('eff-speed-line');
        expect(chart.effUnit).toBe('wh_mi');
    });

    it('drops a chart type or unit it does not know', () => {
        const { chart } = parseChartUrl('tab=efficiency&m=range&rc=pie&eff=furlongs');
        expect(chart.rangeChartType).toBeNull();
        expect(chart.effUnit).toBeNull();
    });

    it('writes them only in range mode, since no other chart reads them', () => {
        const chartConfig = { ...baseConfig(), rangeChartType: 'eff-speed-line', effUnit: 'wh_mi' };
        expect(build({ chartMode: 'charging', chartConfig })).not.toContain('rc=');
    });

    it('lists the same chart types the view draws', () => {
        const view = readFileSync('src/components/RangeChartView.jsx', 'utf8');
        const keys = [...view.slice(view.indexOf('const CHART_TYPES')).matchAll(/key: '([^']+)'/g)]
            .map(m => m[1]).slice(0, RANGE_CHART_TYPES.length);
        expect(keys).toEqual(RANGE_CHART_TYPES);
    });
});

describe('Charge Stop', () => {
    const compareConfig = { xMinutes: 20, mMiles: 200, startSoc: 15, orientation: 'vertical', selected: ['70::12', '71::'] };

    it('round-trips its settings, orientation and plotted pairs', () => {
        const q = build({ chartMode: 'compare', compareConfig });
        const { compare } = parseChartUrl(q);
        expect(compare).toEqual({ startSoc: 15, xMinutes: 20, mMiles: 200, orientation: 'vertical', selected: ['70::12', '71::'] });
    });

    it('leaves the orientation and the selection out until they differ from a fresh chart', () => {
        const q = build({ chartMode: 'compare', compareConfig: { ...compareConfig, orientation: 'horizontal', selected: [] } });
        expect(q).not.toContain('cmp_o');
        expect(q).not.toContain('cmp_sel');
    });

    it('ignores an orientation it does not know', () => {
        expect(parseChartUrl('tab=efficiency&m=compare&cmp_o=diagonal').compare).toBeNull();
    });
});

describe('the spec chart', () => {
    it('round-trips its field, in specs mode only', () => {
        const chartConfig = { ...baseConfig(), specsField: 'charging.max_dc_kw' };
        const q = build({ view: 'vehicles', chartMode: 'specs', chartConfig });
        expect(parseChartUrl(q).chart.specsField).toBe('charging.max_dc_kw');
        expect(build({ chartMode: 'charging', chartConfig })).not.toContain('sf=');
    });
});

describe('the settings that already travelled still do', () => {
    it('round-trips axes, limits, display and correction', () => {
        const chartConfig = {
            ...baseConfig(), xAxis: 'time', yAxis: 'soc', y2Axis: 'chargeRate', alignRaw: true,
            raceThreshold: 12, xMin: 5, xMax: 60, yMin: 10, yMax: 90, showLine: false, showPoints: true,
            compositeSpread: false, addedSpread: true,
            correctionMode: 'aero', correctionTarget: { speedMph: 65, temperatureF: 75, altitudeFt: 1000 },
        };
        const { chart } = parseChartUrl(build({ chartConfig }));
        expect(chart).toMatchObject({
            xAxis: 'time', yAxis: 'soc', y2Axis: 'chargeRate', alignRaw: true, raceThreshold: 12,
            xMin: 5, xMax: 60, yMin: 10, yMax: 90, showLine: false, showPoints: true,
            compositeSpread: false, addedSpread: true,
            correction: { mode: 'aero', target: { speedMph: 65, temperatureF: 75, altitudeFt: 1000 } },
        });
    });

    it('reads an empty query as the defaults', () => {
        const { chart, compare, pairings, roadTrip, epa } = parseChartUrl('');
        expect(chart).toMatchObject({ chartMode: 'charging', yMin: 0, showLine: true, showPoints: false, runIds: [], vehicleIds: [] });
        expect([compare, pairings, roadTrip, epa]).toEqual([null, null, null, null]);
    });

    it('falls back to charging for a mode it does not know', () => {
        expect(parseChartUrl('m=nonsense').chart.chartMode).toBe('charging');
    });

    it('round-trips pairings, Road Trip and the Modeled Efficiency selection', () => {
        const q = build({
            chartMode: 'roadtrip', pairings: { 12: ['5', '7'] },
            roadTripConfig: { mode: 'distance', startSoc: 90, minSoc: 10, legDistance: 150, chargeTime: 30, totalDistance: 500, speed: 70, overhead: 5, yAxis: 'chargeTime', xAxis: 'totalTime', sweepYAxis: 'totalTime', towingMode: false },
        });
        const parsed = parseChartUrl(q);
        expect(parsed.pairings).toEqual({ 12: ['5', '7'] });
        expect(parsed.roadTrip).toMatchObject({ mode: 'distance', startSoc: 90, legDistance: 150, speed: 70 });
        const epa = parseChartUrl(build({ chartMode: 'epacurves', epaConfig: { yAxis: 'whmi', selectedMappings: [4, 9], overlay: 'corrected' } })).epa;
        expect(epa).toEqual({ yAxis: 'whmi', selectedMappings: [4, 9], overlay: 'corrected' });
    });
});
