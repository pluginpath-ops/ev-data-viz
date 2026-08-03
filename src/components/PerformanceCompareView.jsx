/**
 * Performance Compare — one bar per vehicle for a chosen metric.
 *
 * ── LIKE FOR LIKE IS THE WHOLE POINT ────────────────────────────────────────
 *
 * Every bar on the chart comes from the SAME kind of source, chosen by the
 * basis selector: measured against measured, or reported against reported.
 * A vehicle with no data on the selected basis is shown explicitly as having
 * none — it is never quietly filled in from the other basis.
 *
 * This is why the chart does NOT use resolveMetric().preferred, which falls
 * back measured → reported → claimed. That fallback is right for a single
 * vehicle's summary panel, but on a comparison it would silently put one
 * vehicle's stopwatch next to another vehicle's press release and draw them as
 * if they were the same measurement.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';
import { vehicleLabel } from '../utils/specHelpers';
import { useTheme } from '../hooks/useTheme';
import LoadingSpinner from './LoadingSpinner';
import ChartInfoBubble from './ChartInfoBubble';
import {
    deriveFromRuns, deriveFromSummaries, groupIntervals, normaliseInterval,
} from '../utils/performanceDerivations';

/** Metrics stored as promoted columns, available on both bases. */
const SCALAR_METRICS = [
    { key: 'zero_to_60_sec',         label: '0–60 mph (no rollout)', unit: 's',   lowerIsBetter: true  },
    { key: 'zero_to_60_rollout_sec', label: '0–60 mph (1 ft)',        unit: 's',   lowerIsBetter: true  },
    { key: 'quarter_mile_sec',       label: '¼ mile',                 unit: 's',   lowerIsBetter: true  },
    { key: 'quarter_mile_trap_mph',  label: '¼ mile trap',            unit: 'mph', lowerIsBetter: false },
];

const BASES = [
    { key: 'measured', label: 'Measured', hint: 'Derived from testing sessions imported into EVBench.' },
    { key: 'reported', label: 'Reported', hint: 'Published figures entered from a source.' },
];

export default function PerformanceCompareView({ vehicles, selectedVehicleIds, presentationMode }) {
    const { isDark } = useTheme();
    const canvasRef  = useRef(null);
    const chartRef   = useRef(null);

    const [basis, setBasis]   = useState('measured');
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

    // Speed windows are only ever reported, so they appear as metric options
    // only on that basis — and only the windows some selected vehicle actually has.
    const windowOptions = useMemo(() => {
        if (!data || basis !== 'reported') return [];
        const seen = new Map();
        for (const v of selected) {
            for (const b of groupIntervals(data[v.id]?.summaries || [])) {
                if (!seen.has(b.key)) seen.set(b.key, { key: b.key, label: b.label, kind: b.kind });
            }
        }
        return [...seen.values()];
    }, [data, selected, basis]);

    // Selecting a window then switching to Measured would leave an impossible
    // metric selected; fall back rather than rendering an empty chart.
    useEffect(() => {
        const isWindow = metric.includes(':');
        if (isWindow && (basis !== 'reported' || !windowOptions.some(w => w.key === metric))) {
            setMetric('zero_to_60_sec');
        }
    }, [basis, windowOptions, metric]);

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

            const rec = basis === 'measured'
                ? deriveFromRuns(bucket.sessions, activeMetric.key)
                : deriveFromSummaries(bucket.summaries, activeMetric.key);

            return {
                id: v.id, name,
                value: rec.value,
                display: rec.value != null ? `${rec.value.toFixed(3)} ${activeMetric.unit}` : null,
                sub: basis === 'measured'
                    ? (rec.basis?.drive_mode || null)
                    : (rec.basis?.source_name || null),
                flags: rec.flags || [],
                unit: activeMetric.unit,
            };
        });
    }, [data, selected, activeMetric, basis]);

    const withData    = rows.filter(r => r.value != null);
    const withoutData = rows.filter(r => r.value == null);

    const sorted = useMemo(() => {
        const lower = activeMetric.lowerIsBetter !== false;
        return [...withData].sort((a, b) => lower ? a.value - b.value : b.value - a.value);
    }, [withData, activeMetric]);

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
                    if (row.sub) pills.push(row.sub);

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
                                if (r.flags?.includes('multiple-sources')) lines.push('⚠ Sources disagree');
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
        <div className="chart-card">
            {!presentationMode && (
                <div className="flex flex-wrap items-end gap-4 mb-3">
                    <div>
                        <span className="text-xs text-muted block mb-1">Compare using</span>
                        <div className="flex gap-0.5">
                            {BASES.map(b => (
                                <button
                                    key={b.key}
                                    onClick={() => setBasis(b.key)}
                                    title={b.hint}
                                    className={`btn-chart-mode ${basis === b.key ? 'active' : ''}`}
                                >
                                    {b.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <label className="text-xs">
                        <span className="text-muted block mb-1">Metric</span>
                        <select
                            value={metric}
                            onChange={e => setMetric(e.target.value)}
                            className="form-input text-sm py-1 min-w-[14rem]"
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
                    </label>
                </div>
            )}

            <h3 className="chart-title">
                {activeMetric.label}
                <span className="text-muted font-normal"> · {basis}</span>
            </h3>

            {sorted.length === 0 ? (
                <p className="text-sm text-muted py-8 text-center">
                    None of the selected vehicles has {basis} data for this metric.
                    {basis === 'measured'
                        ? ' Import a testing CSV in Tests & Data, or switch to Reported.'
                        : ' Add a reported result in Tests & Data, or switch to Measured.'}
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
                        ? `No ${basis} data for: ${withoutData.map(r => r.name).join(', ')}`
                        : `${withoutData.length} other selected vehicles have no ${basis} data.`}
                </p>
            )}

            {!presentationMode && <ChartInfoBubble chartKey="perfcompare" />}
        </div>
    );
}
