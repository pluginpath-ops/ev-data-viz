import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';

export default function ChartView({ vehicles, selectedVehicleIds, chartConfig, setChartConfig, onUpdateRunColor }) {
    const chartRef = useRef(null);
    const chartInstance = useRef(null);
    const [expandedVehicles, setExpandedVehicles] = useState({});
    const [runDataCache, setRunDataCache] = useState({});
    const [loadingData, setLoadingData] = useState(false);
    const [runsExpanded, setRunsExpanded] = useState(true);

    const selectedVehicles = vehicles.filter(v => selectedVehicleIds.includes(v.id));

    const handleColorChange = (vehicleId, runId, color) => {
        onUpdateRunColor(vehicleId, runId, color);
    };

    // Auto-select default or newest run from each vehicle on mount or when selected vehicles change
    useEffect(() => {
        const autoSelectedRuns = [];
        selectedVehicles.forEach(vehicle => {
            if (vehicle.runs && vehicle.runs.length > 0) {
                const defaultRun = vehicle.runs.find(r => r.isDefault);

                if (defaultRun) {
                    autoSelectedRuns.push(defaultRun.id);
                } else {
                    const sortedRuns = [...vehicle.runs].sort((a, b) =>
                        new Date(b.date) - new Date(a.date)
                    );
                    autoSelectedRuns.push(sortedRuns[0].id);
                }
            }
        });

        if (JSON.stringify(autoSelectedRuns.sort()) !== JSON.stringify(chartConfig.selectedRuns.sort())) {
            setChartConfig(prev => ({
                ...prev,
                selectedRuns: autoSelectedRuns
            }));
        }
    }, [selectedVehicleIds]);

    // Lazy-load data_points for newly selected runs
    useEffect(() => {
        const fetchMissingData = async () => {
            const missingIds = chartConfig.selectedRuns.filter(id => !(id in runDataCache));
            if (missingIds.length === 0) return;
            setLoadingData(true);
            const updates = {};
            for (const runId of missingIds) {
                try {
                    if (dataService.useSupabase) {
                        updates[runId] = await dataService.getRunData(runId);
                    } else {
                        // localStorage: find run.data inline
                        for (const v of vehicles) {
                            const run = v.runs?.find(r => r.id === runId);
                            if (run) { updates[runId] = run.data || []; break; }
                        }
                    }
                } catch (err) {
                    console.error(`Failed to load data for run ${runId}:`, err);
                    updates[runId] = [];
                }
            }
            setRunDataCache(prev => ({ ...prev, ...updates }));
            setLoadingData(false);
        };
        fetchMissingData();
    }, [chartConfig.selectedRuns]);

    const toggleVehicleExpanded = (vehicleId) => {
        setExpandedVehicles(prev => ({
            ...prev,
            [vehicleId]: !prev[vehicleId]
        }));
    };

    const axisOptions = [
        { value: 'soc', label: 'State of Charge (%)' },
        { value: 'chargeRate', label: 'Charge Rate (kW)' },
        { value: 'time', label: 'Time' },
        { value: 'range', label: 'Range (mi)' },
        { value: 'temperature', label: 'Temperature' },
        { value: 'frame', label: 'Frame' }
    ];

    const chartPresets = [
        { name: 'Charge Rate vs SoC', x: 'soc', y: 'chargeRate' },
        { name: 'Range vs Time', x: 'time', y: 'range' },
        { name: 'Charge Rate vs Time', x: 'time', y: 'chargeRate' }
    ];

    // ── Race mode helpers ────────────────────────────────────────────────────

    const raceActive = chartConfig.raceMode && chartConfig.xAxis === 'time';
    const raceThreshold = chartConfig.raceThreshold ?? 10;

    /**
     * Returns null if the run can participate in race mode, or a short reason
     * string if it must be excluded.  Only meaningful when raceActive is true.
     */
    const getRaceExclusionReason = (runId) => {
        if (!raceActive) return null;
        const data = runDataCache[runId];
        if (!data) return null; // not yet loaded — don't flag prematurely
        if (!data.some(p => p.time != null)) return 'no time data';
        const anchor = data.findIndex(p => p.soc != null && p.soc >= raceThreshold);
        if (anchor === -1) return `never reaches ${raceThreshold}% SoC`;
        return null;
    };

    /**
     * Returns the time offset (minutes) subtracted from a participating run,
     * or null if the run is excluded / data not yet loaded.
     * An offset of 0 means the data started right at the threshold — nothing trimmed.
     */
    const getRaceOffset = (runId) => {
        if (!raceActive) return null;
        const data = runDataCache[runId];
        if (!data) return null;
        const anchor = data.findIndex(p => p.soc != null && p.soc >= raceThreshold);
        if (anchor === -1) return null;
        const t = data[anchor].time;
        return t ?? null;
    };

    /**
     * Apply the race-mode time offset transform to a run's raw data.
     * Returns null if the run must be excluded (can't participate).
     */
    const applyRaceTransform = (rawData) => {
        const anchor = rawData.findIndex(p => p.soc != null && p.soc >= raceThreshold);
        if (anchor === -1) return null;
        const offset = rawData[anchor].time;
        if (offset == null) return null;
        return rawData
            .slice(anchor)
            .filter(d => d.time != null && d[chartConfig.yAxis] != null)
            .map(d => ({
                x: Math.round((d.time - offset) * 10) / 10,
                y: d[chartConfig.yAxis],
            }));
    };

    // ── Chart rendering ───────────────────────────────────────────────────────

    useEffect(() => {
        if (!chartRef.current) return;

        const ctx = chartRef.current.getContext('2d');

        if (chartInstance.current) {
            chartInstance.current.destroy();
        }

        const allSelectedRuns = [];
        selectedVehicles.forEach(vehicle => {
            if (vehicle.runs) {
                vehicle.runs.forEach(run => {
                    if (chartConfig.selectedRuns.includes(run.id)) {
                        allSelectedRuns.push({ ...run, vehicleName: vehicle.name });
                    }
                });
            }
        });

        const datasets = allSelectedRuns.flatMap((run) => {
            const rawData = runDataCache[run.id] ?? run.data ?? [];
            const color = run.color || '#3b82f6';

            let points;
            if (raceActive) {
                const transformed = applyRaceTransform(rawData);
                if (!transformed) return []; // excluded — skip this run
                points = transformed;
            } else {
                points = rawData
                    .filter(d => d[chartConfig.xAxis] != null && d[chartConfig.yAxis] != null)
                    .map(d => ({ x: d[chartConfig.xAxis], y: d[chartConfig.yAxis] }));
            }

            return [{
                label: `${run.vehicleName} - ${run.name}`,
                data: points,
                backgroundColor: color,
                borderColor: color,
                pointRadius: 3,
                pointHoverRadius: 5,
                showLine: chartConfig.showLine || false,
                tension: 0.1,
            }];
        });

        // X axis label: update when race mode is active
        const xLabel = raceActive
            ? `Time from ${raceThreshold}% SoC (min)`
            : (axisOptions.find(a => a.value === chartConfig.xAxis)?.label || chartConfig.xAxis);
        const yLabel = axisOptions.find(a => a.value === chartConfig.yAxis)?.label || chartConfig.yAxis;

        chartInstance.current = new Chart(ctx, {
            type: 'scatter',
            data: { datasets },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.dataset.label}: (${context.parsed.x}, ${context.parsed.y})`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: xLabel },
                        ...(chartConfig.xMin != null ? { min: chartConfig.xMin } : {}),
                        ...(chartConfig.xMax != null ? { max: chartConfig.xMax } : {}),
                    },
                    y: {
                        title: { display: true, text: yLabel },
                        ...(chartConfig.yMin != null ? { min: chartConfig.yMin } : {}),
                        ...(chartConfig.yMax != null ? { max: chartConfig.yMax } : {}),
                    }
                }
            }
        });

        return () => {
            if (chartInstance.current) {
                chartInstance.current.destroy();
            }
        };
    }, [chartConfig, selectedVehicles, runDataCache]);

    // ── Shared input class ────────────────────────────────────────────────────
    const numInputCls = 'px-2 py-1 border rounded text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Charts - {selectedVehicles.length} Vehicle{selectedVehicles.length !== 1 ? 's' : ''} Selected</h2>

            {/* ── Top card: presets, axis selectors, run selector ── */}
            <div className="card mb-6">
                <h3 className="text-lg font-bold mb-4">Chart Configuration</h3>

                {/* Presets */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                    {chartPresets.map(preset => (
                        <button
                            key={preset.name}
                            onClick={() => setChartConfig({ ...chartConfig, xAxis: preset.x, yAxis: preset.y })}
                            className="btn"
                            style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)' }}
                        >
                            {preset.name}
                        </button>
                    ))}
                </div>

                {/* Axis selectors */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="block font-medium mb-2">X-Axis:</label>
                        <select
                            value={chartConfig.xAxis}
                            onChange={(e) => setChartConfig({ ...chartConfig, xAxis: e.target.value })}
                            className="border p-2 rounded w-full"
                        >
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Y-Axis:</label>
                        <select
                            value={chartConfig.yAxis}
                            onChange={(e) => setChartConfig({ ...chartConfig, yAxis: e.target.value })}
                            className="border p-2 rounded w-full"
                        >
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* ── Line toggle ── */}
                <div className="mb-4">
                    <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                        <input
                            type="checkbox"
                            checked={chartConfig.showLine || false}
                            onChange={e => setChartConfig({ ...chartConfig, showLine: e.target.checked })}
                            className="w-4 h-4"
                        />
                        <span className="text-sm font-medium">Connect points with lines</span>
                    </label>
                </div>

                {/* ── Collapsible run selector ── */}
                <div>
                    <button
                        onClick={() => setRunsExpanded(prev => !prev)}
                        className="flex items-center gap-2 w-full text-left font-medium hover:text-gray-600 transition-colors mb-1"
                    >
                        <span
                            style={{ display: 'inline-block', transform: runsExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                        >&#9660;</span>
                        Select Runs to Display
                        <span className="text-sm font-normal text-gray-500">
                            ({chartConfig.selectedRuns.length} selected)
                        </span>
                    </button>

                    {runsExpanded && (
                        <div className="space-y-4 mt-3">
                            {selectedVehicles.map(vehicle => {
                                const isExpanded = expandedVehicles[vehicle.id];
                                const activeRuns   = vehicle.runs?.filter(r =>  chartConfig.selectedRuns.includes(r.id)) || [];
                                const inactiveRuns = vehicle.runs?.filter(r => !chartConfig.selectedRuns.includes(r.id)) || [];
                                const hasInactiveRuns = inactiveRuns.length > 0;

                                const RunLabel = ({ run }) => {
                                    const exclusionReason = getRaceExclusionReason(run.id);
                                    const offset = getRaceOffset(run.id);
                                    const noTrim = offset !== null && offset === 0;
                                    return (
                                        <span className="flex-1 flex items-center gap-2 flex-wrap">
                                            <span>
                                                {run.name}
                                                <span className="text-sm text-gray-500"> ({run.date})</span>
                                                {run.isDefault && (
                                                    <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded"
                                                        style={{ backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)' }}>
                                                        Default
                                                    </span>
                                                )}
                                            </span>
                                            {exclusionReason && (
                                                <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full" title={`Hidden in race mode: ${exclusionReason}`}>
                                                    ⚠ {exclusionReason}
                                                </span>
                                            )}
                                            {!exclusionReason && offset !== null && (
                                                noTrim ? (
                                                    <span className="text-xs bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full" title="Data starts at or above the threshold — no time was trimmed">
                                                        no offset
                                                    </span>
                                                ) : (
                                                    <span className="text-xs bg-gray-100 text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded-full" title={`${offset} min of pre-threshold data trimmed`}>
                                                        −{offset} min offset
                                                    </span>
                                                )
                                            )}
                                        </span>
                                    );
                                };

                                const ColorInputs = ({ run }) => (
                                    <>
                                        <input
                                            type="color"
                                            value={run.color || '#3b82f6'}
                                            onChange={(e) => { e.stopPropagation(); handleColorChange(vehicle.id, run.id, e.target.value); }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-8 h-6 border-0 rounded cursor-pointer"
                                            title="Change color"
                                        />
                                        <input
                                            type="text"
                                            value={run.color || '#3b82f6'}
                                            onChange={(e) => { e.stopPropagation(); handleColorChange(vehicle.id, run.id, e.target.value); }}
                                            onBlur={(e) => {
                                                if (!/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                                                    handleColorChange(vehicle.id, run.id, run.color || '#3b82f6');
                                                }
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-20 px-2 py-0.5 border rounded text-xs font-mono"
                                            placeholder="#3b82f6"
                                            maxLength={7}
                                        />
                                    </>
                                );

                                return (
                                    <div key={vehicle.id} className="border-l-4 pl-4" style={{ borderColor: 'var(--color-primary)' }}>
                                        <div className="flex items-center gap-2 mb-2">
                                            <h4 className="font-semibold text-gray-700">{vehicle.name}</h4>
                                            {hasInactiveRuns && (
                                                <button
                                                    onClick={() => toggleVehicleExpanded(vehicle.id)}
                                                    className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                                                >
                                                    <span style={{ display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                                                    <span>{isExpanded ? 'Hide' : 'Show'} all ({vehicle.runs?.length || 0})</span>
                                                </button>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            {/* Active runs — always shown */}
                                            {activeRuns.map(run => (
                                                <label key={run.id} className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={true}
                                                        onChange={() => setChartConfig({ ...chartConfig, selectedRuns: chartConfig.selectedRuns.filter(id => id !== run.id) })}
                                                        className="w-4 h-4"
                                                    />
                                                    <ColorInputs run={run} />
                                                    <RunLabel run={run} />
                                                </label>
                                            ))}

                                            {/* Inactive runs — shown when expanded */}
                                            {isExpanded && inactiveRuns.map(run => (
                                                <label key={run.id} className="flex items-center gap-2 opacity-60 hover:opacity-100">
                                                    <input
                                                        type="checkbox"
                                                        checked={false}
                                                        onChange={() => setChartConfig({ ...chartConfig, selectedRuns: [...chartConfig.selectedRuns, run.id] })}
                                                        className="w-4 h-4"
                                                    />
                                                    <ColorInputs run={run} />
                                                    <RunLabel run={run} />
                                                </label>
                                            ))}

                                            {(!vehicle.runs || vehicle.runs.length === 0) && (
                                                <p className="text-sm text-gray-500 italic">No runs available</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Chart canvas ── */}
            <div className="card mb-4">
                {loadingData && (
                    <div className="text-center py-4 text-gray-500 text-sm">Loading run data...</div>
                )}
                <div style={{ height: '500px' }}>
                    <canvas ref={chartRef}></canvas>
                </div>
            </div>

            {/* ── Controls below chart: scale inputs + line toggle + race mode ── */}
            <div className="card mb-6">

                {/* 2-column: Y scale | X scale — both stacked symmetrically */}
                <div className="grid grid-cols-2 gap-8">

                    {/* Left — Y-Axis Scale */}
                    <div>
                        <div className="flex items-baseline justify-between mb-2">
                            <p className="text-sm font-medium text-gray-500">Y-Axis Scale</p>
                            {(chartConfig.yMin != null || chartConfig.yMax != null) && (
                                <button
                                    onClick={() => setChartConfig({ ...chartConfig, yMin: null, yMax: null })}
                                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                                >
                                    Reset
                                </button>
                            )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 w-7 text-right">Max</span>
                                <input
                                    type="number"
                                    placeholder="Auto"
                                    value={chartConfig.yMax ?? ''}
                                    onChange={e => setChartConfig({ ...chartConfig, yMax: e.target.value === '' ? null : Number(e.target.value) })}
                                    className={`w-24 ${numInputCls}`}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 w-7 text-right">Min</span>
                                <input
                                    type="number"
                                    placeholder="Auto"
                                    value={chartConfig.yMin ?? ''}
                                    onChange={e => setChartConfig({ ...chartConfig, yMin: e.target.value === '' ? null : Number(e.target.value) })}
                                    className={`w-24 ${numInputCls}`}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Right — X-Axis Scale */}
                    <div>
                        <div className="flex items-baseline justify-between mb-2">
                            <p className="text-sm font-medium text-gray-500">X-Axis Scale</p>
                            {(chartConfig.xMin != null || chartConfig.xMax != null) && (
                                <button
                                    onClick={() => setChartConfig({ ...chartConfig, xMin: null, xMax: null })}
                                    className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                                >
                                    Reset
                                </button>
                            )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 w-7 text-right">Max</span>
                                <input
                                    type="number"
                                    placeholder="Auto"
                                    value={chartConfig.xMax ?? ''}
                                    onChange={e => setChartConfig({ ...chartConfig, xMax: e.target.value === '' ? null : Number(e.target.value) })}
                                    className={`w-24 ${numInputCls}`}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 w-7 text-right">Min</span>
                                <input
                                    type="number"
                                    placeholder="Auto"
                                    value={chartConfig.xMin ?? ''}
                                    onChange={e => setChartConfig({ ...chartConfig, xMin: e.target.value === '' ? null : Number(e.target.value) })}
                                    className={`w-24 ${numInputCls}`}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Race mode panel — only visible when X = Time ── */}
                {chartConfig.xAxis === 'time' && (
                    <div className={`mt-4 p-3 rounded-lg border ${chartConfig.raceMode ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={chartConfig.raceMode || false}
                                    onChange={e => setChartConfig({ ...chartConfig, raceMode: e.target.checked })}
                                    className="w-4 h-4 accent-indigo-600"
                                />
                                <span className="font-medium text-sm">Race mode</span>
                            </label>

                            {chartConfig.raceMode && (
                                <>
                                    <span className="text-sm text-gray-600">Start at:</span>
                                    {/* Quick-select chips */}
                                    <div className="flex gap-1 flex-wrap">
                                        {[5, 10, 15, 20].map(pct => (
                                            <button
                                                key={pct}
                                                onClick={() => setChartConfig({ ...chartConfig, raceThreshold: pct })}
                                                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                                                    chartConfig.raceThreshold === pct
                                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                                        : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                                                }`}
                                            >
                                                {pct}%
                                            </button>
                                        ))}
                                        {/* Freeform input */}
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                value={chartConfig.raceThreshold ?? 10}
                                                onChange={e => {
                                                    const v = parseInt(e.target.value, 10);
                                                    if (!isNaN(v) && v >= 0 && v <= 100) {
                                                        setChartConfig({ ...chartConfig, raceThreshold: v });
                                                    }
                                                }}
                                                className="w-14 px-1 py-0.5 border rounded text-xs text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                min="0" max="100"
                                            />
                                            <span className="text-xs text-gray-500">%</span>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                        {chartConfig.raceMode && (
                            <p className="mt-1.5 text-xs text-indigo-700">
                                Each run is shifted so its {raceThreshold}% SoC point lands at t = 0.
                                Runs without time data or that never reach {raceThreshold}% SoC are hidden.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {chartConfig.selectedRuns.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">Select runs to display on the chart</p>
                </div>
            )}
        </div>
    );
}
