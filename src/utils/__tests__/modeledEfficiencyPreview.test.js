import { describe, it, expect } from 'vitest';
import { modeledEfficiencyPreview } from '../modeledEfficiencyPreview';
import { buildEpaCurveFromModel } from '../epaDerivations';

// A record with a constant-speed section, so η is measured (see
// epaCurveSubjects.test.js for why these figures have to agree).
const group = {
    test_group_id: 'TG1', model_year: 2025, make: 'Porsche', epa_carline_name: 'Taycan 4 Cross Turismo',
    useable_kwh: 90,
    epa_coefficient_sets: [{ is_primary: true, target_a: 37, target_b: 0.2, target_c: 0.02, equiv_test_weight_lbs: 5500 }],
    epa_tests: [{
        procedure_code: 77, total_dc_energy_kwh: 90,
        epa_test_phases: [
            { phase_type: 'HWY', distance_mi: 10.26, dc_energy_kwh: 3.1 },
            { phase_type: 'HWY', distance_mi: 10.26, dc_energy_kwh: 3.0 },
            { phase_type: 'SS', distance_mi: 280, dc_energy_kwh: 84.52 },
        ],
    }],
};
const run = (o = {}) => ({
    id: 171, name: 'State of Charge', kind: 'range', synthetic: false, is_hidden: false,
    speed_mph: 70, distance_miles: 302, energy_kwh: 97, temperature_f: 50, ...o,
});
const row = (runs = [run()]) => ({ mappingId: 69, vehicleId: 28, vehicleName: 'Taycan J1.2', epaGroup: group, runs });

describe('modeledEfficiencyPreview', () => {
    it('draws the same curve the chart draws at standard conditions', () => {
        const preview = modeledEfficiencyPreview(row());
        const chart = buildEpaCurveFromModel(group, 90);
        expect(preview.curve.map(p => p.kwh100mi)).toEqual(chart.map(p => p.kwh100mi));
        expect(preview.curve[0].miPerKwh).toBeCloseTo(100 / chart[0].kwh100mi, 10);
        expect(preview).toMatchObject({ mappingId: 69, vehicleId: 28, vehicleName: 'Taycan J1.2', tier: 'measured' });
    });

    it('corrects a range test to standard conditions and keeps the measured value beside it', () => {
        const [test] = modeledEfficiencyPreview(row()).tests;
        expect(test.id).toBe(171);
        expect(test.measured.miPerKwh).toBeCloseTo(302 / 97, 6);
        // 50 °F air is denser than standard, so the correction improves it.
        expect(test.miPerKwh).toBeGreaterThan(test.measured.miPerKwh);
    });

    it('leaves out tests an explainer should not cite, and ones it cannot place', () => {
        const tests = modeledEfficiencyPreview(row([
            run({ id: 1, is_hidden: true }), run({ id: 2, synthetic: true }),
            run({ id: 3, kind: 'charging' }), run({ id: 4, speed_mph: null }), run({ id: 5 }),
            // Listed but excluded from the statistics (#394): not cited either.
            run({ id: 6, is_excluded: true }),
        ])).tests;
        expect(tests.map(t => t.id)).toEqual([5]);
    });

    it('returns null for a link with no record, or a record with no coefficients', () => {
        expect(modeledEfficiencyPreview({ ...row(), epaGroup: null })).toBeNull();
        expect(modeledEfficiencyPreview({ ...row(), epaGroup: { ...group, epa_coefficient_sets: [] } })).toBeNull();
    });
});
