import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

// ── Chart type definitions ────────────────────────────────────────────────────
const CHART_TYPES = [
    { key: 'range-speed-scatter',  label: 'Range vs Speed',        kind: 'scatter', desc: 'Distance driven at each speed' },
    { key: 'range-speed-bar',      label: 'Range by Speed',        kind: 'bar',     desc: 'Grouped bar comparison across speeds' },
    { key: 'eff-speed-scatter',    label: 'Efficiency vs Speed',   kind: 'scatter', desc: 'mi/kWh or Wh/mi at each speed (calculated)' },
    { key: 'eff-temp-scatter',     label: 'Efficiency vs Temp',    kind: 'scatter', desc: 'How ambient temperature affects efficiency (calculated)' },
    { key: 'eff-speed-bar',        label: 'Efficiency by Speed',   kind: 'bar',     desc: 'Grouped efficiency bar comparison (calculated)' },
];

// ── Efficiency helpers ────────────────────────────────────────────────────────
const calcEff = (run, unit) => {
    const e = run.energy_kwh;
    const d = run.distance_miles;
    if (!e || !d || e <= 0 || d <= 0) return null;
    return unit === 'wh_mi'
        ? Math.round((e * 1000) / d * 10) / 10
        : Math.round((d / e) * 100) / 100;
};

const hasDataForType = (run, type) => {
    const needsEff = type.includes('eff-');
    const needsSpeed = !type.includes('-temp');
    const needsTemp = type.includes('-temp');
    if (needsEff && (!run.energy_kwh || !run.distance_miles)) return false;
    if (type.includes('range-') && !run.distance_miles) return false;
    if (needsSpeed && run.speed_mph == null) return false;
    if (needsTemp && run.temperature_f == null) return false;
    return true;
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function RangeChartView({ selectedVehicles, selectedRuns, setChartConfig, onUpdateRunColor }) {
    const chartRef = useRef(null);
    const chartInstance = useRef(null);
    const [chartType, setChartType] = useState('range-speed-scatter');
    const [effUnit, setEffUnit] = useState('mi_kwh'); // 'mi_kwh' | 'wh_mi'
    const [copied, setCopied] = useState(false);

    // ── Derived: all range runs across selected vehicles ──────────────────────
    const allRangeRuns = selectedVehicles.flatMap(v =>
        (v.runs || [])
            .filter(r => r.record_type === 'range')
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
        if (!typeInfo) return null;

        const effLabel = effUnit === 'mi_kwh' ? 'Efficiency (mi/kWh)' : 'Efficiency (Wh/mi)';

        if (typeInfo.kind === 'scatter') {
            const getPoint = (run) => {
                if (chartType === 'range-speed-scatter') return { x: run.speed_mph, y: run.distance_miles };
                if (chartType === 'eff-speed-scatter')  return { x: run.speed_mph, y: calcEff(run, effUnit) };
                if (chartType === 'eff-temp-scatter')   return { x: run.temperature_f, y: calcEff(run, effUnit) };
                return { x: null, y: null };
            };

            const datasets = plottableRuns.map(run => {
                const { x, y } = getPoint(run);
                return {
                    label: `${run.vehicleName} — ${run.name}`,
                    data: (x != null && y != null) ? [{ x, y }] : [],
                    backgroundColor: run.color || '#3b82f6',
                    borderColor: run.color || '#3b82f6',
                    pointRadius: 7,
                    pointHoverRadius: 10,
                    pointStyle: 'circle',
                };
            });

            const xLabel = chartType === 'eff-temp-scatter' ? 'Ambient Temp (°F)' : 'Speed (mph)';
            const yLabel = chartType === 'range-speed-scatter' ? 'Range (miles)' : effLabel;

            return {
                kind: 'scatter',
                data: { datasets },
                xLabel,
                yLabel,
            };
        }

        if (typeInfo.kind === 'bar') {
            // Collect all unique speeds from plottable runs, sorted numerically
            const speeds = [...new Set(plottableRuns.map(r => r.speed_mph).filter(s => s != null))]
                .sort((a, b) => a - b);
            const labels = speeds.map(s => `${s} mph`);

            const datasets = plottableRuns.map(run => {
                const yVal = chartType === 'range-speed-bar'
                    ? run.distance_miles
                    : calcEff(run, effUnit);
                return {
                    label: `${run.vehicleName} — ${run.name}`,
                    data: speeds.map(s => (s === run.speed_mph ? yVal : null)),
                    backgroundColor: run.color || '#3b82f6',
                    borderColor: run.color || '#3b82f6',
                    borderRadius: 4,
                    borderSkipped: false,
                };
            });

            const yLabel = chartType === 'range-speed-bar' ? 'Range (miles)' : effLabel;

            return {
                kind: 'bar',
                data: { labels, datasets },
                xLabel: 'Speed (mph)',
                yLabel,
            };
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
        if (!built || plottableRuns.length === 0) return;

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
                            label(ctx) {
                                if (built.kind === 'scatter') {
                                    return `${ctx.dataset.label}: (${ctx.parsed.x}, ${ctx.parsed.y})`;
                                }
                                return `${ctx.dataset.label}: ${ctx.parsed.y ?? '—'}`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        title: { display: true, text: built.xLabel },
                        ...(built.kind === 'bar' ? {} : {}),
                    },
                    y: {
                        title: { display: true, text: built.yLabel },
                        beginAtZero: false,
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
    }, [chartType, effUnit, selectedRuns, selectedVehicles]);

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
        v => !(v.runs || []).some(r => r.record_type === 'range')
    );

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Config card ── */}
            <div className="card mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">Range &amp; Efficiency</h3>
                    {/* Efficiency unit toggle — only relevant for efficiency charts */}
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
                            onClick={() => setChartType(t.key)}
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

                {/* ── Run selector ── */}
                {noRangeRunsAtAll ? (
                    <div className="text-center py-6 text-gray-400">
                        <p className="text-sm">No range test records yet.</p>
                        <p className="text-xs mt-1">Add records using the Test Runs tab with "Range Test" type.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {selectedVehicles.map(vehicle => {
                            const rangeRuns = (vehicle.runs || []).filter(r => r.record_type === 'range');
                            return (
                                <div key={vehicle.id} className="border-l-4 pl-4" style={{ borderColor: 'var(--color-primary)' }}>
                                    <h4 className="font-semibold text-gray-700 mb-2">{vehicle.name}</h4>
                                    {rangeRuns.length === 0 ? (
                                        <p className="text-sm text-gray-400 italic">No range test records</p>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {rangeRuns.map(run => {
                                                const isChecked = selectedRuns.some(id => String(id) === String(run.id));
                                                const eff = calcEff(run, effUnit);
                                                const effLabel = effUnit === 'mi_kwh' ? 'mi/kWh' : 'Wh/mi';
                                                const canPlot = hasDataForType(run, chartType);
                                                return (
                                                    <label key={run.id} className={`flex items-center gap-2 cursor-pointer ${!canPlot && isChecked ? 'opacity-60' : ''}`}>
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
                                                            title="Change color"
                                                        />
                                                        <span className="text-sm flex-1 flex items-center gap-1.5 flex-wrap">
                                                            <span className="font-medium">{run.name}</span>
                                                            <span className="text-gray-400 text-xs">({run.date})</span>
                                                            {run.speed_mph != null && (
                                                                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{run.speed_mph} mph</span>
                                                            )}
                                                            {run.distance_miles != null && (
                                                                <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded border border-green-200">{run.distance_miles} mi</span>
                                                            )}
                                                            {eff != null && (
                                                                <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">{eff} {effLabel}</span>
                                                            )}
                                                            {run.temperature_f != null && (
                                                                <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200">{run.temperature_f}°F</span>
                                                            )}
                                                            {!canPlot && isChecked && (
                                                                <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200" title="Missing fields required for this chart type">⚠ missing data</span>
                                                            )}
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Chart card ── */}
            <div className="card mb-4">
                <div style={{ height: '500px', position: 'relative' }}>
                    {/* Canvas is always mounted so the ref stays valid */}
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
        </div>
    );
}
