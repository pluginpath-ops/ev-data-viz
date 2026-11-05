/**
 * The chart state a link carries, read and written in one place.
 *
 * App used to hold both halves inline: a parse on mount (about a hundred lines
 * of `p.get`) and a sync effect that rebuilt the query on every change. They
 * have to agree key for key, and living forty lines of effect apart is how a
 * parameter gets written and never read. Here they sit side by side, and a test
 * round-trips one through the other.
 *
 * This is also the seam a featured comparison (#448) needs. A comparison stores
 * a chart's settings as a query string; opening it parses that string and
 * applies it to a running page, which the old inline parse could not do — it ran
 * once, on mount, against `window.location`.
 *
 * Pure module — no React, no `window`. The caller passes the search string in
 * and gets URLSearchParams back.
 *
 * ── What the query holds, by mode ────────────────────────────────────────────
 *   every chart   tab m v  raw rt  line pts cspread aspread  corr c_spd c_tmp
 *                 c_alt c_acc  pairs
 *   axis limits   ax (utils/axisLimits.js) for the five modes that have them
 *                 — charging range roadtrip perfcurve epacurves. The
 *                 xn xx yn yx y2n y2x of links written before #478 are still read.
 *   charging      x y y2 (the axes), r (the plotted tests)
 *   range         r (the plotted tests), rc (chart type), eff (efficiency unit)
 *   compare       cmp_soc cmp_mins cmp_mi  cmp_o (orientation)  cmp_sel (the
 *                 plotted pairs)
 *   roadtrip      rt_*
 *   optimizer     rt_* and rt_otd rt_oc rt_bp rt_osn rt_osx (its own distance,
 *                 chart, best-plan switch and the speeds the best plan may use). A roadtrip link whose rt_xa is a sweep
 *                 (written before the optimizer had its own tab) opens here.
 *   specs         sf (the field charted)
 *   specscatter   scx scy
 *   epacurves     epa_ya epa_m epa_ov
 *   specstable    vt_* (carried over, written by the table itself) and filters
 *
 * ── Three forms of one link (#476) ───────────────────────────────────────────
 *   the address bar   every setting only where it differs from a fresh page's
 *                     — `chartQueryString(buildChartParams(...))`. Before #476
 *                     x y, cmp_soc cmp_mins cmp_mi and ten rt_* were written
 *                     every time; links that carry them still read the same.
 *   written out       the defaults put back (`withDefaultsWrittenOut`), for
 *                     what must not change when a default does: a featured
 *                     comparison's saved chart, and the input to …
 *   the short link    `?k=1.…`, the toolbar's URL button (`chartShortLink`,
 *                     utils/shortLink.js) — the written-out form, packed.
 */
import { ALL_CHART_MODES, DEFAULT_CHART_MODE } from '../constants/chartNav';
import { decodeCorrection, encodeCorrection } from './correctionSettings';
import { encodePairings, decodePairings } from './pairings';
import { isChargingAxis } from './chargingAxes';
import {
    AXIS_LIMITS_PARAM, axisLimitsOf, axisLimitsOfLink, encodeAxisLimits, hasAxisLimits, withAxisLimits,
} from './axisLimits';
import { encodeVehicleFilters } from './vehicleFilters';
import { VEHICLE_TABLE_PARAM_PREFIX, encodeAssumptionParams } from './vehicleTable';
import {
    DEFAULT_RANGE_CHART_TYPE, DEFAULT_EFFICIENCY_UNIT, DEFAULT_COMPARE_ORIENTATION,
    defaultCompareConfig, defaultRoadTripConfig,
} from './chartDefaults';
import { encodeShortLink } from './shortLink';

// The defaults live with the rest of a fresh page's settings (chartDefaults.js);
// re-exported because the views have always found them here.
export { DEFAULT_RANGE_CHART_TYPE, DEFAULT_EFFICIENCY_UNIT, DEFAULT_COMPARE_ORIENTATION };

/** Road Trip X axes that are sweeps: Trip Optimizer's charts since it got its own tab. */
const ROAD_TRIP_SWEEPS = ['speed', 'tripDist'];

/** Trip Optimizer's charts. */
export const OPTIMIZER_CHARTS = ['speed', 'tripDist', 'map'];

/** The Range & Efficiency chart types, in the order the view lists them. */
export const RANGE_CHART_TYPES = [
    'range-vehicle-bar', 'eff-vehicle-bar',
    'range-speed-line', 'eff-speed-line',
    'range-temp-line', 'eff-temp-line',
];

/** Efficiency as mi/kWh or Wh/mi. */
export const EFFICIENCY_UNITS = ['mi_kwh', 'wh_mi'];

export const COMPARE_ORIENTATIONS = ['horizontal', 'vertical'];

/*
 * Charge Stop's and Road Trip's settings, as [parameter, config key, number?].
 * Written only when they differ from a fresh page's (chartDefaults.js), and read
 * whenever present — links written before #476 carried every one of them. One
 * table for the read, the write and `withDefaultsWrittenOut`, so the three
 * cannot disagree about which parameters there are.
 */
const COMPARE_PARAMS = [
    ['cmp_soc', 'startSoc', true], ['cmp_mins', 'xMinutes', true], ['cmp_mi', 'mMiles', true],
];
const ROAD_TRIP_PARAMS = [
    ['rt_m', 'mode'], ['rt_ss', 'startSoc', true], ['rt_ms', 'minSoc', true],
    ['rt_ld', 'legDistance', true], ['rt_ct', 'chargeTime', true], ['rt_td', 'totalDistance', true],
    ['rt_sp', 'speed', true], ['rt_oh', 'overhead', true],
    ['rt_ya', 'yAxis'], ['rt_xa', 'xAxis'], ['rt_sya', 'sweepYAxis'],
];
// Trip Optimizer's own, on its links alone. Its chart is read apart from the
// table (an unknown one is dropped) and written through its own row.
const OPTIMIZER_PARAMS = [
    ['rt_otd', 'optimizerDistance', true], ['rt_osn', 'optimizerSpeedMin', true], ['rt_osx', 'optimizerSpeedMax', true],
];
const OPTIMIZER_CHART_PARAM = [['rt_oc', 'optimizerChart']];
// Written only on a towing link: they mean nothing without rt_tw=1.
const TOWING_PARAMS = [['rt_te', 'towingEfficiency', true], ['rt_tr', 'towingRefSpeedMph', true]];

/** The settings of `table` that `p` names, as a config fragment. */
function readParams(p, table) {
    const out = {};
    for (const [param, key, numeric] of table) {
        const raw = p.get(param);
        if (numeric ? raw != null : raw) out[key] = numeric ? Number(raw) : raw;
    }
    return out;
}

/** Writes each setting of `table` that differs from `defaults`. */
function writeParams(p, table, config, defaults) {
    for (const [param, key] of table) {
        const value = config?.[key];
        if (value != null && String(value) !== String(defaults[key])) p.set(param, String(value));
    }
}

// Ids are numeric on the wire but a uuid-keyed row would not be, so keep a
// non-number as it came rather than turning it into NaN.
const idOf = id => (isNaN(Number(id)) ? id : Number(id));
const idList = raw => (raw?.split(',').filter(Boolean) || []).map(idOf);

/**
 * Everything a chart link says, as the page applies it.
 *
 * @param {string} search  a query string, with or without the leading `?`
 * @returns {{ chart: object, compare: object|null, pairings: object|null,
 *             roadTrip: object|null, epa: object|null }}
 *   `chart` is the main chart's own state, applied once the vehicles have
 *   loaded. The rest are the per-mode configs, each null when the link names
 *   none of its keys so an untouched mode keeps its defaults.
 */
export function parseChartUrl(search) {
    const p = new URLSearchParams(search ?? '');

    const rangeChartType = p.get('rc');
    const effUnit = p.get('eff');
    // A stale or hand-edited ?m= would otherwise fall through to the charging
    // chart with no indication why.
    const linkedMode = ALL_CHART_MODES.includes(p.get('m')) ? p.get('m') : DEFAULT_CHART_MODE;
    // The sweeps were Road Trip X axes until Trip Optimizer took them; a link
    // to one opens the optimizer on that chart, with the trip it named.
    const sweepLink = linkedMode === 'roadtrip' && ROAD_TRIP_SWEEPS.includes(p.get('rt_xa'));
    const chartMode = sweepLink ? 'optimizer' : linkedMode;

    const chart = {
        vehicleIds:    idList(p.get('v')),
        runIds:        idList(p.get('r')),
        xAxis:         p.get('x')  || null,
        yAxis:         p.get('y')  || null,
        y2Axis:        p.get('y2') || null,
        alignRaw:      p.get('raw') === '1',
        raceThreshold: p.get('rt')  ? Number(p.get('rt'))  : null,
        // The limits of the chart this link opens: all six, defaults filled in,
        // so a link that names none sets none. null for a mode with no axis
        // limits. Only that chart's — the link says nothing of the others.
        axisLimits:    axisLimitsOfLink(p, chartMode),
        showLine:   p.get('line') !== '0', // on unless the link says 0
        showPoints: p.get('pts') === '1',  // off unless the link says 1
        compositeSpread: p.get('cspread') !== '0',
        addedSpread:     p.get('aspread') === '1',
        chartMode,
        scatterXField: p.get('scx') || null,
        scatterYField: p.get('scy') || null,
        specsField:    p.get('sf')  || null,
        specScope:     p.get('ss') === 'all' ? 'all' : null,
        // An unknown value is dropped, not applied: the view would otherwise
        // be handed a chart type it has no entry for.
        rangeChartType: RANGE_CHART_TYPES.includes(rangeChartType) ? rangeChartType : null,
        effUnit:        EFFICIENCY_UNITS.includes(effUnit) ? effUnit : null,
        correction:    decodeCorrection(p.toString()),
    };

    // Charge Stop
    const cmpO    = p.get('cmp_o');
    const cmpSel  = p.get('cmp_sel');
    const compare = {
        ...readParams(p, COMPARE_PARAMS),
        ...(COMPARE_ORIENTATIONS.includes(cmpO) && { orientation: cmpO }),
        // Pair keys, not ids ('70::12'), so they stay strings.
        ...(cmpSel  && { selected: cmpSel.split(',').filter(Boolean) }),
    };

    // Pairings — global across chart modes, so read unconditionally.
    const pairsParam = p.get('pairs');

    // Road Trip
    const roadTrip = {
        ...readParams(p, ROAD_TRIP_PARAMS),
        // A sweep was a Road Trip X axis before Trip Optimizer took them: the
        // link opens the optimizer on that chart, with the trip it named.
        ...(sweepLink && { optimizerChart: p.get('rt_xa'), bestPlan: false,
            ...(p.get('rt_td') != null && { optimizerDistance: Number(p.get('rt_td')) }) }),
        ...readParams(p, OPTIMIZER_PARAMS),
        ...(OPTIMIZER_CHARTS.includes(p.get('rt_oc')) && { optimizerChart: p.get('rt_oc') }),
        ...(p.get('rt_bp') === '0' && { bestPlan: false }),
        ...(p.get('rt_bp') === '1' && { bestPlan: true }),
        ...(p.get('rt_tw') === '1' && { towingMode: true }),
        ...readParams(p, TOWING_PARAMS),
    };
    // The sweep was its X axis; on the optimizer it is the chart, above.
    if (sweepLink) delete roadTrip.xAxis;

    // Modeled Efficiency · selected vehicles
    const epa = {};
    if (p.get('epa_ya')) epa.yAxis = p.get('epa_ya');
    const epaOv = p.get('epa_ov');
    if (epaOv === 'corrected' || epaOv === 'uncorrected') epa.overlay = epaOv;
    if (p.get('epa_m')) {
        // Mapping ids are numeric; `filter(Boolean)` runs BEFORE the map
        // because Number('') is 0 and 0 is finite, so `epa_m=` alone would
        // decode to a selection of the mapping with id zero.
        epa.selectedMappings = p.get('epa_m').split(',').filter(Boolean)
            .map(Number).filter(Number.isFinite);
    }

    const some = o => Object.keys(o).length > 0;
    return {
        chart,
        compare:  some(compare) ? compare : null,
        pairings: pairsParam ? decodePairings(pairsParam) : null,
        roadTrip: some(roadTrip) ? roadTrip : null,
        epa:      some(epa) ? epa : null,
    };
}

/**
 * A chart's settings with a link's laid over them: the one place that knows
 * which parsed fields win. App applies a link's state through it once the data
 * has loaded, and a featured comparison applies a chart's through it onto the
 * defaults (#448).
 *
 * Fields the link does not name keep what `base` has, except the ones that are
 * written as "absent means the default" (the opened chart's axis limits, the
 * display toggles, the correction), which a link always sets: a link with no
 * `ax` is an Auto axis, not "whatever the page had".
 *
 * @param {object} chart  `parseChartUrl(...).chart`
 * @param {object} base   the chartConfig to lay it over
 */
export function chartConfigFromParsed(chart, base) {
    const s = chart;
    return {
        ...base,
        // An axis the chart no longer offers (Temperature, Frame) is left at
        // what `base` has, so an old link or saved comparison still opens.
        ...(isChargingAxis(s.xAxis)  && { xAxis: s.xAxis }),
        ...(isChargingAxis(s.yAxis)  && { yAxis: s.yAxis }),
        ...(isChargingAxis(s.y2Axis) && { y2Axis: s.y2Axis }),
        ...(s.runIds.length > 0 && (s.chartMode === 'charging' || s.chartMode === 'range') && { selectedRuns: s.runIds }),
        alignRaw:      s.alignRaw,
        raceThreshold: s.raceThreshold,
        // The opened chart's limits replace the config's; every other chart's
        // stay as they were (the link does not say what they are).
        ...(s.axisLimits && { axisLimits: withAxisLimits(base.axisLimits, s.chartMode, s.axisLimits) }),
        showLine:      s.showLine ?? true,
        showPoints:    s.showPoints ?? false,
        compositeSpread: s.compositeSpread ?? true,
        addedSpread:     s.addedSpread ?? false,
        ...(s.scatterXField && { scatterXField: s.scatterXField }),
        ...(s.scatterYField && { scatterYField: s.scatterYField }),
        ...(s.specsField    && { specsField: s.specsField }),
        // A link names its scope either way: absent means the selection.
        ...((s.chartMode === 'specs' || s.chartMode === 'specscatter') && { specScope: s.specScope ?? 'selection' }),
        ...(s.rangeChartType && { rangeChartType: s.rangeChartType }),
        ...(s.effUnit       && { effUnit: s.effUnit }),
        correctionMode:   s.correction.mode,
        correctionTarget: s.correction.target,
    };
}

/**
 * The vehicles a link names: its v=, and the owners of the tests in its r=
 * (v= carries only the vehicles that have no plotted test).
 */
export function vehicleIdsOfLink(chart, vehicles) {
    const runIdSet = new Set(chart.runIds.map(String));
    const fromRuns = vehicles
        .filter(v => (v.runs || []).some(r => runIdSet.has(String(r.id))))
        .map(v => v.id);
    return [...new Set([...chart.vehicleIds, ...fromRuns])];
}

/**
 * The query a chart category's page writes, from the state that drew it.
 *
 * Each key is written only when it differs from what an untouched page would
 * show, so a fresh chart keeps a short link.
 *
 * @param {object} s
 * @param {string}   s.view            the tab key
 * @param {string}   s.chartMode
 * @param {object}   s.chartConfig
 * @param {Array}    s.selectedVehicles  vehicle ids
 * @param {Array}    s.vehicles          vehicle records, to say which hold a plotted test
 * @param {object}   s.compareConfig
 * @param {object}   s.roadTripConfig
 * @param {object}   s.epaConfig
 * @param {object}   s.pairings
 * @param {object}   [s.vehicleFilters]  the Vehicles & Specs filters (specstable only)
 * @param {string}   [s.currentSearch]   the address now, for the table's own `vt_*`
 * @returns {URLSearchParams}
 */
export function buildChartParams({
    view, chartMode, chartConfig, selectedVehicles, vehicles,
    compareConfig, roadTripConfig, epaConfig, pairings,
    vehicleFilters, currentSearch = '',
}) {
    const p = new URLSearchParams();
    p.set('tab', view);

    // The plotted tests are written for the two charts that plot tests one at a
    // time. A featured comparison needs them fixed in the link: left to
    // bootstrap, the chart would follow whichever test is the vehicle's default
    // today, and the comparison would change under the curator who made it.
    const writesRuns = chartMode === 'charging' || chartMode === 'range';
    if (writesRuns && chartConfig.selectedRuns.length > 0) p.set('r', chartConfig.selectedRuns.join(','));

    // v= carries the vehicles r= does not cover. In every other mode r= is not
    // written, so v= must carry the whole selection — the run selection lingers
    // in chartConfig and would otherwise drop those vehicles from the link.
    const runVehicleIds = writesRuns
        ? new Set(
            vehicles
                .filter(v => (v.runs || []).some(r => chartConfig.selectedRuns.includes(r.id)))
                .map(v => String(v.id))
        )
        : new Set();
    const runlessVehicles = selectedVehicles.filter(id => !runVehicleIds.has(String(id)));
    if (runlessVehicles.length > 0)           p.set('v', runlessVehicles.join(','));
    // x / y / y2 are the Charging Curves axes; no other chart reads them.
    if (chartMode === 'charging') {
        p.set('x', chartConfig.xAxis);
        p.set('y', chartConfig.yAxis);
        if (chartConfig.y2Axis)               p.set('y2',   chartConfig.y2Axis);
    }
    if (chartConfig.alignRaw)                 p.set('raw', '1');
    if (chartConfig.raceThreshold != null)    p.set('rt',   String(chartConfig.raceThreshold));
    // The opened chart's axis limits, only those off its defaults. Written for
    // every mode that has them, so a chart added to AXIS_LIMIT_CHARTS is in the
    // link without anyone remembering to write it here.
    if (hasAxisLimits(chartMode)) {
        const packed = encodeAxisLimits(axisLimitsOf(chartConfig.axisLimits, chartMode), chartMode);
        if (packed) p.set(AXIS_LIMITS_PARAM, packed);
    }
    if (chartConfig.showLine === false)       p.set('line',   '0');
    if (chartConfig.showPoints)               p.set('pts',    '1');
    if (chartConfig.compositeSpread === false) p.set('cspread', '0');
    if (chartConfig.addedSpread)              p.set('aspread', '1');
    if (chartMode !== DEFAULT_CHART_MODE)     p.set('m', chartMode);
    // One correction for every chart and the table, so written for every mode.
    for (const [key, value] of encodeCorrection({ mode: chartConfig.correctionMode, target: chartConfig.correctionTarget })) p.set(key, value);

    // Range & Efficiency
    if (chartMode === 'range') {
        if (chartConfig.rangeChartType && chartConfig.rangeChartType !== DEFAULT_RANGE_CHART_TYPE) p.set('rc', chartConfig.rangeChartType);
        if (chartConfig.effUnit && chartConfig.effUnit !== DEFAULT_EFFICIENCY_UNIT) p.set('eff', chartConfig.effUnit);
    }

    // Charge Stop
    if (chartMode === 'compare') {
        writeParams(p, COMPARE_PARAMS, compareConfig, defaultCompareConfig());
        if (compareConfig.orientation && compareConfig.orientation !== DEFAULT_COMPARE_ORIENTATION) p.set('cmp_o', compareConfig.orientation);
        if (compareConfig.selected?.length) p.set('cmp_sel', compareConfig.selected.join(','));
    }

    // Pairings apply to every chart mode, so they are written whenever any
    // exist rather than being scoped to one tab. Omitted when empty so an
    // untouched chart keeps a clean URL.
    const pairsEncoded = encodePairings(pairings);
    if (pairsEncoded) p.set('pairs', pairsEncoded);

    // Road Trip
    if (chartMode === 'roadtrip' || chartMode === 'optimizer') {
        const defaults = defaultRoadTripConfig();
        writeParams(p, ROAD_TRIP_PARAMS, roadTripConfig, defaults);
        if (chartMode === 'optimizer') {
            writeParams(p, OPTIMIZER_PARAMS, roadTripConfig, defaults);
            writeParams(p, OPTIMIZER_CHART_PARAM, roadTripConfig, defaults);
            if (roadTripConfig.bestPlan === false) p.set('rt_bp', '0');
        }
        if (roadTripConfig.towingMode) {
            p.set('rt_tw', '1');
            writeParams(p, TOWING_PARAMS, roadTripConfig, defaults);
        }
    }

    // The spec chart's column, and the scatter's two (table column keys)
    if (chartMode === 'specs' && chartConfig.specsField) p.set('sf', chartConfig.specsField);
    if (chartMode === 'specscatter') {
        if (chartConfig.scatterXField) p.set('scx', chartConfig.scatterXField);
        if (chartConfig.scatterYField) p.set('scy', chartConfig.scatterYField);
    }

    // Modeled Efficiency · selected vehicles
    if (chartMode === 'epacurves') {
        if (epaConfig.yAxis && epaConfig.yAxis !== 'kwh100mi') p.set('epa_ya', epaConfig.yAxis);
        // Written whenever anything is selected. Without it the curves a
        // link was sent to show are whatever BOOTSTRAP happens to pick on
        // the recipient's machine.
        if (epaConfig.selectedMappings?.length) p.set('epa_m', epaConfig.selectedMappings.join(','));
        if (epaConfig.overlay) p.set('epa_ov', epaConfig.overlay);
    }

    // The spec chart plots the table's calculated columns, so a link to it
    // carries the assumptions behind them (the table's own `vt_` ones, #450).
    if (chartMode === 'specs' || chartMode === 'specscatter') {
        for (const [key, value] of encodeAssumptionParams(chartConfig.assumptions)) p.set(key, value);
        // Plotting every vehicle the filters leave, rather than the selection:
        // the link carries the filters that decide which (#450).
        if (chartConfig.specScope === 'all') {
            p.set('ss', 'all');
            for (const [key, value] of encodeVehicleFilters(vehicleFilters)) p.set(key, value);
        }
    }

    // The vehicle table writes its own columns, sort and filters (vt_*);
    // carry them over rather than wiping them on every selection change.
    if (chartMode === 'specstable') {
        for (const [key, value] of new URLSearchParams(currentSearch)) {
            if (key.startsWith(VEHICLE_TABLE_PARAM_PREFIX)) p.append(key, value);
        }
        // Vehicles & Specs' filters, the same parameters Cards and List write (#338).
        for (const [key, value] of encodeVehicleFilters(vehicleFilters)) p.set(key, value);
    }

    return p;
}

/**
 * A chart link's query with the defaults this module leaves out put back, for
 * a link that has to mean the same thing after a default changes. The address
 * bar leaves out the Charge Stop and Road Trip settings a fresh page would
 * have; a saved chart that did so would follow the default rather than the
 * curator. The others it leaves out (the correction, the display toggles,
 * axis limits) already read absent as one fixed value.
 *
 * @param {string} search  a query string, with or without the leading `?`
 * @returns {string}
 */
export function withDefaultsWrittenOut(search) {
    const p = new URLSearchParams(search ?? '');
    const fill = (table, defaults) => {
        for (const [param, key] of table) if (!p.has(param)) p.set(param, String(defaults[key]));
    };
    const mode = p.get('m');
    if (mode === 'compare') fill(COMPARE_PARAMS, defaultCompareConfig());
    if (mode === 'roadtrip' || mode === 'optimizer') {
        const defaults = defaultRoadTripConfig();
        // An old Road Trip link on a sweep axis opens the optimizer; writing
        // the timeline's default X axis into it would make it a Road Trip.
        fill(ROAD_TRIP_SWEEPS.includes(p.get('rt_xa')) ? ROAD_TRIP_PARAMS.filter(([k]) => k !== 'rt_xa') : ROAD_TRIP_PARAMS, defaults);
        if (mode === 'optimizer') {
            fill(OPTIMIZER_PARAMS, defaults);
            fill(OPTIMIZER_CHART_PARAM, defaults);
            if (!p.has('rt_bp')) p.set('rt_bp', defaults.bestPlan ? '1' : '0');
        }
        if (p.get('rt_tw') === '1') fill(TOWING_PARAMS, defaults);
    }
    return p.toString();
}

/**
 * The query as the address bar shows it. URLSearchParams escapes `,` and `:`,
 * three characters each, and a list of tests is mostly commas; both are legal
 * in a query and read back the same, so they are written plain.
 */
export const chartQueryString = (p) => p.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':');

/**
 * The short link for a chart's query: its defaults written out, then packed
 * (utils/shortLink.js). What the toolbar's URL button copies.
 *
 * @param {string} search  a query string, with or without the leading `?`
 * @returns {string} the key, `1.…`
 */
export const chartShortLink = (search) => encodeShortLink(withDefaultsWrittenOut(search));
