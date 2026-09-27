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
 *   Platform             mechanical and electrical platform, and the voltage
 *                        class (#318)
 *   Battery & range      the resolved capacity and EPA range, with their basis
 *                        (vehicleFigures.js), and EPA city and highway range
 *   Tested performance   the best published or EVBench result per metric,
 *                        with the source that set it (performanceDerivations)
 *   every spec field     through inheritance, in schema order: own, else the
 *                        source vehicle's, else what the platform provides —
 *                        "from <platform>" beneath (#352)
 *   Calculated           ratios of the above, worked out per row (#335)
 *   Tested range         range and efficiency from the vehicle's reported
 *                        range test (testedRange.js), with its conditions
 *   Tested charging      the best 5/10/15-minute average charge rate across
 *                        the vehicle's charging sessions (#346), and the
 *                        charge time over the reader's window (#335)
 *
 * Which tested figure a row shows follows the rule on #335: the best result
 * for what a car is capable of (acceleration, the best charge windows), the
 * vehicle's default test WITH its conditions for what depends on conditions
 * (range, efficiency, charge time).
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
import { specProvenance, vehicleLabel } from './specHelpers';
import { convValue, fmtSpeed, MI_TO_KM, LBS_TO_KG, HP_TO_KW } from './unitConversions';
import { deriveTested } from './performanceDerivations';
import { SOC_WINDOW_BASIS, EPA_RANGE_BASIS } from './vehicleFigures';
import { sortByColumn, barMaximaOf, barPercentOf } from './tableColumns';
import { VEHICLE_TABLE_PRESETS } from './vehicleTablePresets';
import { CHARGE_WINDOWS, chargeTimeSession, minutesBetween } from './chargeWindows';
import { testedRangeSummary, testedEfficiency } from './testedRange';
import {
    rangeTestReference, chargeTimeTestReference, chargeBestTestReference, performanceTestReference,
} from './testDetails';
import { ASSUMED_CHARGER_EFF, MPG_E_CONVERSION } from '../constants/epa';
import { vehiclePlatforms, resolveVoltageClass } from './platforms';
import { preconditionedNote } from './runPreconditioning';

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
const UNIT_WORD = /^(kWh|kW|V|in|sec|s|min|lb-ft|lbs?|hp|cu ft|g|USD|ft|mph|years)$/i;

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

/**
 * What the vehicle is built on (#318), read through its resolved links, so a
 * variant shows its source's platforms.
 *
 * Voltage class is the VEHICLE's, resolved with its basis beneath, like
 * battery and EPA range: a platform provides it, it does not stand in for it.
 * 400 V support is a spec field since #352, provided by
 * the platform where the vehicle sets none. Voltage class replaced the "800-volt" yes/no,
 * which said less and disagreed with nothing it could be checked against. It
 * sorts as a number and draws no bar: 800 V is not "better" than 400 V.
 */
const PLATFORM_COLUMNS = [
    { key: 'platform.mechanical', label: 'Mechanical platform',
      hint: 'Body, structure and suspension: what twins share.' },
    { key: 'platform.electrical', label: 'Electrical platform',
      hint: 'Pack, drive units and power electronics: what shapes the charging curve.' },
    { key: 'figures.voltageClass', label: 'Voltage class', unit: 'V', numeric: true, digits: 0, holds: 'short-values',
      hint: 'The pack architecture: 400 or 800 V class. The electrical platform’s, else worked out from the vehicle’s nominal voltage (under 475 V is 400 V class). Its basis is shown beneath.' },
].map(c => ({ ...c, group: 'Platform' }));

const FIGURE_COLUMNS = [
    { key: 'figures.socWindowKwh', label: 'Battery', unit: 'kWh', group: 'Battery & range', numeric: true,
      hint: 'The energy between the car’s own 0% and 100%: EPA tested when it agrees with a label, else Usable, else Gross. Its basis is shown beneath.' },
    // Range columns share one scale: they are one physical quantity, and bars
    // scaled separately would contradict the numbers printed on them.
    { key: 'figures.epaRangeMi', label: 'EPA range', unitGroup: 'distance', group: 'Battery & range', numeric: true, better: 'higher', bar: true, scale: 'range',
      hint: 'The primary EPA configuration’s label, else an Expected EPA Range, else unsorted. Its basis is shown beneath.' },
    { key: 'figures.epaCityMi', label: 'EPA city range', unitGroup: 'distance', group: 'Battery & range', numeric: true, better: 'higher', bar: true, scale: 'range' },
    { key: 'figures.epaHwyMi',  label: 'EPA hwy range',  unitGroup: 'distance', group: 'Battery & range', numeric: true, better: 'higher', bar: true, scale: 'range' },
    // Its own column rather than a value that replaces Efficiency where it
    // exists: MPGe counts energy from the wall, charging losses included, so
    // it reads ~10–15% below a battery-side figure for the same car. One
    // column holding both would sort a car with a label below its twin
    // without one, for no reason a reader could see.
    { key: 'figures.epaEfficiency', label: 'EPA efficiency', unit: 'mi/kWh', metric: ['km/kWh', MI_TO_KM],
      group: 'Battery & range', numeric: true, better: 'higher', bar: true, digits: 2, scale: 'efficiency',
      hint: 'The EPA label’s combined MPGe ÷ 33.705: miles per kWh from the wall, charging losses included, so it reads below Efficiency, which divides by the battery. The MPGe is shown beneath.' },
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
 * EVBench's own range test (#335): the test the vehicle's card reports
 * (testedRange.reportedRangeRun — the curator's default range test first), so
 * the card and the table never show two different tests. Range and efficiency
 * depend on speed and temperature, so beneath each figure are the conditions
 * that produced it: a measurement, not a verdict.
 */
const RANGE_TESTED_COLUMNS = [
    { key: 'tested.range_mi', label: 'Tested range', unitGroup: 'distance', better: 'higher', digits: 0, scale: 'range',
      hint: 'The vehicle’s reported range test — the curator’s default, else the newest full-pack test — scaled to a full pack when it saw enough of one. Beneath it, its speed, temperature and window. Blank where the window was too narrow to scale from.' },
    { key: 'tested.efficiency_mi_kwh', label: 'Tested efficiency', unit: 'mi/kWh', metric: ['km/kWh', MI_TO_KM],
      better: 'higher', digits: 2, scale: 'efficiency',
      hint: 'Distance ÷ energy used on the same test as Tested range: battery-side, so comparable to Efficiency, not to EPA efficiency. Estimated from the SoC window and battery where the test logged no energy, and marked so.' },
].map(c => ({ ...c, group: 'Tested range', numeric: true, bar: true }));

/**
 * EVBench's own charge rate (#346): the best 5, 10 and 15-minute average
 * across the vehicle's charging sessions, chosen in vehicleFigures.js from
 * summaries stored on each session. Beneath each figure, where the window sat
 * and the session's temperature, so a best set on a warm day says so.
 */
const CHARGING_COLUMNS = CHARGE_WINDOWS.map(w => ({
    key: `tested.charge_best_${w}min_kw`, window: w,
    label: `Best ${w}-min charge`, unit: 'kW', better: 'higher', digits: 0,
    group: 'Tested charging', numeric: true, bar: true, scale: 'chargeBest',
    hint: w === 15
        ? 'The highest average charge rate over any 15 minutes of the vehicle’s own charging sessions: what a real stop delivers. Beneath it, where the window sat and the session’s temperature.'
        : `The highest average charge rate over any ${w} minutes of the vehicle’s charging sessions — shows a boost window a spec’s peak kW overstates and a curve undersells. Beneath it, where the window sat.`,
}));

/**
 * How long a charging stop over the reader's window takes (#335): read off the
 * vehicle's own charging curve where a session covers the window, else the
 * spec's 10→80% time when that is the window. Every charging calculation reads
 * this rather than the spec field, so a tested curve reaches all of them.
 */
const WINDOW_TIME_COLUMN = {
    key: 'tested.charge_window_min', label: 'Charge time', unit: 'min', better: 'lower', digits: 0,
    group: 'Tested charging', numeric: true, bar: true, assumption: ['window'],
    labelFor: ({ windowFrom, windowTo }) => `Charge ${windowFrom}→${windowTo}%`,
    hint: 'Minutes over the charge window set under Assumptions, from the vehicle’s default charging session (else its newest) that covers it, with the session’s temperature beneath. Where none does, the spec’s 10→80% time, marked “spec” — which answers only 10→80%. Sessions held back by the charger are left out.',
};

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
 * Assumptions: inputs the READER sets for calculated columns (#335). They live
 * in the URL beside the columns, so a shared link computes the same numbers.
 *
 *   addDistance          how far a charging stop should take you (`vt_add`),
 *                        in the reader's own units: "add 250" means km to a
 *                        metric reader, and the label says which
 *   windowFrom/windowTo  the charge window, 10→80% by default (`vt_win`)
 *   homePrice/fastPrice  electricity, $/kWh, at home and at a DC fast charger
 *                        (`vt_home`, `vt_fast`)
 *
 * Every one has a default a reader never needs to touch, and the Assumptions
 * menu only offers the ones a shown column reads — a table without a cost
 * column has no price to set.
 */
export const DEFAULT_ASSUMPTIONS = { addDistance: 150, windowFrom: 10, windowTo: 80, homePrice: 0.17, fastPrice: 0.48 };

/**
 * Each assumption's slider. The window's two ends cannot cross: From stops at
 * 40% and To starts at 50%.
 *
 * The price defaults are round figures near US averages in 2026 — about 17¢
 * residential and 48¢ at a DC fast charger — and the Assumptions menu says
 * they are assumptions, not quotes.
 */
export const ASSUMPTION_RANGES = {
    addDistance: { min: 50,   max: 300,  step: 25 },
    windowFrom:  { min: 0,    max: 40,   step: 5 },
    windowTo:    { min: 50,   max: 100,  step: 5 },
    homePrice:   { min: 0.05, max: 0.60, step: 0.01 },
    fastPrice:   { min: 0.15, max: 1.00, step: 0.01 },
};

/** A value held to its slider: in range, on a step, and the default when it is not a number. */
function clampAssumption(key, n) {
    const { min, max, step } = ASSUMPTION_RANGES[key];
    const x = Number(n);
    if (n == null || n === '' || !Number.isFinite(x)) return DEFAULT_ASSUMPTIONS[key];
    // Rounded to the step's decimals, so 0.17 stays 0.17 rather than 0.17000000000000001.
    const decimals = String(step).split('.')[1]?.length ?? 0;
    return Number(Math.min(max, Math.max(min, Math.round(x / step) * step)).toFixed(decimals));
}

/** Every assumption held to its slider, missing ones defaulted. */
function normalizeAssumptions(assumptions = DEFAULT_ASSUMPTIONS) {
    return Object.fromEntries(Object.keys(DEFAULT_ASSUMPTIONS)
        .map(k => [k, clampAssumption(k, assumptions?.[k] ?? DEFAULT_ASSUMPTIONS[k])]));
}

/** What a calculation sees: the assumptions, plus the distance in miles and the window as a share of the pack. */
function assumptionContext(assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial') {
    const a = normalizeAssumptions(assumptions);
    return {
        ...a,
        units,
        addMi: units === 'metric' ? a.addDistance / MI_TO_KM : a.addDistance,
        windowShare: (a.windowTo - a.windowFrom) / 100,
        isSpecWindow: a.windowFrom === SPEC_WINDOW.from && a.windowTo === SPEC_WINDOW.to,
    };
}

/**
 * A column as a header shows it: a column whose name carries an assumption
 * ("Time to add 150 mi", "Charge 10→80%") is named from it.
 */
export function labelledColumn(col, assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial') {
    if (!col?.labelFor) return col;
    return { ...col, label: col.labelFor(assumptionContext(assumptions, units)) };
}

/**
 * The assumptions these column keys read, as the Assumptions menu groups them:
 * 'window', 'addDistance', 'homePrice', 'fastPrice'.
 */
export function assumptionsFor(keys = []) {
    return new Set(keys.flatMap(k => BY_KEY.get(k)?.assumption ?? []));
}

/** Whether any of these column keys is worked out from an assumption. */
export const needsAssumptions = (keys = []) => assumptionsFor(keys).size > 0;

/** The only window a spec answers: its 10→80% charge time. */
const SPEC_WINDOW = { from: 10, to: 80 };

const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
/** a ÷ b, or null when either is absent or b is not a positive number. */
const ratio = (a, b) => (a != null && b != null && b > 0 ? a / b : null);

/**
 * Minutes to add `addMi` from the window's start, or null with why.
 *
 * With a tested curve, read off it — as far as the session reached. Without
 * one, at the average rate over the spec's 10→80%; beyond what that window
 * holds the rate is unknown (it falls off past 80%), so the cell is blank and
 * says why rather than extrapolating.
 */
function timeToAdd([range, windowMin], { addMi, windowFrom, windowShare }, { chargeSummary }) {
    if (range == null || !(range > 0)) return { value: null };
    const miPerPct = range / 100;
    if (chargeSummary) {
        const target = windowFrom + addMi / miPerPct;
        const lo = Math.floor(target), hi = Math.ceil(target);
        const a = minutesBetween(chargeSummary, windowFrom, lo) ?? (lo === windowFrom ? 0 : null);
        const b = hi === lo ? a : minutesBetween(chargeSummary, windowFrom, hi);
        if (hi > 100 || a == null || b == null) return { value: null, note: 'more than the test charged' };
        return { value: a + (b - a) * (target - lo) };
    }
    if (!(windowMin > 0)) return { value: null };
    const windowMi = range * windowShare;
    if (addMi > windowMi) return { value: null, note: `more than a ${SPEC_WINDOW.from}→${SPEC_WINDOW.to}% stop adds` };
    return { value: addMi / (windowMi / windowMin) };
}

/** Wall-side miles per kWh: EPA's where the label gives it, else the battery-side estimate less charging losses. */
const wallEfficiency = (epa, battery) => epa ?? (battery != null ? battery * ASSUMED_CHARGER_EFF : null);
const costPer100 = (price) => ([epa, battery]) => {
    const wall = wallEfficiency(epa, battery);
    return wall > 0 ? (price * 100) / wall : null;
};
const costNote = ([epa, battery]) => (epa == null && battery != null ? 'est. from battery efficiency' : null);

const CALCULATED_COLUMNS = [
    { key: 'calc.efficiency', label: 'Efficiency', unit: 'mi/kWh', metric: ['km/kWh', MI_TO_KM],
      better: 'higher', digits: 2, scale: 'efficiency',
      inputs: ['figures.epaRangeMi', 'figures.socWindowKwh'],
      calc: ([range, kwh]) => ratio(range, kwh),
      hint: 'EPA range ÷ battery. An estimate from the label range and the resolved battery capacity, not a measured figure. Battery-side: EPA efficiency, from the wall, reads lower.' },
    { key: 'calc.rangePerChargeMin', label: 'Range per minute', unit: 'mi/min', metric: ['km/min', MI_TO_KM],
      better: 'higher', digits: 1, assumption: ['window'], charging: true,
      inputs: ['figures.epaRangeMi', 'tested.charge_window_min'],
      calc: ([range, min], { windowShare }) => ratio(range == null ? null : range * windowShare, min),
      hint: 'EPA range × the charge window ÷ the time to charge across it: the miles a stop adds per minute plugged in. Peak kW is the number quoted; this is the one a road trip feels. From a test where one covers the window, else the spec’s 10→80% time.' },
    { key: 'calc.timeToAdd', label: 'Time to add distance', unit: 'min',
      better: 'lower', digits: 0, assumption: ['addDistance', 'window'], charging: true,
      labelFor: ({ addDistance, units }) => `Time to add ${addDistance} ${units === 'metric' ? 'km' : 'mi'}`,
      inputs: ['figures.epaRangeMi', 'tested.charge_window_min'],
      calc: (inputs, ctx, extra) => timeToAdd(inputs, ctx, extra).value,
      note: (inputs, ctx, extra) => timeToAdd(inputs, ctx, extra).note ?? null,
      hint: 'Minutes from the start of the charge window to add the distance set under Assumptions, pricing each percent at the EPA range. Read off the vehicle’s own charging curve where it has one; else at the average rate of the spec’s 10→80% time, and blank where that stop adds less.' },
    { key: 'calc.avgChargeKw', label: 'Avg charge', unit: 'kW',
      better: 'higher', digits: 0, assumption: ['window'], charging: true,
      labelFor: ({ windowFrom, windowTo }) => `Avg charge ${windowFrom}→${windowTo}%`,
      inputs: ['figures.socWindowKwh', 'tested.charge_window_min'],
      calc: ([kwh, min], { windowShare }) => ratio(kwh == null ? null : kwh * windowShare, min == null ? null : min / 60),
      hint: 'Battery × the charge window ÷ the time to charge across it: the average power over the stop, which says more than the peak.' },
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
    { key: 'calc.costPer100Home', label: 'Cost per 100 mi, home', unit: '$', metric: ['$', 1 / MI_TO_KM],
      better: 'lower', digits: 2, assumption: ['homePrice'],
      labelFor: ({ units }) => `Cost per 100 ${units === 'metric' ? 'km' : 'mi'}, home`,
      inputs: ['figures.epaEfficiency', 'calc.efficiency'],
      calc: (inputs, { homePrice }) => costPer100(homePrice)(inputs),
      note: costNote,
      hint: 'The home electricity price set under Assumptions × 100 ÷ EPA efficiency, which counts charging losses. Where the vehicle has no EPA label, Efficiency less the assumed charging loss, marked as an estimate.' },
    { key: 'calc.costPer100Fast', label: 'Cost per 100 mi, DC fast', unit: '$', metric: ['$', 1 / MI_TO_KM],
      better: 'lower', digits: 2, assumption: ['fastPrice'],
      labelFor: ({ units }) => `Cost per 100 ${units === 'metric' ? 'km' : 'mi'}, DC fast`,
      inputs: ['figures.epaEfficiency', 'calc.efficiency'],
      calc: (inputs, { fastPrice }) => costPer100(fastPrice)(inputs),
      note: costNote,
      hint: 'The same at the DC fast-charging price set under Assumptions: what a road trip’s miles cost. Priced on EPA efficiency, so a highway trip, which uses more per mile, costs somewhat more.' },
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
        hint: f.hint ?? null,
        spec: [cat.key, f.key],
    };
}));

/** Every column the table can show, in picker order. */
export const VEHICLE_COLUMNS = [
    ...IDENTITY_COLUMNS, ...PLATFORM_COLUMNS, ...FIGURE_COLUMNS, ...CALCULATED_COLUMNS, ...TESTED_COLUMNS,
    ...RANGE_TESTED_COLUMNS, WINDOW_TIME_COLUMN, ...CHARGING_COLUMNS, ...SPEC_COLUMNS,
];

const BY_KEY = new Map(VEHICLE_COLUMNS.map(c => [c.key, c]));
export const vehicleColumnByKey = (key) => BY_KEY.get(key) ?? null;

/**
 * Column keys that were renamed, to the key that replaced them, so a saved
 * link keeps the column rather than dropping it. #352 moved 400 V charging
 * from a platform-only figure to the vehicle's own spec field.
 */
const RENAMED_COLUMNS = { 'figures.dc400Charging': 'charging.dc_400v_charging' };
const currentColumnKey = (k) => RENAMED_COLUMNS[k] ?? k;

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

const PERFORMANCE_KEYS = new Set(TESTED_COLUMNS.map(c => c.key));
/** Whether any of these column keys needs performance results fetched. Charging figures arrive with the vehicle. */
export const needsPerformance = (keys = []) => keys.some(k => PERFORMANCE_KEYS.has(k));

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
 * @param {Map}    [opts.platformsById]  the platform list by id (#318); platform columns are blank without it
 * @returns {Array<{ id, index, vehicle, values: Object, notes: Object, tests: Object, flagged: Set }>}
 *          `notes` holds the basis or source shown beneath a figure; `tests`
 *          the test behind it, where one is (testDetails.js TestReference)
 */
export function buildVehicleRows(vehicles = [], { performance = null, assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial', platformsById = null } = {}) {
    const calcContext = assumptionContext(assumptions, units);
    return vehicles.map((vehicle, index) => {
        // AppContext attaches the platform rows (withPlatforms); a caller that
        // passes only the list gets the same resolution.
        const withRows = vehicle.platforms || !platformsById ? vehicle : { ...vehicle, platforms: vehiclePlatforms(vehicle, platformsById) };
        const { specs, fromPlatform } = specProvenance(withRows, vehicles);
        const values = {
            name:  vehicleLabel(vehicle),
            make:  present(vehicle.make) ?? vehicle.manufacturer?.name ?? null,
            model: present(vehicle.model),
            trim:  present(vehicle.trim),
            year:  present(vehicle.year),
            tags:  (vehicle.tags ?? []).map(t => t.name).filter(Boolean).join(', ') || null,
        };
        const notes = {};
        // The test behind a figure, where one stands behind it (testDetails.js):
        // its note links to it, and hovering the cell restates it.
        const tests = {};

        for (const col of SPEC_COLUMNS) {
            const [category, field] = col.spec;
            values[col.key] = present(specs?.[category]?.[field]) ?? null;
            // A platform provides the value; it does not stand in for the
            // vehicle's own, so the cell says whose it is (#352).
            const platform = fromPlatform.get(col.key);
            if (values[col.key] != null && platform) notes[col.key] = `from ${platform.name}`;
        }

        const { mechanical, electrical } = vehiclePlatforms(vehicle, platformsById);
        values['platform.mechanical'] = mechanical?.name ?? null;
        values['platform.electrical'] = electrical?.name ?? null;
        const voltageClass = resolveVoltageClass(electrical, specs?.charging?.battery_nominal_voltage_v);
        values['figures.voltageClass'] = voltageClass?.v ?? null;
        notes['figures.voltageClass'] = voltageClass
            ? (voltageClass.basis === 'platform' ? `from ${voltageClass.platform.name}` : `from ${Math.round(voltageClass.nominalV)} V nominal`)
            : null;
        for (const [key, kind] of [['platform.mechanical', 'mechanical_platform_id'], ['platform.electrical', 'electrical_platform_id']]) {
            const from = vehicle.inheritedFrom?.[kind];
            if (values[key] != null && from) notes[key] = `from ${from.name}`;
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
        const mpge = vehicle.epaRange?.combinedMpge ?? null;
        values['figures.epaEfficiency'] = mpge ? mpge / MPG_E_CONVERSION : null;
        notes['figures.epaEfficiency'] = mpge ? `${Math.round(mpge)} MPGe` : null;

        const range = testedRangeSummary(vehicle);
        values['tested.range_mi'] = range?.fullPackMi ?? (range?.isFullPack ? range.distanceMi : null);
        notes['tested.range_mi'] = range ? rangeTestNote(range, units, {
            window: range.isScaled ? 'scaled from' : range.fullPackMi == null && !range.isFullPack ? 'only' : null,
        }) : null;
        tests['tested.range_mi'] = rangeTestReference(vehicle, range, units);
        const efficiency = testedEfficiency(vehicle);
        values['tested.efficiency_mi_kwh'] = efficiency?.miPerKwh ?? null;
        notes['tested.efficiency_mi_kwh'] = efficiency
            ? [rangeTestNote(efficiency, units, { window: efficiency.isRepresentative ? null : 'over' }),
                efficiency.estimated ? 'est. from SoC' : null].filter(Boolean).join(' · ')
            : null;
        tests['tested.efficiency_mi_kwh'] = rangeTestReference(vehicle, efficiency, units, 'efficiency');

        const charge = chargeWindowTime(vehicle, specs, calcContext, units);
        values[WINDOW_TIME_COLUMN.key] = charge.minutes;
        notes[WINDOW_TIME_COLUMN.key] = charge.note;
        const chargeTest = charge.tested
            ? chargeTimeTestReference(vehicle, charge.tested, { from: calcContext.windowFrom, to: calcContext.windowTo }, units)
            : null;
        tests[WINDOW_TIME_COLUMN.key] = chargeTest;

        for (const col of CHARGING_COLUMNS) {
            const best = vehicle.chargeBest?.[col.window] ?? null;
            values[col.key] = best?.kw ?? null;
            notes[col.key] = best ? chargeNote(best, units) : null;
            tests[col.key] = best?.kw ? chargeBestTestReference(vehicle, best, col.window, units) : null;
        }

        if (performance) {
            const perf = performance[vehicle.id] ?? { sessions: [], summaries: [] };
            for (const col of TESTED_COLUMNS) {
                const result = deriveTested(perf.sessions, perf.summaries, col.key.slice('tested.'.length));
                values[col.key] = result.value ?? null;
                notes[col.key] = result.value != null ? (result.basis?.sourceName ?? null) : null;
                tests[col.key] = performanceTestReference(vehicle, result);
            }
        } else {
            for (const col of TESTED_COLUMNS) values[col.key] = null;
        }

        // Last, so every input — spec, figure or tested — is already in place.
        // In order, too: a calculation may read one listed before it.
        const extra = { chargeSummary: charge.summary };
        for (const col of CALCULATED_COLUMNS) {
            const inputs = col.inputs.map(k => num(values[k]));
            const value = col.calc(inputs, calcContext, extra);
            values[col.key] = value == null || (typeof value === 'number' && !Number.isFinite(value)) ? null : value;
            // A note can explain a blank, too ("more than a 10→80% stop adds").
            // A charging figure worked from a test says "tested"; from the spec it
            // is like every other calculation and says nothing.
            const fromTest = col.charging && charge.summary && values[col.key] != null;
            notes[col.key] = col.note?.(inputs, calcContext, extra) ?? (fromTest ? 'tested' : null);
            // "Tested" links to the charging test the time came from — as does
            // a blank explained by that test's reach.
            tests[col.key] = col.charging && charge.summary && (fromTest || notes[col.key]) ? chargeTest : null;
        }

        // Community flags are stored as the spec's own `category.field` key,
        // which is exactly a spec column's key, so a flag lands on its cell
        // with no mapping. Only spec columns can carry one: figures and tested
        // results are worked out, not entered, and nobody flags them.
        const flagged = new Set((vehicle.flagged_specs ?? []).filter(k => BY_KEY.get(k)?.spec));

        return { id: vehicle.id, index, vehicle, values, notes, tests, flagged };
    });
}

/**
 * The charge time over the reader's window, with its basis (#335).
 *
 * A session that covers the window wins over the spec, whatever the window:
 * it is the vehicle's own measurement. Without one, the spec's 10→80% time
 * answers only a 10→80% window; any other and the cell is blank, saying why.
 *
 * @returns {{ minutes: number|null, note: string|null, summary: Object|null, tested: Object|null }}
 *   `summary` — the session's stored summary, for calculations that read its curve;
 *   `tested` — chargeTimeSession's answer, when a test supplied the time
 */
function chargeWindowTime(vehicle, specs, { windowFrom, windowTo, isSpecWindow }, units) {
    const maxDcKw = num(specs?.charging?.max_dc_kw);
    const tested = chargeTimeSession(vehicle.runs ?? [], { from: windowFrom, to: windowTo, maxDcKw });
    if (tested.run) {
        const parts = [tested.run.source, tested.temperatureF != null ? temperatureText(tested.temperatureF, units) : null,
            preconditionedNote(tested.run.preconditioned)];
        return { minutes: tested.minutes, note: parts.filter(Boolean).join(' · ') || 'tested', summary: tested.run.charge_summary, tested };
    }
    const spec = num(specs?.charging?.charge_time_10_to_80_pct_min);
    if (spec > 0 && isSpecWindow) return { minutes: spec, note: 'spec', summary: null };
    const why = tested.limitedOut ? 'tests charger-limited'
        : spec > 0 ? `spec gives ${SPEC_WINDOW.from}→${SPEC_WINDOW.to}% only` : null;
    return { minutes: null, note: why, summary: null };
}

const temperatureText = (f, units) => (units === 'metric' ? `${Math.round((f - 32) * 5 / 9)}°C` : `${Math.round(f)}°F`);

/**
 * What sits beneath a range test's figure: speed (and a mixed cycle, which a
 * held speed is not), temperature, and the SoC window where it matters —
 * "scaled from 90→10%", "56→10% only".
 */
function rangeTestNote(t, units, { window = null } = {}) {
    const parts = [];
    if (t.speedMph != null) parts.push(fmtSpeed(t.speedMph, units));
    if (t.speedNote) parts.push(t.speedNote);
    if (t.temperatureF != null) parts.push(temperatureText(t.temperatureF, units));
    if (window && t.startSoc != null && t.endSoc != null) {
        const span = `${t.startSoc}→${t.endSoc}%`;
        parts.push(window === 'only' ? `${span} only` : `${window} ${span}`);
    }
    return parts.join(' · ') || null;
}

/**
 * What sits beneath a charge rate: where the window was, how warm the session
 * was, and — the one caveat that could flatter it — time worked out from a
 * capacity rather than logged.
 */
function chargeNote(best, units) {
    const parts = [];
    if (best.startSoc != null && best.endSoc != null) parts.push(`${best.startSoc}→${best.endSoc}%`);
    // A session a few seconds short of the window stood in for it.
    if (best.spanMin != null) parts.push(`over ${best.spanMin} min`);
    if (best.temperatureF != null) parts.push(temperatureText(best.temperatureF, units));
    const pre = preconditionedNote(best.preconditioned);
    if (pre) parts.push(pre);
    if (best.timeDerived) parts.push('time derived');
    return parts.join(' · ') || null;
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
    const a = normalizeAssumptions(assumptions);
    if (a.addDistance !== DEFAULT_ASSUMPTIONS.addDistance) p.set('vt_add', String(a.addDistance));
    if (a.windowFrom !== DEFAULT_ASSUMPTIONS.windowFrom || a.windowTo !== DEFAULT_ASSUMPTIONS.windowTo) {
        p.set('vt_win', `${a.windowFrom}-${a.windowTo}`);
    }
    if (a.homePrice !== DEFAULT_ASSUMPTIONS.homePrice) p.set('vt_home', String(a.homePrice));
    if (a.fastPrice !== DEFAULT_ASSUMPTIONS.fastPrice) p.set('vt_fast', String(a.fastPrice));
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
    const cols = [...new Set((p.get('vt_cols') ?? '').split(',').map(currentColumnKey))].filter(k => BY_KEY.has(k));
    // The vehicle name is the row's label; a table without it is numbers
    // belonging to nothing.
    const columns = cols.length ? (cols.includes('name') ? cols : ['name', ...cols])
        : (preset?.columns ?? DEFAULT_VEHICLE_COLUMNS);
    const shown = presetMatching(columns);
    const implied = shown ?? vehiclePresetByKey('overview');
    const filters = { ...EMPTY_VEHICLE_FILTERS, search: p.get('vt_q') ?? '' };
    for (const [key, param] of Object.entries(LIST_PARAMS)) filters[key] = p.getAll(param);
    const rawSort = currentColumnKey(p.get('vt_sort'));
    const sortKey = BY_KEY.has(rawSort) ? rawSort : null;
    return {
        columns,
        sortKey: sortKey ?? implied.sortKey,
        sortDir: sortKey ? (p.get('vt_dir') === 'desc' ? 'desc' : 'asc') : implied.sortDir,
        filters,
        modifiedFrom: !shown && preset ? preset.key : null,
        assumptions: decodeAssumptions(p),
    };
}

/** The assumptions a query carries; each absent or unreadable one is its default. */
function decodeAssumptions(p) {
    const [from, to] = (p.get('vt_win') ?? '').split('-');
    return normalizeAssumptions({
        addDistance: p.get('vt_add'),
        windowFrom: from,
        windowTo: to,
        homePrice: p.get('vt_home'),
        fastPrice: p.get('vt_fast'),
    });
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
