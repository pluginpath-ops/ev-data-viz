/**
 * Performance Compare — four category charts stacked, so a vehicle can be read
 * across acceleration, drag, passing and braking without touching a control.
 *
 * Comparing cars means looking at several of those at once. A single chart
 * behind a metric dropdown turned that into a sequence of clicks and a memory
 * test, so each category gets its own chart with a picker scoped to it.
 *
 * Every bar is a TESTED figure and they all rank together: a result derived
 * from a session imported here and one published by a magazine are the same
 * kind of claim. Each bar names its source and marks the ones backed by full
 * run data. Manufacturer claims are excluded — a marketing figure is not a test
 * result, and mixing one in would misrepresent the rest.
 */
import { useState, useEffect, useMemo } from 'react';
import { dataService } from '../services/DataService';
import { vehicleLabel } from '../utils/specHelpers';
import { buildSeriesLabels } from '../utils/seriesLabel';
import { useTheme } from '../hooks/useTheme';
import { resolveChartColors } from '../utils/colorUtils';
import LoadingSpinner from './LoadingSpinner';
import ChartInfoBubble from './ChartInfoBubble';
import PerformanceCompareChart from './performance/PerformanceCompareChart';
import {
    deriveTestedResults, groupIntervals, normaliseInterval, parseWindowKey,
    windowFromSessions, averageRateG,
} from '../utils/performanceDerivations';
import { MPH_TO_MS, G_MS2 } from '../constants/units';

/** Scalar metrics, by the category each belongs to. */
const SCALARS = {
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

// What distinguishes two performance bars beyond the vehicle itself: who
// produced the figure. Same shape as the range/charging atoms the charging
// charts pass — the composer does not care which subsystem they come from.
const SOURCE_ATOMS = [{ key: 'source', of: s => s.sourceName }];

const CATEGORIES = [
    {
        key: 'accel', title: 'Acceleration',
        defaultMetric: 'zero_to_60_sec',
        note: 'Badge is the average acceleration over the window.',
    },
    {
        key: 'drag', title: 'Drag strip',
        defaultMetric: 'quarter_mile_sec',
        note: 'Badge is the trap speed at that distance.',
    },
    {
        key: 'passing', title: 'Passing',
        defaultMetric: null,   // first available window
        note: 'Badge is the average acceleration over the window.',
    },
    {
        key: 'braking', title: 'Braking',
        defaultMetric: null,
        valueModes: [
            { key: 'distance', label: 'Distance' },
            { key: 'g', label: 'Average g (all windows)' },
        ],
        note: 'In g, every braking window is comparable — grip is near-constant across a stop, ' +
              'so a 70–0 and a 75–0 can be ranked together even though their distances can’t.',
    },
];

export default function PerformanceCompareView({ vehicles, selectedVehicleIds, presentationMode }) {
    const { isDark } = useTheme();

    const [sortDir, setSortDir]   = useState('best');
    // 'best' — one bar per vehicle; 'source' — one per vehicle+source
    const [barMode, setBarMode]   = useState('best');
    const [origin, setOrigin]     = useState('all');   // all | session | published
    const [metrics, setMetrics]   = useState({});      // per-category metric key
    const [brakingMode, setBrakingMode] = useState('distance');
    const [data, setData]         = useState(null);
    const [loading, setLoading]   = useState(true);

    const selected = useMemo(
        () => selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean),
        [selectedVehicleIds, vehicles],
    );

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            const ids = selected.map(v => v.id);
            const [allSessions, allSummaries] = await Promise.all([
                dataService.getPerformanceSessions(ids),
                dataService.getPerformanceSummaries(ids),
            ]);
            const next = {};
            for (const id of ids) next[id] = { sessions: [], summaries: [] };
            for (const s of allSessions)  next[s.vehicle_id]?.sessions.push(s);
            for (const s of allSummaries) next[s.vehicle_id]?.summaries.push(s);
            if (!cancelled) { setData(next); setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [selected.map(v => v.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Every speed window any selected vehicle has, split by kind. */
    const windows = useMemo(() => {
        const byKind = { accel: [], passing: [], braking: [] };
        if (!data) return byKind;
        const seen = new Set();
        for (const v of selected) {
            for (const b of groupIntervals(data[v.id]?.summaries || [])) {
                if (seen.has(b.key)) continue;
                seen.add(b.key);
                byKind[b.kind]?.push({ key: b.key, label: b.label, kind: b.kind });
            }
        }
        return byKind;
    }, [data, selected]);

    /** Metric options offered in each category's picker. */
    const optionsFor = (cat) => {
        if (cat === 'accel')   return [...SCALARS.accel, ...windows.accel];
        if (cat === 'drag')    return SCALARS.drag;
        if (cat === 'passing') return windows.passing;
        return windows.braking;
    };

    const metricFor = (cat, def) => {
        const opts = optionsFor(cat);
        const chosen = metrics[cat] ?? def;
        if (chosen && opts.some(o => o.key === chosen)) return chosen;
        return opts[0]?.key ?? null;
    };

    /**
     * Colour per vehicle, shared across all four charts so a car is the same
     * colour everywhere — the whole point of stacking them.
     */
    const vehicleColors = useMemo(
        () => resolveChartColors(selected.map(v => ({ id: v.id, color: null, created_at: v.created_at })), {}, 'manual'),
        [selected],
    );

    /** Tested entries for one metric, per vehicle, honouring the origin filter. */
    const entriesFor = (metricKey, category) => {
        if (!data || !metricKey) return [];
        const scalar = [...SCALARS.accel, ...SCALARS.drag].find(m => m.key === metricKey);
        const isWindow = metricKey.includes(':');

        return selected.map(v => {
            const bucket = data[v.id] || { sessions: [], summaries: [] };
            let entries = [];

            if (isWindow) {
                const w = parseWindowKey(metricKey);
                const rows = groupIntervals(bucket.summaries).find(x => x.key === metricKey)?.rows || [];
                entries = rows.map(r => {
                    const n = normaliseInterval(r);
                    return {
                        value: n.comparable, display: `${n.value} ${n.displayUnit}`,
                        badge: n.rateG != null ? `${n.rateG.toFixed(3)} g` : null,
                        sourceName: r.source_name || 'Unattributed', origin: 'published',
                        flags: [], windowLabel: n.label,
                    };
                });
                if (w && w.kind !== 'braking' && w.unit === 'mph') {
                    const d = windowFromSessions(bucket.sessions, w.kind, w.from, w.to);
                    if (d) {
                        const g = averageRateG({ kind: w.kind, from_speed: w.from, to_speed: w.to,
                            speed_unit: 'mph', elapsed_s: d.value });
                        entries.push({
                            value: d.value, display: `${d.value.toFixed(3)} s`,
                            badge: g != null ? `${g.toFixed(3)} g` : null,
                            sourceName: bucket.sessions.find(x => x.source_name)?.source_name || 'EVBench',
                            origin: 'session', flags: d.flags,
                        });
                    }
                }
            } else {
                entries = deriveTestedResults(bucket.sessions, bucket.summaries, metricKey).map(e => {
                    let badge = null;
                    if (category === 'accel' && scalar?.to) {
                        // Average acceleration implied by reaching `to` in this time.
                        const g = (scalar.to * MPH_TO_MS) / e.value / G_MS2;
                        badge = `${g.toFixed(3)} g`;
                    } else if (category === 'drag' && scalar?.trap) {
                        const trap = deriveTestedResults(bucket.sessions, bucket.summaries, scalar.trap)
                            .find(t => t.sourceName === e.sourceName)?.value;
                        if (trap != null) badge = `${trap.toFixed(1)} mph`;
                    }
                    return {
                        value: e.value, display: `${e.value.toFixed(3)} ${scalar?.unit ?? 's'}`,
                        badge, sourceName: e.sourceName, origin: e.origin, flags: e.flags,
                    };
                });
            }

            if (origin !== 'all') entries = entries.filter(e => e.origin === origin);
            entries.sort((a, b) => a.value - b.value);
            return { id: v.id, vehicle: v, name: vehicleLabel(v), entries };
        });
    };

    /**
     * Braking in g mode: every window collapses into one comparison.
     * Grip is near-constant across a stop, so a 70–0 and a 75–0 normalise to the
     * same quantity — measured at 0.920 and 0.921 g on the same car. Distances
     * can't be compared across windows; g can.
     */
    const brakingGEntries = () => {
        if (!data) return [];
        return selected.map(v => {
            const bucket = data[v.id] || { summaries: [] };
            let entries = [];
            for (const b of groupIntervals(bucket.summaries)) {
                if (b.kind !== 'braking') continue;
                for (const r of b.rows) {
                    const n = normaliseInterval(r);
                    if (n.rateG == null) continue;
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
            return { id: v.id, vehicle: v, name: vehicleLabel(v), entries };
        });
    };

    /** Flatten per-vehicle entries into bars, honouring bar mode and sort. */
    const rowsFrom = (byVehicle, lowerIsBest) => {
        // Flatten first: a bar is a (vehicle, source) pair, and the labels can
        // only be minimised once the full set of bars is known.
        const flat = [];
        for (const v of byVehicle) {
            if (v.entries.length === 0) { flat.push({ v, e: null }); continue; }
            for (const e of (barMode === 'source' ? v.entries : [v.entries[0]])) flat.push({ v, e });
        }

        // "One per source" declares the source REQUIRED rather than letting
        // minimality drop it: a vehicle with a single source would otherwise
        // show no source at all, in the one mode whose whole point is to name it.
        const labels = buildSeriesLabels(
            flat.map((f, i) => ({ key: i, vehicle: f.v.vehicle, sourceName: f.e?.sourceName })),
            { atoms: SOURCE_ATOMS, required: barMode === 'source' ? ['source'] : [] },
        );

        const out = [];
        flat.forEach(({ v, e }, i) => {
            const name = labels.get(i)?.short ?? v.name;
            if (!e) { out.push({ id: v.id, name, value: null }); return; }
            out.push({
                id: `${v.id}-${e.sourceName}-${e.origin}`,
                name,
                fullName: labels.get(i)?.full ?? v.name,
                value: e.value, display: e.display, badge: e.badge,
                sub: barMode === 'source' ? null : e.sourceName,
                fullData: e.origin === 'session',
                sourceCount: v.entries.length,
                flags: e.flags || [], windowLabel: e.windowLabel,
                color: vehicleColors[v.id],
            });
        });
        const withValue = out.filter(r => r.value != null);
        const bestFirst = sortDir === 'best' ? lowerIsBest : !lowerIsBest;
        withValue.sort((a, b) => bestFirst ? a.value - b.value : b.value - a.value);
        return [...withValue, ...out.filter(r => r.value == null)];
    };

    if (loading) return <LoadingSpinner />;

    return (
        <>
            {!presentationMode && <div className="card mb-6">
                <div className="axis-selectors">
                    <div>
                        <label className="block font-medium mb-2">Bars:</label>
                        <select value={barMode} onChange={e => setBarMode(e.target.value)}
                            className="form-input w-full">
                            <option value="best">Best per vehicle</option>
                            <option value="source">One per source</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Source type:</label>
                        <select value={origin} onChange={e => setOrigin(e.target.value)}
                            className="form-input w-full">
                            <option value="all">All tested</option>
                            <option value="session">Session-backed only</option>
                            <option value="published">Published only</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Sort:</label>
                        <select value={sortDir} onChange={e => setSortDir(e.target.value)}
                            className="form-input w-full">
                            <option value="best">Best first</option>
                            <option value="worst">Worst first</option>
                        </select>
                    </div>
                </div>
                <p className="text-xs text-secondary">
                    Every bar is a tested figure, whoever produced it — results derived from
                    imported sessions rank alongside published ones, marked ✦. Manufacturer
                    claims are excluded. A vehicle keeps its colour across all four charts.
                </p>
            </div>}

            {CATEGORIES.map(cat => {
                const isBrakingG = cat.key === 'braking' && brakingMode === 'g';
                const opts = optionsFor(cat.key);
                const metricKey = metricFor(cat.key, cat.defaultMetric);
                const scalar = [...SCALARS.accel, ...SCALARS.drag].find(m => m.key === metricKey);

                const byVehicle = isBrakingG ? brakingGEntries() : entriesFor(metricKey, cat.key);
                // Higher is better only for braking-in-g; every other metric here
                // is a time or a distance.
                const rows = rowsFrom(byVehicle, !isBrakingG);

                const axisLabel = isBrakingG ? 'Average deceleration (g)'
                    : cat.key === 'braking' ? 'Distance (ft)'
                    : scalar ? `${scalar.label} (${scalar.unit})`
                    : 'Time (s)';

                if (opts.length === 0 && !isBrakingG) {
                    return (
                        <div key={cat.key} className="card mb-4">
                            <h3 className="text-lg font-semibold mb-1">{cat.title}</h3>
                            <p className="text-sm text-secondary">
                                None of the selected vehicles has {cat.title.toLowerCase()} data yet.
                            </p>
                        </div>
                    );
                }

                return (
                    <PerformanceCompareChart
                        key={cat.key}
                        title={cat.title}
                        metricOptions={opts}
                        metric={metricKey}
                        onMetricChange={k => setMetrics(m => ({ ...m, [cat.key]: k }))}
                        valueModes={cat.valueModes}
                        valueMode={brakingMode}
                        onValueModeChange={setBrakingMode}
                        rows={rows}
                        axisLabel={axisLabel}
                        barMode={barMode}
                        isDark={isDark}
                        presentationMode={presentationMode}
                        note={cat.note}
                    />
                );
            })}

            {!presentationMode && <ChartInfoBubble chartKey="perfcompare" />}
        </>
    );
}
