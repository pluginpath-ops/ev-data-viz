/**
 * Performance Derivations
 *
 * Read-time, provenance-tagged derivations for acceleration/braking results.
 * Every derivation is a pure function — nothing here is ever persisted, which
 * is the same discipline epaDerivations.js follows and the reason a stored
 * "derived" value can't go stale when its backing runs change.
 *
 * Three independent things can supply the same metric:
 *
 *   measured  — computed from this vehicle's own detail sessions
 *               (performance_sessions → performance_runs)
 *   reported   — a published figure entered in performance_summaries
 *   claimed    — the manufacturer's own number, from the vehicle_performance
 *                table surfaced via specs.performance.*
 *
 * They are deliberately NOT merged into one number. The gap between claimed and
 * measured is the interesting part, so `resolveMetric` returns all of them and
 * lets the UI decide what to show.
 *
 * Each derivation returns a provenance record, matching epaDerivations.js:
 *   { value, source, certain, flags[], basis? }
 *     value   — number, or null when uncomputable
 *     source  — 'measured' | 'reported' | 'claimed' | null
 *     certain — true only for a measured value with enough supporting runs
 *     flags   — machine-readable warnings ('single-run', 'steep-grade', …)
 *     basis   — what it was computed from, for UI drill-down
 */

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

const EMPTY = Object.freeze({ value: null, source: null, certain: false, flags: [] });

/**
 * Grade beyond which a run materially flatters or penalises the result.
 * The sample data runs ±0.5%; anything past this is worth flagging rather than
 * silently averaging in.
 */
export const GRADE_FLAG_PCT = 1.0;

/** Metrics that are "lower is better" — the whole set, currently. */
const LOWER_IS_BETTER = new Set([
    'zero_to_60_sec', 'zero_to_60_rollout_sec', 'quarter_mile_sec',
    'fifty_to_ninety_sec', 'braking_distance_ft',
]);

// ── Session / run flattening ────────────────────────────────────────────────

/**
 * Flatten a vehicle's sessions into a run list, each run carrying a reference
 * back to its session (for weather/location context in the UI).
 *
 * @param {object[]} sessions — performance_sessions rows with nested
 *                              performance_runs (as getPerformanceSessions returns)
 */
export function flattenRuns(sessions = []) {
    const out = [];
    for (const s of sessions || []) {
        for (const r of s.performance_runs || []) {
            out.push({ ...r, session: s });
        }
    }
    return out;
}

/**
 * Best (fastest / shortest) run for a metric, ignoring runs that lack it.
 *
 * Best-of rather than mean: these are repeated attempts at the same maximum-
 * effort task, so the spread is dominated by driver/surface variance in the
 * slower direction. Publications quote best runs, so this matches how the
 * numbers will be compared. The full run list stays available for anyone who
 * wants the spread.
 */
export function bestRunFor(runs, field) {
    let best = null;
    for (const r of runs) {
        const v = num(r[field]);
        if (v == null) continue;
        if (!best || (LOWER_IS_BETTER.has(field) ? v < num(best[field]) : v > num(best[field]))) {
            best = r;
        }
    }
    return best;
}

/**
 * Derive a metric from detail runs.
 *
 * source: 'measured' — always, when any run carries the field.
 * certain: true when backed by 2+ runs on reasonable grade (a single run can't
 *          be distinguished from a fluke).
 */
export function deriveFromRuns(sessions, field) {
    const runs = flattenRuns(sessions).filter(r => num(r[field]) != null);
    if (runs.length === 0) return { ...EMPTY };

    const best = bestRunFor(runs, field);
    const value = num(best[field]);

    // Spread is only meaningful between comparable attempts. A session sweeps
    // drive modes (Insane → Chill), so spanning all of them would report a
    // ~4 s "spread" that just measures the modes, not run-to-run variance.
    const comparable = runs.filter(r => r.drive_mode === best.drive_mode);
    const values = comparable.map(r => num(r[field])).sort((a, b) => a - b);

    const flags = [];
    if (comparable.length === 1) flags.push('single-run');
    const grade = num(best.slope_pct);
    if (grade != null && Math.abs(grade) > GRADE_FLAG_PCT) flags.push('steep-grade');

    return {
        value,
        source: 'measured',
        certain: comparable.length >= 2 && flags.length === 0,
        flags,
        basis: {
            run_id: best.id ?? null,
            drive_mode: best.drive_mode ?? null,
            session_id: best.session?.id ?? null,
            run_count: runs.length,
            comparable_run_count: comparable.length,
            slope_pct: grade,
            spread: values.length > 1
                ? { min: values[0], max: values[values.length - 1] }
                : null,
        },
    };
}

/**
 * Group runs by drive mode, best-first within each group.
 * Feeds the per-mode comparison the detail data is most interesting for
 * (Insane vs Chill on the same car, same afternoon, same tarmac).
 */
export function groupByDriveMode(sessions, field = 'zero_to_60_sec') {
    const groups = new Map();
    for (const r of flattenRuns(sessions)) {
        if (num(r[field]) == null) continue;
        const key = r.drive_mode || 'Unspecified';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const lower = LOWER_IS_BETTER.has(field);
    return [...groups.entries()]
        .map(([driveMode, runs]) => {
            const sorted = [...runs].sort((a, b) =>
                lower ? num(a[field]) - num(b[field]) : num(b[field]) - num(a[field]));
            return { driveMode, runs: sorted, best: num(sorted[0][field]), count: runs.length };
        })
        .sort((a, b) => (lower ? a.best - b.best : b.best - a.best));
}

/**
 * Pick a metric out of the reported (published) summary rows.
 *
 * When several sources report the same metric, the best figure wins and the
 * others are surfaced in `basis.all` so the UI can show disagreement rather
 * than hiding it.
 *
 * source: 'reported'
 * certain: false — we can't verify someone else's methodology.
 */
export function deriveFromSummaries(summaries = [], field) {
    const rows = (summaries || []).filter(s => num(s[field]) != null);
    if (rows.length === 0) return { ...EMPTY };

    const lower = LOWER_IS_BETTER.has(field);
    const sorted = [...rows].sort((a, b) =>
        lower ? num(a[field]) - num(b[field]) : num(b[field]) - num(a[field]));
    const pick = sorted[0];

    return {
        value: num(pick[field]),
        source: 'reported',
        certain: false,
        flags: rows.length > 1 ? ['multiple-sources'] : [],
        basis: {
            summary_id: pick.id ?? null,
            source_name: pick.source_name ?? null,
            trim_label: pick.trim_label ?? null,
            url: pick.youtube_url || pick.spreadsheet_url || null,
            all: sorted.map(s => ({
                summary_id: s.id ?? null,
                source_name: s.source_name ?? null,
                value: num(s[field]),
            })),
        },
    };
}

/**
 * The manufacturer's claim, read from the promoted spec fields that
 * DataService merges onto vehicle.specs.performance from vehicle_performance.
 *
 * Only the metrics manufacturers actually publish are mapped; the rest return
 * an empty record.
 *
 * source: 'claimed'
 * certain: false — it's marketing, not a measurement.
 */
const CLAIMED_SPEC_KEY = {
    // NB: the spec field has no rollout convention attached, and manufacturers
    // are inconsistent about it. Treated as the rollout figure since that is
    // the more common marketing basis, and flagged so the UI can say so.
    zero_to_60_rollout_sec: 'zero_to_60_mph_sec',
    quarter_mile_sec:       'quarter_mile_sec',
    quarter_mile_trap_mph:  'quarter_mile_mph',
};

export function deriveClaimed(vehicle, field) {
    const key = CLAIMED_SPEC_KEY[field];
    if (!key) return { ...EMPTY };
    const value = num(vehicle?.specs?.performance?.[key]);
    if (value == null) return { ...EMPTY };
    return {
        value,
        source: 'claimed',
        certain: false,
        flags: field === 'zero_to_60_rollout_sec' ? ['rollout-convention-unknown'] : [],
        basis: { spec_key: `performance.${key}` },
    };
}

// ── Top-level resolution ────────────────────────────────────────────────────

/**
 * Resolve one metric across all three supplies.
 *
 * `preferred` is what the UI should lead with: measured beats reported beats
 * claimed, because that ordering runs from "we watched it happen" to "someone
 * told us". Callers wanting a specific supply read the named fields instead.
 *
 * @returns {{ measured, reported, claimed, preferred,
 *             claimedVsMeasured: {delta, pct}|null }}
 */
export function resolveMetric(vehicle, sessions, summaries, field) {
    const measured = deriveFromRuns(sessions, field);
    const reported = deriveFromSummaries(summaries, field);
    const claimed  = deriveClaimed(vehicle, field);

    const preferred = measured.value != null ? measured
        : reported.value != null ? reported
        : claimed;

    // The editorial payoff: how far the marketing number sits from reality.
    let claimedVsMeasured = null;
    const truth = measured.value != null ? measured : reported;
    if (claimed.value != null && truth.value != null) {
        const delta = truth.value - claimed.value;
        claimedVsMeasured = {
            delta,
            pct: claimed.value !== 0 ? (delta / claimed.value) * 100 : null,
            against: truth.source,
        };
    }

    return { measured, reported, claimed, preferred, claimedVsMeasured };
}

/** Metrics resolved by `resolveAll`, in display order. */
export const PERFORMANCE_METRICS = [
    { field: 'zero_to_60_sec',         label: '0–60 mph',        unit: 's',   note: 'no rollout' },
    { field: 'zero_to_60_rollout_sec', label: '0–60 mph',        unit: 's',   note: '1 ft rollout' },
    { field: 'quarter_mile_sec',       label: '¼ mile',          unit: 's' },
    { field: 'quarter_mile_trap_mph',  label: '¼ mile trap',     unit: 'mph' },
    { field: 'fifty_to_ninety_sec',    label: '50–90 mph',       unit: 's' },
    { field: 'braking_distance_ft',    label: 'Braking',         unit: 'ft' },
];

/**
 * Resolve every metric for a vehicle.
 *
 * @param {object}   vehicle   — vehicle row (for specs.performance claims)
 * @param {object[]} sessions  — performance_sessions with nested performance_runs
 * @param {object[]} summaries — performance_summaries rows for this vehicle
 * @returns {Record<string, ReturnType<typeof resolveMetric>>} keyed by field
 */
export function resolveAll(vehicle, sessions = [], summaries = []) {
    const out = {};
    for (const { field } of PERFORMANCE_METRICS) {
        out[field] = resolveMetric(vehicle, sessions, summaries, field);
    }
    return out;
}
