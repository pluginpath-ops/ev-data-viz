import { describe, it, expect } from 'vitest';
import { resolveCurveEta, deriveDrivetrainEta, deriveSteadyStateEta } from '../epaDerivations';
import { HWFET_TO_SS_ETA_RATIO, DEFAULT_ETA, DEFAULT_SS_ETA } from '../../constants/epa';

/**
 * Mercedes' MY2027 CLA 350 has constant-speed phases; BMW's i7, certified on
 * procedures 81 and 84, does not. Between them they are the whole precedence.
 */
const COEFFS = [{ is_primary: true, target_a: 40.69, target_b: 0.0723,
    target_c: 0.01437, equiv_test_weight_lbs: 5000 }];

const HWY = [
    { phase_type: 'HWY', distance_mi: 10.2743406, dc_energy_kwh: 2.0807097 },
    { phase_type: 'HWY', distance_mi: 10.2624932, dc_energy_kwh: 2.0233391 },
];

const withSs = () => ({
    epa_coefficient_sets: COEFFS,
    epa_tests: [{
        procedure_code: 77, total_dc_energy_kwh: 90.038, ac_recharge_kwh: 100.556,
        epa_test_phases: [...HWY,
            { phase_type: 'SS', distance_mi: 281.313556, dc_energy_kwh: 66.0184098 }],
    }],
});

const noSs = () => ({
    epa_coefficient_sets: COEFFS,
    epa_tests: [{
        procedure_code: 84, total_dc_energy_kwh: 106.227, ac_recharge_kwh: 119.873,
        epa_test_phases: HWY,
    }],
});

describe('resolveCurveEta — one basis for every vehicle', () => {
    it('uses the measured steady-state value where the phases exist', () => {
        const r = resolveCurveEta(withSs());
        expect(r.source).toBe('measured');
        expect(r.basis.corrected).toBe(false);
        expect(r.value).toBeCloseTo(deriveSteadyStateEta(withSs()).value, 10);
    });

    it('corrects the HWFET value where they do not', () => {
        // The two-thirds/one-third split is the whole reason the constant
        // exists: without it a steady-state curve could only describe the
        // groups that ran a constant-speed section.
        const r = resolveCurveEta(noSs());
        expect(r.source).toBe('corrected');
        expect(r.basis.corrected).toBe(true);
        expect(r.value).toBeCloseTo(
            deriveDrivetrainEta(noSs()).value * HWFET_TO_SS_ETA_RATIO, 10);
        expect(r.basis.reason).toBe('no constant-speed phase');
    });

    it('never calls a corrected value certain', () => {
        // It is a measurement of a different population applied to this car.
        expect(resolveCurveEta(noSs()).certain).toBe(false);
    });

    it('puts the two bases within a few percent of each other', () => {
        // Which is the point. Uncorrected, the same two records differ by 13%
        // for no reason but which procedure their manufacturer chose.
        const a = resolveCurveEta(withSs()).value;
        const b = resolveCurveEta(noSs()).value;
        expect(Math.abs(a - b) / a).toBeLessThan(0.05);

        const rawA = deriveSteadyStateEta(withSs()).value;
        const rawB = deriveDrivetrainEta(noSs()).value;
        expect(Math.abs(rawA - rawB) / rawA).toBeGreaterThan(0.10);
    });
});

describe('resolveCurveEta — what it refuses to correct', () => {
    it('does not scale an assumed η', () => {
        // Scaling a default would dress the assumption up as a derivation and
        // produce a number that looks more specific than the constant it came
        // from.
        const r = resolveCurveEta({ epa_coefficient_sets: COEFFS, epa_tests: [] });
        expect(r.source).toBe('estimated');
        expect(r.basis.corrected).toBe(false);
    });

    it('falls back on the CRUISE default, not the HWFET one', () => {
        // They are not the same quantity — a steady-state η runs ~13% above a
        // HWFET one — so reaching for the wrong constant would put a curve with
        // no data 13% below every curve around it, from nothing but which
        // fallback it happened to hit.
        const r = resolveCurveEta({ epa_coefficient_sets: COEFFS, epa_tests: [] });
        expect(r.value).toBe(DEFAULT_SS_ETA);
        expect(r.value).not.toBe(DEFAULT_ETA);
        expect(DEFAULT_SS_ETA).toBeGreaterThan(DEFAULT_ETA);
    });

    it('declines a correction that lands past 1', () => {
        // Two plausible inputs can still multiply into an impossibility, and
        // publishing it would be worse than falling back.
        const g = noSs();
        g.epa_coefficient_sets = [{ is_primary: true, target_a: 120, target_b: 0.2, target_c: 0.04 }];
        const r = resolveCurveEta(g);
        expect(r.source).toBe('estimated');
        expect(r.value).toBe(DEFAULT_SS_ETA);
        expect(r.flags).toContain('correction-nonphysical');
    });

    it('corrects rather than trusting a nonphysical steady-state value', () => {
        // Nissan's records derive an SS η above 1. Preferring it because it
        // exists would carry the fault straight into every curve.
        const g = withSs();
        g.epa_coefficient_sets = [{ is_primary: true, target_a: 200, target_b: 0.5, target_c: 0.05 }];
        const r = resolveCurveEta(g);
        expect(r.source).not.toBe('measured');
        if (r.source === 'corrected') {
            expect(r.basis.reason).toBe('steady-state η was not physical');
        }
    });
});

describe('resolveCurveEta — the statistics keep the raw value', () => {
    it('leaves deriveDrivetrainEta untouched', () => {
        // ETA_BAND is calibrated on HWFET values, and ss_eta_ratio divides the
        // steady-state η BY this one. Correcting it in place would make the
        // ratio circular and drift the constant every time it was re-derived.
        const raw = deriveDrivetrainEta(noSs());
        expect(raw.source).toBe('measured-fallback');
        expect(raw.value).toBeLessThan(resolveCurveEta(noSs()).value);
    });
});
