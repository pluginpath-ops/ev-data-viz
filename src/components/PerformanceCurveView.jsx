/**
 * Acceleration Curve — speed against elapsed time, one line per run.
 *
 * Built from the split series (performance_run_points), so it only has anything
 * to draw where a detail testing CSV has been imported. Reported figures carry
 * no trace, and are deliberately not synthesised into a fake curve.
 *
 * Defaults to the best run per drive mode: a session is typically eight
 * launches, and plotting all of them at once buries the comparison that
 * actually matters — what each drive mode costs you.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';
import { vehicleLabel } from '../utils/specHelpers';
import { useTheme } from '../hooks/useTheme';
import LoadingSpinner from './LoadingSpinner';
import ChartInfoBubble from './ChartInfoBubble';

/** Okabe-Ito, matching the palette the other charts use for run colours. */
const PALETTE = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442'];

export default function PerformanceCurveView({ vehicles, selectedVehicleIds, presentationMode }) {
    const { isDark } = useTheme();
    const canvasRef  = useRef(null);
    const chartRef   = useRef(null);

    const [sessionsByVehicle, setSessionsByVehicle] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showAllRuns, setShowAllRuns] = useState(false);
    const [xMax, setXMax] = useState('');   // '' = auto-scale
    const [yMax, setYMax] = useState('');

    const selected = useMemo(
        () => selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean),
        [selectedVehicleIds, vehicles],
    );

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            const ids = selected.map(v => v.id);
            const allSessions = await dataService.getPerformanceSessions(ids);
            const next = {};
            for (const id of ids) next[id] = [];
            for (const s of allSessions) next[s.vehicle_id]?.push(s);
            if (!cancelled) { setSessionsByVehicle(next); setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [selected.map(v => v.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    /**
     * One series per run worth plotting. A run needs at least two split points
     * to be a curve rather than a dot.
     */
    const series = useMemo(() => {
        if (!sessionsByVehicle) return [];
        const out = [];
        for (const v of selected) {
            const name = vehicleLabel(v);
            for (const session of sessionsByVehicle[v.id] || []) {
                if (session.test_type !== 'accel') continue;

                const runs = (session.performance_runs || []).filter(
                    r => (r.performance_run_points || []).length >= 2,
                );
                // Best (quickest) run per drive mode unless showing everything.
                const chosen = showAllRuns ? runs : Object.values(
                    runs.reduce((acc, r) => {
                        const key = r.drive_mode || 'Unspecified';
                        const cur = acc[key];
                        const t = r.zero_to_60_sec ?? Infinity;
                        if (!cur || t < (cur.zero_to_60_sec ?? Infinity)) acc[key] = r;
                        return acc;
                    }, {}),
                );

                for (const run of chosen) {
                    // Drop the 1ft-rollout split: it's the same 60 mph point on a
                    // different clock, and mixing it with the zero-start splits
                    // would double back on the curve.
                    const points = (run.performance_run_points || [])
                        .filter(p => p.speed_mph != null && p.elapsed_s != null && !/\(1ft\)/.test(p.label || ''))
                        .map(p => ({ x: Number(p.elapsed_s), y: Number(p.speed_mph) }))
                        .sort((a, b) => a.x - b.x);
                    if (points.length < 2) continue;

                    // Every launch starts from rest; the export omits that point.
                    if (points[0].x > 0 && points[0].y > 0) points.unshift({ x: 0, y: 0 });

                    // Sources list splits up to 0-50 and then give 0-60 only as the
                    // headline figure, so without this the curve stops short of the
                    // very speed the run is named for. zero_to_60_sec is the
                    // no-rollout time — the same clock as the splits above.
                    const t60 = Number(run.zero_to_60_sec);
                    if (Number.isFinite(t60) && t60 > points[points.length - 1].x) {
                        points.push({ x: t60, y: 60 });
                    }

                    out.push({
                        // Year and trim are dropped: with one line per drive mode the
                        // legend is already long, and the mode is what distinguishes them.
                        label: `${v.name} · ${run.drive_mode || 'Run'}${showAllRuns ? ` #${(run.sequence ?? 0) + 1}` : ''}`,
                        fullLabel: `${name} · ${run.drive_mode || 'Run'}`,
                        points,
                        zeroTo60: run.zero_to_60_sec,
                    });
                }
            }
        }
        return out;
    }, [sessionsByVehicle, selected, showAllRuns]);

    useEffect(() => {
        if (!canvasRef.current || series.length === 0) {
            chartRef.current?.destroy();
            chartRef.current = null;
            return;
        }
        chartRef.current?.destroy();

        const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const tick = isDark ? '#cbd5e1' : '#475569';

        chartRef.current = new Chart(canvasRef.current, {
            type: 'line',
            data: {
                datasets: series.map((s, i) => ({
                    label: s.label,
                    data: s.points,
                    borderColor: PALETTE[i % PALETTE.length],
                    backgroundColor: PALETTE[i % PALETTE.length],
                    borderWidth: 2,
                    pointRadius: presentationMode ? 0 : 2.5,
                    tension: 0.25,
                })),
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', intersect: false },
                plugins: {
                    legend: {
                        // Drive-mode names run long ("Sport - No Launch Mode but 2
                        // foot preload - Firm Damper - Stability Reduced"), so the
                        // legend is capped and truncated rather than eating the plot.
                        position: 'bottom',
                        labels: {
                            color: tick,
                            usePointStyle: true,
                            boxWidth: 8,
                            padding: 8,
                            font: { size: 10 },
                            generateLabels: (chart) => Chart.defaults.plugins.legend.labels
                                .generateLabels(chart)
                                .map(l => ({
                                    ...l,
                                    text: l.text.length > 46 ? l.text.slice(0, 44) + '…' : l.text,
                                })),
                        },
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => `${items[0].parsed.x.toFixed(3)} s`,
                            // Tooltip shows the untruncated name, so the legend can
                            // stay short without losing which vehicle a line is.
                            label: (c) => `${series[c.datasetIndex]?.fullLabel ?? c.dataset.label}: ${c.parsed.y.toFixed(0)} mph`,
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        beginAtZero: true,
                        ...(Number(xMax) > 0 ? { max: Number(xMax) } : {}),
                        grid: { color: grid },
                        ticks: { color: tick },
                        title: { display: true, text: 'Elapsed time (s)', color: tick },
                    },
                    y: {
                        beginAtZero: true,
                        ...(Number(yMax) > 0 ? { max: Number(yMax) } : {}),
                        grid: { color: grid },
                        ticks: { color: tick },
                        title: { display: true, text: 'Speed (mph)', color: tick },
                    },
                },
            },
        });

        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [series, isDark, presentationMode, xMax, yMax]);

    if (loading) return <LoadingSpinner />;

    return (
        <>
            {!presentationMode && <div className="card mb-6">
                <div className="axis-selectors">
                    <div>
                        <label className="block font-medium mb-2">X-Axis:</label>
                        <select disabled value="time" className="border p-2 rounded w-full opacity-60">
                            <option value="time">Elapsed time (s)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Y-Axis:</label>
                        <select disabled value="speed" className="border p-2 rounded w-full opacity-60">
                            <option value="speed">Speed (mph)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Runs shown:</label>
                        <select
                            value={showAllRuns ? 'all' : 'best'}
                            onChange={e => setShowAllRuns(e.target.value === 'all')}
                            className="border p-2 rounded w-full"
                        >
                            <option value="best">Best per drive mode</option>
                            <option value="all">Every run</option>
                        </select>
                    </div>
                </div>

                {/* A single slow mode stretches the time axis and squashes every
                    other line into the left edge, so the range is clampable. */}
                <div className="axis-selectors">
                    <div>
                        <label className="block font-medium mb-2">Max time (s):</label>
                        <input
                            type="number" step="0.5" min="0" value={xMax}
                            onChange={e => setXMax(e.target.value)}
                            placeholder="auto"
                            className="border p-2 rounded w-full"
                        />
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Max speed (mph):</label>
                        <input
                            type="number" step="5" min="0" value={yMax}
                            onChange={e => setYMax(e.target.value)}
                            placeholder="auto"
                            className="border p-2 rounded w-full"
                        />
                    </div>
                    <div className="flex items-end">
                        <span className="text-xs text-faint pb-2">
                            {showAllRuns ? 'All runs' : 'Best run per drive mode'} · {series.length} plotted
                        </span>
                    </div>
                </div>

                <p className="text-xs text-muted">
                    Built from imported split times. The 1&nbsp;ft-rollout split is left out —
                    it is the same 60&nbsp;mph point on a different clock — and the 0–60 time is
                    added as the final point, since sources list splits only to 0–50.
                </p>
            </div>}

            <div className="card mb-4">
                <h3 className="text-lg font-semibold mb-3">Speed vs Time</h3>

                {series.length === 0 ? (
                    <p className="text-sm text-muted py-8 text-center">
                        No acceleration split data for the selected vehicles. This chart is built
                        from imported testing CSVs — reported figures alone carry no trace to plot.
                    </p>
                ) : (
                    <div style={{ height: presentationMode ? 'calc(100vh - 2rem)' : 460 }}>
                        <canvas ref={canvasRef} />
                    </div>
                )}
            </div>

            {!presentationMode && <ChartInfoBubble chartKey="perfcurve" />}
        </>
    );
}
