import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    parseChartUrl, buildChartParams, chartConfigFromParsed, chartQueryString, withDefaultsWrittenOut,
    RANGE_CHART_TYPES, DEFAULT_RANGE_CHART_TYPE, HOME_CHARGER_CHARTS, DEFAULT_EFFICIENCY_UNIT, DEFAULT_COMPARE_ORIENTATION,
} from '../chartUrlState';
import { DEFAULT_READER_MODE, DEFAULT_CORRECTION_TARGET } from '../correctionSettings';
import { defaultChartConfig, defaultCompareConfig, defaultRoadTripConfig } from '../chartDefaults';
import { AXIS_LIMIT_CHARTS, axisLimitsOf } from '../axisLimits';
import { openSettingsKey } from '../settingsKey';

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

describe('Size chart', () => {
    it('writes the front view and an anchor off the default, and reads them back', () => {
        const q = build({ chartMode: 'specsize', chartConfig: { ...baseConfig(), sizeView: 'front', sizeAnchor: 'rearAxle' } });
        expect(q).toContain('sv=front');
        expect(q).toContain('sa=rearAxle');
        const cfg = chartConfigFromParsed(parseChartUrl(q).chart, baseConfig());
        expect(cfg.sizeView).toBe('front');
        expect(cfg.sizeAnchor).toBe('rearAxle');
    });

    it('leaves the defaults out, reads absent as them, and drops what it does not know', () => {
        const q = build({ chartMode: 'specsize', chartConfig: { ...baseConfig(), sizeView: 'side', sizeAnchor: 'front' } });
        expect(q).not.toContain('sv=');
        expect(q).not.toContain('sa=');
        const stale = { ...baseConfig(), sizeView: 'front', sizeAnchor: 'rear' };
        const cfg = chartConfigFromParsed(parseChartUrl(q).chart, stale);
        expect([cfg.sizeView, cfg.sizeAnchor]).toEqual(['side', 'front']);
        expect(parseChartUrl('tab=specifications&m=specsize&sv=top&sa=roof').chart).toMatchObject({ sizeView: null, sizeAnchor: null });
    });

    it('writes its defaults out for a short link', () => {
        const out = new URLSearchParams(withDefaultsWrittenOut('tab=specifications&m=specsize'));
        expect([out.get('sv'), out.get('sa'), out.get('sd')]).toEqual(['side', 'front', 'photos']);
    });

    it('writes Outlines, reads it back, and reads absent as Photos', () => {
        const q = build({ chartMode: 'specsize', chartConfig: { ...baseConfig(), sizeDraw: 'outlines' } });
        expect(q).toContain('sd=outlines');
        expect(chartConfigFromParsed(parseChartUrl(q).chart, baseConfig()).sizeDraw).toBe('outlines');
        const plain = build({ chartMode: 'specsize', chartConfig: { ...baseConfig(), sizeDraw: 'photos' } });
        expect(plain).not.toContain('sd=');
        expect(chartConfigFromParsed(parseChartUrl(plain).chart, { ...baseConfig(), sizeDraw: 'outlines' }).sizeDraw).toBe('photos');
    });
});

describe('Home Charger', () => {
    const base = { ...baseConfig(), homeChargerChart: 'cost' };
    it('writes the time chart and reads it back', () => {
        const q = build({ chartMode: 'drivecharger', chartConfig: { ...base, homeChargerChart: 'time' } });
        expect(q).toContain('hc=time');
        const { chart } = parseChartUrl(q);
        expect(chartConfigFromParsed(chart, baseConfig()).homeChargerChart).toBe('time');
    });

    it('leaves the cost chart, the default, out of the address, and reads absent as cost', () => {
        const q = build({ chartMode: 'drivecharger', chartConfig: base });
        expect(q).not.toContain('hc=');
        const stale = { ...baseConfig(), homeChargerChart: 'time' };
        expect(chartConfigFromParsed(parseChartUrl(q).chart, stale).homeChargerChart).toBe('cost');
    });

    it('is written on Home Charger links only, and drops a chart it does not know', () => {
        expect(build({ chartMode: 'drivecharger', chartConfig: { ...base, homeChargerChart: 'time' } })).toContain('hc=time');
        expect(build({ chartMode: 'drivecost', chartConfig: { ...base, homeChargerChart: 'time' } })).not.toContain('hc=');
        expect(parseChartUrl('tab=cost&m=drivecharger&hc=pie').chart.homeChargerChart).toBeNull();
        expect(HOME_CHARGER_CHARTS).toEqual(['cost', 'time']);
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

describe('the settings that already traveled still do', () => {
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
            roadTripConfig: { ...defaultRoadTripConfig(), mode: 'time', startSoc: 80, legDistance: 120, speed: 75 },
        });
        const parsed = parseChartUrl(q);
        expect(parsed.pairings).toEqual({ 12: ['5', '7'] });
        expect(parsed.roadTrip).toEqual({ mode: 'time', startSoc: 80, legDistance: 120, speed: 75 });
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
        // Road Trip's own settings are at their defaults, so the slim address
        // leaves them out (#476); applied, they are the defaults.
        expect({ ...defaultRoadTripConfig(), ...parsed.roadTrip }).toMatchObject({ totalDistance: 500, xAxis: 'totalTime', optimizerDistance: 900, optimizerChart: 'tripDist', bestPlan: false, optimizerSpeedMin: 50, optimizerSpeedMax: 75 });
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

// ── The slim address bar (#476) ──────────────────────────────────────────────
describe('the address bar leaves out what a fresh page would show (#476)', () => {
    it('an untouched Road Trip writes only where it is', () => {
        const q = new URLSearchParams(build({ chartMode: 'roadtrip', selectedVehicles: [3], roadTripConfig: defaultRoadTripConfig() }));
        expect([...q.keys()].sort()).toEqual(['m', 'tab', 'v']);
    });

    it('an untouched Charge Stop writes none of cmp_soc, cmp_mins, cmp_mi', () => {
        const q = new URLSearchParams(build({ chartMode: 'compare', compareConfig: defaultCompareConfig() }));
        for (const k of ['cmp_soc', 'cmp_mins', 'cmp_mi']) expect(q.has(k)).toBe(false);
        const moved = new URLSearchParams(build({ chartMode: 'compare', compareConfig: { ...defaultCompareConfig(), xMinutes: 20 } }));
        expect(moved.get('cmp_mins')).toBe('20');
        expect(moved.has('cmp_soc')).toBe(false);
    });

    it('towing writes only the towing settings that moved', () => {
        const q = new URLSearchParams(build({ chartMode: 'roadtrip', roadTripConfig: { ...defaultRoadTripConfig(), towingMode: true, towingEfficiency: 1.2 } }));
        expect(q.get('rt_tw')).toBe('1');
        expect(q.get('rt_te')).toBe('1.2');
        expect(q.has('rt_tr')).toBe(false);
    });

    it('writes commas and colons plain', () => {
        const p = new URLSearchParams({ r: '1,2,3', cmp_sel: '4::5' });
        expect(chartQueryString(p)).toBe('r=1,2,3&cmp_sel=4::5');
        expect(parseChartUrl(chartQueryString(p)).chart.runIds).toEqual([1, 2, 3]);
    });

    it('writes the defaults back out for what must not follow them', () => {
        const out = new URLSearchParams(withDefaultsWrittenOut('tab=efficiency&m=roadtrip&rt_ct=15'));
        expect(out.get('rt_ct')).toBe('15');
        expect(out.get('rt_ya')).toBe(defaultRoadTripConfig().yAxis);
        expect(out.has('rt_te')).toBe(false);
        expect(withDefaultsWrittenOut('tab=efficiency&m=range&r=5')).toBe('tab=efficiency&m=range&r=5');
    });
});

describe('a link carries how the chart draws, in its settings key', () => {
    const colored = (over = {}) => ({
        ...baseConfig(), seriesPalette: 'evbench', handSet: false, vehicleBases: {}, colorPicks: {}, ...over,
    });
    const settingsOf = q => openSettingsKey(q);

    it('writes no key for a chart drawn the default way', () => {
        expect(new URLSearchParams(build({ chartConfig: colored(), selectedVehicles: [3] })).has('sk')).toBe(false);
    });

    it('packs the settings into sk, after the readable parameters', () => {
        const q = build({ chartMode: 'range', chartConfig: colored({ seriesPalette: 'okabe-ito', verboseLabels: true }), selectedVehicles: [3] });
        const keys = [...new URLSearchParams(q).keys()];
        expect(keys.at(-1)).toBe('sk');
        expect(keys).not.toContain('pal');
        const s = settingsOf(q);
        expect(s.get('pal')).toBe('okabe-ito');
        expect(s.get('vl')).toBe('1');
    });

    it('round-trips the palette, the selected vehicles\' bases, the chart\'s picks and Road Trip\'s settings', () => {
        const chartConfig = colored({
            seriesPalette: 'okabe-ito',
            vehicleBases: { 3: '#112233', 9: '#445566' },   // 9 is not selected
            handSet: true,
            colorPicks: { roadtrip: { key: '3,4', map: { '434::351': '#aabbcc', 434: '#ddeeff' } } },
        });
        const roadTripConfig = {
            selected: ['434::351'], destinationMinSoc: 20,
            perRun: { '434::351': { minSoc: 5, legDistance: 120 } }, testSpread: true,
        };
        const q = chartQueryString(buildChartParams(baseState({ chartMode: 'roadtrip', chartConfig, selectedVehicles: [4, 3], roadTripConfig })));
        expect(settingsOf(q).get('vb')).toBe('3:112233');

        const parsed = parseChartUrl(q);
        expect(parsed.roadTrip).toMatchObject(roadTripConfig);
        const applied = chartConfigFromParsed(parsed.chart, defaultChartConfig(), [3, 4]);
        expect(applied.seriesPalette).toBe('okabe-ito');
        expect(applied.vehicleBases).toEqual({ 3: '#112233' });
        expect(applied.handSet).toBe(true);
        expect(applied.colorPicks.roadtrip).toEqual({ key: '3,4', map: { '434::351': '#aabbcc', 434: '#ddeeff' } });
    });

    it('round-trips a view\'s group of settings, merged over the config\'s own', () => {
        const chartConfig = colored({ perfCurve: { grouping: 'all', pickedRunIds: [7, 8], colorEdits: { 7: '#aabbcc' }, showG: true } });
        const q = build({ chartMode: 'perfcurve', chartConfig, selectedVehicles: [3] });
        const applied = chartConfigFromParsed(parseChartUrl(q).chart, { ...defaultChartConfig(), perfCurve: { showPublished: false } });
        expect(applied.perfCurve).toEqual({ showPublished: false, grouping: 'all', pickedRunIds: [7, 8], colorEdits: { 7: '#aabbcc' }, showG: true });
    });

    it('writes a chart\'s own settings only for that chart', () => {
        const chartConfig = colored({ perfCurve: { showG: true }, sizeGrid: false });
        expect(settingsOf(build({ chartMode: 'range', chartConfig, selectedVehicles: [3] })).has('pv_g')).toBe(false);
        expect(settingsOf(build({ chartMode: 'specsize', chartConfig, selectedVehicles: [3] })).get('sz_g')).toBe('0');
    });

    it('leaves parked picks, and picks made for another vehicle set, out', () => {
        const picks = { charging: { key: '3', map: { 11: '#aabbcc' } } };
        const parked = build({ chartConfig: colored({ colorPicks: picks }), selectedVehicles: [3] });
        expect(settingsOf(parked).has('col')).toBe(false);
        const otherSet = build({ chartConfig: colored({ handSet: true, colorPicks: picks }), selectedVehicles: [3, 4] });
        expect(settingsOf(otherSet).has('col')).toBe(false);
    });

    it('carries picks and routing only for the rows on the chart', () => {
        const chartConfig = colored({
            handSet: true,
            colorPicks: { roadtrip: { key: '3', map: { '434::351': '#aabbcc', 434: '#ddeeff', 500: '#123456' } } },
        });
        const roadTripConfig = {
            selected: ['434::351'],
            perRun: { '434::351': { minSoc: 5 }, '500::': { minSoc: 8 } },   // 500 was unticked
        };
        const q = chartQueryString(buildChartParams(baseState({ chartMode: 'roadtrip', chartConfig, selectedVehicles: [3], roadTripConfig })));
        const s = settingsOf(q);
        expect(s.get('col')).toBe('434:ddeeff,434::351:aabbcc');   // 500 is gone
        expect(parseChartUrl(q).roadTrip.perRun).toEqual({ '434::351': { minSoc: 5 } });

        const charging = build({
            chartConfig: colored({ handSet: true, selectedRuns: [11], colorPicks: { charging: { key: '3', map: { 11: '#aabbcc', 12: '#ddeeff' } } } }),
            selectedVehicles: [3],
        });
        expect(settingsOf(charging).get('col')).toBe('11:aabbcc');
    });

    it('reads the same settings unpacked, as a short link and a featured comparison hold them', () => {
        expect(parseChartUrl('tab=efficiency&m=range&pal=okabe-ito&vl=1').chart.settings)
            .toEqual({ seriesPalette: 'okabe-ito', verboseLabels: true });
    });

    it('opens a link with no picks with hand-set off', () => {
        const applied = chartConfigFromParsed(parseChartUrl('tab=efficiency&m=range').chart,
            { ...defaultChartConfig(), handSet: true });
        expect(applied.handSet).toBe(false);
    });

    it('drops what it cannot read, and opens the chart anyway', () => {
        expect(parseChartUrl('tab=efficiency&pal=rainbow&pc_bm=sideways').chart.settings).toEqual({});
        expect(parseChartUrl('tab=efficiency&m=range&sk=1.!!').chart.chartMode).toBe('range');
        expect(parseChartUrl('tab=efficiency&m=range&sk=9.AAAA').chart.settings).toEqual({});
    });

    it('a short link packs the settings flat, not a key inside a key', () => {
        const q = build({ chartMode: 'range', chartConfig: colored({ seriesPalette: 'okabe-ito' }), selectedVehicles: [3] });
        const written = new URLSearchParams(withDefaultsWrittenOut(q));
        expect(written.has('sk')).toBe(false);
        expect(written.get('pal')).toBe('okabe-ito');
    });
});
