/**
 * An in-memory stand-in for the one PostgREST table the points readers touch:
 * `data_points`, with eq / in filters, multi-key order and range paging, the
 * way the real one answers. Every request is recorded, so a test can say how
 * many round trips a read took as well as what it returned.
 *
 *   const db = fakePointsDb({ 7: [{ soc: 10, charge_rate: 50 }, …] });
 *   vi.mock('../supabase', () => ({ getSupabase: () => db.client }));
 *   db.requests      → [{ filters, from, to }, …]
 *   db.failWhen = (filters) => boolean   → that request answers with an error
 *
 * Rows per run are given in frame order; ids are assigned here, and are
 * unique across runs as a real table's are.
 */
export function fakePointsDb(rowsByRun) {
    const rows = [];
    let id = 1;
    for (const [runId, list] of Object.entries(rowsByRun)) {
        list.forEach((r, frame) => rows.push({ id: id++, run_id: Number(runId), frame, timestamp: null, soc: null, charge_rate: null, time_value: null, range_value: null, temperature: null, extra_data: null, ...r }));
    }
    const db = { requests: [], failWhen: null, rows };
    db.client = {
        from(table) {
            if (table !== 'data_points') throw new Error(`fake client has no ${table}`);
            const q = { filters: {}, order: [], from: 0, to: Infinity };
            const api = {
                select: () => api,
                eq: (k, v) => { q.filters[k] = [v]; return api; },
                in: (k, v) => { q.filters[k] = v; return api; },
                order: (k, { ascending = true } = {}) => { q.order.push([k, ascending]); return api; },
                range: (from, to) => { q.from = from; q.to = to; return api; },
                then: (resolve, reject) => {
                    db.requests.push({ filters: q.filters, from: q.from, to: q.to });
                    if (db.failWhen?.(q.filters)) return Promise.resolve({ data: null, error: new Error('boom') }).then(resolve, reject);
                    let out = rows.filter(r => Object.entries(q.filters).every(([k, vals]) => vals.some(v => String(r[k]) === String(v))));
                    out = [...out].sort((a, b) => {
                        for (const [k, asc] of q.order) if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1);
                        return 0;
                    }).slice(q.from, q.to + 1);
                    return Promise.resolve({ data: out, error: null }).then(resolve, reject);
                },
            };
            return api;
        },
    };
    return db;
}
