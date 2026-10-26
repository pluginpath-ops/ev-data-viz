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
