/**
 * Performance › Compare's bars, worked out per vehicle: the tested entries for
 * one metric, best first, each with its badge (the average g, or the trap
 * speed). Moved out of PerformanceCompareView so its "Show the math" calls the
 * same code the chart does, with a calculation trace on (calcTrace.js).
 *
 * Pure module — no React.
 */
import {
    deriveTestedResults, groupIntervals, normalizeInterval, parseWindowKey,
    windowFromSessions, averageRateG,
} from './performanceDerivations';
import { MPH_TO_MS, G_MS2 } from '../constants/units';
import { val } from './calcTrace';

/** Scalar metrics, by the category each belongs to. */
export const PERFORMANCE_SCALARS = {
    accel: [
        { key: 'zero_to_60_sec',         label: '0–60 mph (no rollout)', unit: 's', to: 60 },
        { key: 'zero_to_60_rollout_sec', label: '0–60 mph (1 ft)',        unit: 's', to: 60 },
        { key: 'zero_to_100_sec',        label: '0–100 mph',              unit: 's', to: 100 },
    ],
    drag: [
        { key: 'quarter_mile_sec', label: '¼ mile', unit: 's', trap: 'quarter_mile_trap_mph' },
        { key: 'eighth_mile_sec',  label: '⅛ mile', unit: 's', trap: 'eighth_mile_trap_mph' },
        { key: 'sixty_ft_sec',     label: '60 ft',  unit: 's' },
    ],
};

const scalarOf = (key) => [...PERFORMANCE_SCALARS.accel, ...PERFORMANCE_SCALARS.drag].find(m => m.key === key);

/**
 * One vehicle's entries for a metric (a scalar key, or a window key such as
 * "passing:50-80mph"), honoring the origin filter, best first.
 *
 * @param {{ sessions, summaries }} bucket
 * @returns {Array<{ value, display, badge, sourceName, origin, flags, windowLabel? }>}
 */
export function metricEntries(bucket, metricKey, category, origin = 'all', trace = null) {
    const scalar = scalarOf(metricKey);
    let entries;

    if (metricKey.includes(':')) {
        const w = parseWindowKey(metricKey);
        const rows = groupIntervals(bucket.summaries).find(x => x.key === metricKey)?.rows || [];
        entries = rows.map(r => {
            const n = normalizeInterval(r);
            if (trace && n.rateG != null) averageRateG(r, trace.group(`${r.source_name || 'Unattributed'}: ${n.value} ${n.displayUnit}, as an average g`));
            return {
                value: n.comparable, display: `${n.value} ${n.displayUnit}`,
                badge: n.rateG != null ? `${n.rateG.toFixed(3)} g` : null,
                sourceName: r.source_name || 'Unattributed', origin: 'published',
                flags: [], windowLabel: n.label,
            };
        });
        if (w && w.kind !== 'braking' && w.unit === 'mph') {
            const splits = trace?.group('From session splits') ?? null;
            const d = windowFromSessions(bucket.sessions, w.kind, w.from, w.to, splits);
            if (d) {
                const g = averageRateG({ kind: w.kind, from_speed: w.from, to_speed: w.to, speed_unit: 'mph', elapsed_s: d.value }, splits);
                entries.push({
                    value: d.value, display: `${d.value.toFixed(3)} s`,
                    badge: g != null ? `${g.toFixed(3)} g` : null,
                    sourceName: bucket.sessions.find(x => x.source_name)?.source_name || 'EVBench',
                    origin: 'session', flags: d.flags,
                });
            }
        }
    } else {
        entries = deriveTestedResults(bucket.sessions, bucket.summaries, metricKey, trace).map(e => {
            let badge = null;
            if (category === 'accel' && scalar?.to) {
                // Average acceleration implied by reaching `to` in this time.
                const g = (scalar.to * MPH_TO_MS) / e.value / G_MS2;
                trace?.step(`${e.sourceName}: average acceleration`, {
                    formula: 'a = v × c / t / g', values: { v: val(scalar.to, 'mph'), c: val(MPH_TO_MS, 'm/s per mph', 'code:MPH_TO_MS'), t: val(e.value, 's'), g: val(G_MS2, 'm/s²', 'code:G_MS2') },
                    result: g, unit: 'g', note: 'the badge on the bar',
                });
                badge = `${g.toFixed(3)} g`;
            } else if (category === 'drag' && scalar?.trap) {
                const trap = deriveTestedResults(bucket.sessions, bucket.summaries, scalar.trap)
                    .find(t => t.sourceName === e.sourceName)?.value;
                trace?.note(`${e.sourceName}: trap speed ${trap ?? '—'} mph, the same source's best (the badge on the bar)`);
                if (trap != null) badge = `${trap.toFixed(1)} mph`;
            }
            return {
                value: e.value, display: `${e.value.toFixed(3)} ${scalar?.unit ?? 's'}`,
                badge, sourceName: e.sourceName, origin: e.origin, flags: e.flags,
            };
        });
    }

    if (origin !== 'all') {
        entries = entries.filter(e => e.origin === origin);
        trace?.note(`Source type: ${origin} only`);
    }
    entries.sort((a, b) => a.value - b.value);
    return entries;
}

/**
 * Braking in g: every braking window of one vehicle collapses into one
 * comparison, strongest first. Grip is near-constant across a stop, so a 70–0
 * and a 75–0 normalize to the same quantity.
 */
export function brakingGEntries(bucket, origin = 'all', trace = null) {
    let entries = [];
    for (const b of groupIntervals(bucket.summaries)) {
        if (b.kind !== 'braking') continue;
        for (const r of b.rows) {
            const n = normalizeInterval(r);
            if (n.rateG == null) continue;
            if (trace) averageRateG(r, trace.group(`${r.source_name || 'Unattributed'}: ${n.label} in ${n.value} ${n.displayUnit}`));
            entries.push({
                value: n.rateG, display: `${n.rateG.toFixed(3)} g`,
                badge: `${n.value} ${n.displayUnit}`,
                sourceName: r.source_name || 'Unattributed', origin: 'published',
                flags: [], windowLabel: n.label,
            });
        }
    }
    if (origin !== 'all') entries = entries.filter(e => e.origin === origin);
    // Higher g is better here, unlike every other metric on this page.
    entries.sort((a, b) => b.value - a.value);
    return entries;
}
