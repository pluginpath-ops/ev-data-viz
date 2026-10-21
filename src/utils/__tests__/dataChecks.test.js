import { describe, it, expect } from 'vitest';
import {
    runDataChecks, checkCounts, sourceNameVariants, testAttribution, ATTRIBUTION_FINDINGS, groupPerformanceByVehicle, overlaySkips, skipKey, keepOrder,
    DATA_CHECKS, LIMIT_KEYS, LOADED_LIMITS,
} from '../dataChecks';

// The proposed defaults, fixed here so a knob moved in the Admin panel cannot
// change what these tests mean.
const LIMITS = {
    LABEL_RANGE_TOLERANCE_PCT: 5,
    LABEL_SPREAD_PCT: 5,
    TESTED_CAPACITY_TOLERANCE_PCT: 5,
    TESTED_SPREAD_PCT: 5,
    PACK_BUFFER_PCT_BAND: [3, 10],
    TEST_WEIGHT_OFFSET_LBS_BAND: [0, 600],
    VOLTAGE_400_CLASS_BAND: [300, 500],
    VOLTAGE_800_CLASS_BAND: [550, 1000],
    CLAIMED_060_GAP_SEC: 0.5,
};

let nextId = 1;
const group = (over = {}) => ({
    test_vehicle_id: `G${nextId++}`, model_year: 2026, make: 'Make', epa_carline_name: 'Carline',
    label_range_published: null, drive: null, total_voltage: null, preferred_test_number: null,
    epa_tests: [], epa_coefficient_sets: [], ...over,
});
const mct = (kwhValue, over = {}) => ({
    procedure_code: 77, total_dc_energy_kwh: kwhValue, test_number: `T${nextId++}`, test_date: '2026-01-01', ...over,
});
const vehicle = (over = {}, groups = []) => ({
    id: nextId++, name: 'Test vehicle', specs: {}, runs: [],
    epa_mappings: groups.map(g => ({ id: nextId++, confidence: 'verified', notes: null, epaTestVehicle: g })),
    ...over,
});

/** The findings for `v`, run as part of a fleet that also holds `others`. */
function findingsFor(v, { others = [], ...opts } = {}) {
    const rows = runDataChecks([v, ...others], { limits: LIMITS, ...opts });
    return rows.find(r => r.vehicle === v).findings;
}
const checksFor = (v, opts) => findingsFor(v, opts).map(f => f.check);

describe('the registry', () => {
    it('gives every check a figure and a kind', () => {
        for (const c of DATA_CHECKS) {
            expect(['disagrees', 'gap']).toContain(c.kind);
            expect(c.figure).toBeTruthy();
        }
    });

    it('starts the panel from a value for every limit', () => {
        for (const key of LIMIT_KEYS) expect(LOADED_LIMITS[key], key).not.toBeUndefined();
    });

    it('reports nothing for a vehicle with nothing to compare', () => {
        expect(findingsFor(vehicle())).toEqual([]);
    });
});

describe('range', () => {
    it('agrees within tolerance of a label', () => {
        // R2 Performance: 329 against a 330 label.
        const v = vehicle({ range: 329 }, [group({ label_range_published: 330 })]);
        expect(checksFor(v)).toEqual([]);
    });

    it('disagrees when no label is within tolerance', () => {
        // Model Y LR: 337 against its only label, 311.
        const v = vehicle({ range: 337 }, [group({ label_range_published: 311 })]);
        const [f] = findingsFor(v);
        expect(f.check).toBe('range-vs-label');
        expect(f.kind).toBe('disagrees');
        expect(f.text).toMatch(/311 mi/);
    });

    it('agrees when ANY linked configuration agrees — there is no primary yet', () => {
        // Mach E: 300 against labels of 240 and 300. The 240 is another pack,
        // not a disagreement, until a primary configuration says otherwise.
        const v = vehicle({ range: 300 }, [group({ label_range_published: 240 }), group({ label_range_published: 300 })]);
        expect(checksFor(v)).not.toContain('range-vs-label');
    });

    it('reports configurations that disagree with each other', () => {
        const v = vehicle({ range: 380 }, [group({ label_range_published: 303 }), group({ label_range_published: 363 })]);
        expect(checksFor(v)).toContain('label-spread');
    });

    it('reports a typed range with no label, but not a label with no typed range', () => {
        // Since #324 the label IS the vehicle's range: nothing typed beside it is
        // where every vehicle is headed.
        expect(checksFor(vehicle({}, [group({ label_range_published: 330 })]))).toEqual([]);
        expect(checksFor(vehicle({ range: 100 }))).toEqual(['range-no-label']);
        expect(findingsFor(vehicle({ range: 100 }, [group()]))[0].text).toMatch(/none of its 1 linked/);
    });
});

describe('battery capacity', () => {
    const specs = (usable, gross) => ({
        charging:   { battery_usable_kwh: usable },
        powertrain: { battery_gross_kwh: gross },
    });

    it('matches the nearer label, and the rule decides what a buffer does', () => {
        // Taycan: EPA tested 99.7 is 1.7% from Usable 98 and 5.1% from Gross 105.
        // A healthy pack under the nearer rule; a disagreement if every label must agree.
        const v = vehicle({ specs: specs(98, 105) }, [group({ epa_tests: [mct(99.7)] })]);
        expect(checksFor(v, { testedRule: 'nearer' })).not.toContain('tested-vs-label');
        expect(checksFor(v, { testedRule: 'each' })).toContain('tested-vs-label');
    });

    it('disagrees under both rules when neither label is close', () => {
        // Gravity Grand Touring: EPA tested 89.5 against Usable 118 / Gross 123.
        const v = vehicle({ specs: specs(118, 123) }, [group({ epa_tests: [mct(89.5)] })]);
        for (const testedRule of ['nearer', 'each']) {
            expect(checksFor(v, { testedRule })).toContain('tested-vs-label');
        }
    });

    it('reads EPA tested from the preferred test, not simply the latest', () => {
        const older = mct(88, { test_number: 'OLD', test_date: '2025-07-22' });
        const newer = mct(120, { test_number: 'NEW', test_date: '2025-08-19' });
        const v = vehicle({ specs: specs(85, 90) },
            [group({ epa_tests: [older, newer], preferred_test_number: 'OLD' })]);
        expect(checksFor(v)).not.toContain('tested-vs-label');
    });

    it('reports EPA tested that differs across configurations', () => {
        const v = vehicle({}, [group({ epa_tests: [mct(89.451)] }), group({ epa_tests: [mct(124.227)] })]);
        expect(checksFor(v)).toContain('tested-spread');
    });

    it('reports Usable over Gross once, not also as a buffer', () => {
        // Model Y Premium RWD: Usable 82, Gross 78.4.
        expect(checksFor(vehicle({ specs: specs(82, 78.4) }))).toEqual(['usable-over-gross']);
    });

    it('holds the buffer inside its validity band', () => {
        expect(checksFor(vehicle({ specs: specs(78, 84) }))).toEqual([]);          // IONIQ5, 7.1%
        const same = findingsFor(vehicle({ specs: specs(87.9, 87.9) }));           // R2, 0%
        expect(same.map(f => f.check)).toEqual(['buffer-outside']);
        expect(same[0].text).toMatch(/entered twice/);
    });

    it('lists a battery figure that is neither Usable nor Gross', () => {
        expect(checksFor(vehicle({ battery: 78, specs: specs(78, 84) }))).toEqual([]);
        expect(checksFor(vehicle({ battery: 63, specs: specs(50, 53) }))).toContain('battery-unsorted');
        expect(findingsFor(vehicle({ battery: 69 }))[0].text).toMatch(/no Usable or Gross/);
    });

    it('says when the label it judged was inherited', () => {
        const parent = vehicle({ name: 'Parent', specs: specs(118, 123) });
        const child = vehicle({ spec_source_vehicle_id: parent.id }, [group({ epa_tests: [mct(89.5)] })]);
        const f = findingsFor(child, { others: [parent] }).find(x => x.check === 'tested-vs-label');
        expect(f.text).toMatch(/inherited from Parent/);
    });
});

describe('weight', () => {
    const weighed = (curb, etw) => vehicle(
        { specs: { performance: { weight_lbs: curb } } },
        [group({ epa_coefficient_sets: [{ is_primary: true, equiv_test_weight_lbs: etw }] })]);

    it('expects EPA test weight a few hundred pounds above curb', () => {
        expect(checksFor(weighed(4363, 4750))).toEqual([]);   // Model Y LR, +387
    });

    it('disagrees when the gap is far outside that', () => {
        const [f] = findingsFor(weighed(3913, 5250));          // Equinox LS, +1,337
        expect(f.check).toBe('test-weight-offset');
        expect(f.text).toMatch(/1,337 lb above/);
    });
});

describe('drive type', () => {
    const driven = (spec, ...epa) => vehicle(
        { specs: { powertrain: { drive_type: spec } } },
        epa.map(drive => group({ drive })));

    it('treats a blank EPA drive as nothing to compare', () => {
        expect(checksFor(driven('AWD', null))).toEqual([]);
    });

    it("reads EPA's wording", () => {
        expect(checksFor(driven('RWD', '2-Wheel Drive, Rear'))).toEqual([]);
        expect(checksFor(driven('AWD', 'Part-time 4-Wheel Drive'))).toEqual([]);
        expect(checksFor(driven('FWD', 'All Wheel Drive'))).toEqual(['drive-vs-epa']);
    });
});

describe('voltage', () => {
    const volts = (spec, pack) => vehicle(
        { specs: { charging: { battery_nominal_voltage_v: spec } } },
        [group({ total_voltage: pack })]);

    it('checks the class, not equality — they are different quantities', () => {
        // Only this check: a 400 V car with no 400 V support is also a gap (#352).
        const epa = (v) => checksFor(v).filter(c => c === 'voltage-vs-epa');
        expect(epa(volts(400, 335))).toEqual([]);
        expect(epa(volts(800, 765))).toEqual([]);
        expect(epa(volts(400, 628))).toEqual(['voltage-vs-epa']);
    });

    it('skips a spec value that names no class', () => {
        expect(checksFor(volts(520, 900))).toEqual([]);
    });
});

describe('performance', () => {
    const claimed = (sec) => vehicle({ specs: { performance: { zero_to_60_mph_sec: sec } } });
    const withResult = (v, row) => ({
        performance: groupPerformanceByVehicle([{ vehicle_id: v.id, source_name: 'Car and Driver', ...row }], []),
    });

    it('lists a claim well quicker than the quickest tested result', () => {
        // CLA 350: claimed 4.8, Car and Driver 5.8 with rollout.
        const v = claimed(4.8);
        const [f] = findingsFor(v, withResult(v, { zero_to_60_rollout_sec: 5.8 }));
        expect(f.check).toBe('claimed-060-quicker');
        expect(f.text).toMatch(/Car and Driver/);
    });

    it('holds a claim against the quicker of the two conventions', () => {
        // R2 Performance: claimed 3.4, tested 3.8 standing and 3.5 with rollout.
        const v = claimed(3.4);
        expect(checksFor(v, withResult(v, { zero_to_60_sec: 3.8, zero_to_60_rollout_sec: 3.5 }))).toEqual([]);
    });

    it('skips performance while its data is still loading', () => {
        expect(checksFor(claimed(1.0), { performance: null })).toEqual([]);
    });
});

describe('the fleet', () => {
    it('sorts the worst first, and counts vehicles per check', () => {
        const clean = vehicle({ name: 'Clean' });
        const bad = vehicle({ name: 'Bad', range: 337 }, [group({ label_range_published: 311 })]);
        const rows = runDataChecks([clean, bad], { limits: LIMITS });
        expect(rows[0].vehicle).toBe(bad);
        const counts = checkCounts(rows);
        expect(counts['range-vs-label']).toBe(1);
        expect(counts['drive-vs-epa']).toBe(0);
    });
});

describe('source name variants', () => {
    it('groups an abbreviation with the words it stands for', () => {
        const rows = [
            ...Array(10).fill({ source_name: 'Car and Driver' }),
            { source_name: 'C&D' },
            { source_name: 'OoS' },
            { source_name: 'Out of Spec' },
            { source_name: 'MotorTrend' },
        ];
        const groups = sourceNameVariants(rows);
        expect(groups).toHaveLength(2);
        expect(groups[0]).toEqual([{ name: 'Car and Driver', count: 10 }, { name: 'C&D', count: 1 }]);
        expect(groups[1].map(n => n.name).sort()).toEqual(['OoS', 'Out of Spec']);
    });

    it('does not group unrelated short names', () => {
        expect(sourceNameVariants([{ source_name: 'EVBench' }, { source_name: 'Edmunds' }])).toEqual([]);
    });
});

describe('skips', () => {
    // Model Y LR again: 337 against a 311 label.
    const disagreeing = () => vehicle({ range: 337 }, [group({ label_range_published: 311 })]);
    const skipOf = (v, f) => ({ vehicle_id: v.id, check_key: f.check, fingerprint: f.fingerprint, note: 'correct as is' });
    const rangeFinding = (row) => row.findings.find(f => f.check === 'range-vs-label');

    it('keeps a skipped finding on the row but out of every count', () => {
        const v = disagreeing();
        const [f] = findingsFor(v);
        const rows = runDataChecks([v], { limits: LIMITS, skips: [skipOf(v, f)] });
        expect(rangeFinding(rows[0]).skipped).toBe(true);
        expect(rows[0].disagrees).toBe(0);
        expect(rows[0].skipped).toBe(1);
        expect(checkCounts(rows)['range-vs-label']).toBe(0);
    });

    it('stays skipped when only a limit moves — the facts have not changed', () => {
        const v = disagreeing();
        const [f] = findingsFor(v);
        const tighter = { ...LIMITS, LABEL_RANGE_TOLERANCE_PCT: 2 };
        const [row] = runDataChecks([v], { limits: tighter, skips: [skipOf(v, f)] });
        expect(rangeFinding(row).skipped).toBe(true);
    });

    it('comes back, marked, when the values it was judged on change', () => {
        const v = disagreeing();
        const [f] = findingsFor(v);
        const edited = { ...v, range: 345 };
        const again = rangeFinding(runDataChecks([edited], { limits: LIMITS, skips: [skipOf(v, f)] })[0]);
        expect(again.skipped).toBe(false);
        expect(again.resurfaced).toBe(true);
        expect(again.skip.note).toBe('correct as is');
    });

    it('fingerprints the same values the same way whatever order the links arrive in', () => {
        const a = vehicle({ range: 400 }, [group({ label_range_published: 311 }), group({ label_range_published: 330 })]);
        const b = { ...a, epa_mappings: [...a.epa_mappings].reverse() };
        const fa = rangeFinding(runDataChecks([a], { limits: LIMITS })[0]);
        const fb = rangeFinding(runDataChecks([b], { limits: LIMITS })[0]);
        expect(fb.fingerprint).toBe(fa.fingerprint);
    });

    it('never puts a limit or the rule in the evidence', () => {
        const v = vehicle({ specs: { charging: { battery_usable_kwh: 98 }, powertrain: { battery_gross_kwh: 105 } } },
            [group({ epa_tests: [mct(99.7)] })]);
        const each = findingsFor(v, { testedRule: 'each' }).find(f => f.check === 'tested-vs-label');
        expect(Object.keys(each.evidence).sort()).toEqual(['gross', 'tested', 'usable']);
    });

    it('applies a skip only to its own vehicle and check', () => {
        const v = disagreeing();
        const w = disagreeing();
        const [f] = findingsFor(v);
        const rows = runDataChecks([v, w], { limits: LIMITS, skips: [skipOf(v, f)] });
        expect(rangeFinding(rows.find(r => r.vehicle === w)).skipped).toBe(false);
    });
});

describe('skips applied before the write returns', () => {
    const row = (vehicle_id, check_key, fingerprint = '{}') => ({ vehicle_id, check_key, fingerprint });

    it('adds a pending skip on top of what was loaded', () => {
        const pending = new Map([[skipKey(2, 'drive-vs-epa'), row(2, 'drive-vs-epa')]]);
        expect(overlaySkips([row(1, 'range-vs-label')], pending)).toHaveLength(2);
    });

    it('replaces a loaded skip with a pending re-skip, never duplicating it', () => {
        const pending = new Map([[skipKey(1, 'range-vs-label'), row(1, 'range-vs-label', '{"range":345}')]]);
        const out = overlaySkips([row(1, 'range-vs-label', '{"range":337}')], pending);
        expect(out).toEqual([row(1, 'range-vs-label', '{"range":345}')]);
    });

    it('removes a loaded skip for a pending un-skip', () => {
        const pending = new Map([[skipKey(1, 'range-vs-label'), null]]);
        expect(overlaySkips([row(1, 'range-vs-label')], pending)).toEqual([]);
    });

    it('hides a finding the moment its skip is pending', () => {
        const v = vehicle({ range: 337 }, [group({ label_range_published: 311 })]);
        const f = runDataChecks([v], { limits: LIMITS })[0].findings[0];
        const pending = new Map([[skipKey(v.id, f.check), row(v.id, f.check, f.fingerprint)]]);
        const [r] = runDataChecks([v], { limits: LIMITS, skips: overlaySkips([], pending) });
        expect(r.disagrees).toBe(0);
        expect(r.skipped).toBe(1);
    });
});

describe('the primary configuration (#322)', () => {
    /** `v` with the link to `g` marked primary and every other link not. */
    const withPrimary = (v, g) => ({
        ...v,
        epa_mappings: v.epa_mappings.map(m => ({ ...m, isPrimary: m.epaTestVehicle === g })),
    });

    it('reports several configurations with none primary as a gap', () => {
        const v = vehicle({}, [group(), group()]);
        const f = findingsFor(v).find(x => x.check === 'no-primary');
        expect(f.kind).toBe('gap');
        expect(f.text).toMatch(/2 linked EPA configurations/);
    });

    it('puts a configuration two or more years from the vehicle in front of a curator (#374)', () => {
        // The 2022 Mach-E mapped to a MY2024 configuration. A year off is marked
        // "From MY…" beside the figure; two or more is a mapping to check.
        const far = group({ _certification: { yearsOff: 2, fromYear: 2024, years: [2024] } });
        const f = findingsFor(vehicle({ year: '2022' }, [far])).find(x => x.check === 'certification-year');
        expect(f.kind).toBe('disagrees');
        expect(f.text).toMatch(/certified for MY2024; the vehicle is 2022/);
        const near = group({ _certification: { yearsOff: 1, fromYear: 2024, years: [2024] } });
        expect(checksFor(vehicle({ year: '2023' }, [near]))).not.toContain('certification-year');
    });

    it('does not ask for a choice when there is nothing to choose between', () => {
        expect(checksFor(vehicle({}, [group()]))).not.toContain('no-primary');
    });

    it('stops asking once one is primary', () => {
        const a = group();
        expect(checksFor(withPrimary(vehicle({}, [a, group()]), a))).not.toContain('no-primary');
    });

    it('fingerprints the gap on which configurations are linked, not their order', () => {
        const a = group(), b = group();
        const one = findingsFor(vehicle({}, [a, b])).find(x => x.check === 'no-primary');
        const two = findingsFor(vehicle({}, [b, a])).find(x => x.check === 'no-primary');
        expect(one.fingerprint).toBe(two.fingerprint);
    });

    it('judges range against the primary alone', () => {
        // Mach E again: 300 agrees with the 300 label — but the primary is the 240 pack.
        const short = group({ label_range_published: 240 });
        const v = withPrimary(vehicle({ range: 300 }, [short, group({ label_range_published: 300 })]), short);
        const f = findingsFor(v).find(x => x.check === 'range-vs-label');
        expect(f).toBeTruthy();
        expect(f.text).toMatch(/primary configuration, 240 mi/);
        expect(f.evidence.labels).toEqual([240]);
    });

    it('no longer reports label spread once the choice is made', () => {
        const a = group({ label_range_published: 337 });
        const v = vehicle({ range: 337 }, [a, group({ label_range_published: 450 })]);
        expect(checksFor(v)).toContain('label-spread');
        expect(checksFor(withPrimary(v, a))).not.toContain('label-spread');
    });

    it('still reports two packs under one vehicle, whichever is primary', () => {
        const a = group({ epa_tests: [mct(80)] });
        const v = withPrimary(vehicle({}, [a, group({ epa_tests: [mct(100)] })]), a);
        expect(checksFor(v)).toContain('tested-spread');
    });

    it('judges EPA tested against the primary alone', () => {
        // Usable 99 agrees with the 99 kWh configuration, not with the primary 80.
        const small = group({ epa_tests: [mct(80)] });
        const specs = { charging: { battery_usable_kwh: 99 } };
        const v = vehicle({ specs }, [small, group({ epa_tests: [mct(99)] })]);
        expect(checksFor(v)).not.toContain('tested-vs-label');
        expect(checksFor(withPrimary(v, small))).toContain('tested-vs-label');
    });

    it('names a primary that has no label, rather than counting links', () => {
        const bare = group();
        const v = withPrimary(vehicle({ range: 300 }, [bare, group({ label_range_published: 300 })]), bare);
        expect(findingsFor(v).find(x => x.check === 'range-no-label').text).toMatch(/its primary configuration, .* has no EPA label/);
    });
});

describe('Expected EPA Range beside a label (#324)', () => {
    const expecting = (mi) => ({ range: { expected_epa_mi: mi, expected_epa_basis: 'Manufacturer' } });

    it('reports an expectation far from the label that replaced it', () => {
        const v = vehicle({ specs: expecting(360) }, [group({ label_range_published: 300 })]);
        const f = findingsFor(v).find(x => x.check === 'expected-vs-label');
        expect(f.kind).toBe('disagrees');
        expect(f.text).toMatch(/Expected EPA range 360 mi/);
    });

    it('stays quiet when the expectation was close', () => {
        const v = vehicle({ specs: expecting(305) }, [group({ label_range_published: 300 })]);
        expect(checksFor(v)).not.toContain('expected-vs-label');
    });

    it('says nothing without a label — that is what the field is for', () => {
        expect(checksFor(vehicle({ specs: expecting(360) }))).not.toContain('expected-vs-label');
    });
});

describe('keepOrder: rows hold their places while a curator works', () => {
    it('keeps every held vehicle in place, resolved or not', () => {
        // B was fixed, so the live order no longer has it and C now outranks A.
        expect(keepOrder(['A', 'B', 'C'], ['C', 'A'])).toEqual(['A', 'B', 'C']);
    });

    it('adds a vehicle that newly has a finding at the end, pushing nothing down', () => {
        expect(keepOrder(['A', 'B'], ['D', 'A', 'B'])).toEqual(['A', 'B', 'D']);
    });

    it('is the live order when nothing is held', () => {
        expect(keepOrder([], ['C', 'A'])).toEqual(['C', 'A']);
    });
});

describe('400 V support against the voltage class (#352)', () => {
    const e800 = { id: 2, kind: 'electrical', name: 'E-GMP 800 V', voltage_class_v: 800 };
    const volts = (v) => ({ charging: { battery_nominal_voltage_v: v } });

    it('reports a 400 V class car with nothing recorded as a gap', () => {
        const v = vehicle({ specs: volts(400) });
        const f = findingsFor(v).find(x => x.check === 'no-400v-support');
        expect(f).toMatchObject({ kind: 'gap' });
        expect(f.text).toMatch(/400 V class \(from 400 V nominal\)/);
    });

    it('is settled by any recorded answer, and never asked of an 800 V car', () => {
        expect(checksFor(vehicle({ specs: { charging: { battery_nominal_voltage_v: 400, dc_400v_charging: 'Native' } } })))
            .not.toContain('no-400v-support');
        expect(checksFor(vehicle({ specs: volts(800) }))).not.toContain('no-400v-support');
        expect(checksFor(vehicle({ specs: {} }))).not.toContain('no-400v-support');   // no class to judge
    });

    it('reports Native on an 800 V class car, naming where it came from', () => {
        const source = vehicle({ specs: { charging: { battery_nominal_voltage_v: 400, dc_400v_charging: 'Native' } } });
        const variant = vehicle({ spec_source_vehicle_id: source.id, specs: {}, platforms: { electrical: e800 } });
        const f = findingsFor(variant, { others: [source] }).find(x => x.check === 'native-on-800v');
        expect(f).toMatchObject({ kind: 'disagrees' });
        expect(f.text).toMatch(/800 V class \(from E-GMP 800 V\).*inherited from/);
    });
});

describe('test attribution', () => {
    const SOURCES = [
        { id: 1, name: 'Out of Spec', aliases: ['OoS', 'Out of Spec Testing'], domains: ['outofspecstudios.com'] },
        { id: 2, name: 'State of Charge', aliases: [], domains: ['evchargingstations.com'] },
        { id: 3, name: 'Ever', aliases: [], domains: [] },
    ];
    const VIDEO = 'https://www.youtube.com/watch?v=KzzTAAfAN-Y';
    let runId = 1;
    const run = (over = {}) => ({
        id: runId++, kind: 'range', name: 'Out of Spec 70mph', source: 'Out of Spec', source_url: VIDEO, ...over,
    });
    const vehicle = (runs, over = {}) => ({ id: 9, name: 'Model Y', year: 2024, runs, ...over });
    const keys = (rows, i = 0) => rows[i].findings.map(f => f.key);

    it('reports nothing for a test that is attributed correctly', () => {
        const out = testAttribution([vehicle([run()])], { sources: SOURCES });
        expect(out).toMatchObject({ rows: [], checked: 1 });
        expect(Object.values(out.counts).every(n => n === 0)).toBe(true);
    });

    it('reports a blank source, an unlisted one, and another spelling of a listed one', () => {
        const out = testAttribution([vehicle([
            run({ source: '' }),
            run({ source: 'Oos Reviews' }),
            run({ source: 'OoS', name: 'Out of Spec 80mph' }),
        ])], { sources: SOURCES });
        expect(keys(out.rows, 0)).toContain('source-blank');
        expect(keys(out.rows, 1)).toContain('source-unlisted');
        expect(keys(out.rows, 2)).toEqual(['source-spelling']);
        expect(out.rows[2].findings[0].text).toMatch(/Out of Spec/);
    });

    it('treats a trailing space or another case as another spelling, not a match', () => {
        const out = testAttribution([vehicle([run({ source: 'out of spec ' })])], { sources: SOURCES });
        expect(keys(out.rows)).toEqual(['source-spelling']);
    });

    it('wants the name to start with the source, ignoring case', () => {
        const out = testAttribution([vehicle([run({ name: 'OoS 70mph' }), run({ name: 'out of spec 70mph' })])], { sources: SOURCES });
        expect(out.rows).toHaveLength(1);
        expect(keys(out.rows)).toEqual(['name-not-source']);
    });

    it('holds Out of Spec to a video or its testing page', () => {
        const out = testAttribution([vehicle([
            run({ source_url: 'https://outofspecstudios.com/testing' }),
            run({ source_url: 'https://outofspecstudios.com/testing/' }),
            run({ source_url: 'https://outofspecstudios.com/70-mph-range' }),
            run({ source_url: 'https://x.com/someone/status/1' }),
            run({ source_url: 'https://www.youtube.com/@outofspec' }),
        ])], { sources: SOURCES });
        expect(out.rows.map(r => r.url)).toEqual([
            'https://outofspecstudios.com/70-mph-range', 'https://x.com/someone/status/1', 'https://www.youtube.com/@outofspec',
        ]);
        expect(out.rows.every(r => keys([r]).includes('link-rule'))).toBe(true);
    });

    it('lets State of Charge link to its own website, and any source link to anything', () => {
        const out = testAttribution([vehicle([
            run({ source: 'State of Charge', name: 'State of Charge 0-100%', kind: 'charging', source_url: 'https://evchargingstations.com/ford' }),
            run({ source: 'State of Charge', name: 'State of Charge 70mph', source_url: 'https://example.com/post' }),
            run({ source: 'Ever', name: 'Ever 70mph', source_url: 'https://caranddriver.com/x' }),
        ])], { sources: SOURCES });
        expect(out.rows).toHaveLength(1);
        expect(out.rows[0].name).toBe('State of Charge 70mph');
        expect(keys(out.rows)).toEqual(['link-rule']);
    });

    it('asks for a link whatever the source', () => {
        const out = testAttribution([vehicle([run({ source_url: null }), run({ source: 'Ever', name: 'Ever 70mph', source_url: '' })])], { sources: SOURCES });
        expect(out.rows.map(r => keys([r]))).toEqual([['link-missing'], ['link-missing']]);
    });

    it('wants a YouTube link stored plainly', () => {
        const forms = ['https://youtu.be/KzzTAAfAN-Y', `${VIDEO}&si=abc`, `${VIDEO}&`, `${VIDEO}&t=60s`];
        const out = testAttribution([vehicle(forms.map(source_url => run({ source_url })))], { sources: SOURCES });
        expect(out.rows).toHaveLength(4);
        expect(out.rows.every(r => keys([r]).includes('link-form'))).toBe(true);
        expect(testAttribution([vehicle([run()])], { sources: SOURCES }).rows).toEqual([]);
    });

    it('reports a stated window the stored curve does not cover, by the curve and not the columns', () => {
        const charging = (name, id) => run({ id, kind: 'charging', name, start_soc: 78, end_soc: 10 });
        const out = testAttribution([vehicle([
            charging('Out of Spec 0-100%', 101),
            charging('Out of Spec 10-80%', 102),
            charging('Out of Spec 0-100% again', 103),
        ])], { sources: SOURCES, socRanges: { 101: { min: 10, max: 78 }, 102: { min: 9, max: 81 }, 103: { min: 1, max: 99 } } });
        expect(out.rows.map(r => r.runId)).toEqual([101]);
        expect(out.rows[0].findings[0].text).toBe('Name says 0–100%; the curve runs 10–78%.');
    });

    it('does not read a window from a range test, or a name with none, or a test with no curve', () => {
        const out = testAttribution([vehicle([
            run({ name: 'Out of Spec 80-10%', kind: 'range', id: 201 }),
            run({ name: 'Out of Spec 70mph', kind: 'charging', id: 202 }),
            run({ name: 'Out of Spec 0-100%', kind: 'charging', id: 203 }),
        ])], { sources: SOURCES, socRanges: { 201: { min: 40, max: 50 }, 202: { min: 40, max: 50 } } });
        expect(out.rows).toEqual([]);
    });

    it('reads a window written with an en dash or a space before the percent sign', () => {
        const out = testAttribution([vehicle([run({ id: 501, kind: 'charging', name: 'State of Charge 10–80 %', source: 'State of Charge' })])],
            { sources: SOURCES, socRanges: { 501: { min: 30, max: 60 } } });
        expect(out.rows[0].findings.map(f => f.key)).toContain('window-mismatch');
    });

    it('reports the second of two charging tests holding one curve, for one vehicle only', () => {
        const curve = { min: 10, max: 80 };
        const twin = (id, name) => run({
            id, kind: 'charging', name, dataPointCount: 159, charge_summary: { peakKw: 181, durationMin: 30 },
        });
        const out = testAttribution([
            vehicle([twin(301, 'Out of Spec 10-80%'), twin(302, 'Out of Spec Lightning 10-80%')]),
            vehicle([twin(303, 'Out of Spec 10-80%')], { id: 10 }),
        ], { sources: SOURCES, socRanges: { 301: curve, 302: curve, 303: curve } });
        expect(out.rows.map(r => r.runId)).toEqual([302]);
        expect(keys(out.rows)).toEqual(['duplicate-curve']);
        expect(out.rows[0].findings[0].text).toBe('Same curve as “Out of Spec 10-80%”.');
    });

    it('never calls a charging test without a summary a duplicate', () => {
        const bare = (id) => run({ id, kind: 'charging', name: 'Out of Spec 10-80%', dataPointCount: 159 });
        const out = testAttribution([vehicle([bare(401), bare(402)])], { sources: SOURCES, socRanges: { 401: { min: 10, max: 80 }, 402: { min: 10, max: 80 } } });
        expect(out.rows).toEqual([]);
    });

    it('leaves composites out and counts what it checked', () => {
        const out = testAttribution([vehicle([run({ source: '' }), run({ composite: true, source: '' }), run()])], { sources: SOURCES });
        expect(out.checked).toBe(2);
        expect(out.rows).toHaveLength(1);
        expect(out.counts['source-blank']).toBe(1);
        expect(Object.keys(out.counts)).toEqual(ATTRIBUTION_FINDINGS.map(f => f.key));
    });

    it('checks a test on the vehicle that owns it, not on every vehicle that inherits it', () => {
        const own = run({ source: '' });
        const inherited = { ...own, id: 'inherited_94_28', _inherited: true };
        const out = testAttribution([vehicle([own, inherited]), vehicle([inherited], { id: 10 })], { sources: SOURCES });
        expect(out.checked).toBe(1);
        expect(out.rows.map(r => r.runId)).toEqual([own.id]);
    });

    it('judges the name and link against the stored text when the source is not listed', () => {
        const out = testAttribution([vehicle([run({ source: 'Oos Reviews', name: 'Oos Reviews 70mph' })])], { sources: SOURCES });
        expect(keys(out.rows)).toEqual(['source-unlisted']);
    });
});

describe('range tests missing conditions', () => {
    const range = (over = {}) => ({ id: 1, kind: 'range', distance_miles: 300, speed_mph: 70, temperature_f: 70, altitude_ft: 0, ...over });
    const findingOf = (runs, opts = {}) => runDataChecks([vehicle({ runs })], { limits: LIMITS, ...opts })[0]
        .findings.find(f => f.check === 'range-test-conditions');

    it('names each counted test and what it lacks, as one gap per vehicle', () => {
        const f = findingOf([range({ id: 1, name: 'Highway loop', altitude_ft: null }), range({ id: 2, speed_mph: null, temperature_f: null })]);
        expect(f.kind).toBe('gap');
        expect(f.text).toContain('Highway loop (altitude)');
        expect(f.text).toContain('(speed, temperature)');
        expect(f.evidence.tests).toEqual(['1:altitude', '2:speed+temperature']);
    });

    it('takes a reading from the session, and passes a complete test', () => {
        expect(findingOf([range()])).toBeUndefined();
        expect(findingOf([range({ altitude_ft: null, session_id: 9 })], { sessionOf: () => ({ altitude_ft: 600 }) })).toBeUndefined();
    });

    it('ignores excluded tests', () => {
        expect(findingOf([range({ altitude_ft: null, is_excluded: true })])).toBeUndefined();
    });
});
