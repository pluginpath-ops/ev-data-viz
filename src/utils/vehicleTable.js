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
 *                        range test (testedRange.js), with its conditions;
 *                        and the composite of its steady-state tests,
 *                        corrected to the reader's conditions (compositeRange.js)
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
import { testedRangeSummary, testedEfficiency, whenNewRange } from './testedRange';
import {
    rangeTestReference, chargeTimeTestReference, chargeBestTestReference, performanceTestReference,
} from './testDetails';
import { ASSUMED_CHARGER_EFF, DC_FAST_LOSS, MPG_E_CONVERSION } from '../constants/epa';
import { normalizeCorrectionTarget, DEFAULT_CORRECTION_TARGET, DEFAULT_READER_MODE } from './correctionSettings';
import { compositeRange, compositeLeftOutNote } from './compositeRange';
import { correctionFactor, runConditions } from './conditionCorrection';
import { vehiclePlatforms, resolveVoltageClass } from './platforms';
import { preconditionedNote } from './runPreconditioning';
import { isCompositeRun } from './runUtils';

// ── Units ───────────────────────────────────────────────────────────────────
//
// A column's unit is STATED: `unit` (a string), `unitGroup` (converted between
// systems, below), or `unitless: true` for a count, a year or a ratio. Every
// numeric column does one of the three — utils/__tests__/tableUnits.test.js
// fails the one that does not — and every cell draws the unit beside its
// figure (TableCell), so the header carries only the name. A unit is never read
// out of a column's name: "¼ mile" is seconds and mph, "0–100 mph" is seconds.

/**
 * How each unit group reads, imperial then metric — the units convValue
 * converts to. Each string is in CANONICAL_UNITS (tableColumns.js), cased as
 * written: `lb` not `lbs`, `km/h` not `kph`, `cu ft`, `Nm`.
 */
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

/** The unit a column's figures are shown in, set beside each figure in its cell. */
export function unitFor(col, units = 'imperial') {
    if (col?.metric && units === 'metric') return col.metric[0];
    if (col?.unitGroup) return UNIT_LABELS[col.unitGroup]?.[units === 'metric' ? 1 : 0] ?? null;
    return col?.unit ?? null;
}

// How a schema label may spell its own unit where that is not the unit's
// canonical form: "(sec)" for s, "(years)" for yr, "(USD)" for $.
const LABEL_SPELLINGS = { sec: 's', years: 'yr', usd: '$' };

/**
 * A spec label as the table names its column: a parenthetical that only
 * spells out the field's DECLARED unit is dropped ("Battery Usable (kWh)" →
 * "Battery Usable"), because the cells state the unit. The label never decides
 * the unit — that is `unit`/`unitGroup`/`unitless` on the schema field — and a
 * parenthetical that is not that unit stays: "Elk Test Speed (Moose Test)",
 * "Heads-Up Display (HUD)". A name like "0–100 mph" has no parenthesis to read.
 */
function withoutDeclaredUnit(label, declared) {
    const m = /^(.*?)\s*\(([^)]*)\)(.*)$/.exec(label);
    if (!m || !declared) return label;
    const said = m[2].trim();
    const spelled = LABEL_SPELLINGS[said.toLowerCase()] ?? said;
    return spelled.toLowerCase() === declared.toLowerCase() ? `${m[1]}${m[3]}`.trim() : label;
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
      assumption: ['conditions'], labelFor: ({ conditions, units, correctionMode }) => (correctionMode === 'none' ? 'Tested range' : `Tested range, ${speedText(conditions.speedMph, units)}`),
      hint: 'The vehicle’s reported range test — the curator’s default, else the newest full-pack test — scaled to a full pack when it saw enough of one. Beneath it, its speed, temperature and window. Blank where the window was too narrow to scale from. Corrected to the conditions under Assumptions, by the margin beneath, unless correction is off on the charts, where it is the test as measured.' },
    { key: 'tested.efficiency_mi_kwh', label: 'Tested efficiency', unit: 'mi/kWh', metric: ['km/kWh', MI_TO_KM],
      better: 'higher', digits: 2, scale: 'efficiency',
      assumption: ['conditions'], labelFor: ({ conditions, units, correctionMode }) => (correctionMode === 'none' ? 'Tested eff.' : `Tested eff., ${speedText(conditions.speedMph, units)}`),
      fullLabelFor: ({ conditions, units, correctionMode }) => (correctionMode === 'none' ? 'Tested efficiency' : `Tested efficiency, ${speedText(conditions.speedMph, units)}`),
      hint: 'Distance ÷ energy used on the same test as Tested range: battery-side, so comparable to Efficiency, not to EPA efficiency. Estimated from the SoC window and battery where the test logged no energy, and marked so. Corrected to the conditions under Assumptions, by the margin beneath, unless correction is off on the charts, where it is the test as measured.' },
    // The composite (compositeRange.js): every steady-state range test,
    // corrected to the conditions under Assumptions and averaged. The speed is
    // in the header, as the charge window is in "Charge 10→80%"; how many tests
    // made it is beneath.
    { key: 'tested.composite_range_mi', label: 'Composite range', unitGroup: 'distance', better: 'higher', digits: 0, scale: 'range',
      assumption: ['conditions'],
      labelFor: ({ conditions, units }) => `Composite range, ${speedText(conditions.speedMph, units)}`,
      hint: 'The mean of the vehicle’s steady-state range tests, each scaled to a full pack and corrected to the speed, temperature and altitude under Assumptions, in calm air. Tests on a mixed cycle, far from the target speed, or outside the temperature band are left out: below freezing the heating a test is assumed to have used is the least certain part of the correction. A blank altitude is corrected from the assumed test altitude, and the note says so; a blank wind is calm air. How many tests made it is beneath.' },
    { key: 'tested.composite_efficiency_mi_kwh', label: 'Composite efficiency', unit: 'mi/kWh', metric: ['km/kWh', MI_TO_KM],
      better: 'higher', digits: 2, scale: 'efficiency', assumption: ['conditions'],
      labelFor: ({ conditions, units }) => `Composite eff., ${speedText(conditions.speedMph, units)}`,
      fullLabelFor: ({ conditions, units }) => `Composite efficiency, ${speedText(conditions.speedMph, units)}`,
      hint: 'The same tests’ efficiency, corrected the same way. Battery-side, so comparable to Tested efficiency, not to EPA efficiency. Any window counts here, so it can rest on more tests than Composite range; estimated from the SoC window and battery where a test logged no energy, and marked so.' },
    { key: 'tested.when_new_range_mi', label: 'When-new range', unitGroup: 'distance', better: 'higher', digits: 0, scale: 'range',
      assumption: ['conditions'], labelFor: ({ conditions, units, correctionMode }) => (correctionMode === 'none' ? 'When-new range' : `When-new range, ${speedText(conditions.speedMph, units)}`),
      hint: 'What the reported range test would reach with a new pack: its measured efficiency × the car’s new-car capacity (EPA tested, else Usable). Blank unless the test measured its energy, saw most of the pack, a new-car capacity is known, and the pack is more than 5% down — closer than that is test scatter. Corrected to the conditions under Assumptions, by the margin beneath, unless correction is off on the charts, where it is the test as measured.' },
    { key: 'tested.capacity_retention', label: 'Capacity retention', unit: '%', better: 'higher', digits: 0,
      hint: 'The share of its new-car capacity the pack delivered on the reported range test: the energy that test implies for a full pack ÷ EPA tested (else Usable) capacity. Shown only below 95%.' },
// A name that states its speed ("Composite range, 70 mph") is the longest
// header in the table and cannot be shortened without dropping it, so those
// columns take the room (`noted-figures`, index.css).
].map(c => ({ ...c, group: 'Tested range', numeric: true, bar: true,
    holds: c.labelFor ? 'noted-figures' : null, qualified: !!c.labelFor }));

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
 *   rangeBasis           what a percent of charge is priced at in "Time to add":
 *                        'tested' (composite range) or 'epa' (`vt_basis`)
 *
 * The conditions the composite range is corrected to are NOT the table's: they
 * are the site-wide correction target (correctionSettings.js), shared with
 * every chart, and the Assumptions menu edits that setting where a shown
 * column reads it (assumption 'conditions').
 *
 * Every one has a default a reader never needs to touch, and the Assumptions
 * menu only offers the ones a shown column reads — a table without a cost
 * column has no price to set.
 */
export const DEFAULT_ASSUMPTIONS = { addDistance: 150, windowFrom: 10, windowTo: 80, homePrice: 0.17, fastPrice: 0.48, rangeBasis: 'tested' };

/**
 * What "Time to add" prices a percent of charge at (`vt_basis`): what the
 * vehicle has been MEASURED to go (the composite range, else its reported
 * range test), or the EPA label. Either falls back to the other when its own
 * figure is absent, and the note beneath says which it used.
 */
const RANGE_BASES = ['tested', 'epa'];

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
    const { rangeBasis, ...numbers } = DEFAULT_ASSUMPTIONS;
    return {
        ...Object.fromEntries(Object.keys(numbers)
            .map(k => [k, clampAssumption(k, assumptions?.[k] ?? DEFAULT_ASSUMPTIONS[k])])),
        rangeBasis: RANGE_BASES.includes(assumptions?.rangeBasis) ? assumptions.rangeBasis : rangeBasis,
    };
}

/**
 * What a calculation sees: the assumptions, plus the distance in miles, the
 * window as a share of the pack, the correction target (`conditions`) and the
 * reader's correction mode (`correctionMode`, 'none' when they turned it off).
 */
function assumptionContext(assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial', correctionTarget = DEFAULT_CORRECTION_TARGET, correctionMode = DEFAULT_READER_MODE) {
    const conditions = normalizeCorrectionTarget(correctionTarget);
    const a = normalizeAssumptions(assumptions);
    return {
        ...a,
        units,
        addMi: units === 'metric' ? a.addDistance / MI_TO_KM : a.addDistance,
        windowShare: (a.windowTo - a.windowFrom) / 100,
        isSpecWindow: a.windowFrom === SPEC_WINDOW.from && a.windowTo === SPEC_WINDOW.to,
        conditions,
        correctionMode,
    };
}

/**
 * A column as a header shows it: a column whose name carries an assumption
 * ("Time to add 150 mi", "Charge 10→80%") is named from it.
 */
export function labelledColumn(col, assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial', correctionTarget = DEFAULT_CORRECTION_TARGET, correctionMode = DEFAULT_READER_MODE) {
    if (!col?.labelFor) return col;
    const ctx = assumptionContext(assumptions, units, correctionTarget, correctionMode);
    // `fullLabelFor` names the column in full where the header's name is cut
    // short: the header tooltip's fallback and the column picker's search.
    return { ...col, label: col.labelFor(ctx), ...(col.fullLabelFor && { fullLabel: col.fullLabelFor(ctx) }) };
}

/**
 * The assumptions these column keys read, as the Assumptions menu groups them:
 * 'window', 'addDistance', 'homePrice', 'fastPrice', 'conditions'.
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
function timeToAdd([epaRange, , compositeRange, testedRange], { addMi, windowFrom, rangeBasis }, { addSummary, specMin }) {
    const { range, basis } = pricedRange(rangeBasis, { epaRange, compositeRange, testedRange });
    const said = (r) => ({ ...r, note: r.note ?? `${basis} range` });
    if (range == null || !(range > 0)) return { value: null };
    const miPerPct = range / 100;
    // Only the START of the charge window matters here: a stop ends when the
    // distance is added, wherever the reader's "to" sits. What the session
    // must cover is the start up to that point (see addTimeSession).
    if (addSummary) {
        const target = windowFrom + addMi / miPerPct;
        const lo = Math.floor(target), hi = Math.ceil(target);
        const a = minutesBetween(addSummary, windowFrom, lo) ?? (lo === windowFrom ? 0 : null);
        const b = hi === lo ? a : minutesBetween(addSummary, windowFrom, hi);
        if (hi > 100 || a == null || b == null) return { value: null, note: 'more than the test charged' };
        return said({ value: a + (b - a) * (target - lo) });
    }
    // The spec answers one window, 10→80%: its average rate, up to what that holds.
    if (!(specMin > 0) || windowFrom !== SPEC_WINDOW.from) return { value: null };
    const windowMi = range * (SPEC_WINDOW.to - SPEC_WINDOW.from) / 100;
    if (addMi > windowMi) return { value: null, note: `more than a ${SPEC_WINDOW.from}→${SPEC_WINDOW.to}% stop adds` };
    return said({ value: addMi / (windowMi / specMin) });
}

/**
 * The charging session a "Time to add" reads: one that covers the stop from the
 * window's start to where the added distance ends, not to the reader's window
 * end — a 10→90% window must not blank a stop that ends at 63% because the
 * tests stop at 85%. Same pick as the window's (chargeTimeSession).
 */
function addTimeSession(vehicle, maxDcKw, { windowFrom, addMi, rangeBasis }, ranges) {
    const { range } = pricedRange(rangeBasis, ranges);
    if (!(range > 0)) return { tested: { run: null }, to: null };
    const to = Math.min(100, Math.ceil(windowFrom + addMi / (range / 100)));
    return { tested: chargeTimeSession(vehicle.runs ?? [], { from: windowFrom, to, maxDcKw }), to };
}

/** The range a percent is priced at, and what to call it: the reader's basis, else the other. */
function pricedRange(rangeBasis, { epaRange, compositeRange, testedRange }) {
    const measured = compositeRange > 0 ? { range: compositeRange, basis: 'composite' }
        : testedRange > 0 ? { range: testedRange, basis: 'tested' } : null;
    const epa = epaRange > 0 ? { range: epaRange, basis: 'EPA' } : null;
    return (rangeBasis === 'epa' ? epa ?? measured : measured ?? epa) ?? { range: null, basis: null };
}

/** Wall-side miles per kWh: EPA's where the label gives it, else the battery-side estimate less charging losses. */
const wallEfficiency = (epa, battery) => epa ?? (battery != null ? battery * ASSUMED_CHARGER_EFF : null);
const costPer100 = (price) => ([epa, battery]) => {
    const wall = wallEfficiency(epa, battery);
    return wall > 0 ? (price * 100) / wall : null;
};
const costNote = ([epa, battery]) => (epa == null && battery != null ? 'est. from battery efficiency' : null);

/**
 * Battery-side miles per kWh, for a DC fast session: the label's wall figure
 * with the AC charging loss it carries taken back out, else the estimate from
 * range ÷ battery. The loss taken out is the cert's own where it measured one
 * (`chargerEff`), else the assumed one. Unlike `calc.efficiency` it does not
 * lean on which battery capacity (Usable or Gross) the range is divided by.
 */
const batteryEfficiency = (epa, battery, chargerEff) =>
    epa != null ? epa / (chargerEff ?? ASSUMED_CHARGER_EFF) : battery;

/**
 * Cost of 100 miles at a DC fast charger (#506). A fast session bypasses the
 * onboard charger, so it is not priced on the wall figure the home cost is:
 * the battery-side energy, grossed up by the loss between the car's port and
 * the pack's DC output (cooling, auxiliary draw, the pack's own losses; the
 * station's conversion is not billed). Billing is per kWh delivered at the
 * car's port, so that gross-up is the whole of it.
 */
const costPer100Fast = ([epa, battery], price, chargerEff) => {
    const eff = batteryEfficiency(epa, battery, chargerEff);
    return eff > 0 ? (price * 100) / (eff * (1 - DC_FAST_LOSS)) : null;
};
const fastCostNote = ([epa, battery], { chargerEff }) =>
    epa == null ? (battery != null ? 'est. from battery efficiency' : null)
        : chargerEff == null ? 'est. battery-side' : null;

const CALCULATED_COLUMNS = [
    { key: 'calc.efficiency', label: 'Efficiency', unit: 'mi/kWh', metric: ['km/kWh', MI_TO_KM],
      better: 'higher', digits: 2, scale: 'efficiency',
      inputs: ['figures.epaRangeMi', 'figures.socWindowKwh'],
      calc: ([range, kwh]) => ratio(range, kwh),
      hint: 'EPA range ÷ battery. An estimate from the label range and the resolved battery capacity, not a measured figure. Battery-side: EPA efficiency, from the wall, reads lower.' },
    { key: 'calc.rangePerChargeMin', label: 'Range per minute', unit: 'mi/min', metric: ['km/min', MI_TO_KM],
      better: 'higher', digits: 1, assumption: ['window', 'rangeBasis', 'conditions'], charging: true,
      inputs: ['figures.epaRangeMi', 'tested.charge_window_min', 'tested.composite_range_mi', 'tested.range_mi'],
      calc: ([epaRange, min, compositeRange, testedRange], { windowShare, rangeBasis }) => {
          const { range } = pricedRange(rangeBasis, { epaRange, compositeRange, testedRange });
          return ratio(range == null ? null : range * windowShare, min);
      },
      note: ([epaRange, , compositeRange, testedRange], { rangeBasis }) =>
          pricedRange(rangeBasis, { epaRange, compositeRange, testedRange }).basis && `${pricedRange(rangeBasis, { epaRange, compositeRange, testedRange }).basis} range`,
      hint: 'The composite range (else the reported range test, else EPA; or EPA, as set under Assumptions) × the charge window ÷ the time to charge across it: the miles a stop adds per minute plugged in. Peak kW is the number quoted; this is the one a road trip feels. From a test where one covers the window, else the spec’s 10→80% time.' },
    { key: 'calc.timeToAdd', label: 'Time to add distance', unit: 'min',
      better: 'lower', digits: 0, assumption: ['addDistance', 'window', 'rangeBasis', 'conditions'], charging: true,
      labelFor: ({ addDistance, units }) => `Time to add ${addDistance} ${units === 'metric' ? 'km' : 'mi'}`,
      inputs: ['figures.epaRangeMi', 'tested.charge_window_min', 'tested.composite_range_mi', 'tested.range_mi'],
      calc: (inputs, ctx, extra) => timeToAdd(inputs, ctx, extra).value,
      note: (inputs, ctx, extra) => timeToAdd(inputs, ctx, extra).note ?? null,
      hint: 'Minutes from the start of the charge window to add the distance set under Assumptions, pricing each percent at the composite range (else the reported range test, else EPA), or at the EPA range, as set under Assumptions. Read off the vehicle’s own charging curve where it has one; else at the average rate of the spec’s 10→80% time, and blank where that stop adds less.' },
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
    // Over the COMPOSITE range, not the reported test: testedRange.js explains
    // why one test against EPA is not a comparison across vehicles, and the
    // composite, corrected to one set of conditions, is what earns it.
    { key: 'calc.pctOfEpaHwy', label: '% of EPA hwy', unit: '%',
      better: 'higher', digits: 0, assumption: ['conditions'], notesFrom: 'tested.composite_range_mi',
      inputs: ['tested.composite_range_mi', 'figures.epaHwyMi'],
      calc: ([composite, hwy]) => { const r = ratio(composite, hwy); return r == null ? null : r * 100; },
      hint: 'Composite range ÷ EPA hwy range: the vehicle’s steady-state tests, corrected to the conditions under Assumptions, against its label’s highway figure. EPA’s highway figure is not a 70 mph figure — its cycle averages about 48 mph before the label adjustment — so 100% is a reference point, not a pass mark.' },
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
    { key: 'calc.costPer100Home', label: 'Cost/100 mi, home', unit: '$', metric: ['$', 1 / MI_TO_KM],
      better: 'lower', digits: 2, assumption: ['homePrice'],
      labelFor: ({ units }) => `Cost/100 ${units === 'metric' ? 'km' : 'mi'}, home`,
      fullLabelFor: ({ units }) => `Cost per 100 ${units === 'metric' ? 'km' : 'mi'}, home`,
      inputs: ['figures.epaEfficiency', 'calc.efficiency'],
      calc: (inputs, { homePrice }) => costPer100(homePrice)(inputs),
      note: costNote,
      hint: 'The home electricity price set under Assumptions × 100 ÷ EPA efficiency, which counts charging losses. Where the vehicle has no EPA label, Efficiency less the assumed charging loss, marked as an estimate.' },
    { key: 'calc.costPer100Fast', label: 'Cost/100 mi, fast', unit: '$', metric: ['$', 1 / MI_TO_KM],
      better: 'lower', digits: 2, assumption: ['fastPrice'],
      labelFor: ({ units }) => `Cost/100 ${units === 'metric' ? 'km' : 'mi'}, fast`,
      fullLabelFor: ({ units }) => `Cost per 100 ${units === 'metric' ? 'km' : 'mi'}, DC fast`,
      inputs: ['figures.epaEfficiency', 'calc.efficiency'],
      calc: (inputs, { fastPrice }, { chargerEff }) => costPer100Fast(inputs, fastPrice, chargerEff),
      note: (inputs, ctx, extra) => fastCostNote(inputs, extra),
      hint: 'The DC fast-charging price set under Assumptions × 100 ÷ the battery-side efficiency, grossed up by the DC fast charging loss (Admin → Model Constants): what a session loses between the car’s port and the pack’s output, cooling, auxiliary draw and the pack’s own losses among it. A DC session bypasses the onboard charger, so it does not pay the AC charging loss the home cost carries, and the station’s own conversion is not billed. Battery-side: the label’s efficiency with the charging loss taken back out, or range ÷ battery without a label; marked as an estimate unless the certification measured that loss. Priced on EPA efficiency, so a highway trip, which uses more per mile, costs somewhat more.' },
    { key: 'calc.weightPerHp', label: 'Weight per hp', unit: 'lb/hp', metric: ['kg/kW', LBS_TO_KG / HP_TO_KW],
      better: 'lower', digits: 1,
      // The cells are kg/kW in metric, so the name follows the unit.
      labelFor: ({ units }) => `Weight per ${units === 'metric' ? 'kW' : 'hp'}`,
      fullLabelFor: ({ units }) => `Weight per ${units === 'metric' ? 'kilowatt' : 'horsepower'}`,
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
 *   long-figures  figures of six digits, or printed to three decimals, that
 *                 do not fit a figure column beside their unit
 * An enum is sized by its longest option, since the schema lists every value
 * it can hold: Drive Type (FWD, RWD, AWD) is short, Motor Type ("Switched
 * Reluctance") is not. Everything else keeps the default: figures their figure
 * width, identity text the text width. A bar needs the figure width to be
 * readable, so a count that has one is not narrowed.
 *
 * Width is about the VALUES, not the name: a name too long for its column
 * carries a shorter `tableLabel` (the schema's) rather than a wider column.
 * The one exception is `noted-figures` on the tested range columns,
 * whose names state their speed. utils/__tests__/headerFit.test.js holds
 * every name to two lines at its column's width.
 */
const SHORT_OPTION_CHARS = 7;

function holdsFor(field) {
    if (field.type === 'boolean') return 'short-values';
    if (field.type === 'integer' && !field.better) return 'short-values';
    if (field.type === 'enum' && field.options?.length
        && Math.max(...field.options.map(o => String(o).length)) <= SHORT_OPTION_CHARS) return 'short-values';
    if (field.type === 'text') return 'long-text';
    // A warranty's distance is 100,000 mi, and 160,934 km: six digits and a unit.
    if (field.type === 'integer' && field.unitGroup === 'distance') return 'long-figures';
    return null;
}

const SPEC_COLUMNS = SPEC_CATEGORIES.flatMap(cat => cat.fields.map(f => {
    // The field's unit in the imperial spelling the label would use, for
    // matching a parenthetical against it.
    const declared = f.unit ?? (f.unitGroup ? UNIT_LABELS[f.unitGroup]?.[0] : null);
    const label = withoutDeclaredUnit(f.label, declared);
    return {
        key: `${cat.key}.${f.key}`,
        // A header gets ~72px a line, two lines. A field whose name cannot fit
        // carries a shorter `tableLabel` in the schema; the full name stays in
        // the header's tooltip and everywhere else specs are shown.
        label: f.tableLabel ?? label,
        fullLabel: f.tableLabel ? label : null,
        // The unit is the schema's, stated there: `unit`, `unitGroup`, or
        // `unitless` for a count. Never read out of the label.
        unit: f.unitGroup ? null : f.unit ?? null,
        unitGroup: f.unitGroup ?? null,
        unitless: !!f.unitless,
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
 * @param {Function} [opts.sessionOf]  run → its test session, which supplies conditions a range test omits
 * @param {Object}   [opts.correctionTarget]  the site-wide correction target (correctionSettings.js)
 * @param {string}   [opts.correctionMode]  the reader's correction mode; 'none' shows the
 *        reported test's figures as measured. The composite corrects regardless.
 * @returns {Array<{ id, index, vehicle, values: Object, notes: Object, links: Object, tests: Object, flagged: Set }>}
 *          `notes` holds the basis or source shown beneath a figure; `tests`
 *          the test behind it, where one is (testDetails.js TestReference)
 */
export function buildVehicleRows(vehicles = [], { performance = null, assumptions = DEFAULT_ASSUMPTIONS, units = 'imperial', platformsById = null, sessionOf = () => null, correctionTarget = DEFAULT_CORRECTION_TARGET, correctionMode = DEFAULT_READER_MODE } = {}) {
    const calcContext = assumptionContext(assumptions, units, correctionTarget, correctionMode);
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
        // A platform a note names, so the note links to its page (#354).
        const links = {};
        // The test behind a figure, where one stands behind it (testDetails.js):
        // its note links to it, and hovering the cell restates it.
        const tests = {};

        for (const col of SPEC_COLUMNS) {
            const [category, field] = col.spec;
            values[col.key] = present(specs?.[category]?.[field]) ?? null;
            // A platform provides the value; it does not stand in for the
            // vehicle's own, so the cell says whose it is (#352).
            const platform = fromPlatform.get(col.key);
            if (values[col.key] != null && platform) {
                notes[col.key] = `from ${platform.name}`;
                links[col.key] = { platformId: platform.id };
            }
        }

        const { mechanical, electrical } = vehiclePlatforms(vehicle, platformsById);
        values['platform.mechanical'] = mechanical?.name ?? null;
        values['platform.electrical'] = electrical?.name ?? null;
        const voltageClass = resolveVoltageClass(electrical, specs?.charging?.battery_nominal_voltage_v);
        values['figures.voltageClass'] = voltageClass?.v ?? null;
        notes['figures.voltageClass'] = voltageClass
            ? (voltageClass.basis === 'platform' ? `from ${voltageClass.platform.name}` : `from ${Math.round(voltageClass.nominalV)} V nominal`)
            : null;
        if (voltageClass?.basis === 'platform') links['figures.voltageClass'] = { platformId: voltageClass.platform.id };
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

        const whenNew = whenNewRange(vehicle);
        const range = testedRangeSummary(vehicle);
        // Corrected to the site-wide target, as the composite is: a figure that
        // leans on one test's speed, altitude and weather is not comparable
        // until it is re-priced. The conditions it was TESTED at stay beneath it.
        // It follows the reader's mode, as every chart does: with correction
        // off these are the test's own figures. The composite does NOT follow
        // it — an uncorrected mean of tests at different conditions is the
        // comparison it exists to replace (compositeRange.js).
        const correct = (run) => run && calcContext.correctionMode !== 'none'
            ? correctionFactor(runConditions(run, sessionOf(run)), { mode: calcContext.correctionMode, target: calcContext.conditions }).factor
            : 1;
        const rangeFactor = correct(range?.run);
        const rangeRaw = range?.fullPackMi ?? (range?.isFullPack ? range.distanceMi : null);
        values['tested.range_mi'] = rangeRaw != null ? rangeRaw * rangeFactor : null;
        notes['tested.range_mi'] = range ? [rangeTestNote(range, units, {
            window: range.isScaled ? 'scaled from' : range.fullPackMi == null && !range.isFullPack ? 'only' : null,
        }), rangeRaw != null ? correctedNote(rangeFactor) : null].filter(Boolean).join(' · ') : null;
        tests['tested.range_mi'] = rangeTestReference(vehicle, range, units, 'range', whenNew);
        const efficiency = testedEfficiency(vehicle);
        const efficiencyFactor = correct(efficiency?.run);
        values['tested.efficiency_mi_kwh'] = efficiency ? efficiency.miPerKwh * efficiencyFactor : null;
        notes['tested.efficiency_mi_kwh'] = efficiency
            ? [rangeTestNote(efficiency, units, { window: efficiency.isRepresentative ? null : 'over' }),
                efficiency.estimated ? 'est. from SoC' : null, correctedNote(efficiencyFactor)].filter(Boolean).join(' · ')
            : null;
        tests['tested.efficiency_mi_kwh'] = rangeTestReference(vehicle, efficiency, units, 'efficiency');

        const composite = compositeRange(vehicle, { target: calcContext.conditions, sessionOf });
        values['tested.composite_range_mi'] = composite?.rangeMi ?? null;
        notes['tested.composite_range_mi'] = compositeNote(composite, 'range');
        values['tested.composite_efficiency_mi_kwh'] = composite?.miPerKwh ?? null;
        notes['tested.composite_efficiency_mi_kwh'] = compositeNote(composite, 'efficiency');
        const capacityNote = whenNew
            ? `${whenNew.impliedKwh.toFixed(1)} of ${whenNew.capacityKwh} kWh (${SOC_WINDOW_BASIS[whenNew.capacityBasis]?.label})`
            : null;
        values['tested.when_new_range_mi'] = whenNew ? whenNew.whenNewMi * correct(whenNew.run) : null;
        notes['tested.when_new_range_mi'] = whenNew
            ? [`at ${whenNew.capacityKwh} kWh (${SOC_WINDOW_BASIS[whenNew.capacityBasis]?.label})`, correctedNote(correct(whenNew.run))].filter(Boolean).join(' · ')
            : null;
        tests['tested.when_new_range_mi'] = whenNew ? rangeTestReference(vehicle, efficiency, units, 'when-new') : null;
        values['tested.capacity_retention'] = whenNew ? whenNew.retention * 100 : null;
        notes['tested.capacity_retention'] = capacityNote;
        tests['tested.capacity_retention'] = whenNew ? rangeTestReference(vehicle, efficiency, units, 'when-new') : null;

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
        const add = addTimeSession(vehicle, num(specs?.charging?.max_dc_kw), calcContext, {
            epaRange: num(values['figures.epaRangeMi']),
            compositeRange: num(values['tested.composite_range_mi']),
            testedRange: num(values['tested.range_mi']),
        });
        // No session reaches that far: the window's own, so the cell can say
        // "more than the test charged" rather than fall through to the spec.
        const addTested = add.tested.run ? add.tested : (charge.tested ?? { run: null });
        const addTest = addTested.run
            ? chargeTimeTestReference(vehicle, addTested, { from: calcContext.windowFrom, to: add.tested.run ? add.to : calcContext.windowTo }, units)
            : null;
        const extra = {
            chargeSummary: charge.summary,
            addSummary: addTested.run?.charge_summary ?? null,
            specMin: num(specs?.charging?.charge_time_10_to_80_pct_min),
            chargerEff: num(vehicle.epaRange?.chargerEfficiency),
        };
        for (const col of CALCULATED_COLUMNS) {
            const inputs = col.inputs.map(k => num(values[k]));
            const value = col.calc(inputs, calcContext, extra);
            values[col.key] = value == null || (typeof value === 'number' && !Number.isFinite(value)) ? null : value;
            // A note can explain a blank, too ("more than a 10→80% stop adds").
            // A charging figure worked from a test says "tested"; from the spec it
            // is like every other calculation and says nothing.
            const isAdd = col.key === 'calc.timeToAdd';
            const usedSummary = isAdd ? extra.addSummary : charge.summary;
            const fromTest = col.charging && usedSummary && values[col.key] != null;
            // A ratio over one tested figure says what that figure says beneath it.
            if (col.notesFrom) {
                notes[col.key] = values[col.key] != null ? notes[col.notesFrom] ?? null : null;
                tests[col.key] = values[col.key] != null ? tests[col.notesFrom] ?? null : null;
                continue;
            }
            notes[col.key] = col.note?.(inputs, calcContext, extra) ?? (fromTest ? 'tested' : null);
            // "Tested" links to the charging test the time came from — as does
            // a blank explained by that test's reach.
            tests[col.key] = col.charging && usedSummary && (fromTest || notes[col.key]) ? (isAdd ? addTest : chargeTest) : null;
        }

        // Community flags are stored as the spec's own `category.field` key,
        // which is exactly a spec column's key, so a flag lands on its cell
        // with no mapping. Only spec columns can carry one: figures and tested
        // results are worked out, not entered, and nobody flags them.
        const flagged = new Set((vehicle.flagged_specs ?? []).filter(k => BY_KEY.get(k)?.spec));

        return { id: vehicle.id, index, vehicle, values, notes, links, tests, flagged, whenNew };
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
        // A composite curve (#313) has no source or conditions of its own; the
        // note says what it is, so the figure never reads as one test's.
        if (isCompositeRun(tested.run)) {
            const n = tested.run.composite.tests?.length ?? 0;
            return { minutes: tested.minutes, note: `composite of ${n} test${n === 1 ? '' : 's'}`, summary: tested.run.charge_summary, tested };
        }
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
/** What a correction did to a figure, beneath it; nothing when it moved by under half a percent. */
const correctedNote = (factor) => (Math.abs(factor - 1) < 0.005 ? null
    : `${factor > 1 ? '+' : '−'}${Math.abs((factor - 1) * 100).toFixed(1)}% corrected`);

const speedText = (mph, units) => (units === 'metric' ? `${Math.round(mph * MI_TO_KM)} km/h` : `${Math.round(mph)} mph`);

/**
 * What sits beneath a composite figure: how many tests made it, and how many
 * of the vehicle's tests were left out. Blank, it says why — none could be
 * corrected, or (range only) none saw enough of the pack to scale.
 */
function compositeNote(composite, which) {
    if (!composite) return null;
    const n = which === 'range' ? composite.nRange : composite.nEfficiency;
    if (!n) {
        if (composite.tests.length) return 'no test wide enough to scale';
        return compositeLeftOutNote(composite);
    }
    const parts = [`composite of ${n} test${n === 1 ? '' : 's'}`];
    if (which === 'efficiency' && composite.nEstimated) parts.push(`${composite.nEstimated} est. from SoC`);
    if (composite.leftOut.length) parts.push(`${composite.leftOut.length} left out`);
    return parts.join(' · ');
}

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

/**
 * A numeric value in the unit the reader sees it in (`unitFor`): NaN where it
 * is not a number. The cell draws this and the spec chart plots it, so the two
 * cannot disagree about a conversion.
 */
export function displayNumber(col, raw, units = 'imperial') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return NaN;
    return col.metric && units === 'metric' ? n * col.metric[1]
        : col.unitGroup ? convValue(n, col.unitGroup, units) : n;
}

/** One cell's text. Absent is an em dash — a fact, not a zero. */
export function formatVehicleCell(row, col, units = 'imperial') {
    const raw = row?.values?.[col.key];
    if (raw == null || raw === '') return '—';
    if (col.type === 'boolean') return raw ? 'Yes' : 'No';
    if (col.numeric) {
        const shown = displayNumber(col, raw, units);
        if (!Number.isFinite(shown)) return String(raw);
        return shown.toLocaleString('en-US', { maximumFractionDigits: col.digits ?? 2 });
    }
    return String(raw);
}

// ── Filtering and sorting ───────────────────────────────────────────────────

// Filters are Vehicles & Specs' own since #338, shared with Cards and List:
// see vehicleFilters.js. The table sorts and draws what they leave.

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

/**
 * The assumptions as query parameters, only those that differ from the
 * defaults. Their own function because two views write them: the table, and the
 * spec chart, whose sidebar edits the same assumptions (#450).
 */
export function encodeAssumptionParams(assumptions = DEFAULT_ASSUMPTIONS) {
    const p = new URLSearchParams();
    const a = normalizeAssumptions(assumptions);
    if (a.addDistance !== DEFAULT_ASSUMPTIONS.addDistance) p.set('vt_add', String(a.addDistance));
    if (a.windowFrom !== DEFAULT_ASSUMPTIONS.windowFrom || a.windowTo !== DEFAULT_ASSUMPTIONS.windowTo) {
        p.set('vt_win', `${a.windowFrom}-${a.windowTo}`);
    }
    if (a.homePrice !== DEFAULT_ASSUMPTIONS.homePrice) p.set('vt_home', String(a.homePrice));
    if (a.fastPrice !== DEFAULT_ASSUMPTIONS.fastPrice) p.set('vt_fast', String(a.fastPrice));
    if (a.rangeBasis !== DEFAULT_ASSUMPTIONS.rangeBasis) p.set('vt_basis', a.rangeBasis);
    return p;
}

/**
 * Columns, sort and assumptions as query parameters — only what differs from
 * the defaults. Filters are not the table's (vehicleFilters.js, #338); the old
 * `vt_q` and facet parameters are still read there.
 *
 * A preset's own columns travel as `vt_preset=road-trips` rather than the list,
 * so a shared link reads as what it is. Its own sort is implied by it. Columns
 * changed from a preset travel as `vt_cols` WITH `vt_preset`, which then means
 * "modified from", so the reader of a link sees where the view started.
 */
export function encodeVehicleTableParams({ columns, sortKey, sortDir, modifiedFrom = null, assumptions = DEFAULT_ASSUMPTIONS }) {
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
    for (const [key, value] of encodeAssumptionParams(assumptions)) p.set(key, value);
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
    const rawSort = currentColumnKey(p.get('vt_sort'));
    const sortKey = BY_KEY.has(rawSort) ? rawSort : null;
    return {
        columns,
        sortKey: sortKey ?? implied.sortKey,
        sortDir: sortKey ? (p.get('vt_dir') === 'desc' ? 'desc' : 'asc') : implied.sortDir,
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
        rangeBasis: p.get('vt_basis'),
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
 * What it remembers is `view`: columns, sort, the preset they came from, and
 * the assumptions — a preference, kept across visits. Filters used to be
 * remembered here for the session too; since #338 they are Vehicles & Specs'
 * own, held by App for Cards, List and Table alike.
 *
 * A link that carries any table parameter wins outright. It is the sender's
 * view, and blending the reader's memory into it would show neither.
 */
export function vehicleTableStartSearch(urlSearch, { view = '' } = {}) {
    const url = new URLSearchParams(urlSearch ?? '');
    if ([...url.keys()].some(k => k.startsWith(VEHICLE_TABLE_PARAM_PREFIX))) return url.toString();
    return view;
}

/** The remembered string for a state; see vehicleTableStartSearch. */
export function vehicleTableMemory({ columns, sortKey, sortDir, modifiedFrom = null, assumptions = DEFAULT_ASSUMPTIONS }) {
    return { view: encodeVehicleTableParams({ columns, sortKey, sortDir, modifiedFrom, assumptions }).toString() };
}
