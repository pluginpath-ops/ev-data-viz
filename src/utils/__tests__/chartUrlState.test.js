import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    parseChartUrl, buildChartParams, chartConfigFromParsed,
    RANGE_CHART_TYPES, DEFAULT_RANGE_CHART_TYPE, DEFAULT_EFFICIENCY_UNIT, DEFAULT_COMPARE_ORIENTATION,
} from '../chartUrlState';
import { DEFAULT_READER_MODE, DEFAULT_CORRECTION_TARGET } from '../correctionSettings';
import { defaultChartConfig } from '../chartDefaults';
import { AXIS_LIMIT_CHARTS, axisLimitsOf } from '../axisLimits';

const baseConfig = () => ({
    xAxis: 'soc', yAxis: 'chargeRate', y2Axis: null, selectedRuns: [],
    alignRaw: false, raceThreshold: null,
    axisLimits: {},
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

describe('the axes belong to Charging Curves', () => {
    it('are written for charging only, since no other chart reads them', () => {
        const keys = mode => [...new URLSearchParams(build({ chartMode: mode, selectedVehicles: [3] })).keys()];
        expect(keys('charging')).toEqual(expect.arrayContaining(['x', 'y']));
        for (const mode of ['range', 'compare', 'roadtrip', 'epacurves']) {
            expect(keys(mode)).not.toContain('x');
            expect(keys(mode)).not.toContain('y');
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
            raceThreshold: 12, axisLimits: { charging: { xMin: 5, xMax: 60, yMin: 10, yMax: 90 } },
            showLine: false, showPoints: true,
            compositeSpread: false, addedSpread: true,
            correctionMode: 'aero', correctionTarget: { speedMph: 65, temperatureF: 75, altitudeFt: 1000 },
        };
        const { chart } = parseChartUrl(build({ chartConfig }));
        expect(chart).toMatchObject({
            xAxis: 'time', yAxis: 'soc', y2Axis: 'chargeRate', alignRaw: true, raceThreshold: 12,
            axisLimits: { xMin: 5, xMax: 60, yMin: 10, yMax: 90, y2Min: null, y2Max: null },
            showLine: false, showPoints: true,
            compositeSpread: false, addedSpread: true,
            correction: { mode: 'aero', target: { speedMph: 65, temperatureF: 75, altitudeFt: 1000 } },
        });
    });

    it('reads an empty query as the defaults', () => {
        const { chart, compare, pairings, roadTrip, epa } = parseChartUrl('');
        expect(chart).toMatchObject({ chartMode: 'charging', axisLimits: { yMin: 0, yMax: null }, showLine: true, showPoints: false, runIds: [], vehicleIds: [] });
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

describe('Trip Optimizer links', () => {
    const rt = { mode: 'distance', startSoc: 90, minSoc: 10, legDistance: 150, chargeTime: 30, totalDistance: 500, speed: 70, overhead: 5, yAxis: 'chargeTime', xAxis: 'totalTime', sweepYAxis: 'totalTime', towingMode: false };

    it('round-trips its own distance, chart and best-plan switch, leaving Road Trip\'s alone', () => {
        const q = build({ chartMode: 'optimizer', roadTripConfig: { ...rt, optimizerDistance: 900, optimizerChart: 'tripDist', bestPlan: false, optimizerSpeedMin: 50, optimizerSpeedMax: 75 } });
        const parsed = parseChartUrl(q);
        expect(parsed.chart.chartMode).toBe('optimizer');
        expect(parsed.roadTrip).toMatchObject({ totalDistance: 500, xAxis: 'totalTime', optimizerDistance: 900, optimizerChart: 'tripDist', bestPlan: false, optimizerSpeedMin: 50, optimizerSpeedMax: 75 });
    });

    it('does not write its keys on a Road Trip link', () => {
        const keys = [...new URLSearchParams(build({ chartMode: 'roadtrip', roadTripConfig: { ...rt, optimizerDistance: 700, optimizerChart: 'speed', bestPlan: true } })).keys()];
        for (const k of ['rt_otd', 'rt_oc', 'rt_bp', 'rt_osn', 'rt_osx']) expect(keys).not.toContain(k);
    });

    it('opens a Road Trip sweep link from before the tab existed as the same chart', () => {
        const parsed = parseChartUrl('m=roadtrip&rt_xa=speed&rt_td=640');
        expect(parsed.chart.chartMode).toBe('optimizer');
        // Best plan off: the old chart held the stop plan at what the link set.
        expect(parsed.roadTrip).toMatchObject({ optimizerChart: 'speed', optimizerDistance: 640, bestPlan: false });
        expect(parsed.roadTrip.xAxis).toBeUndefined();
        expect(parseChartUrl('m=roadtrip&rt_xa=driveTime').chart.chartMode).toBe('roadtrip');
    });
});

// ── Axis limits (#478) ───────────────────────────────────────────────────────
// Every chart that has Axis Scale controls keeps its limits in
// chartConfig.axisLimits and the link writes them as one `ax` parameter.
describe('axis limits travel with the chart link (#478)', () => {
    const chartsWithLimits = Object.keys(AXIS_LIMIT_CHARTS).filter(k => k !== 'epaexplorer');
    const set = { xMin: 5, xMax: 60, yMin: 2, yMax: 90, y2Min: -1.5, y2Max: 0.25 };
    const withLimits = (chart, limits) => ({ ...baseConfig(), axisLimits: { [chart]: limits } });

    it.each(chartsWithLimits)('%s: limits survive build -> parse -> apply', (mode) => {
        const q = build({ chartMode: mode, chartConfig: withLimits(mode, set) });
        const parsed = parseChartUrl(q);
        expect(parsed.chart.chartMode).toBe(mode);
        expect(parsed.chart.axisLimits).toEqual(set);
        // ...and applied to a fresh page, as a featured comparison's panel is.
        const applied = chartConfigFromParsed(parsed.chart, defaultChartConfig());
        expect(axisLimitsOf(applied.axisLimits, mode)).toEqual(set);
    });

    it.each(chartsWithLimits)('%s: is ONE parameter, and an untouched chart has none', (mode) => {
        const limited = new URLSearchParams(build({ chartMode: mode, chartConfig: withLimits(mode, set) }));
        expect(limited.getAll('ax')).toHaveLength(1);
        for (const legacy of ['xn', 'xx', 'yn', 'yx', 'y2n', 'y2x']) expect(limited.has(legacy)).toBe(false);
        expect(new URLSearchParams(build({ chartMode: mode })).has('ax')).toBe(false);
    });

    it('writes only the limits that differ from the chart\'s own defaults', () => {
        // Charging Curves and Range start the Y axis at zero; the others at Auto.
        expect(new URLSearchParams(build({ chartMode: 'charging', chartConfig: withLimits('charging', { yMin: 0, yMax: 120 }) })).get('ax')).toBe('yx120');
        expect(new URLSearchParams(build({ chartMode: 'roadtrip', chartConfig: withLimits('roadtrip', { yMin: 0 }) })).get('ax')).toBe('yn0');
    });

    it('keeps a Y minimum put back to Auto, where the default is zero', () => {
        const q = build({ chartMode: 'range', chartConfig: withLimits('range', { yMin: null, xMax: 80 }) });
        expect(new URLSearchParams(q).get('ax')).toBe('xx80_yna');
        expect(parseChartUrl(q).chart.axisLimits).toMatchObject({ xMax: 80, yMin: null });
    });

    it('writes the opened chart\'s limits and no other chart\'s', () => {
        const chartConfig = { ...baseConfig(), axisLimits: { charging: { xMax: 40 }, range: { yMax: 500 } } };
        expect(new URLSearchParams(build({ chartMode: 'range', chartConfig })).get('ax')).toBe('yx500');
        expect(new URLSearchParams(build({ chartMode: 'charging', chartConfig })).get('ax')).toBe('xx40');
        // A chart with no axis limits writes none, whatever the config holds.
        expect(new URLSearchParams(build({ chartMode: 'compare', chartConfig })).has('ax')).toBe(false);
        expect(parseChartUrl('m=compare&ax=xx40').chart.axisLimits).toBeNull();
    });

    it('applying a link leaves the other charts\' limits as they were', () => {
        const base = { ...defaultChartConfig(), axisLimits: { range: { yMax: 500 } } };
        const { chart } = parseChartUrl('m=charging&ax=xx40');
        expect(chartConfigFromParsed(chart, base).axisLimits).toEqual({ range: { yMax: 500 }, charging: { ...axisLimitsOf({}, 'charging'), xMax: 40 } });
        // ...and a link that names none puts the opened chart back to Auto.
        expect(chartConfigFromParsed(parseChartUrl('m=range').chart, base).axisLimits).toEqual({});
    });

    it('survives the pop-out\'s structured clone', () => {
        const chartConfig = withLimits('roadtrip', set);
        expect(axisLimitsOf(structuredClone(chartConfig).axisLimits, 'roadtrip')).toEqual(set);
    });
});

describe('links written before #478 still open as they did', () => {
    it('reads xn xx yn yx y2n y2x as Charging Curves\' limits', () => {
        const { chart } = parseChartUrl('tab=efficiency&x=soc&y=chargeRate&xn=10&xx=80&yn=5&yx=200&y2n=1&y2x=2');
        expect(chart.axisLimits).toEqual({ xMin: 10, xMax: 80, yMin: 5, yMax: 200, y2Min: 1, y2Max: 2 });
    });

    it('reads a missing yn as zero, as it always did', () => {
        expect(parseChartUrl('xx=80').chart.axisLimits).toEqual({ xMin: null, xMax: 80, yMin: 0, yMax: null, y2Min: null, y2Max: null });
    });

    it('does not hand another chart the limits Charging Curves left in the link', () => {
        // Before #478 these were written for every mode and read by one. A Range
        // link carrying xn=10 meant "Charging Curves had x from 10", not Range.
        for (const mode of ['range', 'roadtrip', 'perfcurve', 'epacurves']) {
            expect(parseChartUrl(`m=${mode}&xn=10&yx=200`).chart.axisLimits).toEqual(axisLimitsOf({}, mode));
        }
    });

    it('prefers the packed parameter when a link has both', () => {
        expect(parseChartUrl('xn=10&ax=xx40').chart.axisLimits).toMatchObject({ xMin: null, xMax: 40 });
    });

    it('ignores what it cannot read rather than losing the chart', () => {
        expect(parseChartUrl('ax=xx40_bogus_yxNaN_y2n').chart.axisLimits).toMatchObject({ xMax: 40, yMax: null });
        expect(parseChartUrl('xn=abc').chart.axisLimits).toMatchObject({ xMin: null });
    });
});
