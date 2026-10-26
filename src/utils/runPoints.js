/**
 * Whether a test is KNOWN to have no data points, so a chart can skip asking
 * the database for them (#497).
 *
 * `dataPointCount` comes from `data_points(count)` on the runs read (shapeRun)
 * and is kept in step by the write paths in AppContext. It has three states and
 * only one of them licenses a skip:
 *
 *   0                  the database said none      → skip, the answer is []
 *   a positive number  there are some              → fetch
 *   undefined / null   never counted (a run just added, a row from a select
 *                      without the embed, an EPA stand-in) → fetch
 *
 * Unknown must fetch, never skip: guessing "empty" would draw a blank chart for
 * a test that has points, and nothing downstream would say why. An inherited
 * test is a copy of its source run, so it carries the source's count.
 */
export function pointsKnownEmpty(run) {
    return run != null && run.dataPointCount === 0;
}

/**
 * The vehicle list with one run's point count set — on the run itself AND on
 * every copy of it. An inherited test is a spread of its source run (so it
 * carries the source's count), and a count that moved from 0 on the source
 * alone would leave the copy telling a chart there is nothing to fetch.
 */
export function withPointCount(vehicles, realRunId, count, patch = {}) {
    return vehicles.map(v => {
        if (!v.runs?.some(r => r.id === realRunId || r._realRunId === realRunId)) return v;
        return {
            ...v,
            runs: v.runs.map(r => (r.id === realRunId || r._realRunId === realRunId)
                ? { ...r, dataPointCount: count, ...(r.id === realRunId ? patch : {}) }
                : r),
        };
    });
}

/**
 * A range test's own curve as a function: soc → miles (or km), linearly
 * interpolated between its SoC+range points, or null when fewer than two
 * points carry both. The one body behind DataService.buildRangePerSocLookup
 * and the views' batched path, so a lookup built from points fetched in a
 * batch is the lookup the per-test path built.
 */
export function rangePerSocLookup(data) {
    const pts = (data || [])
        .filter(p => p.soc != null && p.range != null)
        .sort((a, b) => a.soc - b.soc);
    if (pts.length < 2) return null;
    return (soc) => {
        if (soc <= pts[0].soc)              return pts[0].range;
        if (soc >= pts[pts.length - 1].soc) return pts[pts.length - 1].range;
        const hi = pts.findIndex(p => p.soc >= soc);
        const lo = hi - 1;
        const t = (soc - pts[lo].soc) / (pts[hi].soc - pts[lo].soc);
        return Math.round((pts[lo].range + t * (pts[hi].range - pts[lo].range)) * 10) / 10;
    };
}

/**
 * (soc) => miles for a charging test, from its range test's own curve when
 * that has one (`lookupPoints`: the test's points), the linear miPerSoc model
 * of the resolved source `src` otherwise. Deliberately UNCORRECTED:
 * correction is one multiplier applied at render time (rangeFactorFor in
 * ChargingView), so the dropdown takes effect without refetching.
 */
export function rangeAtFrom(src, lookupPoints) {
    const lookup = lookupPoints ? rangePerSocLookup(lookupPoints) : null;
    return lookup
        ? (soc) => lookup(soc)
        : (soc) => Math.round(soc * src.miPerSoc * 10) / 10;
}

/** Runs by id string, for loadRunPoints: ids in URLs and state mix numbers and strings. */
export function runsByIdString(vehicles) {
    const out = new Map();
    for (const v of vehicles) for (const r of (v.runs || [])) out.set(String(r.id), r);
    return out;
}

// One test as the per-test path read it: an inherited test through its source
// run, scaled by its link; anything else by its own id, unscaled.
const readOne = (dataService, runId, run) => run?._inherited
    ? dataService.getRunData(run._realRunId, run._efficiencyFactor ?? 1, run._capacityFactor ?? 1)
    : dataService.getRunData(runId);

/**
 * Points for several tests at once (#496), keyed by the id each was asked
 * under — the answer the old `for … await getRunData` loops built, in one
 * round trip instead of one per test.
 *
 *   - a test counted at 0 points is [] without a request (#497);
 *   - the rest go to dataService.getPointsForRuns together. Each is passed as
 *     a bare {id} (or, inherited, its source id and factors) so the batch
 *     scales exactly what getRunData would have;
 *   - a test whose id is not numeric cannot go in a run_id=in.(…) query and
 *     takes the per-test path;
 *   - if the batch fails, every test falls back to the per-test path, where a
 *     failure empties only the test that failed — the loops' own behavior,
 *     so a bad run never blanks its neighbours.
 *
 * @param runsById  Map from runsByIdString; a missing run is read by id.
 */
export async function loadRunPoints(dataService, ids, runsById) {
    const out = {};
    const batch = [];
    const single = [];
    for (const id of ids) {
        const run = runsById.get(String(id));
        if (pointsKnownEmpty(run)) { out[id] = []; continue; }
        const real = run?._inherited ? run._realRunId : id;
        (Number.isFinite(Number(real)) ? batch : single).push({ id, run });
    }
    const perTest = async ({ id, run }) => {
        try { out[id] = await readOne(dataService, id, run); }
        catch (err) { console.error(`Failed to load data for run ${id}:`, err); out[id] = []; }
    };
    if (batch.length) {
        try {
            const got = await dataService.getPointsForRuns(batch.map(({ id, run }) => run?._inherited
                ? { id, _realRunId: run._realRunId, _efficiencyFactor: run._efficiencyFactor ?? 1, _capacityFactor: run._capacityFactor ?? 1 }
                : { id }));
            for (const { id } of batch) out[id] = got[id] ?? [];
        } catch (err) {
            console.error('Batched points load failed; reading tests one at a time:', err);
            for (const item of batch) await perTest(item);
        }
    }
    for (const item of single) await perTest(item);
    return out;
}
