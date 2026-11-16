import { describe, it, expect } from 'vitest';
import { efficiencyAtSpeed, rangeTestBasis, sourceBasis, towingBasis } from '../tripEfficiency';
import { CORRECTION_MODES, SPEED_ONLY_MODE, correctionFactor, runConditions } from '../conditionCorrection';
import { decodeCorrection, DEFAULT_READER_MODE } from '../correctionSettings';
import { AERO_FRACTION, TOWING_AERO_FRACTION, REFERENCE_SPEED_MPH, ASSUMED_TEST_CONDITIONS } from '../../constants/epa';

const run = (over = {}) => ({
    id: 2, kind: 'range', speed_mph: 80, temperature_f: 70, altitude_ft: 0,
    distance_miles: 240, energy_kwh: 75, ...over,
});
const target = (speedMph) => ({ speedMph, temperatureF: 70, altitudeFt: 0, accessoryW: null });
const aero = (mph, f = AERO_FRACTION) => f * (mph / REFERENCE_SPEED_MPH) ** 2 + (1 - f);
// The speed-only re-pricing the simulation used to do itself.
const speedOnly = (miPerKwh, fromMph, toMph, f) => miPerKwh * aero(fromMph, f) / aero(toMph, f);

describe('a trip is priced at its travel speed, one path', () => {
    // The bug: the figure was corrected to the correction target's speed, then
    // the simulation re-priced it to the travel speed with an aero-only factor.
    // Aero composed exactly; the accessory load and air density did not, so a
    // speed this chart no longer shows moved its answer by 1–2%.
    it('never reads the correction target speed', () => {
        const basis = rangeTestBasis(3.5, run());
        const at = (s) => efficiencyAtSpeed(basis, 75, { mode: 'aero', target: target(s) }).miPerKwh;
        expect(at(55)).toBeCloseTo(at(70), 12);
        expect(at(90)).toBeCloseTo(at(70), 12);
    });

    // What #511 computed by resolving the range source at each travel speed:
    // the same number, now from one function.
    it('corrected, is the correction itself with the travel speed as its target speed', () => {
        const r = run({ temperature_f: 30, altitude_ft: 4000 });
        const got = efficiencyAtSpeed(rangeTestBasis(3.5, r), 75, { mode: 'aero', target: target(55) }).miPerKwh;
        const direct = 3.5 * correctionFactor(runConditions(r), { mode: 'aero', target: target(75) }).factor;
        expect(got).toBeCloseTo(direct, 12);
    });

    it('with no correction, re-prices the speed alone, exactly as the simulation did', () => {
        const basis = rangeTestBasis(3.5, run({ temperature_f: 20, altitude_ft: 6000 }));
        const got = efficiencyAtSpeed(basis, 70, { mode: 'none', target: target(55) }).miPerKwh;
        expect(got).toBeCloseTo(speedOnly(3.5, 80, 70), 12);
    });

    it('agrees with no correction, within the accessory load, for a test at standard conditions', () => {
        const basis = rangeTestBasis(3.5, run());
        const on  = efficiencyAtSpeed(basis, 70, { mode: 'aero', target: target(70) }).miPerKwh;
        const off = efficiencyAtSpeed(basis, 70, { mode: 'none' }).miPerKwh;
        expect(Math.abs(on / off - 1)).toBeLessThan(0.01);
    });

    it('reads a test as measured when the trip repeats its conditions', () => {
        const basis = rangeTestBasis(3.5, run({ speed_mph: 75 }));
        expect(efficiencyAtSpeed(basis, 75, { mode: 'aero', target: target(55) }).factor).toBeCloseTo(1, 12);
    });

    it('takes the assumed test speed for a test that recorded none', () => {
        const basis = rangeTestBasis(3.5, run({ speed_mph: null }));
        const got = efficiencyAtSpeed(basis, 80, { mode: 'none' }).miPerKwh;
        expect(got).toBeCloseTo(speedOnly(3.5, ASSUMED_TEST_CONDITIONS.speedMph, 80), 12);
    });

    // The correction skips a mixed cycle's speed, which is right for comparing
    // tests at one target but would draw an EPA cycle flat across a speed sweep.
    it('still re-prices a mixed cycle from its mean speed, corrected or not', () => {
        const basis = rangeTestBasis(3.5, run({ speed_mph: 48, speed_basis: 'mixed' }));
        const off = efficiencyAtSpeed(basis, 75, { mode: 'none' }).miPerKwh;
        expect(off).toBeCloseTo(speedOnly(3.5, 48, 75), 12);
        const slow = efficiencyAtSpeed(basis, 55, { mode: 'aero', target: target(70) }).miPerKwh;
        const fast = efficiencyAtSpeed(basis, 85, { mode: 'aero', target: target(70) }).miPerKwh;
        expect(fast).toBeLessThan(slow * 0.8);
    });
});

describe('the bases a trip is priced from', () => {
    it('prices towing for speed only, at the towing aero fraction, whatever the reader corrects', () => {
        const basis = towingBasis(1.8, 60);
        const got = efficiencyAtSpeed(basis, 70, { mode: 'aero_wind', target: { ...target(55), temperatureF: 20 } }).miPerKwh;
        expect(got).toBeCloseTo(speedOnly(1.8, 60, 70, TOWING_AERO_FRACTION), 12);
    });

    it('prices EPA rated range for speed only, from the assumed test speed', () => {
        const basis = sourceBasis({ source: 'epa', miPerKwh: 3.2, sourceRun: { id: 'epa:9' } });
        expect(basis.speedOnly).toBe(true);
        const got = efficiencyAtSpeed(basis, 80, { mode: 'aero', target: target(70) }).miPerKwh;
        expect(got).toBeCloseTo(speedOnly(3.2, ASSUMED_TEST_CONDITIONS.speedMph, 80), 12);
    });

    it('reads a range test\'s conditions from the run, its session filling the gaps', () => {
        const basis = sourceBasis({ source: 'paired', miPerKwh: 3.2, sourceRun: run({ altitude_ft: null }) }, { altitude_ft: 5280 });
        expect(basis.conditions.altitudeFt).toBe(5280);
        expect(basis.conditions.speedMph).toBe(80);
    });

    it('has no basis without an efficiency', () => {
        expect(sourceBasis({ source: 'recorded', miPerKwh: null })).toBeNull();
        expect(rangeTestBasis(0, run())).toBeNull();
    });
});

describe('the speed-only mode is not a reader\'s choice', () => {
    it('is offered by no picker and carried by no link', () => {
        expect(CORRECTION_MODES.map(m => m.key)).not.toContain(SPEED_ONLY_MODE);
        expect(decodeCorrection(`?corr=${SPEED_ONLY_MODE}`).mode).toBe(DEFAULT_READER_MODE);
    });
});
