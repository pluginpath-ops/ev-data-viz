import { describe, it, expect } from 'vitest';
import { deriveDrivetrainEta, deriveSteadyStateEta } from '../epaDerivations';

/**
 * Mercedes' MY2027 CLA 350 4MATIC (CSI-VMBXV00.0ED7), which is the record that
 * prompted having two ηs at all.
 *
 * Its HWFET-derived η is 0.798, and a road test put the car at 385 miles where
 * the curve built on that η predicted about 285. The car's own constant-speed
 * phases give 4.267 mi/kWh — 385 miles on the ~90 kWh the pack actually
 * delivered — so the phase data was never the problem.
 *
 * Every expectation below was computed by hand from the coefficients before it
 * was written, so this pins the arithmetic rather than recording whatever the
 * code happened to return.
 */
const cla = () => ({
    accessory_load_w_override: null,
    epa_coefficient_sets: [
        { is_primary: true, target_a: 40.69, target_b: 0.0723, target_c: 0.01437,
          equiv_test_weight_lbs: 5000 },
    ],
    epa_tests: [{
        test_number: 'TMBX10091675',
        procedure_code: 77,
        total_dc_energy_kwh: 90.038,
        ac_recharge_kwh: 100.556,
        epa_test_phases: [
            { phase_index: 2, phase_type: 'HWY', distance_mi: 10.2743406, dc_energy_kwh: 2.0807097 },
            { phase_index: 6, phase_type: 'HWY', distance_mi: 10.2624932, dc_energy_kwh: 2.0233391 },
            { phase_index: 4, phase_type: 'SS',  distance_mi: 281.313556, dc_energy_kwh: 66.0184098 },
            { phase_index: 8, phase_type: 'SS',  distance_mi: 59.723748,  dc_energy_kwh: 13.8985443 },
        ],
    }],
});

const close = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('deriveSteadyStateEta — the same quantity, a different operating point', () => {
    it('reproduces the HWFET figure the curve is built on today', () => {
        // The control. 0.798 is what the card shows for this vehicle.
        close(deriveDrivetrainEta(cla()).value, 0.7979, 0.001);
    });

    it('gives a higher η from the constant-speed phases at the assumed 60 mph', () => {
        const r = deriveSteadyStateEta(cla(), 60);
        close(r.value, 0.8389, 0.001);
        expect(r.source).toBe('assumed-speed');
    });

    it('moves a long way with the assumed speed, which is why it is assumed', () => {
        // Four points at 60, twelve at 65, on identical phase data. The speed is
        // the whole uncertainty and the CSI never states it.
        close(deriveSteadyStateEta(cla(), 65).value, 0.9184, 0.001);
        expect(deriveSteadyStateEta(cla(), 65).value)
            .toBeGreaterThan(deriveSteadyStateEta(cla(), 60).value);
    });

    it('is never certain, however plausible the value', () => {
        // An assumed input cannot produce a certain output, and 60 mph sits
        // inside ETA_BAND, so this would otherwise read as confirmed.
        const r = deriveSteadyStateEta(cla(), 60);
        expect(r.flags).toEqual([]);
        expect(r.certain).toBe(false);
    });

    it('flags a value outside the band', () => {
        // 70 mph drives η above the band, which is itself the useful signal:
        // the constant-speed section cannot have been held that high.
        expect(deriveSteadyStateEta(cla(), 70).flags).toContain('eta-out-of-band');
    });

    it('declines when there is no steady-state phase', () => {
        const g = cla();
        g.epa_tests[0].epa_test_phases = g.epa_tests[0].epa_test_phases.filter(p => p.phase_type !== 'SS');
        const r = deriveSteadyStateEta(g, 60);
        expect(r.value).toBeNull();
        expect(r.flags).toContain('no-ss-phase');
    });

    it('declines without coefficients rather than inventing a default', () => {
        // deriveDrivetrainEta falls back to DEFAULT_ETA here because the curve
        // needs a number. This one has no such duty, and a fabricated second
        // opinion that silently agrees with the first is worse than none.
        const r = deriveSteadyStateEta({ ...cla(), epa_coefficient_sets: [] }, 60);
        expect(r.value).toBeNull();
        expect(r.flags).toContain('no-coefficients');
    });
});
