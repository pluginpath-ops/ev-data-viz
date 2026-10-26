import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakePointsDb } from './fakePointsClient';

// The batched loader against the loops it replaced (#496): same points, same
// shape, same keys, same failure behavior — in far fewer requests.
let db;
vi.mock('../supabase', () => ({ getSupabase: () => db.client }));

const { dataService } = await import('../DataService');
const { loadRunPoints, runsByIdString, pointsKnownEmpty, rangePerSocLookup, rangeAtFrom } = await import('../../utils/runPoints');

const curve = (n, base = 10) => Array.from({ length: n }, (_, i) => ({
    soc: base + i * 0.5, charge_rate: 200 - i, time_value: i * 0.4, range_value: 100 + i, temperature: 20 + (i % 3),
}));

const ROWS = {
    1: curve(30), 2: curve(25, 12), 3: curve(1500), 4: curve(40, 5), 5: [],
    // a composite's point carries its contributor count and spread
    6: curve(10).map((r, i) => ({ ...r, extra_data: { n: 3, spreadHi: i + 1, spreadLo: i - 1 } })),
};

const own = (id, count) => ({ id, kind: 'charging', dataPointCount: count });
const inheritedOf = (linkId, src, eff, cap, count) => ({
    id: `inherited_${linkId}_${src}`, _inherited: true, _realRunId: src,
    _efficiencyFactor: eff, _capacityFactor: cap, kind: 'charging', dataPointCount: count,
});
const VEHICLES = [
    { id: 'a', runs: [own(1, 30), own(2, 25), own(3, 1500), own(4, 40), own(5, 0), own(6, 10), { id: 9 }] },
    { id: 'b', runs: [inheritedOf(11, 1, 0.9, 1.1, 30), inheritedOf(12, 2, 1, 1, 25), inheritedOf(13, 5, 1, 1, 0)] },
];

// The loop all three views carried, copied from before the change.
async function oldLoop(missing, vehicles) {
    const updates = {};
    const allRuns = vehicles.flatMap(v => v.runs || []);
    for (const runId of missing) {
        try {
            const run = allRuns.find(r => String(r.id) === String(runId));
            if (run?._inherited) {
                updates[runId] = await dataService.getRunData(run._realRunId, run._efficiencyFactor ?? 1, run._capacityFactor ?? 1);
            } else {
                updates[runId] = await dataService.getRunData(runId);
            }
        } catch { updates[runId] = []; }
    }
    return updates;
}

describe('loadRunPoints', () => {
    beforeEach(() => { db = fakePointsDb(ROWS); dataService.useSupabase = true; });

    const selections = {
        'own tests': [1, 2, 4],
        'own + inherited (scaled) + the inherited one’s source': [1, 'inherited_11_1', 'inherited_12_2', 2],
        'a test over the 1000-row page': [3, 1],
        'composite points keep n and spread': [6, 1],
        'known-empty tests among others': [1, 5, 'inherited_13_5', 2],
        'a run the vehicle list does not know': [1, 9],
        'order is the order asked for': [4, 2, 1],
    };
    for (const [name, ids] of Object.entries(selections)) {
        it(`${name}: identical to the per-test loop`, async () => {
            const before = await oldLoop(ids, VEHICLES);
            db.requests.length = 0;
            const after = await loadRunPoints(dataService, ids, runsByIdString(VEHICLES));
            expect(after).toEqual(before);
            expect(Object.keys(after)).toEqual(Object.keys(before));
        });
    }

    it('is a handful of requests, not one per test', async () => {
        const ids = [1, 2, 3, 4, 'inherited_11_1', 'inherited_12_2'];
        await loadRunPoints(dataService, ids, runsByIdString(VEHICLES));
        // 4 distinct runs, 1,595 rows: two pages of one query.
        expect(db.requests).toHaveLength(2);
        const old = fakePointsDb(ROWS); db = old;
        await oldLoop(ids, VEHICLES);
        expect(old.requests.length).toBeGreaterThanOrEqual(7);
    });

    it('asks nothing for tests counted at zero points', async () => {
        const out = await loadRunPoints(dataService, [5, 'inherited_13_5'], runsByIdString(VEHICLES));
        expect(out).toEqual({ 5: [], inherited_13_5: [] });
        expect(db.requests).toHaveLength(0);
    });

    it('still fetches a test whose count is unknown', async () => {
        const out = await loadRunPoints(dataService, [9], runsByIdString(VEHICLES));
        expect(pointsKnownEmpty(VEHICLES[0].runs[6])).toBe(false);
        expect(db.requests.length).toBeGreaterThan(0);
        expect(out[9]).toEqual([]);   // run 9 has no rows in the fake, but it was asked
    });

    it('falls back to one-at-a-time when the batch fails, emptying only the test that fails', async () => {
        db.failWhen = (f) => f.run_id.length > 1 || f.run_id[0] === 2;   // the batch, and run 2 alone
        const ids = [1, 2, 4];
        const out = await loadRunPoints(dataService, ids, runsByIdString(VEHICLES));
        const expected = await (async () => { db.failWhen = (f) => f.run_id[0] === 2; return oldLoop(ids, VEHICLES); })();
        expect(out).toEqual(expected);
        expect(out[2]).toEqual([]);
        expect(out[1].length).toBe(30);
    });

    it('reads a non-numeric id on the per-test path rather than corrupting the batch query', async () => {
        const out = await loadRunPoints(dataService, [1, 'epa:7'], runsByIdString(VEHICLES));
        expect(out[1].length).toBe(30);
        expect(out['epa:7']).toEqual([]);
    });
});

describe('getPointsForRuns chunking', () => {
    it('answers a long list the same as short ones, in several requests that stay short', async () => {
        const many = {};
        for (let i = 1; i <= 250; i++) many[i] = curve(3, i % 50);
        db = fakePointsDb(many);
        const runs = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
        const all = await dataService.getPointsForRuns(runs);
        expect(db.requests.filter(r => r.from === 0)).toHaveLength(3);          // 100 + 100 + 50
        expect(Math.max(...db.requests.map(r => r.filters.run_id.length))).toBeLessThanOrEqual(100);
        for (const r of runs) expect(all[r.id]).toEqual(await dataService.getRunData(r.id));
    });
});

describe('rangePerSocLookup', () => {
    it('is what buildRangePerSocLookup returns', async () => {
        db = fakePointsDb({ 1: curve(30), 2: [{ soc: 10, range_value: 50 }], 3: [] });
        for (const id of [1, 2, 3]) {
            const viaService = await dataService.buildRangePerSocLookup(id);
            const direct = rangePerSocLookup(await dataService.getRunData(id));
            if (id === 1) { for (const soc of [0, 10, 12.3, 20, 99]) expect(viaService(soc)).toBe(direct(soc)); }
            else { expect(viaService).toBeNull(); expect(direct).toBeNull(); }
        }
    });
});

describe('rangeAtFrom', () => {
    // The old rangeAtFor body, with its per-test fetch.
    const oldRangeAt = async (src, runId) => {
        let lookup = null;
        try { lookup = await dataService.buildRangePerSocLookup(runId); } catch (_) { /* linear */ }
        return lookup ? (soc) => lookup(soc) : (soc) => Math.round(soc * src.miPerSoc * 10) / 10;
    };
    it.each([[1, 'a curve of its own'], [2, 'one point only: linear'], [3, 'no points: linear']])('range test %i (%s) maps every SoC as before', async (id) => {
        db = fakePointsDb({ 1: curve(30), 2: [{ soc: 10, range_value: 50 }], 3: [] });
        const src = { miPerSoc: 3.2 };
        const before = await oldRangeAt(src, id);
        const after = rangeAtFrom(src, await dataService.getRunData(id));
        for (const soc of [0, 5, 10, 11.7, 20, 24.5, 55, 100]) expect(after(soc)).toBe(before(soc));
    });
});
