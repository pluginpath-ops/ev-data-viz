import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakePointsDb } from './fakePointsClient';

// The shared points cache (#498): what it saves, and — the part that matters
// more — every way a cached run stops being served once its points change.
let db;
vi.mock('../supabase', () => ({ getSupabase: () => db.client }));

const { dataService } = await import('../DataService');
const { loadRunPoints, runsByIdString } = await import('../../utils/runPoints');

const curve = (n, base = 10) => Array.from({ length: n }, (_, i) => ({
    soc: base + i, charge_rate: 150 - i, time_value: i * 0.5, range_value: 90 + i, temperature: 20,
}));
const ROWS = () => ({ 1: curve(20), 2: curve(20, 30), 3: curve(5) });
const reads = () => db.requests.filter(r => r.filters);
const VEHICLES = [
    { id: 'a', runs: [{ id: 1, dataPointCount: 20 }, { id: 2, dataPointCount: 20 }, { id: 3, dataPointCount: 5 }] },
    { id: 'b', runs: [{ id: 'inherited_9_1', _inherited: true, _realRunId: 1, _efficiencyFactor: 0.9, _capacityFactor: 1.2, dataPointCount: 20 }] },
];
const load = (ids) => loadRunPoints(dataService, ids, runsByIdString(VEHICLES));

beforeEach(() => {
    db = fakePointsDb(ROWS());
    dataService.useSupabase = true;
    dataService.user = { id: 'u' };
    dataService.invalidateRunPoints();
});

describe('what the cache saves', () => {
    it('a second read of the same tests asks the database nothing', async () => {
        const first = await load([1, 2]);
        const asked = reads().length;
        expect(asked).toBeGreaterThan(0);
        expect(await load([1, 2])).toEqual(first);
        expect(reads()).toHaveLength(asked);
    });

    it('two readers asking at once share one request (in-flight dedupe)', async () => {
        const [a, b] = await Promise.all([load([1, 2]), load([2, 1])]);
        expect(reads()).toHaveLength(1);
        expect(a[1]).toEqual(b[1]);
        expect(a[2]).toEqual(b[2]);
    });

    it('an own test and an inherited test of the same run are one fetch, each scaled by its own factors', async () => {
        const out = await load([1, 'inherited_9_1']);
        expect(reads()).toHaveLength(1);
        expect(reads()[0].filters.run_id).toEqual([1]);
        expect(out[1][0].chargeRate).toBe(150);
        expect(out['inherited_9_1'][0].chargeRate).toBe(180);          // × capacity 1.2
        expect(out['inherited_9_1'][0].range).toBe(Math.round(90 * 1.2 * 0.9 * 10) / 10);
    });

    it('a view that needs one more test asks only for that one', async () => {
        await load([1, 2]);
        db.requests.length = 0;
        await load([1, 2, 3]);
        expect(reads()).toHaveLength(1);
        expect(reads()[0].filters.run_id).toEqual([3]);
    });

    it('serves exactly what the uncached read serves', async () => {
        for (const id of [1, 2, 3]) {
            expect(await dataService.getRunDataCached(id)).toEqual(await dataService.getRunData(id));
            expect(await dataService.getRunDataCached(id)).toEqual(await dataService.getRunData(id));
        }
        expect(await dataService.getRunDataCached('inherited_9_1', 0.9, 1.2)).toEqual(await dataService.getRunData('inherited_9_1', 0.9, 1.2));
    });

    it('the rows it holds are never handed out to be changed', async () => {
        const a = await dataService.getRunDataCached(1);
        a[0].soc = 999; a.pop();
        const b = await dataService.getRunDataCached(1);
        expect(b).toHaveLength(20);
        expect(b[0].soc).toBe(10);
    });
});

describe('invalidation: a changed run is never served stale', () => {
    const warm = async () => { await load([1, 2, 3]); db.requests.length = 0; };

    it('replaceRunData', async () => {
        await warm();
        await dataService.replaceRunData(2, [{ soc: 5, chargeRate: 77, time: 1 }]);
        const after = await dataService.getRunDataCached(2);
        expect(after).toHaveLength(1);
        expect(after[0].chargeRate).toBe(77);
        expect(await dataService.getRunDataCached(1)).toHaveLength(20);   // neighbours stay cached
    });

    it('mergeRunData', async () => {
        await warm();
        await dataService.mergeRunData(3, [{ soc: 99, chargeRate: 1, time: 9 }], 'soc');
        expect((await dataService.getRunDataCached(3)).length).toBe(6);
    });

    it('writeCompositePoints (every composite rebuild goes through it)', async () => {
        await warm();
        await dataService.writeCompositePoints(1, [{ soc: 1, chargeRate: 2, time: 3, n: 4 }]);
        const after = await dataService.getRunDataCached(1);
        expect(after).toHaveLength(1);
        expect(after[0].n).toBe(4);
    });

    it('deleteRun', async () => {
        await warm();
        dataService.user = { id: 'u' };
        db.rows.splice(0, db.rows.length, ...db.rows.filter(r => r.run_id !== 3));   // the database cascades
        await dataService.deleteRun('a', 3);
        expect(await dataService.getRunDataCached(3)).toEqual([]);
    });

    it('addRun with points, for an id read before it had any', async () => {
        await dataService.getRunDataCached(55);                       // cached as empty
        dataService.user = { id: 'u' };
        db.client.from = ((orig) => (t) => t === 'runs'
            ? { insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 55, kind: 'range' }, error: null }) }) }), update: () => ({ eq: () => Promise.resolve({}) }) }
            : orig(t))(db.client.from);
        await dataService.addRun('a', { name: 'n', kind: 'range', data: [{ soc: 1, range: 2 }] });
        expect((await dataService.getRunDataCached(55)).length).toBe(1);
    });

    it('a write that lands while a read is in flight is not cached over', async () => {
        db.delayMs = 20;
        const inFlight = dataService.getRunDataCached(2);             // asked before the write, answered after it
        await new Promise(r => setTimeout(r, 5));
        await dataService.replaceRunData(2, [{ soc: 5, chargeRate: 77, time: 1 }]);
        expect(await inFlight).toHaveLength(20);                       // the pre-write answer, to the one who asked
        db.delayMs = 0;
        const after = await dataService.getRunDataCached(2);
        expect(after).toHaveLength(1);
    });

    it('deleteVehicle and signOut clear everything', async () => {
        await warm();
        dataService.user = { id: 'u' };
        db.client.rpc = async () => ({ error: null });
        await dataService.deleteVehicle('a');
        expect(dataService.pointCache.size).toBe(0);
        await warm();
        dataService.invalidateRunPoints();
        expect(dataService.pointCache.size).toBe(0);
        expect(dataService.pointCacheRows).toBe(0);
    });

    it('a changed row count in a fresh vehicle read evicts the entry (another session wrote)', async () => {
        await warm();
        db.rows.push({ id: 9999, run_id: 1, frame: 99, soc: 50, charge_rate: 1, time_value: 1, range_value: 1, temperature: 1, extra_data: null, timestamp: null });
        dataService.reconcileRunPoints([{ id: 1, dataPointCount: 21 }, { id: 2, dataPointCount: 20 }, { id: 3, dataPointCount: null }]);
        expect(await dataService.getRunDataCached(1)).toHaveLength(21);
        expect(dataService.pointCache.has(2)).toBe(true);             // unchanged: kept
        expect(dataService.pointCache.has(3)).toBe(true);             // unknown count: left alone
    });

    it('a failed read is not remembered', async () => {
        db.failWhen = () => true;
        await expect(dataService.getRunDataCached(1)).rejects.toThrow();
        db.failWhen = null;
        expect(await dataService.getRunDataCached(1)).toHaveLength(20);
    });
});

describe('memory is bounded', () => {
    it('keeps the most recently read runs and lets the oldest go', async () => {
        const big = (n) => Array.from({ length: n }, (_, i) => ({ soc: i % 100, charge_rate: 1, time_value: i }));
        db = fakePointsDb({ 1: big(25000), 2: big(25000), 3: big(25000), 4: big(25000) });
        dataService.invalidateRunPoints();
        for (const id of [1, 2, 3, 4]) await dataService.getRunDataCached(id);
        expect(dataService.pointCacheRows).toBeLessThanOrEqual(60000);
        expect(dataService.pointCache.has(4)).toBe(true);
        expect(dataService.pointCache.has(1)).toBe(false);
    });

    it('a read refreshes an entry, so a run in use outlives idle ones', async () => {
        const big = (n) => Array.from({ length: n }, (_, i) => ({ soc: i % 100, charge_rate: 1, time_value: i }));
        db = fakePointsDb({ 1: big(25000), 2: big(25000), 3: big(25000) });
        dataService.invalidateRunPoints();
        await dataService.getRunDataCached(1);
        await dataService.getRunDataCached(2);
        await dataService.getRunDataCached(1);        // 1 is now the freshest
        await dataService.getRunDataCached(3);
        expect(dataService.pointCache.has(1)).toBe(true);
        expect(dataService.pointCache.has(2)).toBe(false);
    });
});
