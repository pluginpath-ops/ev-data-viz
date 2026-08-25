import { describe, it, expect } from 'vitest';
import { deriveDrivetrainEta, deriveSteadyStateEta, SS_CYCLE_SPEED_MPH } from '../epaDerivations';

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

    it('anchors at the 65 mph J1634 specifies, with no argument', () => {
        // The default IS the standard's speed. Passing nothing must give the
        // same answer as passing 65, or the two would drift.
        expect(SS_CYCLE_SPEED_MPH).toBe(65);
        close(deriveSteadyStateEta(cla()).value, 0.9184, 0.001);
        expect(deriveSteadyStateEta(cla()).value)
            .toBeCloseTo(deriveSteadyStateEta(cla(), 65).value, 10);
    });

    it('is twelve points above the HWFET figure on identical phase data', () => {
        // The whole finding: the HWFET back-solve absorbs the transient losses
        // of the cycle it is fitted to, so it under-reads cruise efficiency.
        const hwfet = deriveDrivetrainEta(cla()).value;
        const ss    = deriveSteadyStateEta(cla()).value;
        expect(ss - hwfet).toBeGreaterThan(0.10);
    });

    it('is measured and certain, now the speed is specified rather than guessed', () => {
        // It was permanently uncertain only because 60 mph was an assumption.
        const r = deriveSteadyStateEta(cla());
        expect(r.source).toBe('measured');
        expect(r.flags).toEqual([]);
        expect(r.certain).toBe(true);
        expect(r.basis.cycle_speed_mph).toBe(65);
    });

    it('still moves a long way with the speed, which is why it is a knob', () => {
        // A manufacturer that deviated from the standard is a curator override.
        close(deriveSteadyStateEta(cla(), 60).value, 0.8389, 0.001);
        expect(deriveSteadyStateEta(cla(), 60).value)
            .toBeLessThan(deriveSteadyStateEta(cla(), 65).value);
    });

    it('flags a value outside the band', () => {
        // 70 mph drives η above the band, which is itself the useful signal:
        // the constant-speed section cannot have been held that high.
        const r = deriveSteadyStateEta(cla(), 70);
        expect(r.flags).toContain('eta-out-of-band');
        expect(r.certain).toBe(false);
    });

    it('declines when there is no steady-state phase', () => {
        // The coverage problem, and the reason the curves do not run on this
        // yet: a group tested on procedures 81 and 84 has no SS phase at all.
        const g = cla();
        g.epa_tests[0].epa_test_phases = g.epa_tests[0].epa_test_phases.filter(p => p.phase_type !== 'SS');
        const r = deriveSteadyStateEta(g);
        expect(r.value).toBeNull();
        expect(r.flags).toContain('no-ss-phase');
    });

    it('declines without coefficients rather than inventing a default', () => {
        // deriveDrivetrainEta falls back to DEFAULT_ETA here because the curve
        // needs a number. This one has no such duty, and a fabricated second
        // opinion that silently agrees with the first is worse than none.
        const r = deriveSteadyStateEta({ ...cla(), epa_coefficient_sets: [] });
        expect(r.value).toBeNull();
        expect(r.flags).toContain('no-coefficients');
    });
});
