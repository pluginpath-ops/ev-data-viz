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
import AxisScaleControls from './AxisScaleControls';

/** Okabe-Ito, matching the palette the other charts use for run colours. */
const PALETTE = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442'];

export default function PerformanceCurveView({ vehicles, selectedVehicleIds, presentationMode }) {
    const { isDark } = useTheme();
    const canvasRef  = useRef(null);
    const chartRef   = useRef(null);

    const [sessionsByVehicle, setSessionsByVehicle] = useState(null);
    const [loading, setLoading] = useState(true);
    // 'mode'   — quickest run in each drive mode (default: the mode comparison)
    // 'vehicle' — one line per vehicle, its single quickest run
    // 'all'     — every run, for run-to-run consistency
    const [grouping, setGrouping] = useState('mode');
    const [scale, setScale] = useState({ xMin: null, xMax: null, yMin: null, yMax: null });

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
        const quickest = (a, b) => (a?.zero_to_60_sec ?? Infinity) <= (b?.zero_to_60_sec ?? Infinity) ? a : b;
        const out = [];
        for (const v of selected) {
            const name = vehicleLabel(v);

            // Runs across every accel session this vehicle has, since a vehicle's
            // quickest run isn't necessarily in its most recent session.
            const allRuns = (sessionsByVehicle[v.id] || [])
                .filter(s => s.test_type === 'accel')
                .flatMap(s => (s.performance_runs || []).filter(
                    r => (r.performance_run_points || []).length >= 2,
                ));
            if (allRuns.length === 0) continue;

            let chosen;
            if (grouping === 'all') {
                chosen = allRuns;
            } else if (grouping === 'vehicle') {
                chosen = [allRuns.reduce(quickest)];
            } else {
                chosen = Object.values(allRuns.reduce((acc, r) => {
                    const key = r.drive_mode || 'Unspecified';
                    acc[key] = acc[key] ? quickest(acc[key], r) : r;
                    return acc;
                }, {}));
            }

            {
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
                        // Best-per-vehicle needs no mode in the label — there's one line.
                        label: grouping === 'vehicle'
                            ? v.name
                            : `${v.name} · ${run.drive_mode || 'Run'}${grouping === 'all' ? ` #${(run.sequence ?? 0) + 1}` : ''}`,
                        fullLabel: `${name} · ${run.drive_mode || 'Run'}`,
                        points,
                        zeroTo60: run.zero_to_60_sec,
                    });
                }
            }
        }
        return out;
    }, [sessionsByVehicle, selected, grouping]);

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
                        beginAtZero: scale.xMin == null,
                        ...(scale.xMin != null ? { min: scale.xMin } : {}),
                        ...(scale.xMax != null ? { max: scale.xMax } : {}),
                        grid: { color: grid },
                        ticks: { color: tick },
                        title: { display: true, text: 'Elapsed time (s)', color: tick },
                    },
                    y: {
                        beginAtZero: scale.yMin == null,
                        ...(scale.yMin != null ? { min: scale.yMin } : {}),
                        ...(scale.yMax != null ? { max: scale.yMax } : {}),
                        grid: { color: grid },
                        ticks: { color: tick },
                        title: { display: true, text: 'Speed (mph)', color: tick },
                    },
                },
            },
        });

        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [series, isDark, presentationMode, scale]);

    if (loading) return <LoadingSpinner />;

    return (
        <>
            {!presentationMode && <div className="card mb-6">
                <div className="flex flex-wrap items-end gap-6">
                    <div>
                        <label className="block font-medium mb-2">Runs shown:</label>
                        <select
                            value={grouping}
                            onChange={e => setGrouping(e.target.value)}
                            className="border p-2 rounded"
                        >
                            <option value="mode">Best per drive mode</option>
                            <option value="vehicle">Best per vehicle</option>
                            <option value="all">Every run</option>
                        </select>
                    </div>
                    <span className="text-xs text-faint pb-3">
                        {series.length} line{series.length === 1 ? '' : 's'} plotted
                    </span>
                </div>
                <p className="text-xs text-muted mt-3">
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

            {/* Scale controls sit BELOW the chart in their own card, matching every
                other chart view. X and Y value pickers are omitted: the split
                series supports only time-versus-speed, and a control with one
                option is noise. */}
            {!presentationMode && series.length > 0 && (
                <AxisScaleControls
                    xMin={scale.xMin} xMax={scale.xMax}
                    yMin={scale.yMin} yMax={scale.yMax}
                    onChange={(key, val) => setScale(prev => ({ ...prev, [key]: val }))}
                    xAxisLabel="X-Axis Scale (s)"
                    yAxisLabel="Y-Axis Scale (mph)"
                />
            )}

            {!presentationMode && <ChartInfoBubble chartKey="perfcurve" />}
        </>
    );
}
