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
    deriveTested, groupIntervals, normaliseInterval,
} from '../utils/performanceDerivations';

/** Metrics stored as promoted columns, available on both bases. */
const SCALAR_METRICS = [
    { key: 'zero_to_60_sec',         label: '0–60 mph (no rollout)', unit: 's',   lowerIsBetter: true  },
    { key: 'zero_to_60_rollout_sec', label: '0–60 mph (1 ft)',        unit: 's',   lowerIsBetter: true  },
    { key: 'quarter_mile_sec',       label: '¼ mile',                 unit: 's',   lowerIsBetter: true  },
    { key: 'quarter_mile_trap_mph',  label: '¼ mile trap',            unit: 'mph', lowerIsBetter: false },
];

export default function PerformanceCompareView({ vehicles, selectedVehicleIds, presentationMode }) {
    const { isDark } = useTheme();
    const canvasRef  = useRef(null);
    const chartRef   = useRef(null);

    const [sortDir, setSortDir] = useState('best');
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

    // Only the windows some selected vehicle actually has.
    const windowOptions = useMemo(() => {
        if (!data) return [];
        const seen = new Map();
        for (const v of selected) {
            for (const b of groupIntervals(data[v.id]?.summaries || [])) {
                if (!seen.has(b.key)) seen.set(b.key, { key: b.key, label: b.label, kind: b.kind });
            }
        }
        return [...seen.values()];
    }, [data, selected]);

    // A window can stop existing when the selection changes; fall back rather
    // than rendering an empty chart against a metric nobody has.
    useEffect(() => {
        if (metric.includes(':') && !windowOptions.some(w => w.key === metric)) {
            setMetric('zero_to_60_sec');
        }
    }, [windowOptions, metric]);

    const activeMetric = useMemo(() => {
        if (metric.includes(':')) {
            const w = windowOptions.find(o => o.key === metric);
            return w
                ? { key: w.key, label: w.label, isWindow: true, kind: w.kind, lowerIsBetter: true }
                : SCALAR_METRICS[0];
        }
        return SCALAR_METRICS.find(m => m.key === metric) || SCALAR_METRICS[0];
    }, [metric, windowOptions]);

    /** One row per selected vehicle on the ACTIVE BASIS ONLY. */
    const rows = useMemo(() => {
        if (!data) return [];
        return selected.map(v => {
            const bucket = data[v.id] || { sessions: [], summaries: [] };
            const name = vehicleLabel(v);

            if (activeMetric.isWindow) {
                const b = groupIntervals(bucket.summaries).find(x => x.key === activeMetric.key);
                const best = b?.rows?.[0];
                return {
                    id: v.id, name,
                    value: best?.comparable ?? null,
                    display: best ? `${best.value} ${best.displayUnit}` : null,
                    sub: best?.source_name ?? null,
                    rateG: best ? normaliseInterval(best).rateG : null,
                    unit: best?.displayUnit ?? '',
                };
            }

            const rec = deriveTested(bucket.sessions, bucket.summaries, activeMetric.key);

            return {
                id: v.id, name,
                value: rec.value,
                display: rec.value != null ? `${rec.value.toFixed(3)} ${activeMetric.unit}` : null,
                // The source is the useful label — a bar is only meaningful if you
                // can see who produced the number.
                sub: rec.basis?.sourceName || null,
                fullData: rec.basis?.origin === 'session',
                sourceCount: rec.basis?.all?.length ?? 0,
                flags: rec.flags || [],
                unit: activeMetric.unit,
            };
        });
    }, [data, selected, activeMetric]);

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
                                if (r.sourceCount > 1) lines.push(`${r.sourceCount} sources have tested this`);
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
    }, [sorted, isDark, activeMetric]);

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
                    Each bar is the best tested figure for that vehicle, whoever produced
                    it — results derived from imported sessions rank alongside published
                    ones, and the bar names its source. Manufacturer claims are excluded.
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
