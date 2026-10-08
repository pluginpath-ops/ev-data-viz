import { describe, it, expect } from 'vitest';
import { deriveEffectiveAdjustmentFactor } from '../epaDerivations';
import { resolveAdjustment } from '../epaMethodology';
import { epaRecordFromTestVehicle } from '../epaRecordFromTestVehicle';

// 0.72 is "vehicle-specific" by the old size threshold; 0.68 is "default".
const group = (published, calc, signature) => ({
    label_range_published: published,
    cd_range_combined_calc: calc,
    epa_fe_guide: signature ? { adjustment_signature: signature } : null,
});

describe('deriveEffectiveAdjustmentFactor reads the signature before guessing from size (#222)', () => {
    it('falls back to the 0.715 threshold when no guide row is linked', () => {
        expect(deriveEffectiveAdjustmentFactor(group(72, 100, null)).basis)
            .toMatchObject({ method: 'vehicle-specific 5-cycle', methodSource: 'threshold' });
        expect(deriveEffectiveAdjustmentFactor(group(68, 100, null)).basis)
            .toMatchObject({ method: 'default 2-cycle', methodSource: 'threshold' });
    });

    it('uses the guide\'s statement when it has one, even against the threshold', () => {
        // 0.72 would read as vehicle-specific by size; the guide says fixed.
        expect(deriveEffectiveAdjustmentFactor(group(72, 100, 'fixed')).basis)
            .toMatchObject({ method: 'default 2-cycle', methodSource: 'signature' });
        expect(deriveEffectiveAdjustmentFactor(group(68, 100, 'per-vehicle')).basis)
            .toMatchObject({ method: 'vehicle-specific 5-cycle', methodSource: 'signature' });
        expect(deriveEffectiveAdjustmentFactor(group(68, 100, 'per-cycle')).basis.method)
            .toBe('per-cycle factors');
    });
});

describe('the signature reaches the methodology record', () => {
    it('resolveAdjustment carries it through', () => {
        expect(resolveAdjustment({ adjustmentFactor: 0.7051, adjustmentSignature: 'per-vehicle' }))
            .toMatchObject({ source: 'guide', signature: 'per-vehicle' });
        expect(resolveAdjustment({})).toMatchObject({ source: 'default', signature: null });
    });

    it('epaRecordFromTestVehicle reads it off the linked guide row', () => {
        const g = {
            model_year: 2027, label_adjustment_factor: 0.7051,
            epa_fe_guide: { adjustment_signature: 'per-vehicle' },
            epa_tests: [{ procedure_code: 77, total_dc_energy_kwh: 100,
                epa_test_phases: [
                    { phase_index: 1, phase_type: 'UDDS', distance_mi: 7.45, dc_energy_kwh: 2 },
                    { phase_index: 2, phase_type: 'HWY', distance_mi: 10.26, dc_energy_kwh: 3 },
                ] }],
        };
        const { record } = epaRecordFromTestVehicle(g);
        expect(record?.adjustmentSignature).toBe('per-vehicle');
    });
});
