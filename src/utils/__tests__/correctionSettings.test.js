import { describe, it, expect } from 'vitest';
import {
    DEFAULT_CORRECTION_TARGET, normalizeCorrectionTarget, encodeCorrection, decodeCorrection, targetDiffers,
} from '../correctionSettings';

describe('correctionSettings', () => {
    it('defaults to corrected for everything, to the standard conditions, and writes nothing', () => {
        expect(DEFAULT_CORRECTION_TARGET).toEqual({ speedMph: 70, temperatureF: 70, altitudeFt: 0 });
        expect(encodeCorrection({ mode: 'aero_wind', target: DEFAULT_CORRECTION_TARGET })).toEqual([]);
        expect(decodeCorrection('')).toEqual({ mode: 'aero_wind', target: DEFAULT_CORRECTION_TARGET });
    });

    it('records turning it off, so a link that did keeps it off', () => {
        expect(encodeCorrection({ mode: 'none' })).toEqual([['corr', 'none']]);
        expect(decodeCorrection('corr=none').mode).toBe('none');
    });

    it('round-trips a mode and a target through the URL', () => {
        const setting = { mode: 'aero', target: { speedMph: 65, temperatureF: 75, altitudeFt: 1000 } };
        const search = new URLSearchParams(encodeCorrection(setting)).toString();
        expect(search).toBe('corr=aero&c_spd=65&c_tmp=75&c_alt=1000');
        expect(decodeCorrection(search)).toEqual(setting);
    });

    it('holds a hand-edited link to the sliders, and drops what it cannot read', () => {
        expect(normalizeCorrectionTarget({ speedMph: 67.3, temperatureF: 10, altitudeFt: 'high' }))
            .toEqual({ speedMph: 65, temperatureF: 50, altitudeFt: 0 });
        expect(decodeCorrection('corr=nonsense').mode).toBe('aero_wind');
    });

    it('says when the target has moved', () => {
        expect(targetDiffers(DEFAULT_CORRECTION_TARGET)).toBe(false);
        expect(targetDiffers({ ...DEFAULT_CORRECTION_TARGET, altitudeFt: 500 })).toBe(true);
    });
});

describe('correctionCaption', () => {
    it('states what was corrected and to what', async () => {
        const { correctionCaption } = await import('../correctionSettings');
        expect(correctionCaption('none')).toBe('no correction');
        expect(correctionCaption('aero_wind', { speedMph: 65, temperatureF: 70, altitudeFt: 1000 }))
            .toBe('corrected for speed, altitude, temp & wind to 65 mph · 70°F · 1,000 ft');
    });
});
