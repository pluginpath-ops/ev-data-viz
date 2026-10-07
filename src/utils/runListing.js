/**
 * Two questions a curator answers about every test (#394), and the one place
 * the answers are read.
 *
 *   LISTED or UNLISTED — whether viewers see it in the pickers, the charts and
 *     Tests & Data. Stored as `runs.is_hidden` (migration 034), which narrowed
 *     to mean this when migration 079 split exclusion out.
 *   EXCLUDED or not — whether it counts in the statistics: composite curves,
 *     test spreads, best charge windows, and later #314's error bars.
 *     `runs.is_excluded` (migration 079). Counting is the default.
 *
 * All four combinations are real. Listed and counted: the tests that represent
 * the vehicle. Unlisted and counted: THE POOL, where n grows without
 * cluttering the lists. Unlisted and excluded: disputed or incomplete data —
 * what "hidden" was made for, and where every hidden test started. Listed but
 * excluded: shown for illustration, kept out of the figures (a towing run).
 *
 * Two kinds of figure, two rules:
 *   - a figure that AGGREGATES tests (a composite, a spread, a best) reads
 *     `statisticalRuns` — the listed tests and the pool, less the excluded;
 *   - a figure that QUOTES one test (the reported range test, the charge-time
 *     session on the table) quotes a listed one, so a reader can find it.
 */

/** Camel first: a local edit sets `isHidden` while `is_hidden` still holds the loaded value. */
const flag = (camel, snake) => !!(camel ?? snake);

export const isUnlisted = (run) => !!run && flag(run.isHidden, run.is_hidden);
export const isListed   = (run) => !!run && !isUnlisted(run);
export const isExcluded = (run) => !!run && flag(run.isExcluded, run.is_excluded);

/**
 * A curator overrode this test's quality checks (migration 080): the pool rule
 * below, and the range spread's pack-coverage rule (rangeCoverageOk). Not
 * exclusion — that is the curator's own call — and not missing data: a test
 * with no start/end SoC still has no range to scale.
 */
export const hasQualityOverride = (run) => !!run && flag(run.qualityOverride, run.quality_override);

/**
 * What a pooled range test is missing before it may count, or [] when nothing.
 *
 * Only an UNLISTED range test is held to this. The pool exists to grow n with
 * tests nobody looks at one by one, and a range test without its speed and
 * temperature cannot be corrected to standard conditions — it widens a
 * corrected spread for no reason (the R2 Performance (20") copies with their
 * speed basis and altitude lost read 191 mi beside 253–277). A listed test is
 * in front of a curator and a reader, with its conditions on the bar.
 *
 * @param {object} run
 * @param {object|null} [session]  supplies a temperature the run omits
 * @returns {Array<'speed'|'temperature'>}
 */
export function poolGateMissing(run, session = null) {
    if (!isUnlisted(run) || run.kind !== 'range' || hasQualityOverride(run)) return [];
    const missing = [];
    if (run.speed_mph == null || run.speed_mph === '') missing.push('speed');
    if ((run.temperature_f ?? session?.temperature_f) == null) missing.push('temperature');
    return missing;
}

/** Whether a test may feed a statistic. Composites, synthetics and inheritance are each caller's own rule. */
export function countsInStatistics(run, session = null) {
    if (!run || isExcluded(run)) return false;
    return poolGateMissing(run, session).length === 0;
}

/**
 * A vehicle's pool: unlisted tests that still count. Worked out once, where
 * the vehicles are prepared (AppContext), because a viewer never receives the
 * unlisted tests in `vehicle.runs` — they ride here instead, for the
 * statistics only.
 */
export function poolOf(runs, sessionOf = () => null) {
    return (runs || []).filter(r => isUnlisted(r) && countsInStatistics(r, sessionOf(r)));
}

/**
 * Every test that may feed a statistic: the listed ones not excluded, and the
 * pool. Each once — a contributor's `vehicle.runs` holds the unlisted tests
 * too, and they are already in the pool.
 */
export function statisticalRuns(vehicle) {
    const out = [];
    const seen = new Set();
    for (const r of (vehicle?.runs || [])) {
        if (isListed(r) && !isExcluded(r)) { out.push(r); seen.add(r.id); }
    }
    for (const r of (vehicle?.pooledRuns || [])) {
        if (!seen.has(r.id)) { out.push(r); seen.add(r.id); }
    }
    return out;
}

/** How many of a set of tests are unlisted — "Across 7 range tests (5 unlisted)". */
export const unlistedCount = (runs) => (runs || []).filter(isUnlisted).length;
