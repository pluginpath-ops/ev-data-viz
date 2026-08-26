import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * How a tunable constant resolves across its three layers (#261).
 *
 * The knobs used to be per-browser, which was right while they were a
 * developer sandbox and wrong once they decided what other people see: the
 * bands flag records on every EPA card, and DEFAULT_ETA is an input to the
 * physics. Publishing them adds a middle layer, and the order matters — a
 * local sandbox must still win locally, or trying a change would mean
 * imposing it.
 *
 * Loaded fresh per test: the store caches both layers on purpose (they are
 * read once, at module load, so the math modules stay static imports), so a
 * shared instance would carry one test's state into the next.
 */
function fakeStorage(initial = {}) {
    let data = { ...initial };
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
    };
}

const KEY = 'evbench.constants.overrides';

async function load(localValues = null) {
    vi.resetModules();
    globalThis.localStorage = fakeStorage(
        localValues ? { [KEY]: JSON.stringify(localValues) } : {}
    );
    return import('../../constants/overrides');
}

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('constant resolution across layers', () => {
    it('falls back to the compiled default when nothing overrides it', async () => {
        const ov = await load();
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.826);
        expect(ov.getOverrides()).toEqual({});
        expect(ov.getSiteConstants()).toEqual({});
    });

    it('uses the published site value over the default', async () => {
        const ov = await load();
        ov.seedSiteConstants({ DEFAULT_ETA: 0.84 });
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.84);
        expect(ov.getSiteConstants()).toEqual({ DEFAULT_ETA: 0.84 });
    });

    it('lets a local override win over the published value', async () => {
        const ov = await load({ DEFAULT_ETA: 0.9 });
        ov.seedSiteConstants({ DEFAULT_ETA: 0.84 });
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.9);
    });

    it('falls through to the published value for keys the local layer does not set', async () => {
        const ov = await load({ AERO_FRACTION: 0.65 });
        ov.seedSiteConstants({ DEFAULT_ETA: 0.84 });
        expect(ov.resolve('AERO_FRACTION', 0.7)).toBe(0.65);
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.84);
    });

    it('carries range constants, not just scalars', async () => {
        const ov = await load();
        ov.seedSiteConstants({ ETA_BAND: [0.7, 0.95] });
        expect(ov.resolve('ETA_BAND', [0.75, 0.92])).toEqual([0.7, 0.95]);
    });

    it('treats a null entry in either layer as absent', async () => {
        const ov = await load({ DEFAULT_ETA: null });
        ov.seedSiteConstants({ DEFAULT_ETA: null });
        // Both layers hold the key; neither holds a value. A published null is
        // how a reverted constant can look mid-flight, and it must read as
        // "nothing published" rather than as a value of null.
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.826);
    });

    it('drops a local override back to the published value', async () => {
        const ov = await load({ DEFAULT_ETA: 0.9 });
        ov.seedSiteConstants({ DEFAULT_ETA: 0.84 });
        ov.setOverride('DEFAULT_ETA', null);
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.84);
        expect(ov.getSiteConstants()).toEqual({ DEFAULT_ETA: 0.84 });
    });

    it('leaves the published layer alone when the local sandbox is reset', async () => {
        const ov = await load({ DEFAULT_ETA: 0.9, AERO_FRACTION: 0.6 });
        ov.seedSiteConstants({ DEFAULT_ETA: 0.84 });
        ov.clearOverrides();
        expect(ov.getOverrides()).toEqual({});
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.84);
        expect(ov.resolve('AERO_FRACTION', 0.7)).toBe(0.7);
    });

    it('ignores a second seed, because the math has already resolved from the first', async () => {
        const ov = await load();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        ov.seedSiteConstants({ DEFAULT_ETA: 0.84 });
        ov.seedSiteConstants({ DEFAULT_ETA: 0.99 });
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.84);
        expect(warn).toHaveBeenCalled();
    });

    it('resolves defaults when localStorage is unavailable', async () => {
        vi.resetModules();
        delete globalThis.localStorage;
        const ov = await import('../../constants/overrides');
        expect(ov.resolve('DEFAULT_ETA', 0.826)).toBe(0.826);
        expect(ov.getOverrides()).toEqual({});
    });
});

describe('parsing the published blob', () => {
    it('reads a JSON object', async () => {
        const ov = await load();
        expect(ov.parseSiteConstants('{"DEFAULT_ETA":0.84}')).toEqual({ DEFAULT_ETA: 0.84 });
    });

    it('reads an already-parsed object unchanged', async () => {
        const ov = await load();
        expect(ov.parseSiteConstants({ AERO_FRACTION: 0.65 })).toEqual({ AERO_FRACTION: 0.65 });
    });

    it('resolves an absent, empty or unusable setting to no overrides', async () => {
        const ov = await load();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Every one of these must leave the site on its compiled defaults
        // rather than refuse to start: a hand-edited row should not be able to
        // take the app down.
        for (const raw of [null, undefined, '', 'not json', '[1,2]', '"a string"', '7']) {
            expect(ov.parseSiteConstants(raw), `${JSON.stringify(raw)}`).toEqual({});
        }
        expect(warn).toHaveBeenCalled();
    });
});
