import { describe, it, expect } from 'vitest';
import { compositeRange, compositeLeftOutNote } from '../compositeRange';
import { correctionFactor } from '../conditionCorrection';

const STD = { speedMph: 70, temperatureF: 70, altitudeFt: 0 };
const test = (over = {}) => ({
    id: Math.random(), kind: 'range', distance_miles: 300, energy_kwh: 100, start_soc: 100, end_soc: 0,
    speed_mph: 70, temperature_f: 70, date: '2025-05-01', ...over,
});
const car = (runs, over = {}) => ({ id: 1, socWindowKwh: 100, runs, ...over });

describe('compositeRange', () => {
    it('averages tests already at the target unchanged', () => {
        const c = compositeRange(car([test(), test({ distance_miles: 280, energy_kwh: 100 })]), { target: STD });
        expect(c.rangeMi).toBeCloseTo(290);
        expect(c.miPerKwh).toBeCloseTo(2.9);
        expect(c.nRange).toBe(2);
    });

    it('corrects each test to the target before averaging', () => {
        // An 80 mph test was harder than 70: its corrected range is higher than measured.
        const c = compositeRange(car([test({ speed_mph: 80 })]), { target: STD });
        expect(c.rangeMi).toBeGreaterThan(300);
        expect(c.tests[0].factor).toBeCloseTo(correctionFactor({ speedMph: 80, temperatureF: 70 }, { mode: 'aero', target: STD }).factor);
    });

    it('leaves out what a correction cannot honestly move', () => {
        const c = compositeRange(car([
            test({ speed_basis: 'mixed' }),
            test({ speed_mph: null }),
            test({ speed_mph: 50 }),
            test({ temperature_f: null }),
            test({ temperature_f: -10 }),
        ]), { target: STD });
        expect(c.rangeMi).toBeNull();
        expect(c.leftOut.map(o => o.reason)).toEqual(['mixed', 'noSpeed', 'speedGap', 'noTemp', 'temperature']);
        expect(compositeLeftOutNote(c)).toBe('5 tests, none steady-state in band');
    });

    it('takes a temperature from the session when the run has none', () => {
        const run = test({ temperature_f: null, session_id: 9 });
        const c = compositeRange(car([run]), { target: STD, sessionOf: () => ({ temperature_f: 70 }) });
        expect(c.nRange).toBe(1);
    });

    it('counts the pool and skips excluded tests and composites', () => {
        const c = compositeRange(car([test({ is_excluded: true }), test({ composite: { tests: [] }, is_synthetic: true })],
            { pooledRuns: [test({ is_hidden: true, distance_miles: 250, energy_kwh: 100 })] }), { target: STD });
        expect(c.nRange).toBe(1);
        expect(c.rangeMi).toBeCloseTo(250);
    });

    it('needs a full-pack window for range but not for efficiency', () => {
        const c = compositeRange(car([test({ start_soc: 60, end_soc: 20, distance_miles: 120, energy_kwh: 40 })]), { target: STD });
        expect(c.rangeMi).toBeNull();
        expect(c.miPerKwh).toBeCloseTo(3);
    });

    it('is null for a vehicle with no range test', () => {
        expect(compositeRange(car([]), { target: STD })).toBeNull();
    });
});

describe('wind correction (aero_wind)', () => {
    const at = (over) => correctionFactor({ speedMph: 70, temperatureF: 70, altitudeFt: 0, ...over }, { mode: 'aero_wind', target: STD }).factor;

    it('credits a headwind and debits a tailwind', () => {
        expect(at({ windMph: 10, windDirDeg: 180 })).toBeGreaterThan(1);
        expect(at({ windMph: 10, windDirDeg: 0 })).toBeLessThan(1);
    });

    it('treats a wind with no direction as a round trip, which always costs', () => {
        // An out-and-back: (80² + 60²) / 2 = 70² + 10², so the aero share rises by
        // 100/4900 — about +1.4% overall at a 0.70 aero fraction.
        expect(at({ windMph: 10 })).toBeCloseTo(1.014, 3);
        // The same as the two legs taken one at a time, to 0.1%, not to six
        // places: the accessory load (#449) makes the factor very slightly
        // non-linear in the aero load, so the mean of two legs' factors is no
        // longer exactly the factor of their mean load.
        expect(Math.abs(at({ windMph: 10 }) - (at({ windMph: 10, windDirDeg: 0 }) + at({ windMph: 10, windDirDeg: 180 })) / 2)).toBeLessThan(0.001);
        // An out-and-back in a quartering wind costs the same: the legs' cross terms cancel.
        expect(Math.abs((at({ windMph: 10, windDirDeg: 45 }) + at({ windMph: 10, windDirDeg: 225 })) / 2 - at({ windMph: 10 }))).toBeLessThan(0.001);
        // A crosswind adds the same w², by the apparent-wind law (exactly: one air speed).
        expect(at({ windMph: 10, windDirDeg: 90 })).toBeCloseTo(at({ windMph: 10 }), 6);
    });

    it('needs a held speed, and is not offered by the plain aero mode', () => {
        const r = correctionFactor({ speedMph: 60, speedBasis: 'mixed', windMph: 10 }, { mode: 'aero_wind', target: STD });
        expect(r.skipped.map(s => s.axis)).toContain('wind');
        expect(correctionFactor({ speedMph: 70, temperatureF: 70, windMph: 10 }, { mode: 'aero', target: STD }).factor).toBeCloseTo(1);
    });
});
