/**
 * The EPA tab's Guide checks, on a candidate before it is linked (#374).
 * The owner's point: the same name can carry very different figures, so a
 * suggestion is only as good as the lab data's agreement with it.
 */
import { describe, it, expect } from 'vitest';
import { checkGuideCandidate } from '../guideCandidateCheck';
import { epaRecordFromTestVehicle } from '../epaRecordFromTestVehicle';
import { buildMethodologyModel } from '../epaMethodology';
import { PROC_MCT, HWFET_MI, UDDS_MI } from '../../constants/epa';

const phase = (index, phase_type, whPerMi, distance_mi) => ({
    phase_index: index, phase_type, distance_mi, dc_energy_kwh: (whPerMi * distance_mi) / 1000,
});

// The Rivian R2 as the database holds it — the fixture epaRecordFromTestVehicle
// is proven against.
const R2 = {
    test_vehicle_id: 'R2-159XR20AT',
    model_year: 2027,
    overrides: {},
    epa_tests: [{
        procedure_code: PROC_MCT,
        total_dc_energy_kwh: 89.54927,
        ac_recharge_kwh: 104.689,
        epa_test_phases: [
            phase(1, 'UDDS', 235.86, 1751.46 / 235.86),
            phase(2, 'HWY',  231.77, HWFET_MI),
            phase(3, 'UDDS', 189.87, UDDS_MI),
            phase(4, 'HWY',  225.00, HWFET_MI),
            phase(5, 'UDDS', 184.62, UDDS_MI),
            phase(7, 'UDDS', 183.46, UDDS_MI),
        ],
    }],
};

// What the lab data derives, so a candidate can be made to agree or not.
const model = buildMethodologyModel(epaRecordFromTestVehicle(R2).record);
const ours = { city: model.cycles.city.mpgeUnadj, hwy: model.cycles.hwy.mpgeUnadj };
const row = (over = {}) => ({
    id: 1, model_year: 2027, carline: 'R2 Performance',
    unadj_city_mpge: ours.city, unadj_hwy_mpge: ours.hwy,
    label_comb_range_mi: 300, label_adjustment_factor: 0.7051, ...over,
});

describe('checkGuideCandidate', () => {
    it('agrees with the row the lab data reproduces', () => {
        const r = checkGuideCandidate(R2, row());
        expect(r.verdict).toBe('agrees');
        expect(r.mpge.cycles).toHaveLength(2);
    });

    it('tells apart two rows with the same name and different figures', () => {
        // The case the check exists for: an identical carline, a different car.
        const same = checkGuideCandidate(R2, row());
        const other = checkGuideCandidate(R2, row({ id: 2, unadj_city_mpge: ours.city * 1.15, unadj_hwy_mpge: ours.hwy * 1.15 }));
        expect(same.verdict).toBe('agrees');
        expect(other.verdict).toBe('disagrees');
    });

    it('calls an impossible label impossible, whatever the MPGe says', () => {
        const r = checkGuideCandidate(R2, row({ label_comb_range_mi: Math.round(model.combinedMi) + 40 }));
        expect(r.verdict).toBe('impossible');
        expect(r.invariant.violated).toBe(true);
    });

    it('judges the row on its own figures, not on a value a curator holds', () => {
        const held = { ...R2, label_range_published: 999, overrides: { label_range_published: { source: 'manual' } } };
        expect(checkGuideCandidate(held, row()).verdict).toBe('agrees');
    });

    it('says why when there is nothing to compare', () => {
        const r = checkGuideCandidate(R2, row({ unadj_city_mpge: null, unadj_hwy_mpge: null }));
        expect(r.verdict).toBeNull();
        expect(r.reason).toMatch(/no unadjusted MPGe/);
        const noLab = checkGuideCandidate({ ...R2, epa_tests: [] }, row());
        expect(noLab.verdict).toBeNull();
        expect(noLab.reason).toBeTruthy();
    });
});
