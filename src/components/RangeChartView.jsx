import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import AxisScaleControls from './AxisScaleControls';
import RunSelector from './RunSelector';
import { runTooltipLines } from '../utils/tooltipHelpers';
import { vehicleLabel } from '../utils/specHelpers';
import { useAppContext } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import {
    convDistance, convSpeed, convTemp,
    distanceLabel, speedLabel, tempLabel,
    calcEff, effOptions, effLabel as getEffLabel,
    fmtSpeed, fmtTemp,
} from '../utils/unitConversions';
import { filterRangeRuns, isRangeRun } from '../utils/runUtils';
import { copyChartAsPng } from '../utils/chartUtils';

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
export default function RangeChartView({ selectedVehicles, selectedRuns, setChartConfig, onUpdateRunColor, presentationMode = false }) {
    const { units } = useAppContext();
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
    const allRangeRuns = selectedVehicles.flatMap(v =>
        filterRangeRuns(v.runs).map(r => ({ ...r, vehicleName: vehicleLabel(v), vehicleId: v.id }))
    );

    const selectedRangeRuns = allRangeRuns.filter(r =>
        selectedRuns.some(id => String(id) === String(r.id))
    );

    const plottableRuns = selectedRangeRuns.filter(r => hasDataForType(r, chartType));

    // ── Run toggle ────────────────────────────────────────────────────────────
    const toggleRun = (runId) => {
        const strId = String(runId);
        setChartConfig(prev => {
            const isSelected = prev.selectedRuns.some(id => String(id) === strId);
            return {
                ...prev,
                selectedRuns: isSelected
                    ? prev.selectedRuns.filter(id => String(id) !== strId)
                    : [...prev.selectedRuns, runId],
            };
        });
    };

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
            const labels = plottableRuns.map(r => r.name);
            const datasets = [{
                label:           yLabel,
                data:            plottableRuns.map(r => getY(r)),
                backgroundColor: plottableRuns.map(r => r.color || '#3b82f6'),
                borderColor:     plottableRuns.map(r => r.color || '#3b82f6'),
                borderRadius:    4,
                borderSkipped:   false,
            }];
            return {
                kind:     'bar',
                data:     { labels, datasets },
                xLabel:   '',
                yLabel,
                flatRuns: plottableRuns.map(r => ({ ...r, _yValue: getY(r), _yUnit: yUnit })),
            };
        }

        // ── Line: one series per vehicle, points sorted by x ─────────────────
        if (typeInfo.kind === 'line') {
            // Build an ordered map preserving selectedVehicles order
            const vehicleMap = new Map();
            selectedVehicles.forEach(v => vehicleMap.set(v.id, { name: v.name, runs: [] }));
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
                        _color:   r.color   || '#3b82f6',
                        _runName: r.name,
                    }))
                    .filter(p => p.x != null && p.y != null)
                    .sort((a, b) => a.x - b.x);
                if (runPoints.length === 0) return;

                // Line stroke = first run's color; individual points use their
                // own run color so multiple runs per vehicle are distinguishable.
                const lineColor   = runs[0].color || '#3b82f6';
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
        const tickColor   = isDark ? 'rgb(226,232,240)' : 'rgb(107,114,128)';
        const gridColor   = isDark ? 'rgba(100,116,139,0.4)' : 'rgba(229,231,235,0.8)';
        const legendColor = isDark ? 'rgb(241,245,249)' : 'rgb(55,65,81)';

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
                    if (run.temperature_f != null) badges.push({ text: fmtTemp(run.temperature_f, units) });
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
                    ctx2.strokeStyle = isDark ? 'rgba(203,213,225,0.5)' : 'rgba(107,114,128,0.55)';
                    ctx2.lineWidth   = 1.5;
                    ctx2.beginPath();
                    ctx2.moveTo(x1 + 3, groupLabelY);
                    ctx2.lineTo(x2 - 3, groupLabelY);
                    ctx2.stroke();
                    ctx2.restore();

                    // Centered bold vehicle name
                    ctx2.save();
                    ctx2.font         = 'bold 13px sans-serif';
                    ctx2.fillStyle    = isDark ? 'rgb(241,245,249)' : '#374151';
                    ctx2.textAlign    = 'center';
                    ctx2.textBaseline = 'top';
                    ctx2.fillText(group.vehicleName, cx, groupLabelY + 4);
                    ctx2.restore();

                    // Dashed vertical separator between groups
                    if (gi < groups.length - 1) {
                        const nextStartBar = meta.data[groups[gi + 1].startIdx];
                        if (nextStartBar) {
                            const sepX = (x2 + (nextStartBar.x - nextStartBar.width / 2)) / 2;
                            ctx2.save();
                            ctx2.strokeStyle = isDark ? 'rgba(100,116,139,0.45)' : 'rgba(107,114,128,0.35)';
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
                    title: {
                        display: true,
                        text: built.kind === 'bar'
                            ? built.yLabel.replace(/\s*\(.*?\)$/, '')
                            : `${built.yLabel.replace(/\s*\(.*?\)$/, '')} vs ${built.xLabel.replace(/\s*\(.*?\)$/, '')}`,
                        font: { size: 14, weight: 'bold' },
                    },
                    legend: { display: built.kind !== 'bar', position: 'top', labels: { color: legendColor } },
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
                                    ].filter(Boolean), units);
                                }
                                // Line charts: run objects are stored parallel to points
                                const run = ctx.dataset?.runMetas?.[ctx.dataIndex];
                                return run ? runTooltipLines(run, [], units) : [];
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
    }, [chartType, effUnit, selectedRuns, selectedVehicles, xMin, xMax, yMin, yMax, showPoints, units, isDark]);

    // ── Copy chart PNG ────────────────────────────────────────────────────────
    const handleCopyImage = async () => {
        if (!chartInstance.current) return;
        try {
            await copyChartAsPng(chartInstance.current, isDark ? 'rgb(8,12,28)' : '#ffffff');
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch { /* Clipboard API not supported — chart is still visible */ }
    };


    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Config card — hidden in presentation mode ── */}
            {!presentationMode && <div className="card mb-6">
                {/* Efficiency unit toggle */}
                <div className="efficiency-unit-toggle mb-4">
                    {effOptions(units).map(({ value: key, label }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setEffUnit(key)}
                            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${effUnit === key ? 'bg-white shadow text-gray-900' : 'text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-slate-100'}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Chart type buttons */}
                <div className="chart-type-buttons mb-4">
                    {CHART_TYPES.map(t => (
                        <button
                            key={t.key}
                            onClick={() => handleChartTypeChange(t.key)}
                            title={t.desc}
                            className="btn text-sm"
                            style={
                                chartType === t.key
                                    ? { backgroundColor: 'var(--color-primary)', color: 'white' }
                                    : { backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)' }
                            }
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Show points toggle — only relevant for line charts */}
                {CHART_TYPES.find(t => t.key === chartType)?.kind === 'line' && (
                    <div className="mb-6">
                        <label className="toggle-label">
                            <input
                                type="checkbox"
                                checked={showPoints}
                                onChange={e => setShowPoints(e.target.checked)}
                                className="w-4 h-4"
                            />
                            <span className="text-sm font-medium">Show points</span>
                        </label>
                    </div>
                )}

                {/* ── Run selector ── */}
                <RunSelector
                    vehicles={selectedVehicles}
                    selectedRunIds={selectedRuns}
                    onToggleRun={toggleRun}
                    onUpdateRunColor={onUpdateRunColor}
                    runFilter={isRangeRun}
                    emptyMessage="No range test records"
                    renderRunMeta={run => {
                        const eff         = calcEff(run.distance_miles, run.energy_kwh, effUnit, units);
                        const rawRange    = calcRange(run);
                        const range       = rawRange != null ? convDistance(rawRange, units) : null;
                        const effLabelStr = getEffLabel(effUnit, units);
                        const dl          = distanceLabel(units);
                        const socUsed     = (run.start_soc != null && run.end_soc != null) ? run.start_soc - run.end_soc : null;
                        const isProjected = socUsed != null && socUsed !== 100;
                        const canPlot     = hasDataForType(run, chartType);
                        const isChecked   = selectedRuns.some(id => String(id) === String(run.id));
                        return (
                            <>
                                {run.speed_mph != null && (
                                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{fmtSpeed(run.speed_mph, units)}</span>
                                )}
                                {run.temperature_f != null && (
                                    <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200">{fmtTemp(run.temperature_f, units)}</span>
                                )}
                                {range != null && (
                                    <span
                                        className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200"
                                        title={isProjected ? `Projected from ${run.distance_miles} mi driven over ${socUsed}% SoC` : 'Measured distance'}
                                    >
                                        {range} {dl}{isProjected ? ' ⟳' : ''}
                                    </span>
                                )}
                                {eff != null && (
                                    <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">{eff} {effLabelStr}</span>
                                )}
                                {!canPlot && isChecked && (
                                    <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200" title="Missing fields required for this chart type">⚠ missing data</span>
                                )}
                            </>
                        );
                    }}
                />
            </div>}

            {/* ── Chart card ── */}
            <div className="card mb-6">
                <div style={{ height: presentationMode ? 'calc(100vh - 2rem)' : '500px', position: 'relative' }}>
                    {/* Canvas always mounted so ref stays valid */}
                    <canvas
                        ref={chartRef}
                        style={{ display: plottableRuns.length > 0 ? 'block' : 'none' }}
                    />
                    {plottableRuns.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                            <div className="text-center">
                                <p className="text-lg font-medium">
                                    {selectedRangeRuns.length === 0
                                        ? 'Select runs above to display'
                                        : 'Selected runs are missing required fields for this chart type'}
                                </p>
                                {selectedRangeRuns.length > 0 && (
                                    <p className="text-sm mt-1 text-gray-400">
                                        {CHART_TYPES.find(t => t.key === chartType)?.desc}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
                <div className="mt-3 flex gap-2">
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
                        {copiedUrl ? '✓ Copied!' : '🔗 Copy URL'}
                    </button>
                    <button
                        onClick={handleCopyImage}
                        disabled={plottableRuns.length === 0}
                        className={`chart-copy-btn disabled:opacity-40 disabled:cursor-not-allowed ${copied ? 'chart-copy-btn-active' : ''}`}
                        title="Export chart as PNG"
                    >
                        {copied ? '✓ Copied to clipboard!' : '📋 Copy Chart as PNG'}
                    </button>
                </div>
            </div>
            {/* ── Axis scale controls (card provided by AxisScaleControls) ── */}
            <AxisScaleControls
                xMin={xMin} xMax={xMax}
                yMin={yMin} yMax={yMax}
                onChange={handleScaleChange}
                showX={CHART_TYPES.find(t => t.key === chartType)?.kind === 'line'}
            />
        </div>
    );
}
