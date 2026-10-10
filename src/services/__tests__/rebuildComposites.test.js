import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake PostgREST that records every runs write. A delete answers with the ids
// it "removed" — all of them, unless `rlsHides` says a policy filtered some
// out, which Postgres does silently.
let log, nextId, rlsHides, selectRows = [];
const chain = (table, op, payload) => {
    const call = { table, op, payload, filters: {} };
    const api = {
        eq: (k, v) => { call.filters[k] = v; return api; },
        in: (k, v) => { call.filters[k] = v; return api; },
        select: () => api,
        single: () => api,
        order: () => api,
        range: () => api,
        then: (resolve, reject) => {
            log.push(call);
            const data = op === 'select' ? selectRows.filter(r => call.filters.run_id.includes(r.run_id))
                : op === 'insert' ? { id: nextId++ }
                : op === 'delete' ? call.filters.id.filter(id => !rlsHides.includes(id)).map(id => ({ id }))
                : null;
            return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
    };
    return api;
};
const fakeClient = {
    from: (table) => ({
        select: () => chain(table, 'select'),
        insert: (p) => chain(table, 'insert', p),
        update: (p) => chain(table, 'update', p),
        delete: () => chain(table, 'delete'),
    }),
};
vi.mock('../supabase', () => ({ getSupabase: () => fakeClient }));

const { dataService } = await import('../DataService');

/** A session sampled at every whole %, power from kwAt, time from power on a 100 kWh pack. */
const session = (kwAt, from = 10, to = 80) => {
    const pts = [];
    let t = 0;
    for (let soc = from; soc <= to; soc++) { const kw = kwAt(soc); pts.push({ soc, chargeRate: kw, time: t }); t += 60 / kw; }
    return pts;
};
const car = (soc) => (soc <= 30 ? 400 : 400 - (soc - 30) * 6);
const supercharger = (soc) => Math.min(car(soc), 180 + soc * 0.2);
const POINTS = { 1: session(car), 2: session(car), 3: session(supercharger), 4: session(supercharger) };

const test = (id, extra = {}) => ({ id, name: `test ${id}`, kind: 'charging', ...extra });
const stored = (id, classV) => ({ id, name: 'old', kind: 'charging', synthetic: true, composite: { chargerClassV: classV } });
const vehicle = { id: 48, platforms: { electrical: { voltage_class_v: 800 } }, specs: {} };

function given(runs) {
    vi.spyOn(dataService, 'getVehicleRuns').mockResolvedValue(runs);
    vi.spyOn(dataService, 'getPointsForRuns').mockImplementation(async (runs) =>
        Object.fromEntries(runs.map(r => [r.id, POINTS[r._realRunId ?? r.id]])));
    vi.spyOn(dataService, 'writeCompositePoints').mockResolvedValue();
    vi.spyOn(dataService, 'writeChargeSummary').mockResolvedValue({});
}
const runsWrites = () => log.filter(c => c.table === 'runs');

describe('rebuildComposites — stored composite curves (#313, migration 077)', () => {
    beforeEach(() => {
        log = []; nextId = 1000; rlsHides = [];
        vi.restoreAllMocks();
        dataService.useSupabase = true;
        dataService.role = 'contributor';
    });

    it('inserts one synthetic charging run per charger class, then writes its points', async () => {
        given([test(1), test(2), test(3), test(4)]);
        await dataService.rebuildComposites(vehicle);
        const inserts = runsWrites().filter(c => c.op === 'insert');
        expect(inserts.map(c => c.payload.composite.chargerClassV)).toEqual([800, 400]);
        expect(inserts[0].payload).toMatchObject({ vehicle_id: 48, kind: 'charging', synthetic: true, name: 'Composite on 800 V chargers (2 tests)' });
        expect(dataService.writeCompositePoints.mock.calls.map(c => c[0]).sort()).toEqual([1000, 1001]);
        // One query for every test's points, and the summary rides on the row
        // write — the round trips that made a rebuild slow (owner, 2026-10-07).
        expect(dataService.getPointsForRuns).toHaveBeenCalledTimes(1);
        expect(dataService.getPointsForRuns.mock.calls[0][0].map(r => r.id)).toEqual([1, 2, 3, 4]);
        expect(dataService.writeChargeSummary).not.toHaveBeenCalled();
        expect(inserts[0].payload.charge_summary.peakKw).toBe(400);
    });

    it('updates in place by charger class, and deletes the class that lost its tests', async () => {
        given([test(1), test(2), test(3), test(4, { is_excluded: true }), stored(900, 800), stored(901, 400)]);
        await dataService.rebuildComposites(vehicle);
        expect(runsWrites().filter(c => c.op === 'insert')).toEqual([]);
        expect(runsWrites().filter(c => c.op === 'update').map(c => c.filters.id)).toEqual([900]);
        expect(runsWrites().filter(c => c.op === 'delete').map(c => c.filters.id)).toEqual([[901]]);
    });

    it('fails loudly when a policy silently keeps a composite it was told to delete', async () => {
        rlsHides = [901];
        given([test(1), test(2), test(3), test(4, { is_excluded: true }), stored(900, 800), stored(901, 400)]);
        await expect(dataService.rebuildComposites(vehicle)).rejects.toThrow(/could not be deleted/);
    });

    it('builds from inherited tests, and never touches a composite read through a link', async () => {
        const inherited = (realId, linkId) => test(`inherited_${linkId}_${realId}`, {
            _inherited: true, _realRunId: realId, _capacityFactor: 1, _sourceVehicleName: 'R1S',
        });
        const theirs = { ...stored('inherited_9_77', 800), _inherited: true };
        given([inherited(1, 5), inherited(2, 6), theirs]);
        await dataService.rebuildComposites(vehicle);
        const inserts = runsWrites().filter(c => c.op === 'insert');
        expect(inserts.map(c => c.payload.name)).toEqual(['Composite on 800 V chargers (2 tests)']);
        expect(inserts[0].payload.composite.tests).toEqual([
            { runId: 'inherited_5_1', name: 'test inherited_5_1', from: 'R1S' },
            { runId: 'inherited_6_2', name: 'test inherited_6_2', from: 'R1S' },
        ]);
        expect(runsWrites().filter(c => c.op !== 'insert')).toEqual([]);
    });

    it('reads an inherited test from its source run, scaled by its link as the chart draws it', async () => {
        selectRows = [
            { run_id: 7, frame: 0, soc: 10, charge_rate: 200, time_value: 0 },
            { run_id: 7, frame: 1, soc: 20, charge_rate: 180, time_value: 3 },
        ];
        const own = { id: 7 };
        const inherited = { id: 'inherited_4_7', _inherited: true, _realRunId: 7, _capacityFactor: 0.5, _efficiencyFactor: 1 };
        const out = await dataService.getPointsForRuns([own, inherited]);
        // One query for the source run, even read twice.
        expect(log.filter(c => c.op === 'select').map(c => c.filters.run_id)).toEqual([[7]]);
        expect(out[7].map(p => p.chargeRate)).toEqual([200, 180]);
        expect(out.inherited_4_7.map(p => p.chargeRate)).toEqual([100, 90]);
        expect(out.inherited_4_7.map(p => p.time)).toEqual([0, 3]);
    });

    it('writes nothing for a viewer', async () => {
        dataService.role = 'user';
        given([test(1), test(2)]);
        expect(await dataService.rebuildComposites(vehicle)).toBeNull();
        expect(log).toEqual([]);
    });
});
