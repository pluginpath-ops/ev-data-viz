import { describe, it, expect } from 'vitest';
import {
    runDataChecks, checkCounts, sourceNameVariants, groupPerformanceByVehicle,
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
    test_group_id: `G${nextId++}`, model_year: 2026, make: 'Make', epa_carline_name: 'Carline',
    label_range_published: null, drive: null, total_voltage: null, preferred_test_number: null,
    epa_tests: [], epa_coefficient_sets: [], ...over,
});
const mct = (kwhValue, over = {}) => ({
    procedure_code: 77, total_dc_energy_kwh: kwhValue, test_number: `T${nextId++}`, test_date: '2026-01-01', ...over,
});
const vehicle = (over = {}, groups = []) => ({
    id: nextId++, name: 'Test vehicle', specs: {}, runs: [],
    epa_mappings: groups.map(g => ({ id: nextId++, confidence: 'verified', notes: null, epaGroup: g })),
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

    it('reports a gap in either direction', () => {
        expect(checksFor(vehicle({}, [group({ label_range_published: 330 })]))).toEqual(['label-no-range']);
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
        expect(checksFor(volts(400, 335))).toEqual([]);
        expect(checksFor(volts(800, 765))).toEqual([]);
        expect(checksFor(volts(400, 628))).toEqual(['voltage-vs-epa']);
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
