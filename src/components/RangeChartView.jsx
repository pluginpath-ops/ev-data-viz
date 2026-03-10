import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import AxisScaleControls from './AxisScaleControls';

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

// ── Efficiency helper ─────────────────────────────────────────────────────────
const calcEff = (run, unit) => {
    const e = run.energy_kwh;
    const d = run.distance_miles;
    if (!e || !d || e <= 0 || d <= 0) return null;
    return unit === 'wh_mi'
        ? Math.round((e * 1000) / d * 10) / 10
        : Math.round((d / e) * 100) / 100;
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
export default function RangeChartView({ selectedVehicles, selectedRuns, setChartConfig, onUpdateRunColor }) {
    const chartRef      = useRef(null);
    const chartInstance = useRef(null);
    const [chartType, setChartType] = useState('range-vehicle-bar');
    const [effUnit,   setEffUnit]   = useState('mi_kwh'); // 'mi_kwh' | 'wh_mi'
    const [copied,    setCopied]    = useState(false);

    // ── Axis scale state — yMin defaults to 0, rest auto ─────────────────────
    const [xMin, setXMin] = useState(null);
    const [xMax, setXMax] = useState(null);
    const [yMin, setYMin] = useState(0);
    const [yMax, setYMax] = useState(null);
    const [runsExpanded,    setRunsExpanded]    = useState(true);
    const [expandedVehicles, setExpandedVehicles] = useState({});

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
        (v.runs || [])
            .filter(r => r.has_range)
            .map(r => ({ ...r, vehicleName: v.name, vehicleId: v.id }))
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

        const isRange = chartType.includes('range-');
        const isSpeed = chartType.includes('-speed-');
        const effLabel = effUnit === 'mi_kwh' ? 'Efficiency (mi/kWh)' : 'Efficiency (Wh/mi)';
        const getY     = (run) => isRange ? calcRange(run) : calcEff(run, effUnit);
        const yLabel   = isRange ? 'Range (miles)' : effLabel;

        // ── Bar: each run grouped by vehicle name ─────────────────────────────
        if (typeInfo.kind === 'bar') {
            const vehicleNames = [...new Set(plottableRuns.map(r => r.vehicleName))];
            const datasets = plottableRuns.map(run => ({
                label: `${run.vehicleName} — ${run.name}`,
                data: vehicleNames.map(v => v === run.vehicleName ? getY(run) : null),
                backgroundColor: run.color || '#3b82f6',
                borderColor:     run.color || '#3b82f6',
                borderRadius: 4,
                borderSkipped: false,
            }));
            return {
                kind: 'bar',
                data: { labels: vehicleNames, datasets },
                xLabel: 'Vehicle',
                yLabel,
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
                const points = runs
                    .map(r => ({ x: isSpeed ? r.speed_mph : r.temperature_f, y: getY(r) }))
                    .filter(p => p.x != null && p.y != null)
                    .sort((a, b) => a.x - b.x);
                if (points.length === 0) return;
                // Line color = first run's color
                const color = runs[0].color || '#3b82f6';
                datasets.push({
                    label: name,
                    data: points,
                    backgroundColor: color,
                    borderColor: color,
                    pointRadius: 6,
                    pointHoverRadius: 9,
                    tension: 0.2,
                });
            });

            const xLabel = isSpeed ? 'Speed (mph)' : 'Ambient Temp (°F)';
            return { kind: 'line', data: { datasets }, xLabel, yLabel };
        }

        return null;
    };

    // ── Render chart ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (chartInstance.current) {
            chartInstance.current.destroy();
            chartInstance.current = null;
        }
        if (!chartRef.current) return;

        const built = buildChart();
        if (!built) return;

        chartInstance.current = new Chart(chartRef.current.getContext('2d'), {
            type: built.kind,
            data: built.data,
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            title(items) {
                                // For line charts show the x-axis value in the title
                                if (built.kind === 'line' && items.length > 0) {
                                    const x = items[0].raw?.x ?? items[0].parsed.x;
                                    return `${built.xLabel}: ${x}`;
                                }
                                return undefined;
                            },
                            label(ctx) {
                                return `${ctx.dataset.label}: ${ctx.parsed.y ?? ctx.raw?.y ?? '—'}`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        // Linear axis for line charts (numeric x); category for bar
                        type: built.kind === 'line' ? 'linear' : 'category',
                        title: { display: true, text: built.xLabel },
                        ...(built.kind === 'line' && xMin != null ? { min: xMin } : {}),
                        ...(built.kind === 'line' && xMax != null ? { max: xMax } : {}),
                    },
                    y: {
                        title: { display: true, text: built.yLabel },
                        beginAtZero: false,
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
    }, [chartType, effUnit, selectedRuns, selectedVehicles, xMin, xMax, yMin, yMax]);

    // ── Copy chart PNG ────────────────────────────────────────────────────────
    const handleCopyImage = async () => {
        if (!chartInstance.current) return;
        const dataUrl = chartInstance.current.toBase64Image('image/png', 1.0);
        try {
            const blob = await (await fetch(dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch { /* Clipboard API not supported — chart is still visible */ }
    };

    const noRangeRunsAtAll = selectedVehicles.every(
        v => !(v.runs || []).some(r => r.has_range)
    );

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Config card ── */}
            <div className="card mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">Chart Options — Range &amp; Efficiency</h3>
                    {/* Efficiency unit toggle — relevant for efficiency charts */}
                    <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                        {[{ key: 'mi_kwh', label: 'mi/kWh' }, { key: 'wh_mi', label: 'Wh/mi' }].map(({ key, label }) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setEffUnit(key)}
                                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${effUnit === key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Chart type buttons */}
                <div className="flex flex-wrap gap-2 mb-6">
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

                {/* ── Run selector — collapsible, matching charging chart pattern ── */}
                <div>
                    <button
                        onClick={() => setRunsExpanded(prev => !prev)}
                        className="flex items-center gap-2 w-full text-left font-medium hover:text-gray-600 transition-colors mb-1"
                    >
                        <span style={{ display: 'inline-block', transform: runsExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                        Select Runs to Display
                        <span className="text-sm font-normal text-gray-500">
                            ({selectedRangeRuns.length} selected)
                        </span>
                    </button>

                    {runsExpanded && (
                        <div className="mt-3">
                            {noRangeRunsAtAll ? (
                                <div className="text-center py-6 text-gray-400">
                                    <p className="text-sm">No range test records yet.</p>
                                    <p className="text-xs mt-1">Add records using the Test Runs tab with "Range Test" type.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {selectedVehicles.map(vehicle => {
                                        const rangeRuns    = (vehicle.runs || []).filter(r => r.has_range);
                                        const activeRuns   = rangeRuns.filter(r =>  selectedRuns.some(id => String(id) === String(r.id)));
                                        const inactiveRuns = rangeRuns.filter(r => !selectedRuns.some(id => String(id) === String(r.id)));
                                        const isVehicleExpanded = expandedVehicles[vehicle.id];

                                        const RunRow = ({ run, dimmed }) => {
                                            const isChecked   = selectedRuns.some(id => String(id) === String(run.id));
                                            const eff         = calcEff(run, effUnit);
                                            const range       = calcRange(run);
                                            const effLabel    = effUnit === 'mi_kwh' ? 'mi/kWh' : 'Wh/mi';
                                            const socUsed     = (run.start_soc != null && run.end_soc != null) ? run.start_soc - run.end_soc : null;
                                            const isProjected = socUsed != null && socUsed !== 100;
                                            const canPlot     = hasDataForType(run, chartType);
                                            return (
                                                <label key={run.id} className={`flex items-center gap-2 cursor-pointer ${dimmed ? 'opacity-60 hover:opacity-100' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => toggleRun(run.id)}
                                                        className="w-4 h-4 shrink-0"
                                                    />
                                                    <input
                                                        type="color"
                                                        value={run.color || '#3b82f6'}
                                                        onChange={(e) => { e.stopPropagation(); onUpdateRunColor(vehicle.id, run.id, e.target.value); }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="w-8 h-6 border-0 rounded cursor-pointer shrink-0"
                                                        title="Change color (also sets line color for first run per vehicle)"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={run.color || '#3b82f6'}
                                                        onChange={(e) => { e.stopPropagation(); onUpdateRunColor(vehicle.id, run.id, e.target.value); }}
                                                        onBlur={(e) => { if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onUpdateRunColor(vehicle.id, run.id, run.color || '#3b82f6'); }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="w-20 px-2 py-0.5 border rounded text-xs font-mono shrink-0"
                                                        placeholder="#3b82f6"
                                                        maxLength={7}
                                                    />
                                                    <span className="text-sm flex-1 flex items-center gap-1.5 flex-wrap">
                                                        <span className="font-medium">{run.name}</span>
                                                        <span className="text-gray-400 text-xs">({run.date})</span>
                                                        {run.speed_mph != null && (
                                                            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{run.speed_mph} mph</span>
                                                        )}
                                                        {run.temperature_f != null && (
                                                            <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200">{run.temperature_f}°F</span>
                                                        )}
                                                        {range != null && (
                                                            <span
                                                                className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200"
                                                                title={isProjected ? `Projected from ${run.distance_miles} mi driven over ${socUsed}% SoC` : 'Measured distance'}
                                                            >
                                                                {range} mi{isProjected ? ' ⟳' : ''}
                                                            </span>
                                                        )}
                                                        {eff != null && (
                                                            <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">{eff} {effLabel}</span>
                                                        )}
                                                        {!canPlot && isChecked && (
                                                            <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200" title="Missing fields required for this chart type">⚠ missing data</span>
                                                        )}
                                                    </span>
                                                </label>
                                            );
                                        };

                                        return (
                                            <div key={vehicle.id} className="border-l-4 pl-4" style={{ borderColor: 'var(--color-primary)' }}>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <h4 className="font-semibold text-gray-700">{vehicle.name}</h4>
                                                    {inactiveRuns.length > 0 && (
                                                        <button
                                                            onClick={() => setExpandedVehicles(prev => ({ ...prev, [vehicle.id]: !prev[vehicle.id] }))}
                                                            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                                                        >
                                                            <span style={{ display: 'inline-block', transform: isVehicleExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                                                            <span>{isVehicleExpanded ? 'Hide' : 'Show all'} ({rangeRuns.length})</span>
                                                        </button>
                                                    )}
                                                </div>
                                                {rangeRuns.length === 0 ? (
                                                    <p className="text-sm text-gray-400 italic">No range test records</p>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {activeRuns.map(run => <RunRow key={run.id} run={run} dimmed={false} />)}
                                                        {isVehicleExpanded && inactiveRuns.map(run => <RunRow key={run.id} run={run} dimmed={true} />)}
                                                        {activeRuns.length === 0 && !isVehicleExpanded && (
                                                            <p className="text-xs text-gray-400 italic">No runs selected — click Show all to re-add</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Chart card ── */}
            <div className="card mb-6">
                <div style={{ height: '500px', position: 'relative' }}>
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
                <div className="mt-3">
                    <button
                        onClick={handleCopyImage}
                        disabled={plottableRuns.length === 0}
                        className={`text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            copied
                                ? 'bg-green-50 border-green-200 text-green-700'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                        title="Export chart as PNG"
                    >
                        {copied ? '✓ Copied to clipboard!' : '📋 Copy Chart as PNG'}
                    </button>
                </div>
            </div>
            {/* ── Axis scale controls card ── */}
            <div className="card mb-4">
                <AxisScaleControls
                    xMin={xMin} xMax={xMax}
                    yMin={yMin} yMax={yMax}
                    onChange={handleScaleChange}
                    showX={CHART_TYPES.find(t => t.key === chartType)?.kind === 'line'}
                />
            </div>
        </div>
    );
}
