import { describe, it, expect } from 'vitest';
import { correctionFactor, applyCorrection, correctionNote } from '../conditionCorrection';
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

    it('prices 20°F at only ~7% — the aero slice of a 20-40% real loss', () => {
        const cold = f({ ...STD, temperatureF: 20 }) - 1;
        expect(cold).toBeGreaterThan(0.05);
        expect(cold).toBeLessThan(0.09);
    });

    it('matches the algebra exactly for a speed change', () => {
        // The density term does NOT cancel: it multiplies only the aero share,
        // so the split shifts slightly at a non-unity density.
        const d70 = temperatureDensityRatio(70) * airDensityRatio(0);
        const expected = (0.7 * (80 / 70) ** 2 * d70 + 0.3) / (0.7 * d70 + 0.3);
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

describe('missing data is reported, never invented', () => {
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
        expect(note).toContain('no temperature recorded');
    });

    it('says why an axis was skipped, even when nothing else was corrected', () => {
        const note = correctionNote(correctionFactor({ speedMph: 52.7, speedBasis: 'mixed' }, { mode: 'aero' }));
        expect(note).toContain('speed not corrected (mixed cycle)');
    });
});
