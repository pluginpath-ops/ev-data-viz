/**
 * The vehicle table (#315): every vehicle a row, anything worth comparing a
 * column, over the whole fleet.
 *
 * It replaces Compare Specs, which put vehicles across and fields down and only
 * showed what was already selected. Browsing is what the FE Guide table proved
 * people do, and that wants the guide's shape: rows you can sort and filter,
 * columns you choose and order, magnitudes drawn behind the figures.
 *
 * ── Columns ─────────────────────────────────────────────────────────────────
 *
 *   Vehicle              name (fixed), make, model, trim, year, tags
 *   Battery & range      the resolved capacity and EPA range, with their basis
 *                        (vehicleFigures.js), and EPA city and highway range
 *   Tested performance   the best published or EVBench result per metric,
 *                        with the source that set it (performanceDerivations)
 *   every spec field     through inheritance, in schema order
 *
 * Tested range and charging data are deliberately not here yet.
 *
 * ── Bars ────────────────────────────────────────────────────────────────────
 *
 * Only on columns whose better direction is a fact — the schema's `better`
 * annotation, mirrored on the tested and EPA range columns. A bar on a field
 * with no direction (more motors, more speakers) would assert an editorial
 * position; see the note on SPEC_CATEGORIES.
 *
 * Pure module: no data access, no React.
 */

import { SPEC_CATEGORIES } from './vehicleSpecSchema';
import { resolveEffectiveSpecs, vehicleLabel } from './specHelpers';
import { convValue } from './unitConversions';
import { deriveTested } from './performanceDerivations';
import { SOC_WINDOW_BASIS, EPA_RANGE_BASIS } from './vehicleFigures';

// ── Units ───────────────────────────────────────────────────────────────────

/** How each unit group reads, imperial then metric — the units convValue converts to. */
const UNIT_LABELS = {
    distance:  ['mi', 'km'],
    speed:     ['mph', 'km/h'],
    weight:    ['lb', 'kg'],
    volume:    ['cu ft', 'L'],
    dimension: ['in', 'mm'],
    torque:    ['lb-ft', 'Nm'],
    power:     ['hp', 'kW'],
    feet:      ['ft', 'm'],
};

/** The unit a column's figures are shown in, for the header's unit line. */
export function unitFor(col, units = 'imperial') {
    if (col?.unitGroup) return UNIT_LABELS[col.unitGroup]?.[units === 'metric' ? 1 : 0] ?? null;
    return col?.unit ?? null;
}

// A parenthetical is taken as a unit only when it is one — "Elk Test Speed
// (Moose Test)" keeps its parenthesis.
const UNIT_WORD = /^(kWh|kW|V|in|sec|s|min|lb-ft|lbs?|hp|cu ft|g|USD|ft|mph)$/i;

/** "Battery Usable (kWh)" → label "Battery Usable", unit "kWh". */
function splitUnit(label) {
    const m = /^(.*?)\s*\(([^)]*)\)(.*)$/.exec(label);
    if (!m || !UNIT_WORD.test(m[2].trim())) return { label, unit: null };
    return { label: `${m[1]}${m[3]}`.trim(), unit: m[2].trim() };
}

// ── Columns ─────────────────────────────────────────────────────────────────

const IDENTITY_COLUMNS = [
    { key: 'name',  label: 'Vehicle', group: 'Vehicle', sticky: true },
    { key: 'make',  label: 'Make',    group: 'Vehicle' },
    { key: 'model', label: 'Model',   group: 'Vehicle' },
    { key: 'trim',  label: 'Trim',    group: 'Vehicle' },
    { key: 'year',  label: 'Year',    group: 'Vehicle' },
    { key: 'tags',  label: 'Tags',    group: 'Vehicle' },
];

const FIGURE_COLUMNS = [
    { key: 'figures.socWindowKwh', label: 'Battery', unit: 'kWh', group: 'Battery & range', numeric: true,
      hint: 'The energy between the car’s own 0% and 100%: EPA tested when it agrees with a label, else Usable, else Gross. Its basis is shown beneath.' },
    // Range columns share one scale: they are one physical quantity, and bars
    // scaled separately would contradict the numbers printed on them.
    { key: 'figures.epaRangeMi', label: 'EPA range', unitGroup: 'distance', group: 'Battery & range', numeric: true, better: 'higher', bar: true, scale: 'range',
      hint: 'The primary EPA configuration’s label, else an Expected EPA Range, else unsorted. Its basis is shown beneath.' },
    { key: 'figures.epaCityMi', label: 'EPA city range', unitGroup: 'distance', group: 'Battery & range', numeric: true, better: 'higher', bar: true, scale: 'range' },
    { key: 'figures.epaHwyMi',  label: 'EPA hwy range',  unitGroup: 'distance', group: 'Battery & range', numeric: true, better: 'higher', bar: true, scale: 'range' },
];

const TESTED_COLUMNS = [
    { key: 'tested.zero_to_60_rollout_sec', label: '0–60 (1ft)', unit: 's', better: 'lower',
      hint: 'The quickest published or EVBench result with the 1-ft rollout omitted — the drag-strip convention. The source that set it is shown beneath.' },
    { key: 'tested.zero_to_60_sec',  label: '0–60 standing', unit: 's', better: 'lower',
      hint: 'The quickest result timed from a standing start, clock from 0 mph — about 0.3 s slower than the rollout figure.' },
    { key: 'tested.quarter_mile_sec',      label: '¼ mile',      unit: 's', better: 'lower' },
    { key: 'tested.quarter_mile_trap_mph', label: '¼ mile trap', unitGroup: 'speed', better: 'higher' },
    { key: 'tested.zero_to_100_sec',       label: '0–100 mph',   unit: 's', better: 'lower' },
    { key: 'tested.top_speed_mph',         label: 'Top speed (tested)', unitGroup: 'speed', better: 'higher' },
    { key: 'tested.skidpad_g',             label: 'Skidpad',     unit: 'g', better: 'higher' },
].map(c => ({ ...c, group: 'Tested performance', numeric: true, bar: true }));

const SPEC_COLUMNS = SPEC_CATEGORIES.flatMap(cat => cat.fields.map(f => {
    const { label, unit } = splitUnit(f.label);
    return {
        key: `${cat.key}.${f.key}`,
        label,
        unit: f.unitGroup ? null : unit,
        unitGroup: f.unitGroup ?? null,
        group: cat.label,
        type: f.type,
        numeric: f.type === 'number' || f.type === 'integer',
        better: f.better ?? null,
        bar: !!f.better,
        spec: [cat.key, f.key],
    };
}));

/** Every column the table can show, in picker order. */
export const VEHICLE_COLUMNS = [...IDENTITY_COLUMNS, ...FIGURE_COLUMNS, ...TESTED_COLUMNS, ...SPEC_COLUMNS];

const BY_KEY = new Map(VEHICLE_COLUMNS.map(c => [c.key, c]));
export const vehicleColumnByKey = (key) => BY_KEY.get(key) ?? null;

/** What the table opens with. */
export const DEFAULT_VEHICLE_COLUMNS = [
    'name', 'figures.socWindowKwh', 'figures.epaRangeMi',
    'tested.zero_to_60_rollout_sec', 'tested.quarter_mile_sec',
    'powertrain.horsepower_hp', 'powertrain.drive_type', 'performance.weight_lbs',
    'dimensions.length_in', 'dimensions.width_in', 'dimensions.height_in', 'dimensions.wheelbase_in',
    'interior.seating', 'interior.cargo_cuft', 'interior.frunk_cuft',
    'charging.battery_nominal_voltage_v', 'charging.max_ac_kw',
];

/** Whether any of these column keys needs performance results fetched. */
export const needsPerformance = (keys = []) => keys.some(k => String(k).startsWith('tested.'));

// ── Rows ────────────────────────────────────────────────────────────────────

const present = (v) => (v === '' || v === undefined ? null : v);

/**
 * One row per vehicle, each value resolved once.
 *
 * @param {Array} vehicles  as AppContext provides them (resolved figures attached)
 * @param {Object} [opts.performance]  groupPerformanceByVehicle output, or null
 *        while it loads — tested columns are then empty, not zero
 * @returns {Array<{ id, index, vehicle, values: Object, notes: Object }>}
 *          `notes` holds the basis or source shown beneath a figure
 */
export function buildVehicleRows(vehicles = [], { performance = null } = {}) {
    return vehicles.map((vehicle, index) => {
        const specs = resolveEffectiveSpecs(vehicle, vehicles);
        const values = {
            name:  vehicleLabel(vehicle),
            make:  present(vehicle.make) ?? vehicle.manufacturer?.name ?? null,
            model: present(vehicle.model),
            trim:  present(vehicle.trim),
            year:  present(vehicle.year),
            tags:  (vehicle.tags ?? []).map(t => t.name).filter(Boolean).join(', ') || null,
        };
        const notes = {};

        for (const col of SPEC_COLUMNS) {
            const [category, field] = col.spec;
            values[col.key] = present(specs?.[category]?.[field]) ?? null;
        }

        values['figures.socWindowKwh'] = vehicle.socWindowKwh ?? null;
        notes['figures.socWindowKwh'] = SOC_WINDOW_BASIS[vehicle.socWindowBasis]?.label ?? null;
        values['figures.epaRangeMi'] = vehicle.epaRangeMi ?? null;
        const expectedSource = vehicle.epaRange?.expectedSource;
        notes['figures.epaRangeMi'] = vehicle.epaRangeBasis
            ? `${EPA_RANGE_BASIS[vehicle.epaRangeBasis]?.label}${expectedSource ? ` (${expectedSource})` : ''}`
            : null;
        values['figures.epaCityMi'] = vehicle.epaRange?.cityMi ?? null;
        values['figures.epaHwyMi'] = vehicle.epaRange?.hwyMi ?? null;

        if (performance) {
            const perf = performance[vehicle.id] ?? { sessions: [], summaries: [] };
            for (const col of TESTED_COLUMNS) {
                const result = deriveTested(perf.sessions, perf.summaries, col.key.slice('tested.'.length));
                values[col.key] = result.value ?? null;
                notes[col.key] = result.value != null ? (result.basis?.sourceName ?? null) : null;
            }
        } else {
            for (const col of TESTED_COLUMNS) values[col.key] = null;
        }

        return { id: vehicle.id, index, vehicle, values, notes };
    });
}

/** One cell's text. Absent is an em dash — a fact, not a zero. */
export function formatVehicleCell(row, col, units = 'imperial') {
    const raw = row?.values?.[col.key];
    if (raw == null || raw === '') return '—';
    if (col.type === 'boolean') return raw ? 'Yes' : 'No';
    if (col.numeric) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return String(raw);
        const shown = col.unitGroup ? convValue(n, col.unitGroup, units) : n;
        return shown.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return String(raw);
}

// ── Filtering and sorting ───────────────────────────────────────────────────

/** The empty filter state, and the shape the URL round-trips. */
export const EMPTY_VEHICLE_FILTERS = { search: '', makes: [], years: [], drives: [], tags: [] };

/** The values a row carries for one facet — several for tags. */
export function facetValues(row, key) {
    switch (key) {
        case 'makes':  return row.values.make != null ? [row.values.make] : [];
        case 'years':  return row.values.year != null ? [String(row.values.year)] : [];
        case 'drives': return row.values['powertrain.drive_type'] != null ? [row.values['powertrain.drive_type']] : [];
        case 'tags':   return (row.vehicle?.tags ?? []).map(t => t.name).filter(Boolean);
        default:       return [];
    }
}

/** Distinct values per facet. */
export function vehicleFacets(rows = []) {
    const out = {};
    for (const key of ['makes', 'years', 'drives', 'tags']) {
        const set = new Set(rows.flatMap(r => facetValues(r, key)));
        out[key] = [...set].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    }
    return out;
}

export function filterVehicleRows(rows = [], filters = EMPTY_VEHICLE_FILTERS) {
    const f = { ...EMPTY_VEHICLE_FILTERS, ...filters };
    const needle = f.search.trim().toLowerCase();
    return rows.filter(row => {
        for (const key of ['makes', 'years', 'drives', 'tags']) {
            if (f[key].length && !facetValues(row, key).some(v => f[key].includes(v))) return false;
        }
        if (needle) {
            const hay = [row.values.name, row.values.make, row.values.model, row.values.trim, row.values.tags]
                .filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    });
}

/**
 * Sort by one column. Nulls last in both directions: they are absences, and
 * floating them to the top would bury the answer under rows that have none.
 */
export function sortVehicleRows(rows = [], key = 'name', dir = 'asc') {
    const col = vehicleColumnByKey(key);
    if (!col) return rows;
    const sign = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
        const av = a.values[key];
        const bv = b.values[key];
        const aNull = av == null || av === '';
        const bNull = bv == null || bv === '';
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        if (col.numeric) return sign * (Number(av) - Number(bv));
        return sign * String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
}

/** Which way a column sorts on its first click: best first where there is a best. */
export const firstSortDir = (col) => (col?.better === 'higher' ? 'desc' : 'asc');

// ── Bars ────────────────────────────────────────────────────────────────────

/**
 * The largest value behind each bar, over the filtered rows — so filtering to
 * pickups scales against the longest-range pickup, as the guide table does.
 * Columns share a scale only when they declare one.
 */
export function vehicleBarMaxima(rows = [], columns = VEHICLE_COLUMNS) {
    const maxima = {};
    for (const col of columns) {
        if (!col?.bar) continue;
        const scale = col.scale ?? col.key;
        let max = maxima[scale] ?? 0;
        for (const row of rows) {
            const n = Number(row.values[col.key]);
            if (row.values[col.key] != null && Number.isFinite(n) && n > max) max = n;
        }
        maxima[scale] = max;
    }
    return maxima;
}

const BAR_MIN_PCT = 2;

/** A bar's fill, or null for no bar — an absent value draws nothing, not an empty bar. */
export function vehicleBarPercent(row, col, maxima) {
    if (!col?.bar) return null;
    const raw = row?.values?.[col.key];
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    const max = maxima?.[col.scale ?? col.key];
    if (!Number.isFinite(n) || !(max > 0)) return null;
    return Math.max(BAR_MIN_PCT, Math.min(100, (n / max) * 100));
}

// ── URL ─────────────────────────────────────────────────────────────────────

/** Every vehicle-table parameter carries this prefix, so the chart URL writer can keep them. */
export const VEHICLE_TABLE_PARAM_PREFIX = 'vt_';

const LIST_PARAMS = { makes: 'vt_mk', years: 'vt_y', drives: 'vt_dr', tags: 'vt_tg' };

/** Columns, sort and filters as query parameters — only what differs from the defaults. */
export function encodeVehicleTableParams({ columns, sortKey, sortDir, filters }) {
    const p = new URLSearchParams();
    const sameColumns = columns?.length === DEFAULT_VEHICLE_COLUMNS.length
        && columns.every((k, i) => k === DEFAULT_VEHICLE_COLUMNS[i]);
    if (columns?.length && !sameColumns) p.set('vt_cols', columns.join(','));
    if (sortKey && sortKey !== 'name') p.set('vt_sort', sortKey);
    if (sortDir === 'desc') p.set('vt_dir', 'desc');
    if (filters?.search?.trim()) p.set('vt_q', filters.search.trim());
    for (const [key, param] of Object.entries(LIST_PARAMS)) {
        for (const v of filters?.[key] ?? []) p.append(param, v);
    }
    return p;
}

/**
 * The reverse. Total: an unknown column or sort key falls back rather than
 * throwing or rendering a header that sorts by nothing, because this reads
 * whatever a URL happens to contain.
 */
export function decodeVehicleTableParams(search) {
    const p = new URLSearchParams(search ?? '');
    const cols = (p.get('vt_cols') ?? '').split(',').filter(k => BY_KEY.has(k));
    // The vehicle name is the row's label; a table without it is numbers
    // belonging to nothing.
    const columns = cols.length ? (cols.includes('name') ? cols : ['name', ...cols]) : DEFAULT_VEHICLE_COLUMNS;
    const filters = { ...EMPTY_VEHICLE_FILTERS, search: p.get('vt_q') ?? '' };
    for (const [key, param] of Object.entries(LIST_PARAMS)) filters[key] = p.getAll(param);
    return {
        columns,
        sortKey: BY_KEY.has(p.get('vt_sort')) ? p.get('vt_sort') : 'name',
        sortDir: p.get('vt_dir') === 'desc' ? 'desc' : 'asc',
        filters,
    };
}
