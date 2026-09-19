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
 *   Calculated           ratios of the above, worked out per row (#335)
 *
 * Tested range and charging data are deliberately not here yet. The plan for
 * choosing which tested figure a row shows is on #335: best result for what a
 * car is capable of, the vehicle's default test WITH its conditions for what
 * depends on conditions.
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
import { convValue, MI_TO_KM, LBS_TO_KG, HP_TO_KW } from './unitConversions';
import { deriveTested } from './performanceDerivations';
import { SOC_WINDOW_BASIS, EPA_RANGE_BASIS } from './vehicleFigures';
import { sortByColumn, barMaximaOf, barPercentOf } from './tableColumns';
import { VEHICLE_TABLE_PRESETS } from './vehicleTablePresets';

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
    if (col?.metric && units === 'metric') return col.metric[0];
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
    { key: 'year',  label: 'Year',    group: 'Vehicle', holds: 'short-values' },
    { key: 'tags',  label: 'Tags',    group: 'Vehicle', holds: 'long-text' },
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

/**
 * Calculated columns (#335): ratios of figures the table already holds.
 *
 * Most of what a shopper compares is a ratio (miles per kWh, dollars per mile,
 * miles added per minute plugged in) and no spec sheet prints one. Each is
 * worked out per row from the row's own values, never stored, so it follows
 * every edit to its inputs and a retired input simply blanks it.
 *
 * `inputs` are other columns' keys; a calculation returns null the moment any
 * of them is absent or unusable, because a ratio over a missing figure is a
 * guess. Battery is the resolved capacity (`figures.socWindowKwh`) — the one
 * figure the calculations use (#323) — rather than a raw spec field.
 *
 * When tested figures arrive they become INPUTS here, with their basis shown
 * beneath the result, not a second set of ratios.
 *
 * Units: a calculated column states its imperial unit and, where the metric
 * one differs, `metric: [unit, factor]` — a rate converts by one factor, which
 * the per-quantity unit groups cannot express.
 */
/**
 * Assumptions: inputs the READER sets for calculated columns (#335), such as
 * how far a charging stop should take them. They live in the URL (`vt_add`)
 * beside the columns, so a shared link computes the same numbers.
 *
 * A distance is in the reader's own units: "add 250" means km to a metric
 * reader, and the label says which.
 */
export const DEFAULT_ASSUMPTIONS = { addDistance: 150 };
export const ADD_DISTANCE_RANGE = { min: 50, max: 300, step: 25 };

const clampAddDistance = (n) => {
    const { min, max, step } = ADD_DISTANCE_RANGE;
    if (!Number.isFinite(n)) return DEFAULT_ASSUMPTIONS.addDistance;
    return Math.min(max, Math.max(min, Math.round(n / step) * step));
};

/** What a calculation sees: the assumptions, plus the distance in miles. */
function assumptionContext(assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial') {
    const addDistance = clampAddDistance(Number(assumptions?.addDistance ?? DEFAULT_ASSUMPTIONS.addDistance));
    return { addDistance, units, addMi: units === 'metric' ? addDistance / MI_TO_KM : addDistance };
}

/**
 * A column as a header shows it: a calculated column whose name carries an
 * assumption ("Time to add 150 mi") is named from it.
 */
export function labelledColumn(col, assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial') {
    if (!col?.labelFor) return col;
    return { ...col, label: col.labelFor(assumptionContext(assumptions, units)) };
}

/** Whether any of these column keys is worked out from an assumption. */
export const needsAssumptions = (keys = []) => keys.some(k => BY_KEY.get(k)?.assumption);

/** 10→80% is 70% of the pack — a definition, not a tunable. */
const WINDOW_10_80 = 0.7;

const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
/** a ÷ b, or null when either is absent or b is not a positive number. */
const ratio = (a, b) => (a != null && b != null && b > 0 ? a / b : null);

const CALCULATED_COLUMNS = [
    { key: 'calc.efficiency', label: 'Efficiency', unit: 'mi/kWh', metric: ['km/kWh', MI_TO_KM],
      better: 'higher', digits: 2,
      inputs: ['figures.epaRangeMi', 'figures.socWindowKwh'],
      calc: ([range, kwh]) => ratio(range, kwh),
      hint: 'EPA range ÷ battery. An estimate from the label range and the resolved battery capacity, not a measured figure.' },
    { key: 'calc.rangePerChargeMin', label: 'Range per minute', unit: 'mi/min', metric: ['km/min', MI_TO_KM],
      better: 'higher', digits: 1,
      inputs: ['figures.epaRangeMi', 'charging.charge_time_10_to_80_pct_min'],
      calc: ([range, min]) => ratio(range == null ? null : range * WINDOW_10_80, min),
      hint: 'EPA range × 70% ÷ the 10→80% charge time: the miles a stop adds per minute plugged in. Peak kW is the number quoted; this is the one a road trip feels.' },
    { key: 'calc.timeToAdd', label: 'Time to add distance', unit: 'min',
      better: 'lower', digits: 0, assumption: 'addDistance',
      labelFor: ({ addDistance, units }) => `Time to add ${addDistance} ${units === 'metric' ? 'km' : 'mi'}`,
      inputs: ['figures.epaRangeMi', 'charging.charge_time_10_to_80_pct_min'],
      // Minutes to add the reader's distance from 10%, at the 10→80% average
      // rate. Beyond what 10→80% holds the rate is unknown (it falls off past
      // 80%), so the cell is blank and says why rather than extrapolating.
      calc: ([range, min], { addMi }) => {
          const window = range == null ? null : range * WINDOW_10_80;
          if (window == null || !(min > 0) || addMi > window) return null;
          return addMi / (window / min);
      },
      note: ([range, min], { addMi }) => (range != null && min > 0 && addMi > range * WINDOW_10_80
          ? 'more than a 10→80% stop adds' : null),
      hint: 'Minutes from 10% to add the distance set under Assumptions, at the average rate of the 10→80% charge time. Blank where a 10→80% stop adds less than that.' },
    { key: 'calc.avgKw10to80', label: 'Avg charge 10→80%', unit: 'kW',
      better: 'higher', digits: 0,
      inputs: ['figures.socWindowKwh', 'charging.charge_time_10_to_80_pct_min'],
      calc: ([kwh, min]) => ratio(kwh == null ? null : kwh * WINDOW_10_80, min == null ? null : min / 60),
      hint: 'Battery × 70% ÷ the 10→80% charge time: the average power over the session, which says more than the peak.' },
    { key: 'calc.peakCRate', label: 'Peak C-rate', unit: 'C',
      better: 'higher', digits: 2,
      inputs: ['charging.max_dc_kw', 'figures.socWindowKwh'],
      calc: ([kw, kwh]) => ratio(kw, kwh),
      hint: 'Max DC charge rate ÷ battery: how hard the pack is pushed at peak, for its size. A nerd stat — it compares packs, not how quickly a stop ends.' },
    { key: 'calc.pricePerMile', label: 'Price ÷ range', unit: '$/mi', metric: ['$/km', 1 / MI_TO_KM],
      better: 'lower', digits: 0,
      inputs: ['pricing.base_price_usd', 'figures.epaRangeMi'],
      calc: ([price, range]) => ratio(price, range),
      hint: 'Advertised base price ÷ EPA range.' },
    { key: 'calc.pricePerKwh', label: 'Price per kWh', unit: '$/kWh',
      better: 'lower', digits: 0,
      inputs: ['pricing.base_price_usd', 'figures.socWindowKwh'],
      calc: ([price, kwh]) => ratio(price, kwh),
      hint: 'Advertised base price ÷ battery.' },
    { key: 'calc.weightPerHp', label: 'Weight per horsepower', unit: 'lb/hp', metric: ['kg/kW', LBS_TO_KG / HP_TO_KW],
      better: 'lower', digits: 1,
      inputs: ['performance.weight_lbs', 'powertrain.horsepower_hp'],
      calc: ([lb, hp]) => ratio(lb, hp),
      hint: 'Curb weight ÷ horsepower. Lower is quicker, all else equal.' },
    { key: 'calc.totalCargo', label: 'Total cargo', unitGroup: 'volume', digits: 1,
      inputs: ['interior.cargo_cuft', 'interior.frunk_cuft'],
      // A missing frunk figure is not a missing frunk, so it does not blank
      // the total — the note beneath says the frunk is not counted.
      calc: ([cargo, frunk]) => (cargo == null ? null : cargo + (frunk ?? 0)),
      note: ([cargo, frunk]) => (cargo != null && frunk == null ? 'no frunk figure' : null),
      hint: 'Cargo volume + frunk, seats up.' },
    { key: 'calc.batteryBuffer', label: 'Battery buffer', unit: '%', digits: 1,
      inputs: ['charging.battery_usable_kwh', 'powertrain.battery_gross_kwh'],
      calc: ([usable, gross]) => (usable != null && gross > 0 && usable <= gross ? (1 - usable / gross) * 100 : null),
      hint: 'The share of the gross pack held back from use: (gross − usable) ÷ gross. No better direction — a bigger buffer costs range and protects the cells.' },
    { key: 'calc.is800v', label: '800-volt', type: 'boolean', holds: 'short-values',
      inputs: ['charging.battery_nominal_voltage_v'],
      calc: ([v]) => (v == null ? null : v > 600),
      hint: 'Nominal pack voltage above 600 V. Charges at full power on 800-volt chargers without a converter.' },
].map(c => ({ ...c, group: 'Calculated', numeric: c.type !== 'boolean', bar: !!c.better }));

/**
 * What a column's values are like, which sets its width (#315).
 *
 * One width per kind of column gave LIDAR ("No") the same room as Front
 * Suspension, which is a sentence and clipped on every row. So widths follow
 * the schema type:
 *   short-values  yes/no, and counts with no bar (cameras, seats)
 *   long-text     free text, which also wraps to two lines
 * An enum is sized by its longest option, since the schema lists every value
 * it can hold: Drive Type (FWD, RWD, AWD) is short, Motor Type ("Switched
 * Reluctance") is not. Everything else keeps the default: figures their figure
 * width, identity text the text width. A bar needs the figure width to be
 * readable, so a count that has one is not narrowed.
 */
const SHORT_OPTION_CHARS = 7;

function holdsFor(field) {
    if (field.type === 'boolean') return 'short-values';
    if (field.type === 'integer' && !field.better) return 'short-values';
    if (field.type === 'enum' && field.options?.length
        && Math.max(...field.options.map(o => String(o).length)) <= SHORT_OPTION_CHARS) return 'short-values';
    if (field.type === 'text') return 'long-text';
    return null;
}

const SPEC_COLUMNS = SPEC_CATEGORIES.flatMap(cat => cat.fields.map(f => {
    const { label, unit } = splitUnit(f.label);
    return {
        key: `${cat.key}.${f.key}`,
        // A header gets ~72px a line, two lines. A field whose name cannot fit
        // carries a shorter `tableLabel` in the schema; the full name stays in
        // the header's tooltip and everywhere else specs are shown.
        label: f.tableLabel ?? label,
        fullLabel: f.tableLabel ? label : null,
        unit: f.unitGroup ? null : unit,
        unitGroup: f.unitGroup ?? null,
        group: cat.label,
        type: f.type,
        numeric: f.type === 'number' || f.type === 'integer',
        better: f.better ?? null,
        bar: !!f.better,
        holds: holdsFor(f),
        spec: [cat.key, f.key],
    };
}));

/** Every column the table can show, in picker order. */
export const VEHICLE_COLUMNS = [...IDENTITY_COLUMNS, ...FIGURE_COLUMNS, ...CALCULATED_COLUMNS, ...TESTED_COLUMNS, ...SPEC_COLUMNS];

const BY_KEY = new Map(VEHICLE_COLUMNS.map(c => [c.key, c]));
export const vehicleColumnByKey = (key) => BY_KEY.get(key) ?? null;

// A vehicle row keeps its figures under `values`, beside the vehicle itself.
const vehicleValue = (row, col) => row?.values?.[col.key];
const vehicleScale = (col) => col.scale ?? col.key;

// ── Presets ─────────────────────────────────────────────────────────────────

/**
 * A preset's columns as the table can show them (#335): a key a later schema
 * change retired drops out quietly, as it does from an old link, rather than
 * breaking the preset. The name column always leads.
 */
function presetColumns(preset) {
    const cols = (preset?.columns ?? []).filter(k => BY_KEY.has(k));
    return cols.includes('name') ? cols : ['name', ...cols];
}

/** Every preset, with its columns checked against the columns that exist. */
export const PRESETS = VEHICLE_TABLE_PRESETS.map(p => ({ ...p, columns: presetColumns(p) }));
const PRESET_BY_KEY = new Map(PRESETS.map(p => [p.key, p]));
export const vehiclePresetByKey = (key) => PRESET_BY_KEY.get(key) ?? null;

/** What the table opens with: the Overview preset. */
export const DEFAULT_VEHICLE_COLUMNS = PRESET_BY_KEY.get('overview').columns;

const sameColumns = (a = [], b = []) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * The preset these columns exactly are, in this order, or null. Columns alone
 * decide it: re-sorting a preset is using it, not leaving it.
 */
export function presetMatching(columns = []) {
    return PRESETS.find(p => sameColumns(p.columns, columns)) ?? null;
}

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
 * @param {Object} [opts.assumptions]  the reader's inputs to calculated columns
 * @param {string} [opts.units]  the reader's unit system, which the assumptions are in
 * @returns {Array<{ id, index, vehicle, values: Object, notes: Object }>}
 *          `notes` holds the basis or source shown beneath a figure
 */
export function buildVehicleRows(vehicles = [], { performance = null, assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial' } = {}) {
    const calcContext = assumptionContext(assumptions, units);
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

        // Last, so every input — spec, figure or tested — is already in place.
        for (const col of CALCULATED_COLUMNS) {
            const inputs = col.inputs.map(k => num(values[k]));
            const value = col.calc(inputs, calcContext);
            values[col.key] = value == null || (typeof value === 'number' && !Number.isFinite(value)) ? null : value;
            // A note can explain a blank, too ("more than a 10→80% stop adds").
            notes[col.key] = col.note?.(inputs, calcContext) ?? null;
        }

        // Community flags are stored as the spec's own `category.field` key,
        // which is exactly a spec column's key, so a flag lands on its cell
        // with no mapping. Only spec columns can carry one: figures and tested
        // results are worked out, not entered, and nobody flags them.
        const flagged = new Set((vehicle.flagged_specs ?? []).filter(k => BY_KEY.get(k)?.spec));

        return { id: vehicle.id, index, vehicle, values, notes, flagged };
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
        const shown = col.metric && units === 'metric' ? n * col.metric[1]
            : col.unitGroup ? convValue(n, col.unitGroup, units) : n;
        return shown.toLocaleString('en-US', { maximumFractionDigits: col.digits ?? 2 });
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

/** Sort by one column; blanks last, as in every sortable table (tableColumns). */
export function sortVehicleRows(rows = [], key = 'name', dir = 'asc') {
    const col = vehicleColumnByKey(key);
    if (!col) return rows;
    return sortByColumn(rows, col, dir, vehicleValue);
}

/** Which way a column sorts on its first click: best first where there is a best. */
export const firstSortDir = (col) => (col?.better === 'higher' ? 'desc' : 'asc');

// ── Bars ────────────────────────────────────────────────────────────────────

/**
 * The largest value behind each bar, over the filtered rows, as the guide table
 * does. Columns share a scale only when they declare one.
 */
export function vehicleBarMaxima(rows = [], columns = VEHICLE_COLUMNS) {
    return barMaximaOf(rows, columns, vehicleValue, vehicleScale);
}

/** A bar's fill, or null for no bar — an absent value draws nothing, not an empty bar. */
export function vehicleBarPercent(row, col, maxima) {
    if (!col?.bar) return null;
    return barPercentOf(vehicleValue(row, col), maxima?.[vehicleScale(col)]);
}

// ── URL ─────────────────────────────────────────────────────────────────────

/** Every vehicle-table parameter carries this prefix, so the chart URL writer can keep them. */
export const VEHICLE_TABLE_PARAM_PREFIX = 'vt_';

const LIST_PARAMS = { makes: 'vt_mk', years: 'vt_y', drives: 'vt_dr', tags: 'vt_tg' };

/**
 * Columns, sort and filters as query parameters — only what differs from the
 * defaults.
 *
 * A preset's own columns travel as `vt_preset=road-trips` rather than the list,
 * so a shared link reads as what it is. Its own sort is implied by it. Columns
 * changed from a preset travel as `vt_cols` WITH `vt_preset`, which then means
 * "modified from", so the reader of a link sees where the view started.
 */
export function encodeVehicleTableParams({ columns, sortKey, sortDir, filters, modifiedFrom = null, assumptions = DEFAULT_ASSUMPTIONS }) {
    const p = new URLSearchParams();
    const preset = presetMatching(columns ?? []);
    const base = preset ?? vehiclePresetByKey(modifiedFrom);
    if (preset) {
        if (preset.key !== 'overview') p.set('vt_preset', preset.key);
    } else if (columns?.length) {
        p.set('vt_cols', columns.join(','));
        if (base) p.set('vt_preset', base.key);
    }
    // Sort is written when it differs from what the preset implies (the
    // Overview's, by name, when there is none).
    const impliedSort = preset ?? vehiclePresetByKey('overview');
    if (sortKey && (sortKey !== impliedSort.sortKey || sortDir !== impliedSort.sortDir)) {
        p.set('vt_sort', sortKey);
        if (sortDir === 'desc') p.set('vt_dir', 'desc');
    }
    const add = clampAddDistance(Number(assumptions?.addDistance));
    if (add !== DEFAULT_ASSUMPTIONS.addDistance) p.set('vt_add', String(add));
    if (filters?.search?.trim()) p.set('vt_q', filters.search.trim());
    for (const [key, param] of Object.entries(LIST_PARAMS)) {
        for (const v of filters?.[key] ?? []) p.append(param, v);
    }
    return p;
}

/**
 * The reverse. Total: an unknown column, sort key or preset falls back rather
 * than throwing or rendering a header that sorts by nothing, because this
 * reads whatever a URL happens to contain.
 *
 * `modifiedFrom` is the preset a changed column set started as, or null.
 */
export function decodeVehicleTableParams(search) {
    const p = new URLSearchParams(search ?? '');
    const preset = vehiclePresetByKey(p.get('vt_preset'));
    const cols = (p.get('vt_cols') ?? '').split(',').filter(k => BY_KEY.has(k));
    // The vehicle name is the row's label; a table without it is numbers
    // belonging to nothing.
    const columns = cols.length ? (cols.includes('name') ? cols : ['name', ...cols])
        : (preset?.columns ?? DEFAULT_VEHICLE_COLUMNS);
    const shown = presetMatching(columns);
    const implied = shown ?? vehiclePresetByKey('overview');
    const filters = { ...EMPTY_VEHICLE_FILTERS, search: p.get('vt_q') ?? '' };
    for (const [key, param] of Object.entries(LIST_PARAMS)) filters[key] = p.getAll(param);
    const sortKey = BY_KEY.has(p.get('vt_sort')) ? p.get('vt_sort') : null;
    return {
        columns,
        sortKey: sortKey ?? implied.sortKey,
        sortDir: sortKey ? (p.get('vt_dir') === 'desc' ? 'desc' : 'asc') : implied.sortDir,
        filters,
        modifiedFrom: !shown && preset ? preset.key : null,
        assumptions: { addDistance: p.has('vt_add') ? clampAddDistance(Number(p.get('vt_add'))) : DEFAULT_ASSUMPTIONS.addDistance },
    };
}

// ── Memory ──────────────────────────────────────────────────────────────────

/**
 * Where the table's settings come from when it mounts (#315).
 *
 * Leaving the tab rebuilds the query string without the table's parameters, so
 * a table that read only the URL came back to its defaults, losing a column set
 * someone had arranged by hand. It now remembers, in the same encoding the URL
 * uses, so the one decoder validates both and a retired column key drops out
 * of a memory exactly as it does out of an old link.
 *
 * Two lifetimes, because they are two kinds of setting:
 * - `view`: columns, sort, the preset they came from, and the assumptions.
 *   A preference, kept across visits.
 * - `filters`: search and facets. A question being asked now, kept for the
 *   session; coming back next week to twelve rows of 94 and no memory of why
 *   is the wrong surprise.
 *
 * A link that carries any table parameter wins outright. It is the sender's
 * view, and blending the reader's memory into it would show neither.
 */
export function vehicleTableStartSearch(urlSearch, { view = '', filters = '' } = {}) {
    const url = new URLSearchParams(urlSearch ?? '');
    if ([...url.keys()].some(k => k.startsWith(VEHICLE_TABLE_PARAM_PREFIX))) return url.toString();
    return [view, filters].filter(Boolean).join('&');
}

/** The two remembered strings for a state; see vehicleTableStartSearch. */
export function vehicleTableMemory({ columns, sortKey, sortDir, filters, modifiedFrom = null, assumptions = DEFAULT_ASSUMPTIONS }) {
    return {
        view: encodeVehicleTableParams({ columns, sortKey, sortDir, filters: EMPTY_VEHICLE_FILTERS, modifiedFrom, assumptions }).toString(),
        filters: encodeVehicleTableParams({ columns: DEFAULT_VEHICLE_COLUMNS, filters }).toString(),
    };
}
