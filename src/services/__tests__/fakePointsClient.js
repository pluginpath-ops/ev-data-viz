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
 *   db.delayMs = 20                      → reads answer late, with the rows as they were when asked
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
    // Every table but data_points answers a generic "kind: range, nothing populated"
    // row to any read or write, which is all the points writers ask of runs.
    const inert = () => { const a = { select: () => a, eq: () => a, in: () => a, single: () => a, update: () => a, delete: () => a, insert: () => a,
        then: (res, rej) => Promise.resolve({ data: { id: 0, kind: 'range', populated_fields: [] }, error: null }).then(res, rej) }; return a; };
    db.client = {
        // The two RPCs that rewrite a run's points, as the database does them.
        rpc(name, args) {
            db.requests.push({ rpc: name, args });
            if (name === 'replace_run_data_points') {
                for (let i = rows.length - 1; i >= 0; i--) if (rows[i].run_id === Number(args.p_run_id)) rows.splice(i, 1);
                args.p_rows.forEach((r, frame) => rows.push({ id: id++, run_id: Number(args.p_run_id), frame, timestamp: null, extra_data: null, ...r }));
            } else if (name === 'merge_run_data_points') {
                const base = rows.filter(r => r.run_id === Number(args.p_run_id)).length;
                args.p_rows.forEach((r, i) => rows.push({ id: id++, run_id: Number(args.p_run_id), frame: base + i, timestamp: null, extra_data: null, ...r }));
            }
            return Promise.resolve({ data: { updated: 0, inserted: args.p_rows?.length ?? 0 }, error: null });
        },
        from(table) {
            if (table !== 'data_points') return inert();
            const q = { filters: {}, order: [], from: 0, to: Infinity, op: 'select', payload: null };
            const api = {
                select: () => api,
                delete: () => { q.op = 'delete'; return api; },
                insert: (p) => { q.op = 'insert'; q.payload = p; return api; },
                eq: (k, v) => { q.filters[k] = [v]; return api; },
                in: (k, v) => { q.filters[k] = v; return api; },
                order: (k, { ascending = true } = {}) => { q.order.push([k, ascending]); return api; },
                range: (from, to) => { q.from = from; q.to = to; return api; },
                then: (resolve, reject) => {
                    if (q.op === 'insert') {
                        for (const r of q.payload) rows.push({ id: id++, timestamp: null, extra_data: null, ...r });
                        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                    }
                    if (q.op === 'delete') {
                        for (let i = rows.length - 1; i >= 0; i--) if (Object.entries(q.filters).every(([k, vals]) => vals.some(v => String(rows[i][k]) === String(v)))) rows.splice(i, 1);
                        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
                    }
                    db.requests.push({ filters: q.filters, from: q.from, to: q.to });
                    if (db.failWhen?.(q.filters)) return Promise.resolve({ data: null, error: new Error('boom') }).then(resolve, reject);
                    let out = rows.filter(r => Object.entries(q.filters).every(([k, vals]) => vals.some(v => String(r[k]) === String(v))));
                    out = [...out].sort((a, b) => {
                        for (const [k, asc] of q.order) if (a[k] !== b[k]) return (a[k] < b[k] ? -1 : 1) * (asc ? 1 : -1);
                        return 0;
                    }).slice(q.from, q.to + 1);
                    // The answer is fixed when the request STARTS; `db.delayMs` holds it
                    // back, so a write can land while a read is still in flight.
                    return new Promise(done => setTimeout(done, db.delayMs ?? 0))
                        .then(() => ({ data: out, error: null })).then(resolve, reject);
                },
            };
            return api;
        },
    };
    return db;
}
