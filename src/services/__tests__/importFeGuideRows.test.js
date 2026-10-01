import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake PostgREST: upsert rejects any batch containing a row with no division,
// the way the NOT NULL constraint rejects the statement rather than the row.
let calls;
const fakeClient = {
    from: () => ({
        select: () => ({ in: async () => ({ data: [] }) }),
        upsert: async (payload) => {
            calls.push(payload.length);
            const bad = payload.find(p => !p.division);
            return { error: bad ? { message: 'null value in column "division" violates not-null constraint' } : null };
        },
    }),
};
vi.mock('../supabase', () => ({ getSupabase: () => fakeClient }));

const { dataService } = await import('../DataService');

const row = (i, division = 'Lucid') => ({
    modelYear: 2022, division, carline: `Car ${i}`, modelTypeIndex: 1,
});

describe('importFeGuideRows — one bad row costs one row (#218)', () => {
    beforeEach(() => { calls = []; dataService.useSupabase = true; });

    it('lands the good rows and reports the bad one by identity', async () => {
        const rows = [row(1), row(2), row(3, ''), row(4)];
        const res = await dataService.importFeGuideRows(rows);
        expect(res.imported).toBe(3);
        expect(res.failed).toBe(1);
        expect(res.errors).toHaveLength(1);
        expect(res.errors[0]).toContain('Car 3');
        expect(res.errors[0]).toContain('not-null');
    });

    it('does not retry row by row when the batch succeeds', async () => {
        const res = await dataService.importFeGuideRows([row(1), row(2)]);
        expect(res.imported).toBe(2);
        expect(calls).toEqual([2]);
    });
});
