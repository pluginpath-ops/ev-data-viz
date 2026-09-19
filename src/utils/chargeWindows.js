/**
 * Charging summaries (#346): the best 5, 10 and 15-minute average charge rate
 * of a charging session, and the best of each across a vehicle's sessions.
 *
 * ── Why these windows ────────────────────────────────────────────────────────
 *
 * 15 minutes is the road-trip figure: the "10% + 15 min" stop. 5 minutes shows
 * boost windows — the Mach-E and Lightning charge harder briefly than their
 * curves suggest — without being the one-sample "peak kW" a spec sheet quotes.
 * The gap between the two is the shape of the curve: a peaky car has a big one.
 *
 * ── How ─────────────────────────────────────────────────────────────────────
 *
 * An ENERGY average, not a mean of samples: power integrated over time (the
 * trapezoid rule between samples) divided by the window's length. Samples are
 * unevenly spaced — some sessions log every 15 seconds, some are checkpoints
 * read off a video every few minutes — and a sample mean would weight whichever
 * stretch was logged densest.
 *
 * A window may not rest on one gap longer than half its own length (2.5 min
 * for the 5-minute window, 7.5 for the 15). A fixed 60-second rule would have
 * discarded every checkpoint-style session in the corpus; half the window
 * still refuses a paused or truncated log, which is what the rule is for.
 *
 * ── Stored per session, chosen per vehicle ──────────────────────────────────
 *
 * `summarizeChargeSession` runs whenever a session's points are written, and
 * the result lives on `runs.charge_summary` (migration 071) with a version, so
 * a change to this algorithm can recompute every session rather than leave a
 * mix. `bestChargeWindows` picks each vehicle's best at READ time from the
 * summaries that load with its runs — a copy stored on the vehicle would go
 * stale on every add, edit, delete or move of a session.
 *
 * Pure module: no data access, no React.
 */
import { isInheritedRunId } from './runUtils';

/** Bump when the calculation changes; stale summaries are then recomputed. */
export const CHARGE_SUMMARY_VERSION = 1;

/** The windows summarized, in minutes. */
export const CHARGE_WINDOWS = [5, 10, 15];

/** Scan resolution for a window's start, in minutes. */
const SCAN_STEP_MIN = 0.1;

const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v));
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * The samples a summary can use: time and power both present, sorted by time,
 * one sample per instant (a repeated time keeps its last reading).
 */
function usableSamples(points = []) {
    const byTime = new Map();
    for (const p of points) {
        if (!finite(p.time) || !finite(p.chargeRate)) continue;
        byTime.set(Number(p.time), {
            t: Number(p.time),
            kw: Math.max(0, Number(p.chargeRate)),
            soc: finite(p.soc) ? Number(p.soc) : null,
        });
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Linear interpolation of `field` at time t over samples sorted by time; null outside or absent. */
function valueAt(samples, t, field) {
    const known = samples.filter(s => s[field] != null);
    if (!known.length || t < known[0].t || t > known[known.length - 1].t) return null;
    for (let i = 1; i < known.length; i++) {
        const a = known[i - 1], b = known[i];
        if (t <= b.t) {
            const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
            return a[field] + f * (b[field] - a[field]);
        }
    }
    return known[known.length - 1][field];
}

/**
 * One session's summary.
 *
 * @param {Array} points  [{ time (min), chargeRate (kW), soc (%) }] in any order
 * @returns {{ version, windows: Object|null, reason?, durationMin?, startSoc?, peakKw? }}
 *   `windows[5|10|15]` is `{ kw, startMin, startSoc, endSoc }`, or null with the
 *   reason in `gaps[W]` — 'short' (the session is shorter than the window) or
 *   'gap' (every placement rests on too long a gap).
 */
export function summarizeChargeSession(points = []) {
    const samples = usableSamples(points);
    if (samples.length < 2) {
        const hasPower = points.some(p => finite(p.chargeRate));
        return { version: CHARGE_SUMMARY_VERSION, windows: null, reason: hasPower ? 'no time' : 'no power' };
    }

    // Cumulative energy (kWh) at each sample, by the trapezoid rule.
    const cum = [0];
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i];
        cum.push(cum[i - 1] + ((a.kw + b.kw) / 2) * ((b.t - a.t) / 60));
    }
    const energyAt = (t) => {
        let i = 1;
        while (i < samples.length - 1 && samples[i].t < t) i++;
        const a = samples[i - 1], b = samples[i];
        const dt = t - a.t;
        const kwAt = a.kw + (b.t === a.t ? 0 : ((b.kw - a.kw) * dt) / (b.t - a.t));
        return cum[i - 1] + ((a.kw + kwAt) / 2) * (dt / 60);
    };

    const t0 = samples[0].t;
    const tEnd = samples[samples.length - 1].t;
    const segments = samples.slice(1).map((b, i) => ({ from: samples[i].t, to: b.t }));

    const windows = {};
    const gaps = {};
    for (const w of CHARGE_WINDOWS) {
        if (tEnd - t0 < w - 1e-9) { windows[w] = null; gaps[w] = 'short'; continue; }
        const tooLong = segments.filter(s => s.to - s.from > w / 2);
        // Every sample time and every sample time minus the window, plus a fine
        // grid: the energy of a sliding window over a piecewise-linear curve
        // peaks at a breakpoint or between them, and the grid catches between.
        const starts = new Set();
        for (let a = t0; a <= tEnd - w + 1e-9; a += SCAN_STEP_MIN) starts.add(round1(a));
        for (const s of samples) {
            if (s.t <= tEnd - w) starts.add(s.t);
            if (s.t - w >= t0) starts.add(s.t - w);
        }
        let best = null;
        for (const a of starts) {
            const b = Math.min(a + w, tEnd);
            if (tooLong.some(s => s.from < b && s.to > a)) continue;
            const kw = (energyAt(b) - energyAt(a)) / (w / 60);
            if (!best || kw > best.kw) best = { kw, a, b };
        }
        if (!best) { windows[w] = null; gaps[w] = 'gap'; continue; }
        const startSoc = valueAt(samples, best.a, 'soc');
        const endSoc = valueAt(samples, best.b, 'soc');
        windows[w] = {
            kw: round1(best.kw),
            startMin: round1(best.a - t0),
            startSoc: startSoc == null ? null : Math.round(startSoc),
            endSoc: endSoc == null ? null : Math.round(endSoc),
        };
    }

    const firstSoc = samples.find(s => s.soc != null)?.soc ?? null;
    return {
        version: CHARGE_SUMMARY_VERSION,
        durationMin: round1(tEnd - t0),
        startSoc: firstSoc == null ? null : Math.round(firstSoc),
        peakKw: round1(Math.max(...samples.map(s => s.kw))),
        windows,
        ...(Object.keys(gaps).length ? { gaps } : {}),
    };
}

/** Whether a stored summary was made by this version of the calculation. */
export const isCurrentSummary = (summary) => summary?.version === CHARGE_SUMMARY_VERSION;

/**
 * Whether a session may set a vehicle's best.
 *
 * Only what could make a figure too HIGH, or not the vehicle's own, excludes:
 * hidden (a curator took it out of view), synthetic (not measured), inherited
 * (another vehicle's session scaled by factors — see buildInheritedRuns).
 * What can only make a figure too LOW — a session starting at 40%, a
 * charger-limited stop — does not exclude: it cannot beat a better session,
 * and when it is the only one, the note beneath says why it reads low.
 */
export function countsTowardBest(run) {
    if (!run || run.kind !== 'charging') return false;
    if (run.isHidden || run.is_hidden || run.synthetic) return false;
    if (isInheritedRunId(run.id)) return false;
    return isCurrentSummary(run.charge_summary) && !!run.charge_summary.windows;
}

/**
 * A vehicle's best window of each length across its sessions, each naming the
 * session that set it — the best 5 and best 15 minutes may be different stops.
 *
 * @returns {Object} `{ 5: best|null, 10: …, 15: … }`, each best being the
 *   window plus `{ runId, runName, source, date, temperatureF, timeDerived }`
 */
export function bestChargeWindows(runs = []) {
    const out = Object.fromEntries(CHARGE_WINDOWS.map(w => [w, null]));
    for (const run of runs) {
        if (!countsTowardBest(run)) continue;
        for (const w of CHARGE_WINDOWS) {
            const win = run.charge_summary.windows[w];
            if (!win || !(win.kw > 0)) continue;
            if (out[w] && out[w].kw >= win.kw) continue;
            out[w] = {
                ...win,
                runId: run.id,
                runName: run.name ?? null,
                source: run.source ?? null,
                date: run.date ?? null,
                temperatureF: finite(run.temperature_f) ? Number(run.temperature_f) : null,
                // Time worked out from SoC, power and a capacity rather than
                // logged: the one input that could flatter the average.
                timeDerived: (run.calculated_fields ?? []).includes('time'),
                sessionStartSoc: run.charge_summary.startSoc ?? null,
                sessionPeakKw: run.charge_summary.peakKw ?? null,
            };
        }
    }
    return out;
}
