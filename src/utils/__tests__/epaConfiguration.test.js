import { describe, it, expect } from 'vitest';
import { epaConfigurationFigures, primaryEpaMapping } from '../epaConfiguration';

const group = (over = {}) => ({
    test_group_id: 'G1', model_year: 2026, make: 'Kia', epa_carline_name: 'EV9',
    label_range_published: null, preferred_test_number: null,
    epa_tests: [], epa_coefficient_sets: [], ...over,
});

describe('epaConfigurationFigures', () => {
    it('reads EPA tested from the preferred multi-cycle test, not the latest', () => {
        const g = group({
            preferred_test_number: 'T1',
            epa_tests: [
                { test_number: 'T1', procedure_code: 77, total_dc_energy_kwh: 99.1, test_date: '2025-01-01' },
                { test_number: 'T2', procedure_code: 77, total_dc_energy_kwh: 84.0, test_date: '2026-01-01' },
            ],
        });
        expect(epaConfigurationFigures(g).testedKwh).toBe(99.1);
    });

    it('reads test weight from the primary coefficient set', () => {
        const g = group({ epa_coefficient_sets: [
            { is_primary: false, equiv_test_weight_lbs: 6000 },
            { is_primary: true,  equiv_test_weight_lbs: 6500 },
        ] });
        expect(epaConfigurationFigures(g).testWeightLbs).toBe(6500);
    });

    it('keeps an absent figure absent rather than zero', () => {
        const f = epaConfigurationFigures(group({ label_range_published: 0 }));
        expect(f.labelRangeMi).toBeNull();
        expect(f.testedKwh).toBeNull();
        expect(f.testWeightLbs).toBeNull();
    });

    it('names a configuration by its display name, else year, make and carline', () => {
        expect(epaConfigurationFigures(group({ display_name: 'EV9 Land 21"' })).name).toBe('EV9 Land 21"');
        expect(epaConfigurationFigures(group()).name).toBe('2026 Kia EV9');
    });
});

describe('primaryEpaMapping', () => {
    const link = (id, over = {}) => ({ id, isPrimary: false, epaGroup: group({ test_group_id: `G${id}` }), ...over });

    it('returns the chosen link', () => {
        const picked = primaryEpaMapping([link(1), link(2, { isPrimary: true })]);
        expect(picked.mapping.id).toBe(2);
        expect(picked.basis).toBe('chosen');
    });

    it('treats a sole unmarked link as the vehicle’s — an un-migrated read', () => {
        expect(primaryEpaMapping([link(1)])).toMatchObject({ mapping: { id: 1 }, basis: 'only' });
    });

    it('picks nothing silently when there are several and none is primary', () => {
        expect(primaryEpaMapping([link(1), link(2)])).toBeNull();
        expect(primaryEpaMapping([])).toBeNull();
        expect(primaryEpaMapping()).toBeNull();
    });

    it('ignores a link with no group, on either side of the choice', () => {
        expect(primaryEpaMapping([link(1), link(2, { epaGroup: null })])).toMatchObject({ mapping: { id: 1 }, basis: 'only' });
        expect(primaryEpaMapping([link(1), link(2, { isPrimary: true, epaGroup: null })])).toMatchObject({ mapping: { id: 1 }, basis: 'only' });
    });
});
