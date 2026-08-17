/**
 * Paging over PostgREST's row cap.
 *
 * Supabase truncates a response at db-max-rows (1000) without an error or any
 * flag — the array is just short. Every bug this helper exists to stop is a
 * silent one, so the loop that replaces the truncation is worth testing
 * directly: an off-by-one in the `.range()` bounds drops or repeats exactly one
 * row per page, which looks like nothing at all until someone counts.
 */
import { describe, it, expect } from 'vitest';
import { fetchAllRows } from '../../services/DataService';

const PAGE = 1000;

/**
 * A builder that serves `total` rows the way PostgREST does, and records the
 * ranges it was asked for. Returns a fresh query object each call, because the
 * real one is single-use.
 */
function fakeTable(total, { failOn = null } = {}) {
    const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
    const calls = [];
    const builder = () => ({
        range(from, to) {
            calls.push([from, to]);
            if (failOn && calls.length === failOn) {
                return Promise.resolve({ data: null, error: { message: 'boom' } });
            }
            // PostgREST's range is inclusive at both ends.
            return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
    });
    return { builder, calls };
}

describe('fetchAllRows', () => {
    it('returns every row when the table fits in one page', async () => {
        const { builder, calls } = fakeTable(42);
        const out = await fetchAllRows(builder);

        expect(out).toHaveLength(42);
        expect(calls).toEqual([[0, PAGE - 1]]);
    });

    it('returns every row across pages, in order and without gaps', async () => {
        const { builder } = fakeTable(2350);
        const out = await fetchAllRows(builder);

        expect(out).toHaveLength(2350);
        // The whole point: no id dropped and none seen twice.
        expect(out.map(r => r.id)).toEqual([...Array(2350).keys()]);
    });

    it('asks for inclusive, non-overlapping ranges', async () => {
        const { builder, calls } = fakeTable(2350);
        await fetchAllRows(builder);

        expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    });

    it('costs one extra empty request when the total is an exact multiple', async () => {
        // A full page is ambiguous — it cannot be distinguished from a page that
        // happens to end on the boundary, so the loop must ask once more.
        const { builder, calls } = fakeTable(2000);
        const out = await fetchAllRows(builder);

        expect(out).toHaveLength(2000);
        expect(calls).toHaveLength(3);
    });

    it('returns empty for an empty table without looping', async () => {
        const { builder, calls } = fakeTable(0);
        expect(await fetchAllRows(builder)).toEqual([]);
        expect(calls).toHaveLength(1);
    });

    it('throws rather than returning a partial result', async () => {
        // Silently returning page 1 would recreate the exact bug this replaces.
        const { builder } = fakeTable(2350, { failOn: 2 });
        await expect(fetchAllRows(builder)).rejects.toMatchObject({ message: 'boom' });
    });
});
