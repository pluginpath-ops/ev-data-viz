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
 */
import { ALL_CHART_MODES, DEFAULT_CHART_MODE } from '../constants/chartNav';
import { decodeCorrection, encodeCorrection } from './correctionSettings';
import { encodePairings, decodePairings } from './pairings';
import {
    AXIS_LIMITS_PARAM, axisLimitsOf, axisLimitsOfLink, encodeAxisLimits, hasAxisLimits, withAxisLimits,
} from './axisLimits';
import { encodeVehicleFilters } from './vehicleFilters';
import { VEHICLE_TABLE_PARAM_PREFIX, encodeAssumptionParams } from './vehicleTable';

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
export const DEFAULT_RANGE_CHART_TYPE = 'range-vehicle-bar';

/** Efficiency as mi/kWh or Wh/mi. */
export const EFFICIENCY_UNITS = ['mi_kwh', 'wh_mi'];
export const DEFAULT_EFFICIENCY_UNIT = 'mi_kwh';

/** Charge Stop's bars lie down by default. */
export const COMPARE_ORIENTATIONS = ['horizontal', 'vertical'];
export const DEFAULT_COMPARE_ORIENTATION = 'horizontal';

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
    const cmpSoc  = p.get('cmp_soc');
    const cmpMins = p.get('cmp_mins');
    const cmpMi   = p.get('cmp_mi');
    const cmpO    = p.get('cmp_o');
    const cmpSel  = p.get('cmp_sel');
    const compare = {
        ...(cmpSoc  != null && { startSoc: Number(cmpSoc)  }),
        ...(cmpMins != null && { xMinutes: Number(cmpMins) }),
        ...(cmpMi   != null && { mMiles:   Number(cmpMi)   }),
        ...(COMPARE_ORIENTATIONS.includes(cmpO) && { orientation: cmpO }),
        // Pair keys, not ids ('70::12'), so they stay strings.
        ...(cmpSel  && { selected: cmpSel.split(',').filter(Boolean) }),
    };

    // Pairings — global across chart modes, so read unconditionally.
    const pairsParam = p.get('pairs');

    // Road Trip
    const n = (key) => { const v = p.get(key); return v != null ? Number(v) : null; };
    const roadTrip = {
        ...(p.get('rt_m')  && { mode:             p.get('rt_m')           }),
        ...(n('rt_ss') != null && { startSoc:     n('rt_ss')               }),
        ...(n('rt_ms') != null && { minSoc:        n('rt_ms')               }),
        ...(n('rt_ld') != null && { legDistance:   n('rt_ld')               }),
        ...(n('rt_ct') != null && { chargeTime:    n('rt_ct')               }),
        ...(n('rt_td') != null && { totalDistance: n('rt_td')               }),
        ...(n('rt_sp') != null && { speed:         n('rt_sp')               }),
        ...(n('rt_oh') != null && { overhead:      n('rt_oh')               }),
        ...(p.get('rt_ya') && { yAxis:              p.get('rt_ya')          }),
        ...(p.get('rt_xa') && !sweepLink && { xAxis: p.get('rt_xa')         }),
        ...(sweepLink && { optimizerChart: p.get('rt_xa'), bestPlan: false,
            ...(n('rt_td') != null && { optimizerDistance: n('rt_td') }) }),
        ...(n('rt_otd') != null && { optimizerDistance: n('rt_otd')         }),
        ...(OPTIMIZER_CHARTS.includes(p.get('rt_oc')) && { optimizerChart: p.get('rt_oc') }),
        ...(p.get('rt_bp') === '0' && { bestPlan: false                     }),
        ...(n('rt_osn') != null && { optimizerSpeedMin: n('rt_osn')         }),
        ...(n('rt_osx') != null && { optimizerSpeedMax: n('rt_osx')         }),
        ...(p.get('rt_sya') && { sweepYAxis:         p.get('rt_sya')         }),
        ...(p.get('rt_tw') === '1' && { towingMode: true                    }),
        ...(n('rt_te') != null && { towingEfficiency:   n('rt_te')          }),
        ...(n('rt_tr') != null && { towingRefSpeedMph:  n('rt_tr')          }),
    };

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
        ...(s.xAxis         && { xAxis: s.xAxis }),
        ...(s.yAxis         && { yAxis: s.yAxis }),
        ...(s.y2Axis        && { y2Axis: s.y2Axis }),
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
        p.set('cmp_soc',  compareConfig.startSoc);
        p.set('cmp_mins', compareConfig.xMinutes);
        p.set('cmp_mi',   compareConfig.mMiles);
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
        const rt = roadTripConfig;
        p.set('rt_m',  rt.mode);
        p.set('rt_ss', rt.startSoc);
        p.set('rt_ms', rt.minSoc);
        p.set('rt_ld', rt.legDistance);
        p.set('rt_ct', rt.chargeTime);
        p.set('rt_td', rt.totalDistance);
        p.set('rt_sp', rt.speed);
        p.set('rt_oh', rt.overhead);
        p.set('rt_ya',  rt.yAxis);
        p.set('rt_xa',  rt.xAxis);
        if (rt.sweepYAxis !== 'totalTime')     p.set('rt_sya', rt.sweepYAxis);
        if (rt.towingMode)                    p.set('rt_tw', '1');
        if (chartMode === 'optimizer') {
            p.set('rt_otd', rt.optimizerDistance);
            p.set('rt_oc',  rt.optimizerChart);
            if (rt.bestPlan === false)        p.set('rt_bp', '0');
            if (rt.optimizerSpeedMin != null) p.set('rt_osn', rt.optimizerSpeedMin);
            if (rt.optimizerSpeedMax != null) p.set('rt_osx', rt.optimizerSpeedMax);
        }
        if (rt.towingMode) {
            p.set('rt_te', rt.towingEfficiency);
            p.set('rt_tr', rt.towingRefSpeedMph);
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
