import { describe, it, expect } from 'vitest';
import { resolveRangeSource, pricedAtSpeedMph } from '../rangeSource';
import { simulateRoadTrip } from '../roadTripSimulation';
import { STANDARD_CONDITIONS } from '../../constants/epa';

const rangeRun = (over = {}) => ({
    id: 2, kind: 'range', name: 'R', start_soc: 90, end_soc: 10,
    distance_miles: 240, energy_kwh: 75, speed_mph: 70, temperature_f: 70, altitude_ft: 0, ...over,
});
const charging = { id: 1, kind: 'charging', name: 'C' };
const veh = r => ({ id: 9, socWindowKwh: 80, runs: [charging, r] });
const resolve = (r, opts) => resolveRangeSource(charging, { vehicle: veh(r), explicitPairing: r, ...opts });

describe('correction at the range-source chokepoint', () => {
    it('leaves figures untouched when no correction is asked for', () => {
        const res = resolve(rangeRun());
        expect(res.correction).toBeNull();
        expect(res.miPerSoc).toBe(3);
    });

    it('corrects an 80 mph basis upward', () => {
        const at80 = rangeRun({ speed_mph: 80 });
        const off = resolve(at80);
        const on  = resolve(at80, { correction: { mode: 'aero' } });
        expect(on.miPerSoc).toBeGreaterThan(off.miPerSoc);
    });

    it('moves miPerKwh and miPerSoc by the same factor', () => {
        const at80 = rangeRun({ speed_mph: 80 });
        const off = resolve(at80);
        const on  = resolve(at80, { correction: { mode: 'aero' } });
        expect(on.miPerKwh / off.miPerKwh).toBeCloseTo(on.miPerSoc / off.miPerSoc, 9);
    });

    it('reports what it did, so a chart can say so', () => {
        const on = resolve(rangeRun({ speed_mph: 80 }), { correction: { mode: 'aero' } });
        expect(on.correction.applied).toContain('speed');
        expect(on.correction.note).toMatch(/corrected \+/);
    });

    it('keeps provenance intact through correction', () => {
        const on = resolve(rangeRun({ speed_mph: 80 }), { correction: { mode: 'aero' } });
        expect(on.source).toBe('paired');
        expect(on.sourceRun.id).toBe(2);
    });
});

describe('conditions come from the range test, falling back to its session', () => {
    it('fills in a session altitude for a run that omits one', () => {
        const noAlt = rangeRun({ altitude_ft: null });
        const res = resolve(noAlt, {
            correction: { mode: 'aero' },
            session: { altitude_ft: 5280, temperature_f: 70 },
        });
        expect(res.correction.applied).toContain('altitude');
        expect(res.miPerSoc).toBeLessThan(3);
    });

    it("lets a run's own altitude beat its session's", () => {
        const res = resolve(rangeRun({ altitude_ft: 0 }), {
            correction: { mode: 'aero' },
            session: { altitude_ft: 5280 },
        });
        expect(res.miPerSoc).toBeCloseTo(3, 9);
    });

    it('leaves a run with no conditions alone and says which are missing', () => {
        const bare = rangeRun({ speed_mph: null, temperature_f: null, altitude_ft: null });
        const res = resolve(bare, { correction: { mode: 'aero' } });
        expect(res.miPerSoc).toBeCloseTo(3, 9);
        expect(res.correction.missing).toHaveLength(3);
    });
});

// Road Trip re-prices the resolved efficiency from the test's speed to the
// travel speed. When correction has already moved it to the standard speed,
// handing the simulation the test's own speed counted speed twice: an 80 mph
// test read 4.00 mi/kWh at 70 mph uncorrected and 4.85 corrected.
describe('the speed a resolved figure is priced at', () => {
    const at80 = rangeRun({ speed_mph: 80, distance_miles: 105.3, energy_kwh: 32 });
    const priceAt70 = (opts) => {
        const src = resolve(at80, opts);
        return simulateRoadTrip({
            batteryKwh: 80, miPerKwh: src.miPerKwh,
            testSpeedMph: pricedAtSpeedMph(src, at80.speed_mph),
            chargingData: [{ soc: 0, time: 0 }, { soc: 100, time: 100 }],
            startSoc: 90, minSoc: 10, destinationMinSoc: 10,
            legDistanceMi: 100, totalDistanceMi: 100,
            speedMph: STANDARD_CONDITIONS.speedMph, mode: 'distance', overheadMinutes: 0,
        }).correctedMiPerKwh;
    };

    it('prices an 80 mph test the same at 70 mph with correction on or off', () => {
        const off = priceAt70();
        const on  = priceAt70({ correction: { mode: 'aero' } });
        expect(off).toBeGreaterThan(3.9);
        expect(on / off).toBeCloseTo(1, 2);
    });

    it('is the standard speed only when correction applied the speed axis', () => {
        expect(pricedAtSpeedMph(resolve(at80), 80)).toBe(80);
        expect(pricedAtSpeedMph(resolve(at80, { correction: { mode: 'aero' } }), 80))
            .toBe(STANDARD_CONDITIONS.speedMph);
        const mixed = rangeRun({ speed_mph: 80, speed_basis: 'mixed' });
        expect(pricedAtSpeedMph(resolve(mixed, { correction: { mode: 'aero' } }), 80)).toBe(80);
    });
});
