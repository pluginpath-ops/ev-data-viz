/**
 * Performance Derivations
 *
 * Read-time, provenance-tagged derivations for acceleration/braking results.
 * Every derivation is a pure function — nothing here is ever persisted, which
 * is the same discipline epaDerivations.js follows and the reason a stored
 * "derived" value can't go stale when its backing runs change.
 *
 * ── EVERYTHING TESTED IS ONE POOL ──────────────────────────────────────────
 *
 * A figure derived from a session imported here and a figure published by Car
 * and Driver are the same KIND of thing: somebody put a car on a surface and
 * timed it. The only difference is whether we also hold the full trace behind
 * the number. So they rank together as TESTED results, and holding the detail
 * data is provenance on an entry — not a separate axis to compare along.
 *
 * `deriveTestedResults` is the entry point: it returns one ranked list per
 * metric, mixing entries derived on the fly from sessions with entries entered
 * from a published source. Each carries where it came from and how much is
 * known about it.
 *
 * Manufacturer claims are deliberately NOT in that pool — a marketing figure
 * is not a test result. `deriveClaimed` still exists for anyone who wants to
 * contrast the two, but nothing in the UI currently uses it.
 *
 * Each derivation returns a provenance record, matching epaDerivations.js:
 *   { value, source, certain, flags[], basis? }
 *     value   — number, or null when uncomputable
 *     source  — 'tested' | 'claimed' | null
 *     certain — true only when backed by enough runs to rule out a fluke
 *     flags   — machine-readable warnings ('single-run', 'steep-grade', …)
 *     basis   — what it was computed from, for UI drill-down
 */

import { MI_TO_KM, FT_TO_M, MPH_TO_MS, G_MS2 } from '../constants/units';

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

const EMPTY = Object.freeze({ value: null, source: null, certain: false, flags: [] });

/**
 * Grade beyond which a run materially flatters or penalises the result.
 * The sample data runs ±0.5%; anything past this is worth flagging rather than
 * silently averaging in.
 */
export const GRADE_FLAG_PCT = 1.0;

/**
 * Metrics where a smaller number is a better result. Trap speed is the one
 * exception — higher is quicker.
 */
const LOWER_IS_BETTER = new Set([
    'zero_to_60_sec', 'zero_to_60_rollout_sec', 'zero_to_100_sec',
    'quarter_mile_sec', 'eighth_mile_sec', 'sixty_ft_sec',
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
 * Metrics a session carries in its SPLIT POINTS rather than as a column.
 *
 * performance_runs deliberately has no quarter-mile column: the figure is
 * already in the points as the '1/4' split, and copying it into a column would
 * let the two drift. That means anything reading these metrics off a run has to
 * look in the points — without this map they simply read undefined, and a
 * session's drag figures are stored but invisible.
 */
const POINT_DERIVED = {
    quarter_mile_sec:       { label: '1/4',  field: 'elapsed_s' },
    quarter_mile_trap_mph:  { label: '1/4',  field: 'speed_mph' },
    eighth_mile_sec:        { label: '1/8',  field: 'elapsed_s' },
    eighth_mile_trap_mph:   { label: '1/8',  field: 'speed_mph' },
    sixty_ft_sec:           { label: '60ft', field: 'elapsed_s' },
};

/**
 * A metric's value on a run — the column when there is one, otherwise the
 * matching split point.
 */
export function runValue(run, field) {
    const direct = num(run?.[field]);
    if (direct != null) return direct;
    const from = POINT_DERIVED[field];
    if (!from) return null;
    const pt = (run?.performance_run_points || []).find(p => p.label === from.label);
    return pt ? num(pt[from.field]) : null;
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
        const v = runValue(r, field);
        if (v == null) continue;
        const bv = best ? runValue(best, field) : null;
        if (bv == null || (LOWER_IS_BETTER.has(field) ? v < bv : v > bv)) best = r;
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
    const runs = flattenRuns(sessions).filter(r => runValue(r, field) != null);
    if (runs.length === 0) return { ...EMPTY };

    const best = bestRunFor(runs, field);
    const value = runValue(best, field);

    // Spread is only meaningful between comparable attempts. A session sweeps
    // drive modes (Insane → Chill), so spanning all of them would report a
    // ~4 s "spread" that just measures the modes, not run-to-run variance.
    const comparable = runs.filter(r => r.drive_mode === best.drive_mode);
    const values = comparable.map(r => runValue(r, field)).sort((a, b) => a - b);

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
        if (runValue(r, field) == null) continue;
        const key = r.drive_mode || 'Unspecified';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const lower = LOWER_IS_BETTER.has(field);
    return [...groups.entries()]
        .map(([driveMode, runs]) => {
            const sorted = [...runs].sort((a, b) =>
                lower ? runValue(a, field) - runValue(b, field) : runValue(b, field) - runValue(a, field));
            return { driveMode, runs: sorted, best: runValue(sorted[0], field), count: runs.length };
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
            url: pick.source_url || pick.spreadsheet_url || null,
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

// ── Speed windows derived from split data ───────────────────────────────────

/**
 * A speed window read out of a run's split times — 30-50 from a Draggy trace,
 * say, as t(50) − t(30).
 *
 * ── WHY THIS ISN'T QUITE A PUBLISHED ROLL-ON ────────────────────────────────
 *
 * A published "Top Gear, 30–50" is a roll-on: the car is cruising steadily at
 * 30 and then goes to full throttle, so the figure includes the torque ramp. A
 * window cut out of a standing-start launch has the car already at full power
 * as it passes 30. For an EV the two are usually close, but they are different
 * tests and the launch-derived one flatters slightly.
 *
 * So the result is tagged `derivedFrom: 'launch'` and flagged, rather than
 * being quietly presented as the same measurement.
 *
 * Interpolates between splits when the exact speeds aren't recorded, and
 * refuses to extrapolate past the fastest split — a window reaching beyond the
 * data isn't measured, it's guessed.
 *
 * @returns {{value, runId, driveMode, flags}|null} seconds for the window
 */
export function windowFromSplits(run, fromSpeed, toSpeed) {
    const pts = (run?.performance_run_points || [])
        .filter(p => !/\(1ft\)/.test(p.label || '') && num(p.speed_mph) != null && num(p.elapsed_s) != null)
        .map(p => ({ speed: num(p.speed_mph), t: num(p.elapsed_s) }))
        .sort((a, b) => a.speed - b.speed);
    // Every launch starts from rest, and exports omit that point.
    if (pts.length && pts[0].speed > 0) pts.unshift({ speed: 0, t: 0 });
    // The 0-60 headline extends the usable range past the last split.
    const t60 = num(run?.zero_to_60_sec);
    if (t60 != null && !pts.some(p => p.speed === 60)) pts.push({ speed: 60, t: t60 });
    if (pts.length < 2) return null;

    const timeAt = (speed) => {
        if (speed <= 0) return 0;
        const max = pts[pts.length - 1].speed;
        if (speed > max) return null;              // no extrapolation
        const exact = pts.find(p => p.speed === speed);
        if (exact) return exact.t;
        const after  = pts.find(p => p.speed > speed);
        const before = [...pts].reverse().find(p => p.speed < speed);
        if (!after || !before) return null;
        const f = (speed - before.speed) / (after.speed - before.speed);
        return before.t + f * (after.t - before.t);
    };

    const tFrom = timeAt(fromSpeed);
    const tTo   = timeAt(toSpeed);
    if (tFrom == null || tTo == null || tTo <= tFrom) return null;

    const flags = ['derived-from-launch'];
    // Interpolated endpoints are softer evidence than recorded ones.
    if (![fromSpeed, toSpeed].every(sp => pts.some(p => p.speed === sp))) {
        flags.push('interpolated');
    }

    return {
        value: tTo - tFrom,
        runId: run.id ?? null,
        driveMode: run.drive_mode ?? null,
        flags,
    };
}

/**
 * Best split-derived figure for a window across a group of sessions.
 * Braking windows are never derivable this way — a launch trace contains no
 * deceleration — so only timed windows are attempted.
 */
export function windowFromSessions(sessions = [], kind, fromSpeed, toSpeed) {
    if (kind === 'braking') return null;
    let best = null;
    for (const run of flattenRuns(sessions)) {
        const r = windowFromSplits(run, fromSpeed, toSpeed);
        if (r && (!best || r.value < best.value)) best = r;
    }
    return best;
}

// ── Tested results: one pool ────────────────────────────────────────────────

/**
 * Every tested figure for a metric, from every source, ranked best first.
 *
 * Two kinds of entry, ranked together because they are the same kind of claim:
 *
 *   origin 'session'   — derived here from imported run data. Carries the extra
 *                        detail we hold: which drive mode, how many comparable
 *                        runs, the spread between them, and warnings when the
 *                        figure rests on one run or a run taken on a grade.
 *   origin 'published'  — a figure entered from a source, with no trace behind it.
 *
 * Sessions are grouped by source so a vehicle tested twice by different people
 * yields two entries rather than one merged best-of. Sessions with no source
 * name are attributed to EVBench, since importing the raw data here is what
 * makes the result ours.
 *
 * @returns {Array<{value, sourceName, origin, certain, flags, url, basis}>}
 */
export function deriveTestedResults(sessions = [], summaries = [], field) {
    const lower = LOWER_IS_BETTER.has(field);
    const out = [];

    // Sessions → one entry per source, derived on the fly.
    const bySource = new Map();
    for (const s of sessions || []) {
        const key = s.source_name?.trim() || 'EVBench';
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key).push(s);
    }
    for (const [sourceName, group] of bySource) {
        const rec = deriveFromRuns(group, field);
        if (rec.value == null) continue;
        out.push({
            value: rec.value,
            sourceName,
            origin: 'session',
            certain: rec.certain,
            flags: rec.flags,
            url: group.find(s => s.source_url)?.source_url ?? null,
            basis: rec.basis,
        });
    }

    // Published figures → one entry each, so disagreement stays visible.
    for (const row of summaries || []) {
        const value = num(row[field]);
        if (value == null) continue;
        out.push({
            value,
            sourceName: row.source_name?.trim() || 'Unattributed',
            origin: 'published',
            // Someone else's methodology can't be checked from here.
            certain: false,
            flags: [],
            url: row.source_url || row.spreadsheet_url || null,
            basis: { summary_id: row.id ?? null, trim_label: row.trim_label ?? null },
        });
    }

    return out.sort((a, b) => (lower ? a.value - b.value : b.value - a.value));
}

/**
 * The single best tested figure for a metric, in the provenance-record shape
 * the rest of this module returns.
 *
 * source is always 'tested'; `basis.all` carries every entry so the UI can show
 * who else tested it and whether they agree.
 */
export function deriveTested(sessions, summaries, field) {
    const all = deriveTestedResults(sessions, summaries, field);
    if (all.length === 0) return { ...EMPTY };
    const best = all[0];
    const flags = [...best.flags];
    if (all.length > 1) flags.push('multiple-sources');
    return {
        value: best.value,
        source: 'tested',
        certain: best.certain,
        flags,
        basis: { ...best.basis, sourceName: best.sourceName, origin: best.origin, url: best.url, all },
    };
}

// ── Traced curve points ─────────────────────────────────────────────────────

/**
 * The (time, speed) points for one run, on a single consistent clock.
 *
 * A run can carry two split ladders: speed thresholds (0-10 … 0-50) and a drag
 * distance ladder (60ft, 330ft, … 1/4). They come from separate exports and are
 * timestamped on different epochs — measured across 13 runs of two vehicles and
 * seven drive modes, the drag ladder reads 0.0997 s late, SD 0.0045 s. That is
 * NOT the rollout, which varies 0.182-0.301 s on the same runs and tracks launch
 * aggression; this sits flat regardless of car, mode or launch, which is a fixed
 * instrumentation latency between distance triggers and speed-threshold
 * crossings.
 *
 * The offset is measured per run from wherever the ladders overlap and
 * subtracted, so every point lands on one clock. Self-calibrating rather than a
 * hardcoded 0.1, so a source with different latency corrects itself.
 *
 * THIS IS THE ONLY PLACE THAT CORRECTION LIVES. Anything reading elapsed times
 * off the raw points instead will be wrong in a way that barely shows on a speed
 * curve but wrecks a derivative: uncorrected, the segments either side of the
 * 60 ft point read 0.378 and 0.923 g where the truth is 0.741 for both.
 *
 * @returns {{points: Array<{x,y,label}>, offset: number}}
 */
export function tracedCurvePoints(run) {
    const raw = (run?.performance_run_points || []).filter(p =>
        p.speed_mph != null && p.elapsed_s != null
        // The 1ft split is the same 60 mph point on the rollout clock and would
        // double back on the curve.
        && !/\(1ft\)/.test(p.label || ''));

    const speedLadder = raw.filter(p => p.distance_ft == null)
        .map(p => ({ x: num(p.elapsed_s), y: num(p.speed_mph), label: p.label }));
    const dragLadder = raw.filter(p => p.distance_ft != null)
        .map(p => ({ x: num(p.elapsed_s), y: num(p.speed_mph), label: p.label }));

    const bySpeed = [...speedLadder].sort((a, b) => a.y - b.y);
    const tAtSpeed = (v) => {
        const after  = bySpeed.find(p => p.y >= v);
        const before = [...bySpeed].reverse().find(p => p.y <= v);
        if (!after || !before || after.y === before.y) return null;
        return before.x + (v - before.y) / (after.y - before.y) * (after.x - before.x);
    };

    let offset = 0;
    if (speedLadder.length >= 2) {
        const deltas = dragLadder
            .map(p => { const t = tAtSpeed(p.y); return t == null ? null : p.x - t; })
            .filter(d => d != null);
        if (deltas.length) offset = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    }

    const points = [
        ...speedLadder,
        ...dragLadder.map(p => ({ ...p, x: p.x - offset })),
    ].sort((a, b) => a.x - b.x);

    // Speed splits stop at 0-50 and give 0-60 only as the headline figure.
    const t60 = num(run?.zero_to_60_sec);
    if (t60 != null && !points.some(p => p.y === 60)) {
        points.push({ x: t60, y: 60, label: '0-60' });
        points.sort((a, b) => a.x - b.x);
    }
    // Every launch starts from rest; exports omit that point.
    if (points.length && points[0].x > 0 && points[0].y > 0) {
        points.unshift({ x: 0, y: 0, label: 'rest' });
    }

    return { points, offset };
}

/**
 * Per-segment acceleration in g along a run's curve.
 *
 * Derived rather than imported: sources print g to one decimal, which is a ±7%
 * band at 0.7 g and ±25% at 0.2 g, while a finite difference over times stored
 * to 3 decimals is good to well under 1%.
 *
 * Each entry describes the SEGMENT between two points, not either endpoint —
 * plot it stepped, not as a smooth line through point positions.
 *
 * @returns {Array<{x0, x1, y0, y1, g, label}>}
 */
export function segmentAccelerationG(run) {
    const { points } = tracedCurvePoints(run);
    const out = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const dt = b.x - a.x;
        if (!(dt > 0)) continue;
        out.push({
            x0: a.x, x1: b.x, y0: a.y, y1: b.y,
            g: ((b.y - a.y) * MPH_TO_MS) / dt / G_MS2,
            label: `${a.label ?? ''}→${b.label ?? ''}`,
        });
    }
    return out;
}

// ── Synthetic curves from headline figures ──────────────────────────────────

/**
 * Windows surfaced as named metrics rather than left in the generic list.
 * Empty since 0-100 became a promoted column — kept as the hook for the next
 * fixed window that earns promotion.
 */
export const PINNED_WINDOWS = [];

/**
 * Reconstruct a speed-vs-time curve from a source's headline figures, for
 * vehicles that have published numbers but no split trace.
 *
 * Points come from whatever exists:
 *   (0, 0)                          every launch starts from rest
 *   (t 0-60,  60)
 *   (t 0-100, 100)
 *   (¼-mile ET, ¼-mile trap speed)  trap IS the speed at the ¼-mile mark, so
 *                                   the ET/trap pair is a genuine (time, speed)
 *                                   point rather than a derived guess
 *   every other FROM-REST accel window (0-130, 0-150, …), which is where the
 *   top end of the curve comes from — rolling starts are excluded, since they
 *   begin at speed and don't share the from-rest clock
 *
 * ── ROLLOUT, WHICH DECIDES WHETHER THIS IS HONEST ───────────────────────────
 *
 * A quarter-mile ET is a drag-strip measure and so includes the 1 ft rollout.
 * Pairing it with a NO-rollout 0-60 would put two clocks ~0.3 s apart on one
 * time axis and bend the curve by more than the difference between many cars.
 * So the rollout 0-60 is preferred whenever the source gives one, and when only
 * the no-rollout figure exists the result is flagged `mixed-rollout` rather
 * than silently drawn as if it were consistent.
 *
 * Fewer than two points beyond the origin isn't a curve — those return null.
 *
 * @returns {{points: Array<{x,y}>, basis: string[], flags: string[]}|null}
 */
export function buildSyntheticCurve(summary) {
    if (!summary) return null;
    const intervals = summary.performance_intervals || [];
    const flags = [];
    const basis = [];

    const rollout   = num(summary.zero_to_60_rollout_sec);
    const noRollout = num(summary.zero_to_60_sec);
    const qtrSec    = num(summary.quarter_mile_sec);
    const qtrTrap   = num(summary.quarter_mile_trap_mph);

    // Prefer the rollout clock, since the quarter-mile point is on it.
    const t60 = rollout ?? noRollout;
    if (t60 != null) {
        basis.push(rollout != null ? '0–60 (1 ft)' : '0–60 (no rollout)');
        if (rollout == null && qtrSec != null) flags.push('mixed-rollout');
    }

    // Every acceleration window measured FROM REST is a point on this curve —
    // 0-130, 0-150, whatever the source published. Rolling starts (5-60 and the
    // like) are excluded: they begin at speed, so plotting their elapsed time
    // against the from-rest clock would place them far to the left of where the
    // car actually was.
    const fromRest = (intervals || [])
        .filter(iv => iv.kind === 'accel'
            && Number(iv.from_speed) === 0
            && num(iv.elapsed_s) != null
            && num(iv.to_speed) != null)
        .map(iv => ({ x: num(iv.elapsed_s), y: num(iv.to_speed) }));

    // 0-100 is a promoted column (migration 042); the interval form is still
    // honoured for anything entered before that existed.
    const t100 = num(summary.zero_to_100_sec)
        ?? fromRest.find(p => p.y === 100)?.x
        ?? null;
    if (t100 != null) basis.push('0–100');

    const points = [{ x: 0, y: 0 }];
    if (t60  != null) points.push({ x: t60,  y: 60 });
    if (t100 != null) points.push({ x: t100, y: 100 });
    if (qtrSec != null && qtrTrap != null) {
        points.push({ x: qtrSec, y: qtrTrap });
        basis.push('¼ mile @ trap');
    }

    // Add the remaining from-rest windows, skipping speeds a column already
    // supplied so one figure entered twice doesn't become two stacked points.
    const extras = fromRest
        .filter(p => !points.some(q => q.y === p.y))
        .sort((a, b) => a.y - b.y);
    for (const p of extras) {
        points.push(p);
        basis.push(`0–${p.y}`);
    }

    if (points.length < 3) return null;   // origin plus one point is a line, not a curve

    points.sort((a, b) => a.x - b.x);
    // A later point at a lower speed means the figures disagree with each other.
    for (let i = 1; i < points.length; i++) {
        if (points[i].y <= points[i - 1].y) { flags.push('non-monotonic'); break; }
    }

    return { points, basis, flags };
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
    { field: 'zero_to_100_sec',        label: '0–100 mph',       unit: 's' },
    { field: 'quarter_mile_sec',       label: '¼ mile',          unit: 's' },
    { field: 'quarter_mile_trap_mph',  label: '¼ mile trap',     unit: 'mph' },
    { field: 'eighth_mile_sec',        label: '⅛ mile',          unit: 's' },
    { field: 'eighth_mile_trap_mph',   label: '⅛ mile trap',     unit: 'mph' },
    { field: 'sixty_ft_sec',           label: '60 ft',           unit: 's' },
];

// ── Variable speed-window results (performance_intervals) ───────────────────
//
// Braking windows vary (75-0, 70-0, 60-0) and passing windows vary (50-80,
// 50-90), so these can't be fixed columns like 0-60. Sources also report metric
// (100-0 km/h in metres), and normalising on write would destroy the label —
// so values are stored as reported and converted here.

const KPH_TO_MPH = 1 / MI_TO_KM;
const M_TO_FT    = 1 / FT_TO_M;

/** Speed in mph, whatever unit it was reported in. */
export const speedToMph = (value, unit) => {
    const v = num(value);
    if (v == null) return null;
    return unit === 'kph' ? v * KPH_TO_MPH : v;
};

/** Distance in feet, whatever unit it was reported in. */
export const distanceToFt = (value, unit) => {
    const v = num(value);
    if (v == null) return null;
    return unit === 'm' ? v * M_TO_FT : v;
};

/**
 * Canonical key for a speed window, so results from different sources and unit
 * systems land in the same comparison bucket.
 *
 * Metric windows are kept as their own bucket rather than converted: "100-0
 * km/h" is a standard test in its own right, and folding it into "62-0 mph"
 * would invent a window nobody actually tested and compare it against a 60-0.
 */
export function windowKey(interval) {
    const from = num(interval.from_speed);
    const to   = num(interval.to_speed) ?? 0;
    const unit = interval.speed_unit || 'mph';
    return `${interval.kind}:${from}-${to}${unit}`;
}

/** Inverse of windowKey: "passing:30-50mph" → {kind, from, to, unit}. */
export function parseWindowKey(key) {
    const m = /^([a-z]+):(-?[\d.]+)-(-?[\d.]+)(mph|kph)$/.exec(key || '');
    if (!m) return null;
    return { kind: m[1], from: Number(m[2]), to: Number(m[3]), unit: m[4] };
}

/** Human label for a window, e.g. "75–0 mph", "100–0 km/h", "50–90 mph". */
export function windowLabel(interval) {
    const unit = (interval.speed_unit || 'mph') === 'kph' ? 'km/h' : 'mph';
    const from = num(interval.from_speed);
    const to   = num(interval.to_speed) ?? 0;
    return `${from}–${to} ${unit}`;
}

/**
 * Average acceleration/deceleration over a window, in g.
 *
 * Lets otherwise-incomparable windows be put on one axis: a 50-80 against a
 * 50-90, or a 60-0 against a 100-0 km/h. Two forms depending on what was
 * measured:
 *
 *   timed windows (accel/passing)    a = Δv / Δt
 *   distance windows (braking)       a = (v₁² − v₂²) / 2d
 *
 * ── ACCURACY, because this matters for how it should be presented ──
 *
 * BRAKING normalises well, and this is measured rather than assumed: on the
 * sample data one car's 60-0 (0.986 g) and 75-0 (0.983 g) agree to 0.3%.
 * Braking is grip-limited, so deceleration really is near-constant across the
 * stop and the constant-rate assumption roughly holds. Cross-window braking
 * comparison is trustworthy.
 *
 * ACCELERATION is the subtler case. The rate is near-constant while the car is
 * traction/torque-limited — measured segment rates across 0-50 mph hold at
 * 0.77-0.80 g — but collapses once it goes power-limited higher up: the same
 * class of car averages ~0.57 g over 50-80 and ~0.51 g over 50-90.
 *
 * So it isn't window WIDTH that breaks comparability, it's window SPEED RANGE.
 * 0-30 against 0-60 is reasonable; 0-60 (~0.79 g) against 50-90 (~0.51 g) is
 * not, and reads as a far bigger gap than the cars actually differ by.
 *
 * Callers get `rateCertain` to reflect this: true for braking, false for timed
 * windows, so the UI can mark the latter as indicative.
 */
export function averageRateG(interval) {
    const fromMph = speedToMph(interval.from_speed, interval.speed_unit);
    const toMph   = speedToMph(interval.to_speed ?? 0, interval.speed_unit);
    if (fromMph == null || toMph == null) return null;

    const v1 = fromMph * MPH_TO_MS;
    const v2 = toMph   * MPH_TO_MS;

    if (interval.kind === 'braking') {
        const distFt = distanceToFt(interval.distance, interval.distance_unit);
        if (distFt == null || distFt <= 0) return null;
        const d = distFt * FT_TO_M;
        // v₂² = v₁² − 2ad  ⇒  a = (v₁² − v₂²) / 2d
        return Math.abs(v1 * v1 - v2 * v2) / (2 * d) / G_MS2;
    }

    const dt = num(interval.elapsed_s);
    if (dt == null || dt <= 0) return null;
    return Math.abs(v2 - v1) / dt / G_MS2;
}

/**
 * Normalise an interval row into a comparable record.
 * `value` is in the interval's natural unit; `comparable` is mph/ft/seconds.
 */
export function normaliseInterval(interval) {
    const isBraking = interval.kind === 'braking';
    const raw = isBraking ? num(interval.distance) : num(interval.elapsed_s);
    return {
        ...interval,
        key: windowKey(interval),
        label: windowLabel(interval),
        value: raw,
        // Braking compares in feet; timed windows are already unit-agnostic.
        comparable: isBraking ? distanceToFt(interval.distance, interval.distance_unit) : raw,
        displayUnit: isBraking ? (interval.distance_unit || 'ft') : 's',
        lowerIsBetter: true,
        // Cross-window normalisation — see averageRateG for the caveats.
        rateG: averageRateG(interval),
        rateCertain: isBraking,
    };
}

/**
 * Every interval for a vehicle, expressed as an average rate in g so windows
 * that aren't otherwise comparable can share an axis.
 *
 * Sorted strongest-first. `certain` distinguishes braking (grip-limited, so the
 * constant-rate assumption roughly holds) from timed windows (rate falls away
 * with speed, so cross-window reads are indicative only).
 */
export function ratesByWindow(summaries = [], kind = null) {
    const out = [];
    for (const s of summaries || []) {
        for (const iv of s.performance_intervals || []) {
            if (kind && iv.kind !== kind) continue;
            const n = normaliseInterval(iv);
            if (n.rateG == null) continue;
            out.push({
                key: n.key,
                label: n.label,
                kind: n.kind,
                rateG: n.rateG,
                certain: n.rateCertain,
                value: n.value,
                unit: n.displayUnit,
                source_name: s.source_name ?? null,
                summary_id: s.id ?? null,
            });
        }
    }
    return out.sort((a, b) => b.rateG - a.rateG);
}

/**
 * Group every interval across a vehicle's summaries by comparable window.
 * Feeds both the summary UI and any chart that needs to compare one window
 * across vehicles.
 *
 * @returns {Array<{key, label, kind, best, rows}>} best-first within each window
 */
export function groupIntervals(summaries = []) {
    const buckets = new Map();
    for (const s of summaries || []) {
        for (const iv of s.performance_intervals || []) {
            const n = normaliseInterval(iv);
            if (n.comparable == null) continue;
            n.source_name = s.source_name ?? null;
            n.summary_id  = s.id ?? null;
            if (!buckets.has(n.key)) {
                buckets.set(n.key, { key: n.key, label: n.label, kind: n.kind, rows: [] });
            }
            buckets.get(n.key).rows.push(n);
        }
    }
    return [...buckets.values()].map(b => {
        b.rows.sort((a, c) => a.comparable - c.comparable);
        b.best = b.rows[0]?.comparable ?? null;
        return b;
    });
}

/**
 * Resolve one speed window across a vehicle's sources, e.g. its best 75-0.
 *
 * source: 'reported' — intervals only ever come from entered summary data.
 */
export function resolveInterval(summaries, key) {
    const bucket = groupIntervals(summaries).find(b => b.key === key);
    if (!bucket || bucket.rows.length === 0) return { ...EMPTY };
    const best = bucket.rows[0];
    return {
        value: best.value,
        source: 'reported',
        certain: false,
        flags: bucket.rows.length > 1 ? ['multiple-sources'] : [],
        basis: {
            summary_id: best.summary_id,
            source_name: best.source_name,
            label: bucket.label,
            unit: best.displayUnit,
            comparable_ft: bucket.kind === 'braking' ? best.comparable : null,
            all: bucket.rows.map(r => ({
                summary_id: r.summary_id,
                source_name: r.source_name,
                value: r.value,
                unit: r.displayUnit,
            })),
        },
    };
}

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
