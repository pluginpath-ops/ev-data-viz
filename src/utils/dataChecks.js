/**
 * Data Checks — which vehicles disagree with their own sources (#321).
 *
 * The site holds several figures in two or three places: a hand-entered range
 * and an EPA label, the manufacturer's Usable and Gross beside the energy EPA
 * measured, a curb weight beside EPA's test weight. Nothing said when they
 * disagreed. `epaAudit` answers "which EPA records don't reconcile"; this
 * answers "which VEHICLES disagree with their sources", across the fleet at
 * once, so the size of each problem is visible before anything is restructured.
 *
 * ── Two kinds of finding ────────────────────────────────────────────────────
 *
 *   disagrees   two sources for one figure are further apart than a limit
 *   gap         something is missing that would let a figure be checked or
 *               resolved — a range with no EPA link, a battery figure that has
 *               not been sorted into Usable or Gross
 *
 * Deliberately not called flags: community members already flag suspect spec
 * values (`flagged_specs`), and that is a different act by different people.
 *
 * ── No primary configuration yet ────────────────────────────────────────────
 *
 * A vehicle can link to several EPA configurations and nothing says which one
 * represents it (#322). Until something does, a vehicle disagrees only when
 * NONE of its linked configurations agrees. Judging against any single one would
 * report every wheel-and-trim variant a vehicle legitimately spans. Where the
 * configurations themselves disagree, that is reported as its own finding.
 *
 * ── Limits are arguments, not imports ───────────────────────────────────────
 *
 * The constants resolve once at module load and need a reload to change (see
 * constants/overrides.js). The panel exists to try limits live, so every check
 * takes them as an argument; `LOADED_LIMITS` is only where the panel starts.
 *
 * Pure module: no data access, no React.
 */

import { resolveEffectiveSpecs, mergeInheritedSpecs, vehicleLabel } from './specHelpers';
import { preferredMctTest } from './epaRecordFromGroup';
import { labelRangeCheck } from './labelRangeCheck';
import { deriveTested } from './performanceDerivations';
import {
    LABEL_RANGE_TOLERANCE_PCT, LABEL_SPREAD_PCT,
    TESTED_CAPACITY_TOLERANCE_PCT, TESTED_SPREAD_PCT, PACK_BUFFER_PCT_BAND,
    TEST_WEIGHT_OFFSET_LBS_BAND, VOLTAGE_400_CLASS_BAND, VOLTAGE_800_CLASS_BAND,
    CLAIMED_060_GAP_SEC,
} from '../constants/epa';

/** The figures findings are grouped under, in display order. */
export const CHECK_FIGURES = [
    { key: 'range',       label: 'Range' },
    { key: 'capacity',    label: 'Battery capacity' },
    { key: 'weight',      label: 'Weight' },
    { key: 'drive',       label: 'Drive type' },
    { key: 'voltage',     label: 'Voltage' },
    { key: 'performance', label: 'Performance' },
];

/** Every per-vehicle check, with the kind of finding it produces. */
export const DATA_CHECKS = [
    { key: 'range-vs-label',     figure: 'range',       kind: 'disagrees', label: 'Range disagrees with every EPA label' },
    { key: 'label-spread',       figure: 'range',       kind: 'disagrees', label: 'EPA configurations disagree on range' },
    { key: 'label-no-range',     figure: 'range',       kind: 'gap',       label: 'EPA label, no range on the vehicle' },
    { key: 'range-no-label',     figure: 'range',       kind: 'gap',       label: 'Range with no EPA label' },
    { key: 'tested-vs-label',    figure: 'capacity',    kind: 'disagrees', label: 'EPA tested disagrees with Usable/Gross' },
    { key: 'tested-spread',      figure: 'capacity',    kind: 'disagrees', label: 'EPA tested differs across configurations' },
    { key: 'usable-over-gross',  figure: 'capacity',    kind: 'disagrees', label: 'Usable larger than Gross' },
    { key: 'buffer-outside',     figure: 'capacity',    kind: 'disagrees', label: 'Usable/Gross buffer outside its validity band' },
    { key: 'battery-unsorted',   figure: 'capacity',    kind: 'gap',       label: 'vehicles.battery is neither Usable nor Gross' },
    { key: 'test-weight-offset', figure: 'weight',      kind: 'disagrees', label: 'Curb weight does not fit EPA test weight' },
    { key: 'drive-vs-epa',       figure: 'drive',       kind: 'disagrees', label: 'Drive type disagrees with EPA' },
    { key: 'voltage-vs-epa',     figure: 'voltage',     kind: 'disagrees', label: 'Voltage does not fit EPA pack voltage' },
    { key: 'claimed-060-quicker', figure: 'performance', kind: 'disagrees', label: 'Claimed 0–60 quicker than tested' },
];

const CHECK_BY_KEY = Object.fromEntries(DATA_CHECKS.map(c => [c.key, c]));

/**
 * How EPA tested is compared with the manufacturer's labels.
 *
 * With a normal 3–10% buffer between Gross and Usable, EPA tested cannot sit
 * within 5% of both — so requiring it to (`each`) reports healthy packs whenever
 * the manufacturer's pack matches one label. `nearer` is the proposed default;
 * both are offered so the panel can show what each one catches.
 */
export const TESTED_RULES = [
    { key: 'nearer', label: 'Nearer label', blurb: 'EPA tested must sit within tolerance of Usable or Gross, whichever is closer.' },
    { key: 'each',   label: 'Each label',   blurb: 'EPA tested must sit within tolerance of every label the vehicle carries.' },
];

/** The limits, in the order the panel shows them. Each is a knob in constants/knobs.js. */
export const LIMIT_KEYS = [
    'LABEL_RANGE_TOLERANCE_PCT', 'LABEL_SPREAD_PCT',
    'TESTED_CAPACITY_TOLERANCE_PCT', 'TESTED_SPREAD_PCT', 'PACK_BUFFER_PCT_BAND',
    'TEST_WEIGHT_OFFSET_LBS_BAND', 'VOLTAGE_400_CLASS_BAND', 'VOLTAGE_800_CLASS_BAND',
    'CLAIMED_060_GAP_SEC',
];

/** The limits as this page load resolved them — local ∥ site ∥ default. */
export const LOADED_LIMITS = Object.freeze({
    LABEL_RANGE_TOLERANCE_PCT, LABEL_SPREAD_PCT,
    TESTED_CAPACITY_TOLERANCE_PCT, TESTED_SPREAD_PCT, PACK_BUFFER_PCT_BAND,
    TEST_WEIGHT_OFFSET_LBS_BAND, VOLTAGE_400_CLASS_BAND, VOLTAGE_800_CLASS_BAND,
    CLAIMED_060_GAP_SEC,
});

// ── Small helpers ───────────────────────────────────────────────────────────

// Absent stays absent: Number(null) is 0, and a 0 kWh pack is a finding the
// data never made. Same rule, and same reason, as epaIntegrity.
const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const positive = (v) => {
    const n = num(v);
    return n > 0 ? n : null;
};

/** How far `value` sits from `base`, as a percentage of `base`. */
const pctFrom = (value, base) => (Math.abs(value - base) / base) * 100;
const spreadPct = (values) => ((Math.max(...values) - Math.min(...values)) / Math.min(...values)) * 100;
const inside = (v, [lo, hi]) => v >= lo && v <= hi;

const oneDp = (v) => Math.round(v * 10) / 10;
const kwh = (v) => `${oneDp(v)} kWh`;
const mi  = (v) => `${Math.round(v)} mi`;
/** A span of values with the unit said once: "252–293 mi", not "252 mi–293 mi". */
const miSpan  = (values) => `${Math.round(Math.min(...values))}–${Math.round(Math.max(...values))} mi`;
const kwhSpan = (values) => `${oneDp(Math.min(...values))}–${oneDp(Math.max(...values))} kWh`;
const lb  = (v) => `${Math.round(v).toLocaleString('en-US')} lb`;
const pct = (v) => `${v.toFixed(1)}%`;

const finding = (check, text) => ({
    check, text, figure: CHECK_BY_KEY[check].figure, kind: CHECK_BY_KEY[check].kind,
});

/** EPA's drive description in the spec schema's vocabulary, or null when blank or unreadable. */
function epaDriveType(drive) {
    const s = String(drive ?? '').toLowerCase();
    if (!s.trim()) return null;
    if (/all.?wheel|4.?wheel|four.?wheel/.test(s)) return 'AWD';
    if (/front/.test(s)) return 'FWD';
    if (/rear/.test(s)) return 'RWD';
    return null;
}

/**
 * Each linked EPA configuration, reduced to the figures the checks compare.
 *
 * EPA tested is read from the same test the derivations use — the preferred
 * multi-cycle test, else the most recent — so a finding here never describes a
 * different run from the one the curator card shows.
 */
function linkedConfigurations(vehicle) {
    return (vehicle?.epa_mappings ?? [])
        .map(m => m.epaGroup)
        .filter(Boolean)
        .map(g => {
            const test = preferredMctTest(g.epa_tests ?? [], g.preferred_test_number);
            const sets = g.epa_coefficient_sets ?? [];
            const coeff = sets.find(c => c.is_primary) ?? sets[0] ?? null;
            return {
                id: g.test_group_id,
                name: g.display_name
                    || [g.model_year, g.make, g.epa_carline_name].filter(Boolean).join(' ')
                    || g.test_group_id,
                labelRangeMi:  positive(g.label_range_published),
                testedKwh:     positive(test?.total_dc_energy_kwh),
                testWeightLbs: positive(coeff?.equiv_test_weight_lbs),
                driveType:     epaDriveType(g.drive),
                packVoltage:   positive(g.total_voltage),
            };
        });
}

/**
 * The specs a check reads, through inheritance, and which of them were inherited.
 *
 * A finding against an inherited figure says so: a trim borrowing its parent's
 * Usable figure and disagreeing with its own EPA tested is a different fix from
 * a mistyped value on the vehicle itself.
 */
function specContext(vehicle, vehicles) {
    const parent = vehicle.spec_source_vehicle_id
        ? vehicles.find(v => v.id === vehicle.spec_source_vehicle_id)
        : null;
    if (!parent) return { specs: vehicle.specs ?? {}, inherited: new Set(), parentName: null };
    const { merged, inheritedKeys } = mergeInheritedSpecs(vehicle.specs, resolveEffectiveSpecs(parent, vehicles));
    return { specs: merged, inherited: inheritedKeys, parentName: vehicleLabel(parent) };
}

const specValue = (ctx, category, field) => ctx.specs?.[category]?.[field] ?? null;
const inheritedNote = (ctx, category, field) =>
    ctx.inherited.has(`${category}.${field}`) ? ` (inherited from ${ctx.parentName})` : '';

// ── The checks ──────────────────────────────────────────────────────────────

function rangeFindings(vehicle, configs, limits) {
    const out = [];
    const range = positive(vehicle.range);
    const labelled = configs.filter(c => c.labelRangeMi);
    const labels = labelled.map(c => c.labelRangeMi);

    if (labelled.length > 1) {
        const spread = spreadPct(labels);
        if (spread > limits.LABEL_SPREAD_PCT) {
            out.push(finding('label-spread',
                `${labelled.length} linked EPA configurations read ${miSpan(labels)}, `
                + `${pct(spread)} apart, and none is chosen to represent the vehicle.`));
        }
    }

    if (range && labelled.length) {
        const checks = labelled.map(c => ({ c, check: labelRangeCheck(c.labelRangeMi, range, limits.LABEL_RANGE_TOLERANCE_PCT) }));
        if (checks.every(x => x.check.mismatch)) {
            const { c, check } = checks.reduce((a, b) => (Math.abs(b.check.deltaPct) < Math.abs(a.check.deltaPct) ? b : a));
            const dir = check.deltaMi > 0 ? 'below' : 'above';
            out.push(finding('range-vs-label',
                `Range ${mi(range)} is ${pct(Math.abs(check.deltaPct))} ${dir} the nearest EPA label, ${mi(c.labelRangeMi)} on ${c.name}`
                + (labelled.length > 1 ? `; none of the ${labelled.length} labels is within ${limits.LABEL_RANGE_TOLERANCE_PCT}%.` : '.')));
        }
    }

    if (labelled.length && !range) {
        out.push(finding('label-no-range', labelled.length === 1
            ? `No range on the vehicle; its EPA label reads ${mi(labels[0])}.`
            : `No range on the vehicle; its ${labelled.length} EPA labels read ${miSpan(labels)}.`));
    }

    if (range && !labelled.length) {
        out.push(finding('range-no-label', configs.length
            ? `Range ${mi(range)}, but none of its ${configs.length} linked EPA configuration${configs.length === 1 ? '' : 's'} has a label.`
            : `Range ${mi(range)}, but no EPA configuration is linked.`));
    }

    return out;
}

/**
 * Does EPA tested agree with the manufacturer's labels, under a rule?
 *
 * @param {number} testedKwh
 * @param {Array<{name, kwh}>} labels  Usable and/or Gross, whichever exist
 * @returns {{ ok: boolean, nearest: {name, kwh, pct} }}
 */
function testedAgreement(testedKwh, labels, tolerancePct, rule) {
    const offsets = labels.map(l => ({ ...l, pct: pctFrom(testedKwh, l.kwh) }));
    const nearest = offsets.reduce((a, b) => (b.pct < a.pct ? b : a));
    const ok = rule === 'each'
        ? offsets.every(o => o.pct <= tolerancePct)
        : nearest.pct <= tolerancePct;
    return { ok, nearest, offsets };
}

function capacityFindings(vehicle, configs, ctx, limits, testedRule) {
    const out = [];
    const usable = positive(specValue(ctx, 'charging', 'battery_usable_kwh'));
    const gross  = positive(specValue(ctx, 'powertrain', 'battery_gross_kwh'));
    const usableText = usable && `Usable ${kwh(usable)}${inheritedNote(ctx, 'charging', 'battery_usable_kwh')}`;
    const grossText  = gross  && `Gross ${kwh(gross)}${inheritedNote(ctx, 'powertrain', 'battery_gross_kwh')}`;

    if (usable && gross) {
        if (usable > gross) {
            out.push(finding('usable-over-gross', `${usableText} is larger than ${grossText}.`));
        } else {
            // Only when the two are in the right order — a negative buffer is
            // already reported above, and saying it twice doubles its weight.
            const buffer = ((gross - usable) / gross) * 100;
            const [lo, hi] = limits.PACK_BUFFER_PCT_BAND;
            if (!inside(buffer, limits.PACK_BUFFER_PCT_BAND)) {
                out.push(finding('buffer-outside',
                    `${grossText} holds back ${pct(buffer)} from ${usableText}, outside ${lo}–${hi}%`
                    + (buffer === 0 ? ' — often one figure entered twice.' : '.')));
            }
        }
    }

    const tested = configs.filter(c => c.testedKwh);
    if (tested.length > 1) {
        const values = tested.map(c => c.testedKwh);
        const spread = spreadPct(values);
        if (spread > limits.TESTED_SPREAD_PCT) {
            out.push(finding('tested-spread',
                `EPA tested reads ${kwhSpan(values)} across ${tested.length} linked `
                + `configurations, ${pct(spread)} apart — more than one pack on one vehicle, or a wrong link.`));
        }
    }

    const labels = [usable && { name: 'Usable', kwh: usable }, gross && { name: 'Gross', kwh: gross }].filter(Boolean);
    if (tested.length && labels.length) {
        const verdicts = tested.map(c => ({ c, ...testedAgreement(c.testedKwh, labels, limits.TESTED_CAPACITY_TOLERANCE_PCT, testedRule) }));
        if (!verdicts.some(v => v.ok)) {
            // Name the closest case, so the curator starts from the least-bad link.
            const best = verdicts.reduce((a, b) => (b.nearest.pct < a.nearest.pct ? b : a));
            const against = best.offsets.map(o => `${pct(o.pct)} from ${o.name} ${kwh(o.kwh)}`).join(', ');
            out.push(finding('tested-vs-label',
                `EPA tested ${kwh(best.c.testedKwh)} on ${best.c.name} is ${against}`
                + (testedRule === 'each' ? ` — not within ${limits.TESTED_CAPACITY_TOLERANCE_PCT}% of every label.` : ` — neither is within ${limits.TESTED_CAPACITY_TOLERANCE_PCT}%.`)
                + (ctx.inherited.size && (inheritedNote(ctx, 'charging', 'battery_usable_kwh') || inheritedNote(ctx, 'powertrain', 'battery_gross_kwh'))
                    ? ` The label is inherited from ${ctx.parentName}.` : '')));
        }
    }

    const battery = positive(vehicle.battery);
    if (battery) {
        // Stored figures are typed by hand to one decimal; anything closer than
        // that is the same number.
        const matches = labels.filter(l => Math.abs(l.kwh - battery) < 0.05);
        if (!matches.length) {
            out.push(finding('battery-unsorted', labels.length
                ? `vehicles.battery ${kwh(battery)} matches neither ${[usableText, grossText].filter(Boolean).join(' nor ')}.`
                : `vehicles.battery ${kwh(battery)} has no Usable or Gross figure to be sorted into.`));
        }
    }

    return out;
}

function weightFindings(configs, ctx, limits) {
    const curb = positive(specValue(ctx, 'performance', 'weight_lbs'));
    const weighed = configs.filter(c => c.testWeightLbs);
    if (!curb || !weighed.length) return [];

    const band = limits.TEST_WEIGHT_OFFSET_LBS_BAND;
    const offsets = weighed.map(c => ({ c, off: c.testWeightLbs - curb }));
    if (offsets.some(o => inside(o.off, band))) return [];

    const distance = (o) => Math.abs(o.off - Math.min(Math.max(o.off, band[0]), band[1]));
    const { c, off } = offsets.reduce((a, b) => (distance(b) < distance(a) ? b : a));
    const where = off >= 0 ? `${lb(off)} above` : `${lb(-off)} below`;
    return [finding('test-weight-offset',
        `EPA test weight ${lb(c.testWeightLbs)} on ${c.name} sits ${where} curb weight ${lb(curb)}`
        + `${inheritedNote(ctx, 'performance', 'weight_lbs')}; expected ${band[0]}–${band[1]} lb above `
        + '(curb + 300 lb, rounded to an inertia class).')];
}

function driveFindings(configs, ctx) {
    const spec = specValue(ctx, 'powertrain', 'drive_type');
    // A blank EPA drive is not a disagreement — it is blank on many linked groups.
    const epa = [...new Set(configs.map(c => c.driveType).filter(Boolean))];
    if (!spec || !epa.length || epa.includes(spec)) return [];
    return [finding('drive-vs-epa',
        `Drive type is ${spec}${inheritedNote(ctx, 'powertrain', 'drive_type')}; EPA lists ${epa.join(' / ')}.`)];
}

/**
 * Spec voltage and EPA pack voltage are different quantities: the spec field
 * holds the 400 / 800 V class people compare for charging, EPA holds the pack's
 * nominal voltage. So this is a plausibility check — does EPA's figure fall in
 * the class the spec names — never an equality test.
 */
function voltageFindings(configs, ctx, limits) {
    const spec = positive(specValue(ctx, 'charging', 'battery_nominal_voltage_v'));
    const packs = configs.map(c => c.packVoltage).filter(Boolean);
    if (!spec || !packs.length) return [];

    const classes = [
        { name: '400 V', band: limits.VOLTAGE_400_CLASS_BAND },
        { name: '800 V', band: limits.VOLTAGE_800_CLASS_BAND },
    ];
    // A spec value outside both classes names no class, so there is nothing to test.
    const cls = classes.find(k => inside(spec, k.band));
    if (!cls || packs.some(v => inside(v, cls.band))) return [];

    return [finding('voltage-vs-epa',
        `Voltage ${spec} V${inheritedNote(ctx, 'charging', 'battery_nominal_voltage_v')} reads as the ${cls.name} class `
        + `(${cls.band[0]}–${cls.band[1]} V), but EPA's pack voltage is ${[...new Set(packs)].join(' / ')} V.`)];
}

/**
 * A manufacturer's claim quicker than anyone measured.
 *
 * Claims carry no rollout convention, so the claim is held against the QUICKER
 * of the two tested figures — the lenient comparison. A claim slower than
 * tested is not listed: conservative marketing is not a data problem.
 */
function performanceFindings(ctx, perf, limits) {
    const claimed = positive(specValue(ctx, 'performance', 'zero_to_60_mph_sec'));
    if (!claimed || !perf) return [];

    const tested = ['zero_to_60_rollout_sec', 'zero_to_60_sec']
        .map(field => deriveTested(perf.sessions, perf.summaries, field))
        .filter(r => r.value != null);
    if (!tested.length) return [];

    const best = tested.reduce((a, b) => (b.value < a.value ? b : a));
    if (claimed >= best.value - limits.CLAIMED_060_GAP_SEC) return [];
    return [finding('claimed-060-quicker',
        `Claimed 0–60 ${claimed} s${inheritedNote(ctx, 'performance', 'zero_to_60_mph_sec')} is `
        + `${(best.value - claimed).toFixed(1)} s quicker than the quickest tested result, ${best.value} s`
        + (best.basis?.sourceName ? ` (${best.basis.sourceName}).` : '.'))];
}

// ── The fleet ───────────────────────────────────────────────────────────────

/**
 * Performance results keyed by vehicle, from the two flat fetches the panel makes.
 * They are not on the vehicle object; see the note in DataService.getVehicles.
 */
export function groupPerformanceByVehicle(summaries = [], sessions = []) {
    const out = {};
    const slot = (id) => (out[id] ??= { summaries: [], sessions: [] });
    for (const s of summaries) slot(s.vehicle_id).summaries.push(s);
    for (const s of sessions) slot(s.vehicle_id).sessions.push(s);
    return out;
}

/**
 * Run every check on every vehicle.
 *
 * @param {Array}  vehicles     the app's vehicle objects (getVehicles shape)
 * @param {Object} opts
 * @param {Object} [opts.limits]       keyed as LIMIT_KEYS; defaults to LOADED_LIMITS
 * @param {'nearer'|'each'} [opts.testedRule]
 * @param {Object|null} [opts.performance]  groupPerformanceByVehicle output, or
 *                                          null while it loads — performance
 *                                          checks are then skipped, not failed
 * @returns {Array<{ vehicle, findings, disagrees: number, gaps: number }>}
 *          worst first
 */
export function runDataChecks(vehicles = [], { limits = LOADED_LIMITS, testedRule = 'nearer', performance = null } = {}) {
    return vehicles
        .map(vehicle => {
            const configs = linkedConfigurations(vehicle);
            const ctx = specContext(vehicle, vehicles);
            const perf = performance ? (performance[vehicle.id] ?? { summaries: [], sessions: [] }) : null;
            const findings = [
                ...rangeFindings(vehicle, configs, limits),
                ...capacityFindings(vehicle, configs, ctx, limits, testedRule),
                ...weightFindings(configs, ctx, limits),
                ...driveFindings(configs, ctx),
                ...voltageFindings(configs, ctx, limits),
                ...performanceFindings(ctx, perf, limits),
            ];
            return {
                vehicle,
                findings,
                disagrees: findings.filter(f => f.kind === 'disagrees').length,
                gaps:      findings.filter(f => f.kind === 'gap').length,
            };
        })
        .sort((a, b) => b.disagrees - a.disagrees || b.gaps - a.gaps
            || vehicleLabel(a.vehicle).localeCompare(vehicleLabel(b.vehicle)));
}

/** How many vehicles each check reports. Every check key is present, zero included. */
export function checkCounts(rows = []) {
    const counts = Object.fromEntries(DATA_CHECKS.map(c => [c.key, 0]));
    for (const row of rows) {
        for (const key of new Set(row.findings.map(f => f.check))) counts[key] += 1;
    }
    return counts;
}

// ── Across the fleet: one source, several spellings ─────────────────────────

const STOP_WORDS = new Set(['and', 'the', 'of']);
const letters = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const initials = (name, dropStopWords) => name
    .split(/[\s&]+/)
    .filter(Boolean)
    .filter(w => !dropStopWords || !STOP_WORDS.has(w.toLowerCase()))
    .map(w => w[0].toLowerCase())
    .join('');

/** Same source under two spellings: punctuation and case, or an abbreviation of the words. */
function sameSource(a, b) {
    if (letters(a) === letters(b)) return true;
    const [short, long] = letters(a).length <= letters(b).length ? [a, b] : [b, a];
    const abbrev = letters(short);
    if (abbrev.length < 2 || long.trim().split(/\s+/).length < 2) return false;
    // "C&D" is Car and Driver without the "and"; "OoS" is Out of Spec with the "of".
    return abbrev === initials(long, true) || abbrev === initials(long, false);
}

/**
 * Source names on published results that look like one source spelled more than
 * one way — "Car and Driver" and "C&D" split one publication's results in two.
 *
 * @returns {Array<Array<{ name, count }>>} one group per source, most-used spelling first
 */
export function sourceNameVariants(summaries = []) {
    const counts = new Map();
    for (const row of summaries) {
        const name = row.source_name?.trim();
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const groups = [];
    for (const name of counts.keys()) {
        const home = groups.find(g => g.some(n => sameSource(n, name)));
        if (home) home.push(name);
        else groups.push([name]);
    }
    return groups
        .filter(g => g.length > 1)
        .map(g => g.map(name => ({ name, count: counts.get(name) })).sort((a, b) => b.count - a.count));
}
