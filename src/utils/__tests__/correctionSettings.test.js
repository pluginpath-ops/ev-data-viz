import { describe, it, expect } from 'vitest';
import {
    DEFAULT_CORRECTION_TARGET, normalizeCorrectionTarget, encodeCorrection, decodeCorrection, targetDiffers,
} from '../correctionSettings';

describe('correctionSettings', () => {
    it('defaults to corrected for everything, to the standard conditions, and writes nothing', () => {
        expect(DEFAULT_CORRECTION_TARGET).toEqual({ speedMph: 70, temperatureF: 70, altitudeFt: 0, accessoryW: null });
        expect(encodeCorrection({ mode: 'aero_wind', target: DEFAULT_CORRECTION_TARGET })).toEqual([]);
        expect(decodeCorrection('')).toEqual({ mode: 'aero_wind', target: DEFAULT_CORRECTION_TARGET });
    });

    it('records turning it off, so a link that did keeps it off', () => {
        expect(encodeCorrection({ mode: 'none' })).toEqual([['corr', 'none']]);
        expect(decodeCorrection('corr=none').mode).toBe('none');
    });

    it('round-trips a mode and a target through the URL', () => {
        const setting = { mode: 'aero', target: { speedMph: 65, temperatureF: 75, altitudeFt: 1000, accessoryW: null } };
        const search = new URLSearchParams(encodeCorrection(setting)).toString();
        expect(search).toBe('corr=aero&c_spd=65&c_tmp=75&c_alt=1000');
        expect(decodeCorrection(search)).toEqual(setting);
    });

    it('holds a hand-edited link to the sliders, and drops what it cannot read', () => {
        expect(normalizeCorrectionTarget({ speedMph: 67.3, temperatureF: 10, altitudeFt: 'high' }))
            .toEqual({ speedMph: 65, temperatureF: 10, altitudeFt: 0, accessoryW: null });
        expect(decodeCorrection('corr=nonsense').mode).toBe('aero_wind');
    });

    it('says when the target has moved', () => {
        expect(targetDiffers(DEFAULT_CORRECTION_TARGET)).toBe(false);
        expect(targetDiffers({ ...DEFAULT_CORRECTION_TARGET, altitudeFt: 500 })).toBe(true);
    });
});

describe('the sliders reach 45–90 mph, 0–100°F and 8,000 ft (#449)', () => {
    it('accepts the new extremes, and holds anything further to them', () => {
        const at = (over) => normalizeCorrectionTarget({ ...DEFAULT_CORRECTION_TARGET, ...over });
        expect(at({ temperatureF: 0 }).temperatureF).toBe(0);
        expect(at({ temperatureF: 100 }).temperatureF).toBe(100);
        expect(at({ altitudeFt: 8000 }).altitudeFt).toBe(8000);
        expect(at({ temperatureF: -20 }).temperatureF).toBe(0);
        expect(at({ temperatureF: 120 }).temperatureF).toBe(100);
        expect(at({ altitudeFt: 12000 }).altitudeFt).toBe(8000);
        expect(decodeCorrection('c_tmp=0&c_alt=8000').target).toMatchObject({ temperatureF: 0, altitudeFt: 8000 });
        // Speed reaches 45–90 mph (owner, 2026-10-25).
        expect(at({ speedMph: 45 }).speedMph).toBe(45);
        expect(at({ speedMph: 90 }).speedMph).toBe(90);
        expect(at({ speedMph: 30 }).speedMph).toBe(45);
        expect(at({ speedMph: 100 }).speedMph).toBe(90);
    });
});

describe('the accessory load, auto until the reader sets it (#449)', () => {
    it('writes nothing on auto, and decodes a missing or unreadable parameter as auto', () => {
        expect(encodeCorrection({ mode: 'aero_wind', target: { ...DEFAULT_CORRECTION_TARGET, temperatureF: 20 } }))
            .toEqual([['c_tmp', '20']]);
        for (const search of ['', 'c_acc=auto', 'c_acc=abc', 'c_acc=']) {
            expect(decodeCorrection(search).target.accessoryW).toBeNull();
        }
    });

    it('round-trips a set load through c_acc', () => {
        const setting = { mode: 'aero_wind', target: { ...DEFAULT_CORRECTION_TARGET, accessoryW: 2300 } };
        const search = new URLSearchParams(encodeCorrection(setting)).toString();
        expect(search).toBe('c_acc=2300');
        expect(decodeCorrection(search)).toEqual(setting);
    });

    it('holds a hand-edited load to 250–5,000 W in steps of 50', () => {
        expect(decodeCorrection('c_acc=6000').target.accessoryW).toBe(5000);
        expect(decodeCorrection('c_acc=100').target.accessoryW).toBe(250);
        expect(decodeCorrection('c_acc=1234').target.accessoryW).toBe(1250);
    });

    it('counts a set load as the target having moved, so "reset" appears and clears it', () => {
        expect(targetDiffers({ ...DEFAULT_CORRECTION_TARGET, accessoryW: 400 })).toBe(true);
        expect(targetDiffers({ ...DEFAULT_CORRECTION_TARGET, accessoryW: null })).toBe(false);
        expect(normalizeCorrectionTarget(DEFAULT_CORRECTION_TARGET).accessoryW).toBeNull();
    });

    it('is named in a caption only when set, since auto follows the temperature already stated', async () => {
        const { correctionTargetText } = await import('../correctionSettings');
        expect(correctionTargetText(DEFAULT_CORRECTION_TARGET)).toBe('70 mph · 70°F · 0 ft');
        expect(correctionTargetText({ ...DEFAULT_CORRECTION_TARGET, accessoryW: 2300 })).toBe('70 mph · 70°F · 0 ft · 2,300 W');
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
