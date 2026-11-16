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
                : f.kind === 'text' ? ['', 'My Accord', 'Café 4×4 🚗', 'x'.repeat(f.max)]
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
        expect(encodeCostToDriveKey(settings({ level: 0 }))).toBe('4.AQA');
        expect(encodeCostToDriveKey(settings({ season: 'summer' }))).toBe('4.gIBAAQ');
        expect(encodeCostToDriveKey(settings({ week: 'LLLLLLL', longMi: 250 }))).toBe('4.wBDFCPUB');
        // Version 4's moved defaults and loosened minimums. A price of 0 or a
        // detour of 0 is index 0 — the bytes version 3 spent on its old
        // minimums, so only the version tells them apart.
        expect(encodeCostToDriveKey(settings({ stopBy: 30 }))).toBe('4.gIACBA');
        expect(encodeCostToDriveKey(settings({ homePrice: 0 }))).toBe('4.IAA');
        expect(encodeCostToDriveKey(settings({ fastPrice: 0 }))).toBe('4.gIAgAA');
        expect(encodeCostToDriveKey(settings({ detourMin: 0 }))).toBe('4.gIABAA');
        expect(encodeCostToDriveKey(settings({ homePrice: 0.31, fastPrice: 0.6, detourMin: 12, stopBy: 40 }))).toBe('4.oIAjHwwGPA');
    });

    // What versions 1-3 left out of a key for stop-by and fast price.
    const V3_DEFAULTS_NOW = { stopBy: 30, fastPrice: 0.48 };

    it('still reads version-3 keys, with their own defaults', () => {
        const v3 = (over) => settings({ ...V3_DEFAULTS_NOW, ...over });
        expect(decodeCostToDriveKey('3.AQA')).toEqual({ settings: v3({ level: 0 }), error: null });
        expect(decodeCostToDriveKey('3.gIBAAQ')).toEqual({ settings: v3({ season: 'summer' }), error: null });
        expect(decodeCostToDriveKey('3.wBDFCPUB')).toEqual({ settings: v3({ week: 'LLLLLLL', longMi: 250 }), error: null });
    });

    // Numbers are stored as steps above the field's minimum, and version 4
    // lowered three minimums: these keys were made by the version-3 codec
    // (git show 11fa895) and must keep their meaning.
    it('reads a version-3 home price, fast price and detour against the old minimums', () => {
        const v3 = (over) => settings({ ...V3_DEFAULTS_NOW, ...over });
        expect(decodeCostToDriveKey('3.IAA').settings).toEqual(v3({ homePrice: 0.05 }));
        expect(decodeCostToDriveKey('3.gIAgAA').settings).toEqual(v3({ fastPrice: 0.15 }));
        expect(decodeCostToDriveKey('3.gIABAA').settings).toEqual(v3({ detourMin: 5 }));
        expect(decodeCostToDriveKey('3.oIAjGgcGLQ').settings)
            .toEqual(v3({ homePrice: 0.31, fastPrice: 0.6, detourMin: 12, stopBy: 40 }));
    });

    it('lets prices be free and the detour nil, and round-trips the new ends', () => {
        for (const over of [{ homePrice: 0, fastPrice: 0, detourMin: 0 }, { homePrice: 1, fastPrice: 1.5 }]) {
            const s = settings(over);
            expect(s).toMatchObject(over);
            expect(decodeCostToDriveKey(encodeCostToDriveKey(s)).settings).toEqual(s);
        }
    });

    it('defaults to a 25% stop and a 42¢ fast price, left out of the key', () => {
        expect(DEFAULT_COST_TO_DRIVE).toMatchObject({ stopBy: 25, fastPrice: 0.42 });
        expect(encodeCostToDriveKey(settings({ stopBy: 25, fastPrice: 0.42 }))).toBeNull();
        const old = settings({ stopBy: 30, fastPrice: 0.48 });
        expect(decodeCostToDriveKey(encodeCostToDriveKey(old)).settings).toEqual(old);
    });

    // Versions 1 and 2 left the old week out of the key: long days between
    // short ones and a planned Sunday stop. Their links keep it.
    const OLD_WEEK = { week: 'LDLDLDO', planned: 0b1000000, dailyMi: 45, dailyCity: 40, longMi: 220, longCity: 15 };

    it('still reads version-2 keys, with their own defaults', () => {
        const v2 = (over) => settings({ ...OLD_WEEK, ...V3_DEFAULTS_NOW, ...over });
        expect(decodeCostToDriveKey('2.AQA')).toEqual({ settings: v2({ level: 0 }), error: null });
        expect(decodeCostToDriveKey('2.gIBAAQ')).toEqual({ settings: v2({ season: 'summer' }), error: null });
        expect(decodeCostToDriveKey('2.wBDFCPUB')).toEqual({ settings: v2({ week: 'LLLLLLL', longMi: 250 }), error: null });
    });

    // Version 1 keys were shared before the miles went to the mile: they
    // must still open the same week, their miles read in fives.
    it('still reads version-1 keys, with their own defaults', () => {
        // Version 1 left $3.20 gas and an 8-minute fill-up out of the key, so its links keep them.
        const v1 = (over) => settings({ ...OLD_WEEK, ...V3_DEFAULTS_NOW, gasPrice: 3.2, gasFillMin: 8, ...over });
        expect(decodeCostToDriveKey('1.AQA')).toEqual({ settings: v1({ level: 0 }), error: null });
        expect(decodeCostToDriveKey('1.gIBAAQ')).toEqual({ settings: v1({ season: 'summer' }), error: null });
        expect(decodeCostToDriveKey('1.wBDFCDE')).toEqual({ settings: v1({ week: 'LLLLLLL', longMi: 250 }), error: null });
    });

    it('leaves $4 gas and a 5-minute fill-up out of the key', () => {
        expect(encodeCostToDriveKey(settings({ gasPrice: 4, gasFillMin: 5 }))).toBe(null);
        const s = settings({ gasPrice: 3.2, gasFillMin: 8 });
        expect(decodeCostToDriveKey(encodeCostToDriveKey(s)).settings).toEqual(s);
    });

    it('keeps any whole number of miles', () => {
        const s = settings({ dailyMi: 8, longMi: 137 });
        expect(s.dailyMi).toBe(8);
        expect(decodeCostToDriveKey(encodeCostToDriveKey(s)).settings).toEqual(s);
    });

    it('carries the gas car and its name, and holds the name to 24 characters', () => {
        const s = settings({ gasCar: 'rav4', gasName: 'Our old one' });
        expect(decodeCostToDriveKey(encodeCostToDriveKey(s)).settings).toEqual(s);
        expect(normalizeCostToDrive({ gasName: 'a'.repeat(40) }).gasName).toHaveLength(24);
        expect(normalizeCostToDrive({ gasName: 'two\nlines\t' }).gasName).toBe('twolines');
        expect(normalizeCostToDrive({ gasCar: 'tesla' }).gasCar).toBe('custom');
    });

    it('a name cut short in the key is unreadable, not half read', () => {
        const key = encodeCostToDriveKey(settings({ gasName: 'Long enough name' }));
        expect(decodeCostToDriveKey(key.slice(0, -4)).error).toBeTruthy();
    });

    it('holds values to their sliders', () => {
        expect(normalizeCostToDrive({ homePrice: 0.1749 }).homePrice).toBe(0.17);
        expect(normalizeCostToDrive({ chargeTo: 200 }).chargeTo).toBe(100);
        expect(normalizeCostToDrive({ week: 'XYZ' }).week).toBe('DDDDDLO');
        expect(normalizeCostToDrive({ winterF: -27 }).winterF).toBe(-20);
    });

    it('a key that cannot be read shows the defaults and says why', () => {
        for (const bad of ['1.***', '1.', '1.AQ', '1.AQAAAA', 'garbage']) {
            const r = decodeCostToDriveKey(bad);
            expect(r.settings, bad).toEqual(settings());
            expect(r.error, bad).toBeTruthy();
        }
        expect(decodeCostToDriveKey('9.AQA').error).toMatch(/newer version/);
    });
});
