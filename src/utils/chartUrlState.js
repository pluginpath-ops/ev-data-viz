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
 *   every chart   tab m v  x y y2 raw rt xn xx yn yx y2n y2x  line pts cspread
 *                 aspread  corr c_spd c_tmp c_alt  pairs
 *   charging      r (the plotted tests)
 *   range         r (the plotted tests), rc (chart type), eff (efficiency unit)
 *   compare       cmp_soc cmp_mins cmp_mi  cmp_o (orientation)  cmp_sel (the
 *                 plotted pairs)
 *   roadtrip      rt_*
 *   specs         sf (the field charted)
 *   specscatter   scx scy
 *   epacurves     epa_ya epa_m epa_ov
 *   specstable    vt_* (carried over, written by the table itself) and filters
 */
import { ALL_CHART_MODES, DEFAULT_CHART_MODE } from '../constants/chartNav';
import { decodeCorrection, encodeCorrection } from './correctionSettings';
import { encodePairings, decodePairings } from './pairings';
import { encodeVehicleFilters } from './vehicleFilters';
import { VEHICLE_TABLE_PARAM_PREFIX } from './vehicleTable';

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
const numOrNull = raw => (raw !== null && raw !== '' ? Number(raw) : null);

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

    const chart = {
        vehicleIds:    idList(p.get('v')),
        runIds:        idList(p.get('r')),
        xAxis:         p.get('x')  || null,
        yAxis:         p.get('y')  || null,
        y2Axis:        p.get('y2') || null,
        alignRaw:      p.get('raw') === '1',
        raceThreshold: p.get('rt')  ? Number(p.get('rt'))  : null,
        xMin:  numOrNull(p.get('xn')),
        xMax:  numOrNull(p.get('xx')),
        // A missing yn is zero, not "auto": every chart's y axis starts at zero.
        yMin:  p.get('yn') !== null && p.get('yn') !== '' ? Number(p.get('yn')) : 0,
        yMax:  numOrNull(p.get('yx')),
        y2Min: numOrNull(p.get('y2n')),
        y2Max: numOrNull(p.get('y2x')),
        showLine:   p.get('line') !== '0', // on unless the link says 0
        showPoints: p.get('pts') === '1',  // off unless the link says 1
        compositeSpread: p.get('cspread') !== '0',
        addedSpread:     p.get('aspread') === '1',
        // A stale or hand-edited ?m= would otherwise fall through to the
        // charging chart with no indication why.
        chartMode:     ALL_CHART_MODES.includes(p.get('m')) ? p.get('m') : DEFAULT_CHART_MODE,
        scatterXField: p.get('scx') || null,
        scatterYField: p.get('scy') || null,
        specsField:    p.get('sf')  || null,
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
        ...(p.get('rt_xa') && { xAxis:              p.get('rt_xa')          }),
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
    p.set('x', chartConfig.xAxis);
    p.set('y', chartConfig.yAxis);
    if (chartConfig.y2Axis)                   p.set('y2',   chartConfig.y2Axis);
    if (chartConfig.alignRaw)                 p.set('raw', '1');
    if (chartConfig.raceThreshold != null)    p.set('rt',   String(chartConfig.raceThreshold));
    if (chartConfig.xMin != null)             p.set('xn',   String(chartConfig.xMin));
    if (chartConfig.xMax != null)             p.set('xx',   String(chartConfig.xMax));
    if (chartConfig.yMin != null && chartConfig.yMin !== 0) p.set('yn', String(chartConfig.yMin));
    if (chartConfig.yMax != null)             p.set('yx',   String(chartConfig.yMax));
    if (chartConfig.y2Min != null)            p.set('y2n',  String(chartConfig.y2Min));
    if (chartConfig.y2Max != null)            p.set('y2x',  String(chartConfig.y2Max));
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
    if (chartMode === 'roadtrip') {
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
        if (rt.towingMode) {
            p.set('rt_te', rt.towingEfficiency);
            p.set('rt_tr', rt.towingRefSpeedMph);
        }
    }

    // The spec chart's field, and the scatter's two
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
