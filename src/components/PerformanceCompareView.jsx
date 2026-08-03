/**
 * Performance Compare — one bar per vehicle for a chosen metric.
 *
 * Every bar is a TESTED figure, and they all rank together: a result derived
 * from a session imported here and one published by a magazine are the same
 * kind of claim, so there is no basis to choose between. Each bar names the
 * source it came from, and marks the ones EVBench holds the full run data for.
 *
 * Manufacturer claims are deliberately absent — a marketing figure is not a
 * test result, and mixing one into this ranking would misrepresent the rest.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';
import { vehicleLabel } from '../utils/specHelpers';
import { useTheme } from '../hooks/useTheme';
import LoadingSpinner from './LoadingSpinner';
import ChartInfoBubble from './ChartInfoBubble';
import {
    deriveTestedResults, groupIntervals, normaliseInterval, parseWindowKey,
    windowFromSessions, PINNED_WINDOWS,
} from '../utils/performanceDerivations';

/** Metrics stored as promoted columns, available on both bases. */
const SCALAR_METRICS = [
    { key: 'zero_to_60_sec',         label: '0–60 mph (no rollout)', unit: 's',   lowerIsBetter: true  },
    { key: 'zero_to_60_rollout_sec', label: '0–60 mph (1 ft)',        unit: 's',   lowerIsBetter: true  },
    { key: 'zero_to_100_sec',        label: '0–100 mph',              unit: 's',   lowerIsBetter: true  },
    { key: 'quarter_mile_sec',       label: '¼ mile',                 unit: 's',   lowerIsBetter: true  },
    { key: 'quarter_mile_trap_mph',  label: '¼ mile trap',            unit: 'mph', lowerIsBetter: false },
    { key: 'eighth_mile_sec',        label: '⅛ mile',                 unit: 's',   lowerIsBetter: true  },
    { key: 'eighth_mile_trap_mph',   label: '⅛ mile trap',            unit: 'mph', lowerIsBetter: false },
    { key: 'sixty_ft_sec',           label: '60 ft',                  unit: 's',   lowerIsBetter: true  },
];

export default function PerformanceCompareView({ vehicles, selectedVehicleIds, presentationMode }) {
    const { isDark } = useTheme();
    const canvasRef  = useRef(null);
    const chartRef   = useRef(null);

    const [sortDir, setSortDir] = useState('best');
    // 'best'   — one bar per vehicle, its strongest figure
    // 'source' — one bar per vehicle+source, to compare publications directly
    const [barMode, setBarMode] = useState('best');
    const [metric, setMetric] = useState('zero_to_60_sec');
    const [data, setData]     = useState(null);   // { [vehicleId]: {sessions, summaries} }
    const [loading, setLoading] = useState(true);

    const selected = useMemo(
        () => selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean),
        [selectedVehicleIds, vehicles],
    );

    // Fetch straight from dataService, matching how the other chart views load
    // their series rather than routing bulk reads through context.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            const ids = selected.map(v => v.id);
            // Two queries total, not two per vehicle — a wide selection is the
            // normal case here, and per-vehicle fetching meant ~100 round trips.
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

    // Every window some selected vehicle actually has. Pinned ones are listed
    // as standard metrics instead, so 0-100 sits beside 0-60 rather than being
    // buried among braking distances.
    const windowOptions = useMemo(() => {
        if (!data) return [];
        const seen = new Map();
        for (const v of selected) {
            for (const b of groupIntervals(data[v.id]?.summaries || [])) {
                if (PINNED_WINDOWS.some(p => p.key === b.key)) continue;
                if (!seen.has(b.key)) seen.set(b.key, { key: b.key, label: b.label, kind: b.kind });
            }
        }
        return [...seen.values()];
    }, [data, selected]);

    /** Pinned + discovered windows — everything resolvable as a speed window. */
    const allWindows = useMemo(
        () => [...PINNED_WINDOWS, ...windowOptions],
        [windowOptions],
    );

    // A window can stop existing when the selection changes; fall back rather
    // than rendering an empty chart against a metric nobody has.
    useEffect(() => {
        if (metric.includes(':') && !allWindows.some(w => w.key === metric)) {
            setMetric('zero_to_60_sec');
        }
    }, [allWindows, metric]);

    const activeMetric = useMemo(() => {
        if (metric.includes(':')) {
            const w = allWindows.find(o => o.key === metric);
            return w
                ? { key: w.key, label: w.label, isWindow: true, kind: w.kind, lowerIsBetter: true }
                : SCALAR_METRICS[0];
        }
        return SCALAR_METRICS.find(m => m.key === metric) || SCALAR_METRICS[0];
    }, [metric, allWindows]);

    /**
     * Every tested entry per vehicle, from every source.
     *
     * Speed windows pull from two places: published interval rows, and windows
     * cut out of session split data (a Draggy trace contains a 30-50 as
     * t(50) − t(30)). Without the second, a vehicle with full run data would
     * show nothing for a window that its own trace clearly measures.
     */
    const entriesByVehicle = useMemo(() => {
        if (!data) return [];
        return selected.map(v => {
            const bucket = data[v.id] || { sessions: [], summaries: [] };
            const name = vehicleLabel(v);
            let entries = [];

            if (activeMetric.isWindow) {
                const w = parseWindowKey(activeMetric.key);
                const bucketRows = groupIntervals(bucket.summaries)
                    .find(x => x.key === activeMetric.key)?.rows || [];

                entries = bucketRows.map(r => ({
                    value: r.comparable,
                    display: `${r.value} ${r.displayUnit}`,
                    rateG: normaliseInterval(r).rateG,
                    sourceName: r.source_name || 'Unattributed',
                    origin: 'published',
                    flags: [],
                }));

                // Metric units are seconds for timed windows, feet for braking.
                if (w && w.kind !== 'braking' && w.unit === 'mph') {
                    const derived = windowFromSessions(bucket.sessions, w.kind, w.from, w.to);
                    if (derived) {
                        entries.push({
                            value: derived.value,
                            display: `${derived.value.toFixed(3)} s`,
                            rateG: null,
                            sourceName: bucket.sessions.find(x => x.source_name)?.source_name || 'EVBench',
                            origin: 'session',
                            flags: derived.flags,
                        });
                    }
                }
            } else {
                entries = deriveTestedResults(bucket.sessions, bucket.summaries, activeMetric.key)
                    .map(e => ({
                        value: e.value,
                        display: `${e.value.toFixed(3)} ${activeMetric.unit}`,
                        rateG: null,
                        sourceName: e.sourceName,
                        origin: e.origin,
                        flags: e.flags,
                        basis: e.basis,
                    }));
            }

            const lower = activeMetric.lowerIsBetter !== false;
            entries.sort((a, b) => lower ? a.value - b.value : b.value - a.value);
            return { id: v.id, name, entries };
        });
    }, [data, selected, activeMetric]);

    /** Flattened to bars, either best-per-vehicle or one per source. */
    const rows = useMemo(() => {
        const out = [];
        for (const v of entriesByVehicle) {
            if (v.entries.length === 0) {
                out.push({ id: v.id, name: v.name, value: null });
                continue;
            }
            const picked = barMode === 'source' ? v.entries : [v.entries[0]];
            for (const e of picked) {
                out.push({
                    id: `${v.id}-${e.sourceName}-${e.origin}`,
                    name: barMode === 'source' ? `${v.name} · ${e.sourceName}` : v.name,
                    value: e.value,
                    display: e.display,
                    rateG: e.rateG,
                    sub: barMode === 'source' ? null : e.sourceName,
                    fullData: e.origin === 'session',
                    sourceCount: v.entries.length,
                    flags: e.flags || [],
                    unit: activeMetric.unit,
                });
            }
        }
        return out;
    }, [entriesByVehicle, barMode, activeMetric]);

    const withData    = rows.filter(r => r.value != null);
    const withoutData = rows.filter(r => r.value == null);

    const sorted = useMemo(() => {
        // "Best" depends on the metric: quicker is better for a time, but higher
        // is better for a trap speed.
        const lowerIsBest = activeMetric.lowerIsBetter !== false;
        const bestFirst = sortDir === 'best' ? lowerIsBest : !lowerIsBest;
        return [...withData].sort((a, b) => bestFirst ? a.value - b.value : b.value - a.value);
    }, [withData, activeMetric, sortDir]);

    // ── Chart ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!canvasRef.current || sorted.length === 0) {
            chartRef.current?.destroy();
            chartRef.current = null;
            return;
        }
        chartRef.current?.destroy();

        const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const tick = isDark ? '#cbd5e1' : '#475569';

        const labelPlugin = {
            id: 'perfBarLabels',
            afterDatasetsDraw(chart) {
                const ctx = chart.ctx;
                const meta = chart.getDatasetMeta(0);
                meta.data.forEach((bar, i) => {
                    const row = sorted[i];
                    if (!row) return;
                    const pills = [row.display];
                    if (row.rateG != null) pills.push(`${row.rateG.toFixed(3)} g`);
                    // Source, and a marker when the run data sits behind it.
                    if (row.sub) pills.push(row.fullData ? `${row.sub} ✦` : row.sub);

                    let x = bar.base + 8;
                    const y = bar.y - 7;
                    pills.forEach((text, idx) => {
                        ctx.save();
                        ctx.font = idx === 0 ? 'bold 11px sans-serif' : '10px sans-serif';
                        const w = ctx.measureText(text).width + 10;
                        if (x + w > bar.x - 2) { ctx.restore(); return; }
                        ctx.fillStyle = 'rgba(0,0,0,0.28)';
                        ctx.beginPath();
                        ctx.roundRect(x, y, w, 15, 3);
                        ctx.fill();
                        ctx.fillStyle = '#fff';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(text, x + w / 2, y + 7.5);
                        ctx.restore();
                        x += w + 4;
                    });
                });
            },
        };

        chartRef.current = new Chart(canvasRef.current, {
            type: 'bar',
            data: {
                labels: sorted.map(r => r.name),
                datasets: [{
                    data: sorted.map(r => r.value),
                    backgroundColor: sorted.map((_, i) =>
                        `hsl(${(210 + i * 26) % 360} 70% ${isDark ? 45 : 55}%)`),
                    borderRadius: 4,
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => {
                                const r = sorted[c.dataIndex];
                                const lines = [r.display];
                                if (r.rateG != null) lines.push(`Average rate: ${r.rateG.toFixed(3)} g`);
                                if (r.sub) lines.push(r.sub);
                                if (r.flags?.includes('single-run')) lines.push('⚠ Single run only');
                                if (r.flags?.includes('steep-grade')) lines.push('⚠ Best run was on a grade');
                                if (r.fullData) lines.push('✦ Full run data held here');
                                if (r.flags?.includes('derived-from-launch')) {
                                    lines.push('Cut from a standing-start launch, not a roll-on —');
                                    lines.push('the car was already at full power, so this reads slightly quick');
                                }
                                if (r.flags?.includes('interpolated')) lines.push('⚠ Interpolated between recorded splits');
                                if (r.sourceCount > 1 && barMode !== 'source') {
                                    lines.push(`${r.sourceCount} sources have tested this — switch Bars to "One per source"`);
                                }
                                return lines;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: grid },
                        ticks: { color: tick },
                        title: {
                            display: true,
                            color: tick,
                            text: activeMetric.isWindow
                                ? (activeMetric.kind === 'braking' ? 'Distance (ft)' : 'Time (s)')
                                : `${activeMetric.label} (${activeMetric.unit})`,
                        },
                    },
                    y: { grid: { display: false }, ticks: { color: tick } },
                },
            },
            plugins: [labelPlugin],
        });

        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [sorted, isDark, activeMetric, barMode]);

    if (loading) return <LoadingSpinner />;

    return (
        <>
            {!presentationMode && <div className="card mb-6">
                <div className="axis-selectors">
                    <div>
                        <label className="block font-medium mb-2">Metric:</label>
                        <select
                            value={metric}
                            onChange={e => setMetric(e.target.value)}
                            className="border p-2 rounded w-full"
                        >
                            {SCALAR_METRICS.map(m => (
                                <option key={m.key} value={m.key}>{m.label}</option>
                            ))}
                            {PINNED_WINDOWS.map(w => (
                                <option key={w.key} value={w.key}>{w.label}</option>
                            ))}
                            {windowOptions.length > 0 && (
                                <optgroup label="Speed windows">
                                    {windowOptions.map(w => (
                                        <option key={w.key} value={w.key}>
                                            {w.label} ({w.kind})
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Bars:</label>
                        <select
                            value={barMode}
                            onChange={e => setBarMode(e.target.value)}
                            className="border p-2 rounded w-full"
                        >
                            <option value="best">Best per vehicle</option>
                            <option value="source">One per source</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Sort:</label>
                        <select
                            value={sortDir}
                            onChange={e => setSortDir(e.target.value)}
                            className="border p-2 rounded w-full"
                        >
                            <option value="best">Best first</option>
                            <option value="worst">Worst first</option>
                        </select>
                    </div>
                </div>
                <p className="text-xs text-muted">
                    Every bar is a tested figure, whoever produced it — results derived from
                    imported sessions rank alongside published ones. “One per source” splits
                    a vehicle into a bar per publication, to compare who measured what.
                    Speed windows are also read out of session split data where the trace
                    covers them; those are marked ✦ and, being cut from a standing-start
                    launch rather than a roll-on, read slightly quicker than a published
                    roll-on of the same window. Manufacturer claims are excluded.
                </p>
            </div>}

            <div className="card mb-4">
                <h3 className="text-lg font-semibold mb-3">
                    {activeMetric.label}
                    <span className="text-muted font-normal text-sm"> · tested</span>
                </h3>

                {sorted.length === 0 ? (
                    <p className="text-sm text-muted py-8 text-center">
                        None of the selected vehicles has a tested figure for this metric.
                        Import a testing CSV or add a published result in Tests &amp; Data.
                    </p>
                ) : (
                    <div style={{ height: Math.max(180, sorted.length * 46) }}>
                        <canvas ref={canvasRef} />
                    </div>
                )}

                {/* Absent vehicles are acknowledged rather than dropped, so a missing
                    bar doesn't read as a vehicle that simply performed badly. Named
                    only while the list is short enough to be worth reading — most
                    selections have far more vehicles without data than with. */}
                {withoutData.length > 0 && sorted.length > 0 && (
                    <p className="text-xs text-faint mt-2">
                        {withoutData.length <= 6
                            ? `No tested figure for: ${withoutData.map(r => r.name).join(', ')}`
                            : `${withoutData.length} other selected vehicles have no tested figure for this metric.`}
                    </p>
                )}
            </div>

            {!presentationMode && <ChartInfoBubble chartKey="perfcompare" />}
        </>
    );
}
