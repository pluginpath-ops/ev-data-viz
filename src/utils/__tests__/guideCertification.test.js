import { describe, it, expect } from 'vitest';
import {
    procedureLabel, certificationTests, certificationCoefficients,
    configurationsInTestGroup, linkedVehicleLinks,
} from '../guideCertification';

describe('procedureLabel', () => {
    it('names the procedures the app uses and falls back to the number', () => {
        expect(procedureLabel(77)).toBe('Multi-cycle test');
        expect(procedureLabel('84')).toBe('Charge-depleting highway');
        expect(procedureLabel(99)).toBe('Procedure 99');
        expect(procedureLabel(null)).toBe('Unknown procedure');
    });
});

describe('certificationTests', () => {
    const group = { epa_tests: [
        { id: 1, test_number: 'B', procedure_code: 84, total_dc_energy_kwh: '60.1',
          epa_test_phases: [{ phase_index: 2, phase_type: 'HWY', distance_mi: 10.3 }, { phase_index: 1, phase_type: 'UDDS', distance_mi: 7.5 }] },
        { id: 2, test_number: 'A', procedure_code: 77, total_dc_energy_kwh: 82, epa_test_phases: [] },
    ] };

    it('leads with the multi-cycle test, which is the EPA tested one', () => {
        const rows = certificationTests(group);
        expect(rows.map(r => r.number)).toEqual(['A', 'B']);
        expect(rows[0].isEpaTested).toBe(true);
        expect(rows[1].isEpaTested).toBe(false);
    });

    it('reads numbers and orders phases', () => {
        const [, b] = certificationTests(group);
        expect(b.dcKwh).toBe(60.1);
        expect(b.phases.map(p => p.index)).toEqual([1, 2]);
    });

    it('survives a group with nothing in it', () => {
        expect(certificationTests(null)).toEqual([]);
        expect(certificationTests({})).toEqual([]);
    });
});

describe('certificationCoefficients', () => {
    it('puts the primary set first and keeps A/B/C in order', () => {
        const sets = certificationCoefficients({ epa_coefficient_sets: [
            { id: 1, category: 'Alt', is_primary: false, set_a: 1, set_b: 2, set_c: 3 },
            { id: 2, category: 'Main', is_primary: true, target_a: '40.5', target_b: 0.1, target_c: 0.02, equiv_test_weight_lbs: 5500 },
        ] });
        expect(sets[0].category).toBe('Main');
        expect(sets[0].target).toEqual([40.5, 0.1, 0.02]);
        expect(sets[0].weightLbs).toBe(5500);
        expect(sets[1].set).toEqual([1, 2, 3]);
    });
});

describe('configurationsInTestGroup', () => {
    const rows = [
        { id: 1, smog_test_group: 'R2', model_year: 2027 },
        { id: 2, smog_test_group: 'R2', model_year: 2027 },
        { id: 3, smog_test_group: 'R2', model_year: 2026 },
        { id: 4, smog_test_group: null, model_year: 2027 },
    ];
    it('counts the configurations sharing the test group in the same year', () => {
        expect(configurationsInTestGroup(rows, rows[0])).toBe(2);
        expect(configurationsInTestGroup(rows, rows[2])).toBe(1);
    });
    it('is 1 with no test group', () => {
        expect(configurationsInTestGroup(rows, rows[3])).toBe(1);
        expect(configurationsInTestGroup([], null)).toBe(1);
    });
});

describe('linkedVehicleLinks', () => {
    it('lists each vehicle once, linked to its EPA section', () => {
        const links = linkedVehicleLinks([{ id: 7, name: 'Air', year: 2024 }, { id: 7, name: 'Air', year: 2024 }]);
        expect(links).toHaveLength(1);
        expect(links[0].label).toBe('2024 Air');
        expect(links[0].href).toBe('?tab=runs&vid=7&sub=epa');
    });
});
