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
import { buildSeriesLabels } from '../utils/seriesLabel';
import { useTheme } from '../hooks/useTheme';
import LoadingSpinner from './LoadingSpinner';
import ChartInfoBubble from './ChartInfoBubble';
import AxisScaleControls from './AxisScaleControls';
import PerformanceRunSelector from './performance/PerformanceRunSelector';
import { buildSyntheticCurve, tracedCurvePoints, segmentAccelerationG } from '../utils/performanceDerivations';
import { resolveChartColors } from '../utils/colorUtils';
import ChartExportButtons from './ChartExportButtons';
import { chartTheme, applyChartDefaults } from '../utils/chartTheme';

/** Okabe-Ito, matching the palette the other charts use for run colours. */
const PALETTE = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442'];

// What distinguishes two curves beyond the vehicle: the drive mode, then which
// run of that mode, then — for the dashed reconstructions — who published the
// figures. Priority order, so a run number is only reached for once the mode
// has failed to separate two lines.
const CURVE_ATOMS = [
    { key: 'mode',   of: s => s.mode },
    { key: 'run',    of: s => s.seq },
    { key: 'source', of: s => s.source },
];

export default function PerformanceCurveView({ vehicles, selectedVehicleIds, presentationMode }) {
    const { isDark } = useTheme();
    const canvasRef  = useRef(null);
    const chartRef   = useRef(null);

    const [sessionsByVehicle, setSessionsByVehicle] = useState(null);
    const [summariesByVehicle, setSummariesByVehicle] = useState({});
    // Published-only vehicles can't otherwise appear here at all, so this is on
    // by default; the dashes keep them from being mistaken for measured traces.
    const [showPublished, setShowPublished] = useState(true);
    const [loading, setLoading] = useState(true);
    // 'mode'   — quickest run in each drive mode (default: the mode comparison)
    // 'vehicle' — one line per vehicle, its single quickest run
    // 'all'     — every run, for run-to-run consistency
    const [grouping, setGrouping] = useState('mode');
    const [scale, setScale] = useState({ xMin: null, xMax: null, yMin: null, yMax: null });
    // Only consulted when grouping is 'all'; null means "not curated yet", which
    // shows everything rather than an empty chart on first switch.
    const [pickedRunIds, setPickedRunIds] = useState(null);
    // Colour picks are LOCAL TO THIS VIEW and deliberately not written to the
    // database. Recolouring a line to read a chart is a viewing preference, not
    // a change to the data — and persisting it would need contributor rights,
    // so a signed-out visitor would recolour a line, see it change, and have it
    // silently revert on reload. Anyone can recolour here; nobody's choice
    // leaks onto anyone else's view.
    const [colorEdits, setColorEdits] = useState({});
    // Acceleration between points, as a second axis. Off by default — it's a
    // derivative, so it's spikier than the speed curve and would distract from
    // the primary read.
    const [showG, setShowG] = useState(false);

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
            const next = {}, sums = {};
            for (const id of ids) { next[id] = []; sums[id] = []; }
            for (const s of allSessions)  next[s.vehicle_id]?.push(s);
            for (const s of allSummaries) sums[s.vehicle_id]?.push(s);
            if (!cancelled) { setSessionsByVehicle(next); setSummariesByVehicle(sums); setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [selected.map(v => v.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    /**
     * Every plottable accel run, per vehicle, for the picker.
     */
    const selectorVehicles = useMemo(() => {
        if (!sessionsByVehicle) return [];
        return selected.map(v => ({
            id: v.id,
            name: v.name,
            runs: (sessionsByVehicle[v.id] || [])
                .filter(s => s.test_type === 'accel')
                .flatMap(s => (s.performance_runs || [])
                    .filter(r => (r.performance_run_points || []).length >= 2)
                    .map(r => ({
                        id: r.id,
                        name: `Run #${(r.sequence ?? 0) + 1}`,
                        driveMode: r.drive_mode,
                        zeroTo60: r.zero_to_60_sec,
                        // Attribution is a property of the SESSION — every run
                        // in it came from the same video — so it is carried
                        // down onto the row that the selector can credit.
                        sourceUrl: s.source_url || s.spreadsheet_url || null,
                    }))),
        })).filter(v => v.runs.length > 0);
    }, [sessionsByVehicle, selected]);

    const allRunIds = useMemo(
        () => selectorVehicles.flatMap(v => v.runs.map(r => r.id)),
        [selectorVehicles],
    );

    /**
     * Colour per run, from the same Okabe-Ito resolver the charging and range
     * charts use — so a run keeps its colour across both, and unset runs get
     * maximally distinct hues rather than a fixed rotation.
     */
    const colorMap = useMemo(() => {
        const runs = (sessionsByVehicle ? Object.values(sessionsByVehicle).flat() : [])
            .flatMap(s => s.performance_runs || [])
            .map(r => ({ id: r.id, color: colorEdits[r.id] ?? null, created_at: r.created_at }));
        return resolveChartColors(runs, colorEdits, 'manual');
    }, [sessionsByVehicle, colorEdits]);

    const handleRunColor = (runId, hex) => {
        setColorEdits(prev => {
            const next = { ...prev };
            // null clears the pick and hands the run back to the auto palette.
            if (hex == null) delete next[runId]; else next[runId] = hex;
            return next;
        });
    };

    /**
     * One series per run worth plotting. A run needs at least two split points
     * to be a curve rather than a dot.
     */
    const series = useMemo(() => {
        if (!sessionsByVehicle) return [];
        const quickest = (a, b) => (a?.zero_to_60_sec ?? Infinity) <= (b?.zero_to_60_sec ?? Infinity) ? a : b;
        const out = [];
        for (const v of selected) {

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
                // Curated subset when the user has picked; everything until then.
                chosen = pickedRunIds === null
                    ? allRuns
                    : allRuns.filter(r => pickedRunIds.some(id => String(id) === String(r.id)));
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
                    // One consistent clock, ladder offset corrected — see
                    // tracedCurvePoints. Deliberately not reimplemented here:
                    // the g series below depends on the same correction.
                    const { points } = tracedCurvePoints(run);
                    if (points.length < 2) continue;

                    out.push({
                        runId: run.id,
                        gSegments: segmentAccelerationG(run),
                        vehicle: v,
                        mode: run.drive_mode || 'Run',
                        // Only meaningful when several runs share a mode, which is
                        // exactly when the composer will reach for it.
                        seq: `#${(run.sequence ?? 0) + 1}`,
                        points,
                        zeroTo60: run.zero_to_60_sec,
                    });
                }
            }
        }
        // Curves reconstructed from published headline figures. Drawn dashed and
        // listed after the traced runs, because three points off a spec sheet is
        // a sketch of a curve, not a measurement of one.
        if (showPublished) {
            for (const v of selected) {
                for (const summary of summariesByVehicle[v.id] || []) {
                    const synth = buildSyntheticCurve(summary);
                    if (!synth) continue;
                    out.push({
                        vehicle: v,
                        source: summary.source_name || 'published',
                        points: synth.points,
                        synthetic: true,
                        basis: synth.basis,
                        flags: synth.flags,
                    });
                }
            }
        }
        // Name each curve by what tells it apart from the others plotted. This
        // replaces a hand-rolled rule that always dropped the year and trim and
        // always spelled out the drive mode: right for one car's drive modes,
        // wrong the moment two model years of the same trim are compared, when
        // the year was the only thing distinguishing the lines.
        // The source is REQUIRED, not merely available: a dashed reconstruction
        // off a spec sheet must say whose figures it is drawn from, even when the
        // vehicle alone would tell it apart from every other line. Traced runs
        // have no source and are unaffected.
        const labels = buildSeriesLabels(
            out.map((o, i) => ({ ...o, key: i })),
            { atoms: CURVE_ATOMS, required: ['source'] },
        );
        return out.map((o, i) => ({
            ...o,
            label:     labels.get(i)?.short ?? vehicleLabel(o.vehicle),
            fullLabel: labels.get(i)?.full  ?? vehicleLabel(o.vehicle),
        }));
    }, [sessionsByVehicle, summariesByVehicle, selected, grouping, pickedRunIds, showPublished]);

    useEffect(() => {
        if (!canvasRef.current || series.length === 0) {
            chartRef.current?.destroy();
            chartRef.current = null;
            return;
        }
        chartRef.current?.destroy();

        // From the stylesheet, not retyped here — see utils/chartTheme.
        const { grid, tick } = chartTheme();
        const fonts = applyChartDefaults(Chart);

        // Traced runs take their resolved colour first; reconstructed curves then
        // fill from the palette AROUND those, so a dashed line can't land on the
        // same hue as a solid one and be mistaken for it.
        const taken = new Set(
            series.map(s => (s.runId != null ? colorMap[s.runId] : null)).filter(Boolean),
        );
        const spare = PALETTE.filter(c => !taken.has(c));
        let spareIdx = 0;
        const seriesColors = series.map((s, i) =>
            (s.runId != null && colorMap[s.runId])
            || spare[spareIdx++ % (spare.length || 1)]
            || PALETTE[i % PALETTE.length]);

        // Acceleration segments, drawn as horizontal spans on a second axis.
        // Each g value describes the interval between two points, so it's plotted
        // as a flat segment from x0 to x1 rather than a smooth line through point
        // positions, which would imply a value at each instant that wasn't measured.
        const gDatasets = !showG ? [] : series.flatMap((s, i) => {
            if (!s.gSegments?.length) return [];
            const c = seriesColors[i];
            // Plotted at each segment's MIDPOINT and splined, rather than as flat
            // spans from x0 to x1. The spans were technically honest — a g value
            // describes an interval — but a ladder of disconnected horizontal
            // dashes reads as noise. The midpoint is where that average best
            // represents the instant, and a smooth line through them shows the
            // shape of the falloff, which is the thing worth seeing.
            const data = s.gSegments.map(seg => ({ x: (seg.x0 + seg.x1) / 2, y: seg.g }));
            return [{
                label: `${s.label} · g`,
                data,
                yAxisID: 'yG',
                borderColor: c,
                backgroundColor: c,
                borderWidth: 1.5,
                borderDash: [4, 3],
                pointRadius: presentationMode ? 0 : 2,
                tension: 0.35,
            }];
        });

        chartRef.current = new Chart(canvasRef.current, {
            type: 'line',
            data: {
                datasets: series.map((s, i) => {
                    const c = seriesColors[i];
                    return {
                    label: s.label,
                    data: s.points,
                    // Named explicitly: without it Chart.js assigns the dataset to
                    // the FIRST y-scale in definition order, which put speed on the
                    // g axis and g on the speed axis while the titles stayed put.
                    yAxisID: 'y',
                    borderColor: c,
                    backgroundColor: c,
                    borderWidth: 2,
                    // Dashed = reconstructed from headline figures, not traced.
                    borderDash: s.synthetic ? [6, 4] : [],
                    pointStyle: s.synthetic ? 'rectRot' : 'circle',
                    pointRadius: presentationMode ? 0 : (s.synthetic ? 4 : 2.5),
                    // Straight segments: with three points, a curve fit would
                    // invent shape the figures don't support.
                    tension: s.synthetic ? 0 : 0.25,
                    };
                }).concat(gDatasets),
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
                            font: { size: fonts.micro },
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
                            label: (c) => {
                                // g datasets are concatenated after the speed ones,
                                // so anything past series.length is an acceleration
                                // span and is measured in g, not mph.
                                if (c.datasetIndex >= series.length) {
                                    const sr = series[c.datasetIndex - series.length];
                                    const seg = sr?.gSegments?.[c.dataIndex];
                                    const line = `${c.dataset.label}: ${c.parsed.y.toFixed(3)} g`;
                                    // Say so rather than quietly showing a bound as if
                                    // it were a reading.
                                    return seg?.clamped
                                        ? [line, `Capped at this run's recorded peak (computed ${seg.rawG.toFixed(3)} g over ${(seg.x1 - seg.x0).toFixed(3)} s)`]
                                        : line;
                                }
                                const sr = series[c.datasetIndex];
                                const lines = [`${sr?.fullLabel ?? c.dataset.label}: ${c.parsed.y.toFixed(0)} mph`];
                                if (sr?.synthetic) {
                                    lines.push(`Reconstructed from ${sr.basis.join(' + ')}`);
                                    if (sr.flags.includes('mixed-rollout')) {
                                        lines.push('⚠ 0–60 is a no-rollout figure paired with a ¼-mile ET, which is not');
                                    }
                                    if (sr.flags.includes('non-monotonic')) {
                                        lines.push('⚠ The published figures disagree with each other');
                                    }
                                }
                                return lines;
                            },
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
                    ...(showG ? { yG: {
                        position: 'right',
                        beginAtZero: true,
                        grid: { drawOnChartArea: false },
                        ticks: { color: tick },
                        title: { display: true, text: 'Acceleration (g)', color: tick },
                    } } : {}),
                },
            },
        });

        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [series, isDark, presentationMode, scale, colorMap, showG]);

    if (loading) return <LoadingSpinner />;

    return (
        <>
            {!presentationMode && <div className="card mb-6">
                <div className="flex flex-wrap items-end gap-6">
                    <div>
                        <label className="block font-medium mb-2">Focus:</label>
                        <select
                            value={scale.xMax == null ? 'full' : 'launch'}
                            onChange={e => setScale(prev => ({
                                ...prev,
                                // A merged drag ladder stretches the axis to ~13 s and
                                // squeezes the whole 0-60 into the left quarter, which
                                // reads as if the low-speed splits had gone missing.
                                xMax: e.target.value === 'launch' ? 5 : null,
                            }))}
                            className="form-input"
                        >
                            <option value="full">Full run</option>
                            <option value="launch">Launch (0–5 s)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Runs shown:</label>
                        <select
                            value={grouping}
                            onChange={e => setGrouping(e.target.value)}
                            className="form-input"
                        >
                            <option value="mode">Best per drive mode</option>
                            <option value="vehicle">Best per vehicle</option>
                            <option value="all">Every run</option>
                        </select>
                    </div>
                    {/* Both toggles sit together to the right of the pickers, styled
                        alike so they read as one pair rather than two controls that
                        happen to be checkboxes. */}
                    <div className="flex flex-col gap-1.5 pb-1">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showPublished}
                                onChange={e => setShowPublished(e.target.checked)}
                            />
                            <span className="text-secondary">Include published figures</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={showG}
                                onChange={e => setShowG(e.target.checked)}
                            />
                            <span className="text-secondary">Show acceleration (g)</span>
                        </label>
                    </div>
                    <span className="text-xs text-meta pb-1">
                        {series.length} line{series.length === 1 ? '' : 's'} plotted
                    </span>
                </div>
                <p className="text-xs text-secondary mt-3">
                    Solid lines are traced from imported splits, dashed lines reconstructed
                    from a source’s headline figures. The 1&nbsp;ft-rollout split is left out —
                    it is the same 60&nbsp;mph point on a different clock.
                    {showG && ' Dotted lines are estimated acceleration between splits.'}
                </p>

                {/* Curation sits with the control that enables it, and only under
                    "Every run" — the other groupings already pick for you, so a
                    picker there would silently do nothing. */}
                {grouping === 'all' && selectorVehicles.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                        <PerformanceRunSelector
                            vehicles={selectorVehicles}
                            selectedRunIds={pickedRunIds}
                            onChange={setPickedRunIds}
                            colorMap={colorMap}
                            onUpdateColor={handleRunColor}
                            colorPicked={id => id in colorEdits}
                        />
                    </div>
                )}
            </div>}

            <div className="card mb-4">
                <h3 className="text-lg font-semibold mb-3">Speed vs Time</h3>

                {series.length === 0 ? (
                    <p className="text-sm text-secondary py-8 text-center">
                        No acceleration split data for the selected vehicles. This chart is built
                        from imported testing CSVs — reported figures alone carry no trace to plot.
                    </p>
                ) : (
                    <div style={{ height: presentationMode ? 'calc(100vh - 2rem)' : 460 }}>
                        <canvas ref={canvasRef} />
                    </div>
                )}
                {!presentationMode && series.length > 0 && (
                    <ChartExportButtons
                        chartRef={chartRef}
                        buildParams={p => {
                            p.set('tab', 'performance');
                            p.set('m', 'perfcurve');
                        }}
                    />
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
