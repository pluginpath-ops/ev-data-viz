import { describe, it, expect } from 'vitest';
import { testFingerprint, isDifferentCar, resolveTestVehicleIds, testCarListTwin } from '../epaTestVehicleIdentity';

const epaTest = (test_number, extra = {}) => ({
    test_number, procedure_code: 84, test_date: '2024-05-01',
    cd_range_combined_calc: 300, ac_recharge_kwh: 100, ...extra,
});
const tv = (test_vehicle_id, tests, extra = {}) => ({ test_vehicle_id, tests, ...extra });
const file = (name, ...testVehicles) => ({ name, testVehicles });
const ids = (res, i = 0) => res.files[i].testVehicles.map(t => t.test_vehicle_id);

describe('testFingerprint', () => {
    it('is procedure, date, CD range and AC energy', () => {
        expect(testFingerprint(epaTest('X'))).toBe('84|2024-05-01|300.0|100.00');
    });

    it('is null for a placeholder — Zoox filed 999 miles and no energy twice', () => {
        expect(testFingerprint(epaTest('X', { cd_range_combined_calc: 999, ac_recharge_kwh: null }))).toBeNull();
        expect(testFingerprint(epaTest('X', { cd_range_combined_calc: 0 }))).toBeNull();
        expect(testFingerprint(epaTest('X', { test_date: null }))).toBeNull();
    });
});

describe('isDifferentCar', () => {
    it('by carline, ignoring spacing and case', () => {
        expect(isDifferentCar({ epa_carline_name: 'HUMMER EV SUT' }, { epa_carline_name: 'BrightDrop EV600' })).toBe(true);
        expect(isDifferentCar({ epa_carline_name: 'Blazer EV AWD' }, { epa_carline_name: 'BLAZER EV  AWD' })).toBe(false);
    });

    it('by test weight — Mullen THREE filed at 5,500 and 10,500 lb', () => {
        expect(isDifferentCar({ equiv_test_weight_lbs: 5500 }, { coefficient_sets: [{ equiv_test_weight_lbs: 10500 }] })).toBe(true);
        expect(isDifferentCar({ equiv_test_weight_lbs: 5500 }, { equiv_test_weight_lbs: 6000 })).toBe(false);
    });
});

describe('resolveTestVehicleIds', () => {
    it('adopts the stored record that holds the test — the Blazer EV carryover', () => {
        // MY2025 stored 1SMV5028-0; the MY2026 file lists one configuration
        // so the parser keys it 1SMV5028.
        const res = resolveTestVehicleIds(
            [file('MY26', tv('1SMV5028', [epaTest('SGMX10086618')]))],
            { byTestNumber: { SGMX10086618: '1SMV5028-0' } },
        );
        expect(ids(res)).toEqual(['1SMV5028-0']);
        expect(res.renamed[0]).toMatchObject({ from: '1SMV5028', to: '1SMV5028-0', why: 'shares a test number' });
        // Written to epa_test_vehicles as it stands: only the key changes,
        // nothing the table has no column for (the 2022 import failed on
        // "renamedFrom").
        const parsed = tv('1SMV5028', [epaTest('SGMX10086618')]);
        expect(Object.keys(res.files[0].testVehicles[0]).sort()).toEqual(Object.keys(parsed).sort());
    });

    it('follows a renumbered test by its fingerprint — Polestar VVX → PAB', () => {
        const res = resolveTestVehicleIds(
            [file('MY27', tv('PS2-LR', [epaTest('PAB0001')]))],
            { byFingerprint: { [testFingerprint(epaTest('VVX0001'))]: 'PS2-LR-0' } },
        );
        expect(ids(res)).toEqual(['PS2-LR-0']);
        expect(res.renamed[0].why).toBe('shares a renumbered test');
    });

    it('prefers a test number over a fingerprint', () => {
        const res = resolveTestVehicleIds(
            [file('f', tv('A', [epaTest('N1')]))],
            { byTestNumber: { N1: 'A-0' }, byFingerprint: { [testFingerprint(epaTest('N1'))]: 'B' } },
        );
        expect(ids(res)).toEqual(['A-0']);
    });

    it('never adopts another vehicle of the same file — the Mercedes guard (PR #413)', () => {
        // A failed upload stored configuration 1's test under the real
        // V297PSM140f-Z2791-1, which this file also holds.
        const res = resolveTestVehicleIds(
            [file('66073',
                tv('V297PSM140f-Z2791-0', [epaTest('94618')]),
                tv('V297PSM140f-Z2791/1', [epaTest('94619')]),
                tv('V297PSM140f-Z2791-1', [epaTest('94620')]))],
            { byTestNumber: { 94619: 'V297PSM140f-Z2791-1' } },
        );
        expect(ids(res)).toEqual(['V297PSM140f-Z2791-0', 'V297PSM140f-Z2791/1', 'V297PSM140f-Z2791-1']);
        expect(res.warnings.some(w => w.includes('another test vehicle in this file'))).toBe(true);
    });

    it('never adopts one record twice in a file', () => {
        const res = resolveTestVehicleIds(
            [file('f', tv('A', [epaTest('N1')]), tv('B', [epaTest('N2')]))],
            { byTestNumber: { N1: 'S', N2: 'S' } },
        );
        expect(ids(res)).toEqual(['S', 'B']);
    });

    it('warns and keeps the key when its tests are spread over two records', () => {
        const res = resolveTestVehicleIds(
            [file('f', tv('A', [epaTest('N1'), epaTest('N2', { procedure_code: 3 })]))],
            { byTestNumber: { N1: 'S1', N2: 'S2' } },
        );
        expect(ids(res)).toEqual(['A']);
        expect(res.warnings[0]).toMatch(/S1 and S2/);
    });

    it('keys a reused Vehicle ID by Test Group — NNGAA078', () => {
        const res = resolveTestVehicleIds(
            [file('f', tv('NNGAA078', [epaTest('BD1')], { test_group: 'NGMXT00.0BD1', epa_carline_name: 'BrightDrop EV600' }))],
            { records: { NNGAA078: { epa_carline_name: 'HUMMER EV SUT' } } },
        );
        expect(ids(res)).toEqual(['NNGAA078@NGMXT00.0BD1']);
        expect(res.renamed[0].why).toBe('reused Vehicle ID');
    });

    it('leaves a retest of the same car under its key', () => {
        const res = resolveTestVehicleIds(
            [file('f', tv('K', [epaTest('NEW')], { epa_carline_name: 'Ioniq 5' }))],
            { records: { K: { epa_carline_name: 'IONIQ 5' } } },
        );
        expect(ids(res)).toEqual(['K']);
        expect(res.renamed).toEqual([]);
    });

    it('carries what one file resolved into the next in the batch', () => {
        // Neither Blazer file stored yet: MY2025 first, then its carryover.
        const res = resolveTestVehicleIds([
            file('MY25', tv('1SMV5028-0', [epaTest('SGMX10086618')])),
            file('MY26', tv('1SMV5028', [epaTest('SGMX10086618')])),
        ]);
        expect(ids(res, 1)).toEqual(['1SMV5028-0']);
    });

    it('adopts the Test Car List record of a suffixed configuration — RMA00015', () => {
        // The Test Car List stored the Mach-E GT as RMA00015 with no tests; a
        // CSI file listing two configurations keys it RMA00015-0.
        const res = resolveTestVehicleIds(
            [file('MY26', tv('RMA00015-0', [epaTest('RFMX10083371')], { vehicle_config_number: '0', epa_carline_name: 'Mustang Mach-E GT' }))],
            { records: { RMA00015: { epa_carline_name: 'Mustang Mach-E GT', vehicle_config_number: '0', has_tests: false } } },
        );
        expect(ids(res)).toEqual(['RMA00015']);
        expect(res.renamed[0].why).toBe('the Test Car List record');
    });
});

describe('testCarListTwin', () => {
    const rec = (extra = {}) => ({ epa_carline_name: 'HUMMER EV PICKUP', vehicle_config_number: '2', has_tests: false, ...extra });
    const parsed = (extra = {}) => ({ epa_carline_name: 'HUMMER EV PICKUP', vehicle_config_number: '2', ...extra });

    it('is the bare Vehicle ID when it has no tests and the same configuration', () => {
        expect(testCarListTwin('RVTBB204-2', parsed(), { RVTBB204: rec() })).toBe('RVTBB204');
        expect(testCarListTwin('RVTBB204/2', parsed(), { RVTBB204: rec() })).toBe('RVTBB204');
    });

    it('is null when the stored record has tests of its own — a different configuration filed bare', () => {
        expect(testCarListTwin('RVTBB204-2', parsed(), { RVTBB204: rec({ has_tests: true }) })).toBeNull();
    });

    it('is null for another configuration number', () => {
        expect(testCarListTwin('RVTBB204-2', parsed(), { RVTBB204: rec({ vehicle_config_number: '1' }) })).toBeNull();
        expect(testCarListTwin('RVTBB204-2', parsed({ vehicle_config_number: '1' }), { RVTBB204: rec() })).toBeNull();
    });

    it('is null for an ID that merely ends in digits — Tesla 3D224-649671', () => {
        expect(testCarListTwin('3D224-649671', parsed({ vehicle_config_number: '0' }), {})).toBeNull();
    });

    it('is null for a different car', () => {
        expect(testCarListTwin('RVTBB204-2', parsed(), { RVTBB204: rec({ epa_carline_name: 'BrightDrop EV600' }) })).toBeNull();
    });
});
