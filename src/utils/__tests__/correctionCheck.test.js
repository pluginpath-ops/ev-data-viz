import { describe, it, expect } from 'vitest';
import { correctionFactor } from '../conditionCorrection';
import {
    CHECK_MODE, checkTests, epaCurveOf, epaAeroShare, vehiclePairs, correctionCheck, fitConstants, FIT_MIN_VEHICLES,
} from '../correctionCheck';
import { DEFAULT_ACCESSORY_W, ACCESSORY_COMFORT_BAND_F, ACCESSORY_HEAT_W_PER_F, ACCESSORY_COOL_W_PER_F } from '../../constants/epa';

let nextId = 1;
const test = (over = {}) => ({
    id: nextId++, name: 'test', kind: 'range', distance_miles: 200, energy_kwh: 60,
    speed_mph: 70, speed_basis: 'steady', temperature_f: 65, altitude_ft: 0, ...over,
});
const target = (speedMph, temperatureF = 65, altitudeFt = 0) => ({ speedMph, temperatureF, altitudeFt, accessoryW: null });

describe('correctionFactor: the options only the check passes', () => {
    it('a road-load curve with no B term and the same aero share is the generic model', () => {
        // L = (A + C v² ρ) / (A + C v_ref²) with A = 1 − f and C = f / v_ref² is f (v/v_ref)² ρ + (1 − f).
        const f = 0.62;
        const roadLoad = { a: 1 - f, b: 0, c: f / 70 ** 2 };
        const conditions = { speedMph: 80, temperatureF: 30, altitudeFt: 5000, windMph: 10, whPerMile: 330 };
        const opts = { mode: CHECK_MODE, target: target(65) };
        expect(correctionFactor(conditions, { ...opts, roadLoad }).factor)
            .toBeCloseTo(correctionFactor(conditions, { ...opts, aeroFraction: f }).factor, 12);
    });

    it('accessory constants passed as the knobs give the knobs\' answer, and other values move a cold test', () => {
        const cold = { speedMph: 70, temperatureF: 20, altitudeFt: 0, whPerMile: 380 };
        const opts = { mode: CHECK_MODE, target: target(70, 70) };
        const knobs = { baseW: DEFAULT_ACCESSORY_W, comfortBand: ACCESSORY_COMFORT_BAND_F, heatWPerF: ACCESSORY_HEAT_W_PER_F, coolWPerF: ACCESSORY_COOL_W_PER_F };
        const base = correctionFactor(cold, opts).factor;
        expect(correctionFactor(cold, { ...opts, accessory: knobs }).factor).toBeCloseTo(base, 12);
        expect(correctionFactor(cold, { ...opts, accessory: { ...knobs, heatWPerF: 0 } }).factor).toBeLessThan(base);
    });
});

describe('checkTests', () => {
    it('says why each test is left out, and takes a temperature from the session', () => {
        const runs = [
            test({ id: 1 }),
            test({ id: 2, is_excluded: true }),
            test({ id: 3, energy_kwh: null }),
            test({ id: 4, speed_mph: null }),
            test({ id: 5, temperature_f: null, session_id: 9 }),
            test({ id: 6, temperature_f: null }),
            test({ id: 7, kind: 'charging' }),
        ];
        const { tests, leftOut } = checkTests({ runs }, (r) => (r.session_id === 9 ? { temperature_f: 50 } : null));
        expect(tests.map(t => t.run.id)).toEqual([1, 5]);
        expect(tests[1].conditions.temperatureF).toBe(50);
        expect(Object.fromEntries(leftOut.map(x => [x.run.id, x.reason]))).toEqual({ 2: 'excluded', 3: 'noEnergy', 4: 'noSpeed', 6: 'noTemp' });
    });

    it('a vehicle with one usable test has no pair, and says so', () => {
        const { tests, leftOut } = checkTests({ runs: [test({ id: 11 })] });
        expect(tests).toEqual([]);
        expect(leftOut).toEqual([expect.objectContaining({ reason: 'alone' })]);
    });
});

describe('epaCurveOf', () => {
    const tv = (id, sets) => ({ test_vehicle_id: id, epa_coefficient_sets: sets });
    const set = { is_primary: true, category: 'City/Highway', target_a: 30, target_b: 0.2, target_c: 0.018 };
    it('takes the chosen configuration, and never guesses among several', () => {
        expect(epaCurveOf([])).toEqual({ reason: 'unlinked' });
        expect(epaCurveOf([{ isPrimary: false, epaTestVehicle: tv('a', [set]) }, { isPrimary: false, epaTestVehicle: tv('b', [set]) }]))
            .toEqual({ reason: 'unchosen' });
        expect(epaCurveOf([{ isPrimary: true, epaTestVehicle: tv('a', []) }])).toEqual({ reason: 'noCoeffs' });
        expect(epaCurveOf([{ isPrimary: false, epaTestVehicle: tv('b', [set]) }, { isPrimary: true, epaTestVehicle: tv('a', [set]) }]))
            .toMatchObject({ a: 30, b: 0.2, c: 0.018, testVehicleId: 'a', basis: 'chosen' });
    });

    it('aero share is the C term over the whole curve', () => {
        expect(epaAeroShare({ a: 30, b: 0, c: 0.01 }, 70)).toBeCloseTo(49 / 79, 12);
    });
});

describe('vehiclePairs', () => {
    const tests = (runs) => checkTests({ runs }).tests;

    it('two tests at the same conditions: the correction changes nothing', () => {
        const [p] = vehiclePairs(tests([test({ id: 21, distance_miles: 210 }), test({ id: 22 })]), { reason: 'unlinked' });
        expect(p.misses.generic.predicted).toBeCloseTo(p.misses.none.predicted, 12);
        expect(p.misses.epa).toBeNull();
    });

    it('the test nearer the standard conditions is the reference, and a faster test at the same mi/kWh reads high', () => {
        const [p] = vehiclePairs(tests([test({ id: 31, speed_mph: 80 }), test({ id: 32, speed_mph: 70, temperature_f: 70 })]), { reason: 'unlinked' });
        expect(p.ref.run.id).toBe(32);
        expect(p.misses.none.pct).toBeCloseTo(0, 12);
        expect(p.misses.generic.pct).toBeGreaterThan(0);
    });
});

/**
 * Tests made by the generic model itself, at a known aero fraction: the
 * consumption at a speed is the traction at 70 mph re-priced by the load
 * ratio, plus the base draw over the speed.
 */
function syntheticVehicle(id, c70, aeroFraction, baseW, speeds) {
    const load = (v) => aeroFraction * (v / 70) ** 2 + (1 - aeroFraction);
    const traction70 = c70 - baseW / 70;
    return {
        id, name: `car ${id}`,
        runs: speeds.map(v => {
            const whPerMile = traction70 * load(v) / load(70) + baseW / v;
            return test({ speed_mph: v, temperature_f: 65, distance_miles: 200, energy_kwh: 200 * whPerMile / 1000 });
        }),
        epaMappings: [],
    };
}

describe('fitConstants', () => {
    it('finds the aero fraction the tests were made with', () => {
        const vehicles = [
            syntheticVehicle(101, 280, 0.6, 300, [60, 70, 80]),
            syntheticVehicle(102, 330, 0.6, 300, [55, 75]),
            syntheticVehicle(103, 250, 0.6, 300, [65, 80]),
            syntheticVehicle(104, 400, 0.6, 300, [50, 70, 85]),
        ];
        const fit = fitConstants(correctionCheck(vehicles).vehicles, 'generic', { bootstrap: 3 });
        const aero = fit.params.find(p => p.key === 'AERO_FRACTION');
        expect(aero.fitted).toBeCloseTo(0.6, 1);
        expect(fit.loss.fitted).toBeLessThan(fit.loss.knobs);
        // No test is outside the comfort band, so heating and cooling are held.
        expect(fit.params.find(p => p.key === 'ACCESSORY_HEAT_W_PER_F')).toMatchObject({ fitted: null, supportVehicles: 0 });
    });

    it(`holds a constant fewer than ${FIT_MIN_VEHICLES} vehicles can move`, () => {
        const vehicles = [syntheticVehicle(201, 280, 0.6, 300, [60, 80]), syntheticVehicle(202, 300, 0.6, 300, [60, 80])];
        const aero = fitConstants(correctionCheck(vehicles).vehicles, 'generic', { bootstrap: 0 }).params.find(p => p.key === 'AERO_FRACTION');
        expect(aero.fitted).toBeNull();
        expect(aero.heldBecause).toMatch(/only 2 vehicles/);
    });
});
