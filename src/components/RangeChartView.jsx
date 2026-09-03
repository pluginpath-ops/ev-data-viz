import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import AxisScaleControls from './AxisScaleControls';
import RunSelector from './RunSelector';
import { runTooltipLines } from '../utils/tooltipHelpers';
import { vehicleLabel } from '../utils/specHelpers';
import { buildSeriesLabels } from '../utils/seriesLabel';
import { correctionFactor, correctionNote } from '../utils/conditionCorrection';
import { sessionFor } from '../utils/testSessions';
import CorrectionControl from './CorrectionControl';
import VerboseLabelToggle from './VerboseLabelToggle';
import AutoColorToggle from './AutoColorToggle';
import { useAppContext } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import {
    convDistance, convSpeed, convTemp,
    distanceLabel, speedLabel, tempLabel,
    calcEff, effOptions, effLabel as getEffLabel,
    fmtSpeed, speedBasisNote, fmtTemp,
} from '../utils/unitConversions';
import { filterRangeRuns, isRangeRun } from '../utils/runUtils';
import { copyChartAsPng } from '../utils/chartUtils';
import { chartTheme, MONO_STACK } from '../utils/chartTheme';
import { useStickyChartColors } from '../hooks/useStickyChartColors';
import ChartInfoBubble from './ChartInfoBubble';
import PlotFrame from './charts/PlotFrame';
import SpeedBadge from './charts/SpeedBadge';

// ── Chart type definitions ────────────────────────────────────────────────────
const CHART_TYPES = [
    { key: 'range-vehicle-bar',  label: '📊 Range by Vehicle',       kind: 'bar',  desc: 'Projected full range per run, grouped by vehicle' },
    { key: 'eff-vehicle-bar',    label: '📊 Efficiency by Vehicle',   kind: 'bar',  desc: 'Efficiency per run, grouped by vehicle' },
    { key: 'range-speed-line',   label: '📈 Range by Speed',          kind: 'line', desc: 'Projected range at each tested speed; one line per vehicle' },
    { key: 'eff-speed-line',     label: '📈 Efficiency by Speed',     kind: 'line', desc: 'Efficiency at each tested speed; one line per vehicle' },
    { key: 'range-temp-line',    label: '📈 Range by Temperature',    kind: 'line', desc: 'Projected range vs ambient temperature; one line per vehicle' },
    { key: 'eff-temp-line',      label: '📈 Efficiency by Temp',      kind: 'line', desc: 'Efficiency vs ambient temperature; one line per vehicle' },
];

// ── Range helper ──────────────────────────────────────────────────────────────
// Projected full-range: distance × (100 / SoC_used).
// Falls back to raw distance_miles when SoC fields are absent.
const calcRange = (run) => {
    const d = run.distance_miles;
    if (!d || d <= 0) return null;
    const start = run.start_soc;
    const end   = run.end_soc;
    if (start != null && end != null) {
        const used = start - end;
        if (used > 0) return Math.round((d * 100) / used);
    }
    return Math.round(d);
};


// ── Data availability check ───────────────────────────────────────────────────
const hasDataForType = (run, type) => {
    if (type.includes('eff-')    && (!run.energy_kwh || !run.distance_miles)) return false;
    if (type.includes('range-')  && !run.distance_miles)                       return false;
    if (type.includes('-speed-') && run.speed_mph    == null)                  return false;
    if (type.includes('-temp-')  && run.temperature_f == null)                 return false;
    return true;
};

// ── Component ─────────────────────────────────────────────────────────────────
// `selectedRuns` and `toggleRun` both come from ChargingView, which owns this
// view's selection through the shared useRunSelection hook (#176). This file
// used to roll its own toggle against chartConfig — one more copy of the
// behaviour, and the reason a run could be switched off here and come back.
export default function RangeChartView({ selectedVehicles, selectedRuns, toggleRun, setChartConfig, presentationMode = false, autoColor = false, verboseLabels = false, correctionMode = 'none' }) {
    const { units, testSessions } = useAppContext();
    const { isDark } = useTheme();
    const chartRef      = useRef(null);
    const chartInstance = useRef(null);
    const [chartType,    setChartType]    = useState('range-vehicle-bar');
    const [effUnit,      setEffUnit]      = useState('mi_kwh'); // 'mi_kwh' | 'wh_mi'
    const [copied,       setCopied]       = useState(false);
    const [copiedUrl,    setCopiedUrl]    = useState(false);

    // ── Axis scale state — yMin defaults to 0, rest auto ─────────────────────
    const [xMin, setXMin] = useState(null);
    const [xMax, setXMax] = useState(null);
    const [yMin, setYMin] = useState(0);
    const [yMax, setYMax] = useState(null);
    const [showPoints,       setShowPoints]       = useState(true);
    const handleScaleChange = (key, val) => {
        if (key === 'xMin') setXMin(val);
        else if (key === 'xMax') setXMax(val);
        else if (key === 'yMin') setYMin(val);
        else if (key === 'yMax') setYMax(val);
    };

    // Reset all scale overrides (back to defaults) when switching chart types,
    // since axis semantics change between chart types.
    const handleChartTypeChange = (newType) => {
        setChartType(newType);
        setXMin(null);
        setXMax(null);
        setYMin(0);
        setYMax(null);
    };

    // ── Derived: all range runs across selected vehicles ──────────────────────
    // Correction is applied to distance_miles rather than to the outputs.
    // calcRange and calcEff both scale linearly with distance, so one
    // multiplication corrects range AND efficiency in every unit — including
    // Wh/mi, which inverts correctly because it is energy over distance.
    // Correcting the two outputs separately would let them drift apart.
    const allRangeRuns = selectedVehicles.flatMap(v =>
        filterRangeRuns(v.runs).map(r => {
            const session = sessionFor(testSessions, r);
            const result = correctionFactor({
                speedMph:     r.speed_mph,
                speedBasis:   r.speed_basis,
                altitudeFt:   r.altitude_ft   ?? session?.altitude_ft,
                temperatureF: r.temperature_f ?? session?.temperature_f,
            }, { mode: correctionMode });
            const base = { ...r, vehicle: v, vehicleName: vehicleLabel(v), vehicleId: v.id };
            if (result.factor === 1) return base;
            return {
                ...base,
                distance_miles: base.distance_miles != null ? base.distance_miles * result.factor : null,
                _correction: { ...result, note: correctionNote(result) },
            };
        })
    );

    const selectedRangeRuns = allRangeRuns.filter(r =>
        selectedRuns.some(id => String(id) === String(r.id))
    );

    const plottableRuns = selectedRangeRuns.filter(r => hasDataForType(r, chartType));

    // Perceptual color resolution.  In auto mode every run gets an Okabe-Ito
    // slot (with hue-family bias toward the stored color); in manual mode only
    // default-blue runs are nudged.
    // Sticky in auto mode — see hooks/useStickyChartColors. Colours are added as
    // runs are selected and held until the vehicle set changes or Auto Color is
    // cycled, so the chart you were reading does not recolour under you.
    // Every range run of every selected vehicle, NOT just the plotted ones.
    // Feeding the filtered set meant unticking a run shrank the input, the
    // palette re-solved across what was left, and unrelated runs changed colour
    // — the shuffling that stickiness was meant to end. A stable input cannot
    // shuffle, which is a stronger guarantee than remembering what it assigned.
    const { colorMap, setColorOverride } = useStickyChartColors(allRangeRuns, {
        autoColor,
        resetKey: selectedVehicles.map(v => v.id).join(','),
    });

    // Value-identity for the resolved colours — see the render effect's deps.
    const colorSignature = allRangeRuns.map(r => `${r.id}:${colorMap[r.id] ?? ''}`).join(',');


    // ── Build Chart.js datasets ───────────────────────────────────────────────
    const buildChart = () => {
        const typeInfo = CHART_TYPES.find(t => t.key === chartType);
        if (!typeInfo || plottableRuns.length === 0) return null;

        const isRange    = chartType.includes('range-');
        const isSpeed    = chartType.includes('-speed-');
        const effLabelStr = getEffLabel(effUnit, units);
        const getY       = isRange
            ? (run) => convDistance(calcRange(run), units)
            : (run) => calcEff(run.distance_miles, run.energy_kwh, effUnit, units);
        const yLabel     = isRange ? `Range (${distanceLabel(units)})` : `Efficiency (${effLabelStr})`;

        // ── Bar: flat single dataset — one bar per run, vehicle grouping via plugin ─
        if (typeInfo.kind === 'bar') {
            const yUnit  = isRange ? distanceLabel(units) : effLabelStr;
            // Grouped by vehicle with the name drawn under the axis, so the bar
            // labels declare the vehicle atoms supplied and name only the test.
            const barLabels = buildSeriesLabels(
                plottableRuns.map(r => ({ key: r.id, vehicle: r.vehicle, rangeRun: r })),
                { supplied: ['year', 'make', 'model', 'trim'] },
            );
            const nameFor = r => {
                const l = barLabels.get(r.id);
                if (!l) return r.name;
                return verboseLabels ? l.full : l.short;
            };
            const labels = plottableRuns.map(nameFor);
            const datasets = [{
                label:           yLabel,
                data:            plottableRuns.map(r => getY(r)),
                backgroundColor: plottableRuns.map(r => colorMap[r.id] || r.color || '#3b82f6'),
                borderColor:     plottableRuns.map(r => colorMap[r.id] || r.color || '#3b82f6'),
                borderRadius:    4,
                borderSkipped:   false,
            }];
            return {
                kind:     'bar',
                data:     { labels, datasets },
                xLabel:   '',
                yLabel,
                flatRuns: plottableRuns.map(r => ({
                    ...r,
                    name:     nameFor(r),
                    fullName: barLabels.get(r.id)?.full ?? r.name,
                    _yValue: getY(r), _yUnit: yUnit,
                })),
            };
        }

        // ── Line: one series per vehicle, points sorted by x ─────────────────
        if (typeInfo.kind === 'line') {
            // Build an ordered map preserving selectedVehicles order
            // One line per vehicle: the vehicle atoms are the whole label, and
            // there is no single test to name — a line aggregates several.
            const lineLabels = buildSeriesLabels(
                selectedVehicles.map(v => ({ key: v.id, vehicle: v })),
                { atoms: [] },
            );
            const vehicleMap = new Map();
            selectedVehicles.forEach(v => vehicleMap.set(v.id, {
                name: (verboseLabels ? lineLabels.get(v.id)?.full : lineLabels.get(v.id)?.short) ?? v.name,
                runs: [],
            }));
            plottableRuns.forEach(run => vehicleMap.get(run.vehicleId)?.runs.push(run));

            const datasets = [];
            vehicleMap.forEach(({ name, runs }) => {
                if (runs.length === 0) return;
                // Include run metadata in each point so tooltip and per-point
                // color can reference it; Chart.js ignores extra fields on {x,y}.
                const runPoints = runs
                    .map(r => ({
                        run:      r,
                        x:        isSpeed ? convSpeed(r.speed_mph, units) : convTemp(r.temperature_f, units),
                        y:        getY(r),
                        _color:   colorMap[r.id] || r.color || '#3b82f6',
                        _runName: r.name,
                    }))
                    .filter(p => p.x != null && p.y != null)
                    .sort((a, b) => a.x - b.x);
                if (runPoints.length === 0) return;

                // Line stroke = first run's color; individual points use their
                // own run color so multiple runs per vehicle are distinguishable.
                const lineColor   = colorMap[runs[0].id] || runs[0].color || '#3b82f6';
                const pointColors = runPoints.map(p => p._color);
                // Keep run objects parallel to points for tooltip access
                const runMetas    = runPoints.map(p => p.run);
                const points      = runPoints.map(({ run: _r, ...rest }) => rest);

                datasets.push({
                    label:                name,
                    data:                 points,
                    borderColor:          lineColor,
                    backgroundColor:      lineColor,   // legend swatch
                    pointBackgroundColor: pointColors,
                    pointBorderColor:     pointColors,
                    pointRadius:          showPoints ? 6 : 0,
                    pointHoverRadius:     showPoints ? 9 : 0,
                    tension:              0.2,
                    runMetas,
                });
            });

            const xLabel = isSpeed ? `Speed (${speedLabel(units)})` : `Ambient Temp (${tempLabel(units)})`;
            return { kind: 'line', data: { datasets }, xLabel, yLabel };
        }

        return null;
    };

    // ── Render chart ──────────────────────────────────────────────────────────
    useEffect(() => {
        // From the stylesheet, not retyped here — see utils/chartTheme.
        const { tick: tickColor, grid: gridColor, legend: legendColor, axis: axisColor } = chartTheme();

        if (chartInstance.current) {
            chartInstance.current.destroy();
            chartInstance.current = null;
        }
        if (!chartRef.current) return;

        const built = buildChart();
        if (!built) return;

        // ── Bar: vehicle grouping labels + speed/temp pills ───────────────────
        const barGroupPlugin = {
            id: 'barGroupLabels',
            afterDatasetsDraw(chart) {
                if (!built.flatRuns?.length) return;
                const runs   = built.flatRuns;
                const ctx2   = chart.ctx;
                const meta   = chart.getDatasetMeta(0);
                const xScale = chart.scales.x;
                const area   = chart.chartArea;

                // Build consecutive vehicle groups
                const groups = [];
                runs.forEach((run, i) => {
                    const last = groups[groups.length - 1];
                    if (last && last.vehicleName === run.vehicleName) {
                        last.endIdx = i;
                    } else {
                        groups.push({ vehicleName: run.vehicleName, startIdx: i, endIdx: i });
                    }
                });

                // ── Badges inside each bar: value (bold), speed, temp ────────
                runs.forEach((run, i) => {
                    const bar = meta.data[i];
                    if (!bar) return;

                    const barH = bar.base - bar.y;
                    const barW = bar.width;

                    // Build ordered badge list
                    const badges = [];
                    if (run._yValue != null) badges.push({ text: `${run._yValue} ${run._yUnit}`, primary: true });
                    if (run.speed_mph     != null) badges.push({ text: fmtSpeed(run.speed_mph, units) });
                    if (speedBasisNote(run))       badges.push({ text: speedBasisNote(run) });
                    if (run.temperature_f != null) badges.push({ text: fmtTemp(run.temperature_f, units) });
                    if (run.avg_wind_speed_mph != null) {
                        const dir = run.wind_direction_deg != null ? ` @ ${run.wind_direction_deg}°` : '';
                        badges.push({ text: `💨 ${fmtSpeed(run.avg_wind_speed_mph, units)}${dir}` });
                    }
                    if (badges.length === 0) return;

                    const pillH  = 15, pillPad = 5, gap = 3, topPad = 6;
                    let drawY = bar.y + topPad;

                    badges.forEach(({ text, primary }) => {
                        // Skip if no vertical room left inside the bar
                        if (drawY + pillH > bar.base - topPad) return;

                        ctx2.save();
                        ctx2.font = primary ? 'bold 11px sans-serif' : '10px sans-serif';
                        const tw = ctx2.measureText(text).width;
                        const pw = tw + pillPad * 2;

                        // Skip if pill is wider than the bar
                        if (pw > barW - 4) { ctx2.restore(); drawY += pillH + gap; return; }

                        const px = bar.x - pw / 2;
                        const rr = 3;

                        // Semi-transparent dark pill — bar colour shows through
                        ctx2.fillStyle = 'rgba(0,0,0,0.28)';
                        ctx2.beginPath();
                        ctx2.moveTo(px + rr, drawY);
                        ctx2.lineTo(px + pw - rr, drawY);
                        ctx2.quadraticCurveTo(px + pw, drawY,        px + pw, drawY + rr);
                        ctx2.lineTo(px + pw, drawY + pillH - rr);
                        ctx2.quadraticCurveTo(px + pw, drawY + pillH, px + pw - rr, drawY + pillH);
                        ctx2.lineTo(px + rr, drawY + pillH);
                        ctx2.quadraticCurveTo(px,       drawY + pillH, px,       drawY + pillH - rr);
                        ctx2.lineTo(px, drawY + rr);
                        ctx2.quadraticCurveTo(px, drawY, px + rr, drawY);
                        ctx2.closePath();
                        ctx2.fill();

                        ctx2.fillStyle    = '#fff';
                        ctx2.textAlign    = 'center';
                        ctx2.textBaseline = 'middle';
                        ctx2.fillText(text, bar.x, drawY + pillH / 2);
                        ctx2.restore();

                        drawY += pillH + gap;
                    });
                });

                // ── Vehicle group labels + dashed separators below x-axis ────
                const groupLabelY = xScale.bottom + 5;
                groups.forEach((group, gi) => {
                    const startBar = meta.data[group.startIdx];
                    const endBar   = meta.data[group.endIdx];
                    if (!startBar || !endBar) return;

                    const x1 = startBar.x - startBar.width / 2;
                    const x2 = endBar.x   + endBar.width / 2;
                    const cx = (x1 + x2) / 2;

                    // Underline spanning the group
                    ctx2.save();
                    ctx2.strokeStyle = axisColor;
                    ctx2.lineWidth   = 1.5;
                    ctx2.beginPath();
                    ctx2.moveTo(x1 + 3, groupLabelY);
                    ctx2.lineTo(x2 - 3, groupLabelY);
                    ctx2.stroke();
                    ctx2.restore();

                    // Centered vehicle name, CLAMPED TO ITS GROUP. It was drawn
                    // at a fixed size with no width to respect, which was
                    // survivable while the plot was full-bleed and became five
                    // overlapping names the moment it moved beside a rail.
                    // Below a floor the name is dropped entirely — the underline
                    // and the separator still show the grouping, and a smear of
                    // half-letters shows nothing.
                    const span = x2 - x1 - 6;
                    if (span >= 28) {
                        ctx2.save();
                        ctx2.font         = `600 12px ${MONO_STACK}`;
                        ctx2.fillStyle    = legendColor;
                        ctx2.textAlign    = 'center';
                        ctx2.textBaseline = 'top';
                        let label = group.vehicleName;
                        if (ctx2.measureText(label).width > span) {
                            while (label.length > 1 && ctx2.measureText(label + '…').width > span) {
                                label = label.slice(0, -1);
                            }
                            label += '…';
                        }
                        ctx2.fillText(label, cx, groupLabelY + 4);
                        ctx2.restore();
                    }

                    // Dashed vertical separator between groups
                    if (gi < groups.length - 1) {
                        const nextStartBar = meta.data[groups[gi + 1].startIdx];
                        if (nextStartBar) {
                            const sepX = (x2 + (nextStartBar.x - nextStartBar.width / 2)) / 2;
                            ctx2.save();
                            ctx2.strokeStyle = gridColor;
                            ctx2.lineWidth   = 1;
                            ctx2.setLineDash([5, 4]);
                            ctx2.beginPath();
                            ctx2.moveTo(sepX, area.top);
                            ctx2.lineTo(sepX, area.bottom);
                            ctx2.stroke();
                            ctx2.restore();
                        }
                    }
                });
            },
        };

        chartInstance.current = new Chart(chartRef.current.getContext('2d'), {
            type:    built.kind,
            data:    built.data,
            plugins: built.kind === 'bar' ? [barGroupPlugin] : [],
            options: {
                layout: {
                    padding: {
                        top:    0,
                        bottom: built.kind === 'bar' ? 55 : 0,
                    },
                },
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    // The frame draws the title now, in the DOM, and the export
                    // draws it onto the PNG. Leaving it on here printed it twice.
                    title: { display: false },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            title(items) {
                                if (built.kind === 'bar' && items.length > 0) {
                                    const run = built.flatRuns?.[items[0].dataIndex];
                                    return run ? `${run.name} — ${run.vehicleName}` : undefined;
                                }
                                if (built.kind === 'line' && items.length > 0) {
                                    const x = items[0].raw?.x ?? items[0].parsed.x;
                                    return `${built.xLabel}: ${x}`;
                                }
                                return undefined;
                            },
                            label(ctx) {
                                if (built.kind === 'bar') {
                                    return `${ctx.dataset.label}: ${ctx.parsed.y ?? '—'}`;
                                }
                                // For line charts, show run name if the point carries one
                                const runName = ctx.raw?._runName;
                                const val     = ctx.parsed.y ?? ctx.raw?.y ?? '—';
                                return runName
                                    ? `${runName}: ${val}`
                                    : `${ctx.dataset.label}: ${val}`;
                            },
                            afterLabel(ctx) {
                                if (built.kind === 'bar') {
                                    const run = built.flatRuns?.[ctx.dataIndex];
                                    if (!run) return [];
                                    return runTooltipLines(run, [
                                        run._yValue != null ? `${built.yLabel}: ${run._yValue}` : null,
                                        // What was done to this figure, and what could
                                        // not be. A corrected number that cannot say
                                        // which axes moved it leaves the reader to
                                        // infer it from the size of the change.
                                        run._correction?.note ?? null,
                                    ].filter(Boolean), units);
                                }
                                // Line charts: run objects are stored parallel to points
                                const run = ctx.dataset?.runMetas?.[ctx.dataIndex];
                                return run
                                    ? runTooltipLines(run, [run._correction?.note ?? null].filter(Boolean), units)
                                    : [];
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type:  built.kind === 'line' ? 'linear' : 'category',
                        grid:  { display: built.kind !== 'bar', color: gridColor },
                        title: { display: !!built.xLabel, text: built.xLabel, color: legendColor },
                        ticks: { color: tickColor },
                        ...(built.kind === 'line' && xMin != null ? { min: xMin } : {}),
                        ...(built.kind === 'line' && xMax != null ? { max: xMax } : {}),
                    },
                    y: {
                        title: { display: true, text: built.yLabel, color: legendColor },
                        beginAtZero: false,
                        ticks: { color: tickColor },
                        grid: { color: gridColor },
                        ...(yMin != null ? { min: yMin } : {}),
                        ...(yMax != null ? { max: yMax } : {}),
                    },
                },
            },
        });

        return () => {
            if (chartInstance.current) {
                chartInstance.current.destroy();
                chartInstance.current = null;
            }
        };
    // The colours and Full Labels belong here: a colour picked in the selector
    // and a label toggle both change what is drawn without changing the
    // selection, and the chart used to keep the old canvas until some unrelated
    // toggle forced it to redraw.
    //
    // A SIGNATURE, not colorMap itself. The arrays feeding the resolver are
    // rebuilt every render, so the map is a new object each time while holding
    // the same values — depending on its identity would redraw the chart on
    // every render. Comparing the colours by value redraws only when one moves.
    }, [chartType, effUnit, selectedRuns, selectedVehicles, xMin, xMax, yMin, yMax, showPoints, units, isDark, colorSignature, verboseLabels, autoColor, correctionMode]);

    // ── The frame's caption ──────────────────────────────────────────────────
    // In the frame, so it is in the export: a bar chart pasted into a thread has
    // to say what the bars are OF and in what unit, without anyone typing a
    // caption under it.
    const plotTitle = useMemo(() => {
        const t = CHART_TYPES.find(x => x.key === chartType);
        // The emoji belongs on the button, not in the title of an exported
        // image — it is a wayfinding aid in a list of six, and noise alone.
        return (t?.label ?? 'Range & Efficiency').replace(/^\W+\s*/, '');
    }, [chartType]);

    const plotSubtitle = useMemo(() => {
        const runs = plottableRuns.length;
        const vehicles = new Set(plottableRuns.map(r => r.vehicleName ?? r.vehicle?.id)).size;
        const isEff = chartType.startsWith('eff-');
        const parts = [
            `${runs} run${runs === 1 ? '' : 's'}`,
            `${vehicles} vehicle${vehicles === 1 ? '' : 's'}`,
        ];
        if (isEff) parts.push(effOptions(units).find(o => o.value === effUnit)?.label ?? effUnit);
        parts.push(correctionMode === 'none' ? 'no correction' : `corrected: ${correctionMode}`);
        parts.push(units === 'metric' ? 'metric' : 'imperial');
        return parts.join(' · ');
    }, [plottableRuns, chartType, effUnit, correctionMode, units]);

    // ── Copy chart PNG ────────────────────────────────────────────────────────
    const handleCopyImage = async () => {
        if (!chartInstance.current) return;
        try {
            await copyChartAsPng(chartInstance.current, { title: plotTitle, subtitle: plotSubtitle });
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch { /* Clipboard API not supported — chart is still visible */ }
    };


    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="chart-layout">
            {/* ── Left rail: pick here, read on the right. Same rig as Charging,
              * so the two chart screens read as one family. */}
            {!presentationMode && <aside className="chart-rail">
                {/* ── MEASURE ──
                  * What the bars are OF, and in which unit. The chart-type row
                  * was five buttons in an accent fill that read as five primary
                  * actions; as a labelled group of toggles it reads as the one
                  * choice it is. */}
                <div className="chart-rail-group">
                    <span className="text-micro">Measure</span>
                    <div className="chart-type-buttons">
                        {CHART_TYPES.map(t => (
                            <button
                                key={t.key}
                                onClick={() => handleChartTypeChange(t.key)}
                                title={t.desc}
                                className={`btn btn-toggle${chartType === t.key ? ' active' : ''}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="chart-rail-group">
                    <span className="text-micro">Efficiency unit</span>
                    <div className="efficiency-unit-toggle">
                        {effOptions(units).map(({ value: key, label }) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setEffUnit(key)}
                                className={`btn btn-toggle${effUnit === key ? ' active' : ''}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* ── DISPLAY ── every toggle in one region, as in Charging. */}
                <div className="chart-rail-group">
                    <span className="text-micro">Display</span>
                    <div className="display-grid">
                        {CHART_TYPES.find(t => t.key === chartType)?.kind === 'line' && (
                            <label className="toggle-label">
                                <input
                                    type="checkbox"
                                    checked={showPoints}
                                    onChange={e => setShowPoints(e.target.checked)}
                                    className="w-4 h-4"
                                />
                                <span className="text-sm">Points</span>
                            </label>
                        )}
                        <AutoColorToggle autoColor={autoColor} setChartConfig={setChartConfig} />
                        <VerboseLabelToggle verbose={verboseLabels} setChartConfig={setChartConfig} />
                    </div>
                    <CorrectionControl mode={correctionMode} setChartConfig={setChartConfig} />
                </div>

                {/* ── Run selector ── */}
                <RunSelector
                    vehicles={selectedVehicles}
                    selectedRunIds={selectedRuns}
                    onToggleRun={toggleRun}
                    onUpdateRunColor={(_vehicleId, runId, color) => setColorOverride(runId, color)}
                    runFilter={isRangeRun}
                    colorMap={colorMap}
                    emptyMessage="No range test records"
                    renderRunMeta={run => {
                        // Speed, temperature, wind, distance — the conditions
                        // that make one range test comparable to another.
                        //
                        // Efficiency is deliberately NOT here: it is what the
                        // chart plots, so a badge repeating it beside every row
                        // is the answer printed on the question.
                        const rawRange    = calcRange(run);
                        const range       = rawRange != null ? convDistance(rawRange, units) : null;
                        const dl          = distanceLabel(units);
                        const socUsed     = (run.start_soc != null && run.end_soc != null) ? run.start_soc - run.end_soc : null;
                        const isProjected = socUsed != null && socUsed !== 100;
                        const canPlot     = hasDataForType(run, chartType);
                        const isChecked   = selectedRuns.some(id => String(id) === String(run.id));
                        return (
                            <>
                                {/* Carries its own basis — see SpeedBadge. */}
                                <SpeedBadge run={run} units={units} />
                                {run.temperature_f != null && (
                                    <span className="badge-micro">{fmtTemp(run.temperature_f, units)}</span>
                                )}
                                {run.avg_wind_speed_mph != null && (
                                    <span
                                        className="badge-micro"
                                        title={run.wind_direction_deg != null
                                            ? `Wind ${fmtSpeed(run.avg_wind_speed_mph, units)} at ${run.wind_direction_deg}° vs travel (0° tailwind, 180° headwind)`
                                            : `Wind ${fmtSpeed(run.avg_wind_speed_mph, units)}, direction not recorded`}
                                    >
                                        ~{fmtSpeed(run.avg_wind_speed_mph, units)}
                                    </span>
                                )}
                                {range != null && (
                                    <span
                                        className="badge-micro"
                                        title={isProjected
                                            ? `Projected from ${run.distance_miles} mi driven over ${socUsed}% SoC`
                                            : 'Measured distance'}
                                    >
                                        {range} {dl}{isProjected ? ' ⟳' : ''}
                                    </span>
                                )}
                                {!canPlot && isChecked && (
                                    <span className="badge-micro is-warning" title="Missing fields required for this chart type">
                                        ⚠ no data
                                    </span>
                                )}
                            </>
                        );
                    }}
                />
            </aside>}

            <div className="chart-main">

            {/* ── The plot, inside the frame the export captures ── */}
            <PlotFrame
                title={plotTitle}
                subtitle={plotSubtitle}
                exportControls={!presentationMode && (
                    <>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(window.location.href).then(() => {
                                    setCopiedUrl(true);
                                    setTimeout(() => setCopiedUrl(false), 2000);
                                });
                            }}
                            className={`chart-copy-btn ${copiedUrl ? 'chart-copy-btn-active' : ''}`}
                            title="Copy link to this chart view"
                        >
                            {copiedUrl ? '✓ Copied' : '🔗 URL'}
                        </button>
                        <button
                            onClick={handleCopyImage}
                            disabled={plottableRuns.length === 0}
                            className={`chart-copy-btn disabled:opacity-40 disabled:cursor-not-allowed ${copied ? 'chart-copy-btn-active' : ''}`}
                            title="Copy the framed chart as a PNG"
                        >
                            {copied ? '✓ Copied' : 'PNG'}
                        </button>
                    </>
                )}
            >
                <div style={{ height: presentationMode ? 'calc(100vh - 2rem)' : '500px', position: 'relative' }}>
                    {/* Canvas always mounted so ref stays valid */}
                    <canvas
                        ref={chartRef}
                        style={{ display: plottableRuns.length > 0 ? 'block' : 'none' }}
                    />
                    {plottableRuns.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-meta">
                            <div className="text-center">
                                <p className="text-lg font-medium">
                                    {selectedRangeRuns.length === 0
                                        ? 'Select runs above to display'
                                        : 'Selected runs are missing required fields for this chart type'}
                                </p>
                                {selectedRangeRuns.length > 0 && (
                                    <p className="text-sm mt-1 text-meta">
                                        {CHART_TYPES.find(t => t.key === chartType)?.desc}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </PlotFrame>
            {/* ── Axis scale controls (card provided by AxisScaleControls) ──
                Hidden in presentation/pop-out mode — these belong on the main page. */}
            {!presentationMode && (
                <AxisScaleControls
                    xMin={xMin} xMax={xMax}
                    yMin={yMin} yMax={yMax}
                    onChange={handleScaleChange}
                    showX={CHART_TYPES.find(t => t.key === chartType)?.kind === 'line'}
                />
            )}

            {!presentationMode && <ChartInfoBubble chartKey="range" />}

            </div>{/* .chart-main */}
        </div>
    );
}
