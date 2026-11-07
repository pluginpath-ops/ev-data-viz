import { describe, it, expect } from 'vitest';
import { encodeCostToDriveKey, decodeCostToDriveKey, normalizeCostToDrive } from '../costToDriveKey';
import { DEFAULT_COST_TO_DRIVE, COST_TO_DRIVE_FIELDS } from '../../constants/costToDrive';

const settings = (over = {}) => normalizeCostToDrive({ ...DEFAULT_COST_TO_DRIVE, ...over });

describe('the Cost to Drive key', () => {
    it('an untouched page has no key', () => {
        expect(encodeCostToDriveKey(DEFAULT_COST_TO_DRIVE)).toBeNull();
        expect(decodeCostToDriveKey(null)).toEqual({ settings: settings(), error: null });
    });

    it('round-trips every field at its far ends', () => {
        for (const f of COST_TO_DRIVE_FIELDS) {
            const values = f.kind === 'num' ? [f.min, f.max]
                : f.kind === 'bool' ? [true, false]
                : f.kind === 'enum' ? f.values
                : f.kind === 'week' ? ['OOOOOOO', 'LLLLLLL', 'DLODLOD']
                : [0, 127];
            for (const v of values) {
                const s = settings({ [f.key]: v });
                expect(decodeCostToDriveKey(encodeCostToDriveKey(s)).settings, `${f.key}=${v}`).toEqual(s);
            }
        }
    });

    it('round-trips a whole changed week, and stays short', () => {
        const s = settings({
            level: 0, week: 'LLLDDOO', planned: 0b0100001, longMi: 300, winterF: -10,
            homePrice: 0.31, gasPrice: 4.79, efficiencyFrom: 'epa', season: 'summer',
        });
        const key = encodeCostToDriveKey(s);
        expect(decodeCostToDriveKey(key).settings).toEqual(s);
        expect(key.length).toBeLessThan(30);
    });

    // Golden keys: if one of these changes, a field moved and every shared
    // link now says something else. Append fields; never reorder them.
    it('golden keys', () => {
        expect(encodeCostToDriveKey(settings({ level: 0 }))).toBe('1.AQA');
        expect(encodeCostToDriveKey(settings({ season: 'summer' }))).toBe('1.gIBAAQ');
        expect(encodeCostToDriveKey(settings({ week: 'LLLLLLL', longMi: 250 }))).toBe('1.wBDFCDE');
    });

    it('holds values to their sliders', () => {
        expect(normalizeCostToDrive({ homePrice: 0.1749 }).homePrice).toBe(0.17);
        expect(normalizeCostToDrive({ chargeTo: 200 }).chargeTo).toBe(100);
        expect(normalizeCostToDrive({ week: 'XYZ' }).week).toBe('LDLDLDO');
        expect(normalizeCostToDrive({ winterF: -27 }).winterF).toBe(-20);
    });

    it('a key that cannot be read shows the defaults and says why', () => {
        for (const bad of ['1.***', '1.', '1.AQ', '1.AQAAAA', 'garbage']) {
            const r = decodeCostToDriveKey(bad);
            expect(r.settings, bad).toEqual(settings());
            expect(r.error, bad).toBeTruthy();
        }
        expect(decodeCostToDriveKey('2.AQA').error).toMatch(/newer version/);
    });
});
