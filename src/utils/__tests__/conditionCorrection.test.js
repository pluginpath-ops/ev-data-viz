import { describe, it, expect } from 'vitest';
import { correctionFactor, applyCorrection, correctionNote, runConditions } from '../conditionCorrection';
import { airDensityRatio, temperatureDensityRatio } from '../epaDerivations';

const STD = { speedMph: 70, altitudeFt: 0, temperatureF: 70 };
const f = (cond, mode = 'aero') => correctionFactor(cond, { mode }).factor;

describe('identity', () => {
    it('leaves a test already at standard conditions alone', () => {
        expect(f(STD)).toBeCloseTo(1, 9);
    });

    it('corrects nothing in mode "none", whatever the conditions', () => {
        expect(f({ speedMph: 80, altitudeFt: 5280, temperatureF: 20 }, 'none')).toBe(1);
    });
});

describe('direction', () => {
    it('corrects a Denver test DOWN — thin air flattered it', () => {
        expect(f({ ...STD, altitudeFt: 5280 })).toBeLessThan(1);
    });

    it('corrects a cold test UP — it fought denser air', () => {
        expect(f({ ...STD, temperatureF: 20 })).toBeGreaterThan(1);
    });

    it('corrects a fast test UP and a slow test DOWN', () => {
        expect(f({ ...STD, speedMph: 80 })).toBeGreaterThan(1);
        expect(f({ ...STD, speedMph: 55 })).toBeLessThan(1);
    });
});

describe('magnitude', () => {
    it('prices Denver at roughly 10%', () => {
        expect(1 - f({ ...STD, altitudeFt: 5280 })).toBeGreaterThan(0.08);
        expect(1 - f({ ...STD, altitudeFt: 5280 })).toBeLessThan(0.12);
    });

    it('prices 20°F at about 17%: air density is 7% of it, the assumed heater the rest', () => {
        // 350 Wh/mi at 70 mph, heater assumed at 300 + 50 × 40 = 2,300 W.
        const cold = f({ ...STD, temperatureF: 20, whPerMile: 350 }) - 1;
        expect(cold).toBeCloseTo(0.1667, 3);
    });

    it('matches the algebra exactly for a speed change', () => {
        // The density term does NOT cancel: it multiplies only the aero share,
        // so the split shifts slightly at a non-unity density. The test has no
        // energy, so its consumption is the assumed 300 Wh/mi, 300 W of it
        // accessory — which scales as 1/v, not with the aero share.
        const d70 = temperatureDensityRatio(70) * airDensityRatio(0);
        const scale = (0.7 * d70 + 0.3) / (0.7 * (80 / 70) ** 2 * d70 + 0.3);
        const expected = 300 / ((300 - 300 / 80) * scale + 300 / 70);
        expect(f({ ...STD, speedMph: 80 })).toBeCloseTo(expected, 9);
    });

    it('corrects a speed gap harder at a higher aero fraction', () => {
        const towing = correctionFactor({ ...STD, speedMph: 80 }, { mode: 'aero', aeroFraction: 0.85 }).factor;
        expect(towing).toBeGreaterThan(f({ ...STD, speedMph: 80 }));
    });
});

describe('the case that motivated it', () => {
    it('recovers the same efficiency from an 80 mph test as from a 70 mph one', () => {
        const k = f({ ...STD, speedMph: 80 });
        const measuredAt80 = 3.20 / k;          // what an 80 mph test would read
        expect(measuredAt80 * k).toBeCloseTo(3.20, 9);
    });
});

describe('a blank axis is reported, and corrected from the assumed test conditions', () => {
    it('lists an unrecorded axis as missing while correcting what was recorded', () => {
        const r = correctionFactor({ speedMph: 80 }, { mode: 'aero' });
        expect(r.missing).toContain('altitude');
        expect(r.missing).toContain('temperature');
        expect(r.applied).toContain('speed');
        expect(r.factor).toBeGreaterThan(1);
    });

    it('leaves a run with no conditions untouched', () => {
        const r = correctionFactor({}, { mode: 'aero' });
        expect(r.factor).toBe(1);
        expect(r.missing).toHaveLength(3);
    });

    it('tolerates null conditions', () => {
        expect(correctionFactor(null, { mode: 'aero' }).factor).toBe(1);
    });

    it('corrects a blank from the assumption, not the target, so a moving target moves every blank test one way', () => {
        // Assumed 0 ft. Correcting to 6,000 ft must lift a blank-altitude test
        // exactly as it lifts one that recorded 0 ft — taking the blank as the
        // target used to shrink a fast test and grow a slow one instead.
        const target = { speedMph: 55, temperatureF: 70, altitudeFt: 6000 };
        const assumed = { speedMph: 70, temperatureF: 70, altitudeFt: 0 };
        const blank = correctionFactor({ speedMph: 74.5, temperatureF: 65 }, { mode: 'aero', target, assumed });
        const recorded = correctionFactor({ speedMph: 74.5, temperatureF: 65, altitudeFt: 0 }, { mode: 'aero', target, assumed });
        expect(blank.factor).toBeCloseTo(recorded.factor, 9);
        expect(blank.assumed).toEqual([{ axis: 'altitude', value: 0 }]);
        const atSea = correctionFactor({ speedMph: 74.5, temperatureF: 65 }, { mode: 'aero', target: { ...target, altitudeFt: 0 }, assumed });
        expect(blank.factor).toBeGreaterThan(atSea.factor);
    });

    it('does not assume a mixed cycle\'s speed: it is skipped, not blank', () => {
        const r = correctionFactor({ speedMph: 52.7, speedBasis: 'mixed', altitudeFt: 0, temperatureF: 70 }, { mode: 'aero' });
        expect(r.assumed).toEqual([]);
    });
});

describe('mixed-cycle tests', () => {
    // Aero energy goes as the mean of v²; an average speed supplies the square
    // of the mean, and <v²> > <v>², so correcting from it is invalid.
    const mixed = { speedMph: 52.7, speedBasis: 'mixed', altitudeFt: 5280, temperatureF: 80 };

    it('skips the speed axis with a reason rather than silently applying it', () => {
        const r = correctionFactor(mixed, { mode: 'aero' });
        expect(r.skipped).toContainEqual({ axis: 'speed', reason: 'mixed cycle' });
        expect(r.applied).not.toContain('speed');
    });

    it('still applies altitude and temperature — density ignores the speed trace', () => {
        const r = correctionFactor(mixed, { mode: 'aero' });
        expect(r.applied).toContain('altitude');
        expect(r.applied).toContain('temperature');
    });

    it('avoids the implausible result treating it as steady would produce', () => {
        const asMixed  = correctionFactor(mixed, { mode: 'aero' }).factor;
        const asSteady = correctionFactor({ ...mixed, speedBasis: 'steady' }, { mode: 'aero' }).factor;
        expect(asMixed).toBeGreaterThan(asSteady);
        expect(277 * asMixed).toBeGreaterThan(240);     // not the 191 mi it collapsed to
    });

    it('changes nothing at the reference speed, and leaves unflagged runs alone', () => {
        const flagged = correctionFactor({ speedMph: 70, speedBasis: 'mixed', altitudeFt: 5280, temperatureF: 70 }, { mode: 'aero' });
        const plain   = correctionFactor({ speedMph: 70, altitudeFt: 5280, temperatureF: 70 }, { mode: 'aero' });
        expect(flagged.factor).toBeCloseTo(plain.factor, 9);
        expect(correctionFactor({ speedMph: 80 }, { mode: 'aero' }).applied).toContain('speed');
    });
});

describe('one factor drives both figures', () => {
    it('scales efficiency and range-per-SoC identically', () => {
        expect(applyCorrection({ miPerKwh: 3.0, miPerSoc: 2.5 }, 1.1))
            .toEqual({ miPerKwh: 3.3000000000000003, miPerSoc: 2.75 });
    });

    it('leaves a null figure null rather than making it 0', () => {
        expect(applyCorrection({ miPerKwh: null, miPerSoc: 2 }, 1.1).miPerKwh).toBeNull();
    });

    it('passes through unchanged at factor 1', () => {
        expect(applyCorrection({ miPerKwh: 3, miPerSoc: 2 }, 1).miPerKwh).toBe(3);
    });
});

describe('the note never lets a corrected number pass for measured', () => {
    it('says nothing when nothing happened', () => {
        expect(correctionNote({ factor: 1, applied: [], missing: [], skipped: [] })).toBeNull();
    });

    it('states direction, size, axes and gaps', () => {
        const note = correctionNote(correctionFactor({ speedMph: 80, altitudeFt: 5280 }, { mode: 'aero' }));
        expect(note).toMatch(/corrected [+-]/);
        expect(note).toContain('speed');
        expect(note).toContain('temperature not recorded, taken as 70°F');
    });

    it('does not call a blank wind missing: it is calm air', () => {
        const note = correctionNote(correctionFactor({ speedMph: 80, altitudeFt: 0, temperatureF: 70 }, { mode: 'aero_wind' }));
        expect(note).not.toContain('wind');
    });

    it('says why an axis was skipped, even when nothing else was corrected', () => {
        const note = correctionNote(correctionFactor({ speedMph: 52.7, speedBasis: 'mixed' }, { mode: 'aero' }));
        expect(note).toContain('speed not corrected (mixed cycle)');
    });
});

describe('the heating and cooling a test is assumed to have run (#449)', () => {
    const accessory = (cond, opts = {}) => correctionFactor(cond, { mode: 'aero', ...opts });

    it('gives a cold test more than the air-density share, and a hot one the reverse sign', () => {
        // 20°F, 350 Wh/mi: +16.7%, against +7.3% for density alone.
        expect(f({ ...STD, temperatureF: 20, whPerMile: 350 })).toBeCloseTo(1.1667, 3);
        // 95°F, 300 Wh/mi: density alone says the warm air flattered the test
        // (−3.1%); the A/C it is assumed to have run says it was harder (+5.7%).
        expect(f({ ...STD, temperatureF: 95, whPerMile: 300 })).toBeCloseTo(1.0572, 3);
    });

    it('prices a reader’s cold target against a mild test, and a heavier override harder', () => {
        const target = { speedMph: 70, altitudeFt: 0, temperatureF: 20 };
        const mild = { ...STD, whPerMile: 280 };
        // Auto at 20°F is 2,300 W: 300 mi of range becomes about 256.
        expect(correctionFactor(mild, { mode: 'aero', target }).factor).toBeCloseTo(0.852, 3);
        expect(correctionFactor(mild, { mode: 'aero', target: { ...target, accessoryW: 4000 } }).factor).toBeCloseTo(0.7935, 3);
        // Auto and an override equal to auto are the same figure.
        expect(correctionFactor(mild, { mode: 'aero', target: { ...target, accessoryW: 2300 } }).factor)
            .toBeCloseTo(correctionFactor(mild, { mode: 'aero', target }).factor, 12);
    });

    it('leaves a test at the target alone, whatever the weather it shares with it', () => {
        expect(f({ ...STD, whPerMile: 320 })).toBeCloseTo(1, 12);
        for (const T of [0, 45, 65, 100]) {
            const same = { speedMph: 70, altitudeFt: 0, temperatureF: T, whPerMile: 320 };
            expect(correctionFactor(same, { mode: 'aero', target: same }).factor).toBeCloseTo(1, 12);
        }
    });

    it('reads a blank temperature as the base load', () => {
        const blank = accessory({ speedMph: 70, altitudeFt: 0, whPerMile: 300 });
        expect(blank.assumed).toContainEqual({ axis: 'temperature', value: 70 });
        expect(blank.factor).toBeCloseTo(1, 12);
    });

    it('uses a mixed cycle’s own average speed for the accessory term', () => {
        // The aero axis skips the speed, but a heater still costs watts per
        // hour: 2,300 W at 52.7 mph is 43.6 Wh/mi, not 32.9 at the target's 70.
        const mixed = { speedMph: 52.7, speedBasis: 'mixed', altitudeFt: 0, temperatureF: 20, whPerMile: 350 };
        const rho = (T) => 518.67 / (459.67 + T);
        const scale = (0.7 * rho(70) + 0.3) / (0.7 * rho(20) + 0.3);
        const expected = 350 / ((350 - 2300 / 52.7) * scale + 300 / 70);
        const r = accessory(mixed);
        expect(r.skipped).toContainEqual({ axis: 'speed', reason: 'mixed cycle' });
        expect(r.factor).toBeCloseTo(expected, 9);
        expect(r.factor).not.toBeCloseTo(350 / ((350 - 2300 / 70) * scale + 300 / 70), 3);
    });

    it('names the consumption it fell back on, and only then', () => {
        const noEnergy = correctionNote(accessory({ ...STD, temperatureF: 20 }));
        expect(noEnergy).toContain('consumption not recorded, taken as 300 Wh/mi');
        expect(accessory({ ...STD, temperatureF: 20 }).assumedConsumptionWhMi).toBe(300);
        const withEnergy = accessory({ ...STD, temperatureF: 20, whPerMile: 350 });
        expect(withEnergy.assumedConsumptionWhMi).toBeNull();
        expect(correctionNote(withEnergy)).not.toContain('consumption');
        expect(correctionNote(withEnergy)).toContain('accessory load');
    });

    it('does nothing in mode "none"', () => {
        const r = correctionFactor({ ...STD, temperatureF: 20, whPerMile: 350 }, { mode: 'none' });
        expect(r.factor).toBe(1);
        expect(r.applied).toEqual([]);
        expect(r.assumedConsumptionWhMi).toBeNull();
    });

    it('is in the wind mode too', () => {
        const aero = correctionFactor({ ...STD, temperatureF: 20, whPerMile: 350 }, { mode: 'aero' });
        const wind = correctionFactor({ ...STD, temperatureF: 20, whPerMile: 350 }, { mode: 'aero_wind' });
        expect(wind.applied).toContain('accessory');
        expect(wind.factor).toBeCloseTo(aero.factor, 12);
    });

    it('falls back to the aero factor, and says so, when the load exceeds the test’s whole consumption', () => {
        // 3,300 W at 70 mph is 47 Wh/mi: more than a mistyped 40 Wh/mi test used.
        const r = accessory({ ...STD, temperatureF: 0, whPerMile: 40 });
        expect(r.applied).not.toContain('accessory');
        expect(r.skipped).toContainEqual({ axis: 'accessory', reason: 'more than the test used' });
        expect(correctionNote(r)).toContain('accessory load not corrected (more than the test used)');
        expect(r.factor).toBeGreaterThan(1);
    });
});

describe('what a run says about its consumption', () => {
    it('is its energy over its distance, in Wh/mi', () => {
        expect(runConditions({ energy_kwh: 70, distance_miles: 200 }).whPerMile).toBeCloseTo(350, 9);
    });

    it('is blank when the run recorded no energy or no distance', () => {
        expect(runConditions({ distance_miles: 200 }).whPerMile).toBeNull();
        expect(runConditions({ energy_kwh: 70 }).whPerMile).toBeNull();
        expect(runConditions({ energy_kwh: 0, distance_miles: 200 }).whPerMile).toBeNull();
        expect(runConditions(null).whPerMile).toBeNull();
    });
});
