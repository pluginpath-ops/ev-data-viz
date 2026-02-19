import { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

export default function ChartView({ vehicles, selectedVehicleIds, chartConfig, setChartConfig, onUpdateRunColor }) {
    const chartRef = useRef(null);
    const chartInstance = useRef(null);
    const [expandedVehicles, setExpandedVehicles] = useState({});

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
                        allSelectedRuns.push({
                            ...run,
                            vehicleName: vehicle.name
                        });
                    }
                });
            }
        });

        const datasets = allSelectedRuns.map((run) => {
            const data = run.data
                .filter(d => d[chartConfig.xAxis] != null && d[chartConfig.yAxis] != null)
                .map(d => ({
                    x: d[chartConfig.xAxis],
                    y: d[chartConfig.yAxis]
                }));

            const color = run.color || '#3b82f6';

            return {
                label: `${run.vehicleName} - ${run.name}`,
                data: data,
                backgroundColor: color,
                borderColor: color,
                pointRadius: 3,
                pointHoverRadius: 5
            };
        });

        chartInstance.current = new Chart(ctx, {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
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
                        title: {
                            display: true,
                            text: axisOptions.find(a => a.value === chartConfig.xAxis)?.label || chartConfig.xAxis
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: axisOptions.find(a => a.value === chartConfig.yAxis)?.label || chartConfig.yAxis
                        }
                    }
                }
            }
        });

        return () => {
            if (chartInstance.current) {
                chartInstance.current.destroy();
            }
        };
    }, [chartConfig, selectedVehicles]);

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Charts - {selectedVehicles.length} Vehicle{selectedVehicles.length !== 1 ? 's' : ''} Selected</h2>

            <div className="card mb-6">
                <h3 className="text-lg font-bold mb-4">Chart Configuration</h3>

                <div className="grid grid-cols-3 gap-4 mb-6">
                    {chartPresets.map(preset => (
                        <button
                            key={preset.name}
                            onClick={() => setChartConfig({
                                ...chartConfig,
                                xAxis: preset.x,
                                yAxis: preset.y
                            })}
                            className="btn"
                            style={{
                                backgroundColor: 'var(--color-primary-light)',
                                color: 'var(--color-primary-text)'
                            }}
                        >
                            {preset.name}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="block font-medium mb-2">X-Axis:</label>
                        <select
                            value={chartConfig.xAxis}
                            onChange={(e) => setChartConfig({...chartConfig, xAxis: e.target.value})}
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
                            onChange={(e) => setChartConfig({...chartConfig, yAxis: e.target.value})}
                            className="border p-2 rounded w-full"
                        >
                            {axisOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className="block font-medium mb-2">Select Runs to Display:</label>
                    <div className="space-y-4">
                        {selectedVehicles.map(vehicle => {
                            const isExpanded = expandedVehicles[vehicle.id];
                            const activeRuns = vehicle.runs?.filter(r => chartConfig.selectedRuns.includes(r.id)) || [];
                            const inactiveRuns = vehicle.runs?.filter(r => !chartConfig.selectedRuns.includes(r.id)) || [];
                            const hasInactiveRuns = inactiveRuns.length > 0;

                            return (
                                <div key={vehicle.id} className="border-l-4 pl-4" style={{borderColor: 'var(--color-primary)'}}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <h4 className="font-semibold text-gray-700">{vehicle.name}</h4>
                                        {hasInactiveRuns && (
                                            <button
                                                onClick={() => toggleVehicleExpanded(vehicle.id)}
                                                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                                            >
                                                <span style={{
                                                    display: 'inline-block',
                                                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                                    transition: 'transform 0.2s'
                                                }}>&#9660;</span>
                                                <span>{isExpanded ? 'Hide' : 'Show'} all ({vehicle.runs?.length || 0})</span>
                                            </button>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        {/* Active runs - always shown */}
                                        {activeRuns.map(run => (
                                            <label key={run.id} className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    checked={true}
                                                    onChange={() => {
                                                        setChartConfig({
                                                            ...chartConfig,
                                                            selectedRuns: chartConfig.selectedRuns.filter(id => id !== run.id)
                                                        });
                                                    }}
                                                    className="w-4 h-4"
                                                />
                                                <input
                                                    type="color"
                                                    value={run.color || '#3b82f6'}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        handleColorChange(vehicle.id, run.id, e.target.value);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-8 h-6 border-0 rounded cursor-pointer"
                                                    title="Change color"
                                                />
                                                <input
                                                    type="text"
                                                    value={run.color || '#3b82f6'}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        const value = e.target.value;
                                                        handleColorChange(vehicle.id, run.id, value);
                                                    }}
                                                    onBlur={(e) => {
                                                        const value = e.target.value;
                                                        if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
                                                            handleColorChange(vehicle.id, run.id, run.color || '#3b82f6');
                                                        }
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-20 px-2 py-0.5 border rounded text-xs font-mono"
                                                    placeholder="#3b82f6"
                                                    maxLength={7}
                                                />
                                                <span className="flex-1">
                                                    {run.name}
                                                    <span className="text-sm text-gray-500"> ({run.date})</span>
                                                    {run.isDefault && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded" style={{backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)'}}>Default</span>}
                                                </span>
                                            </label>
                                        ))}

                                        {/* Inactive runs - shown when expanded */}
                                        {isExpanded && inactiveRuns.map(run => (
                                            <label key={run.id} className="flex items-center gap-2 opacity-60 hover:opacity-100">
                                                <input
                                                    type="checkbox"
                                                    checked={false}
                                                    onChange={() => {
                                                        setChartConfig({
                                                            ...chartConfig,
                                                            selectedRuns: [...chartConfig.selectedRuns, run.id]
                                                        });
                                                    }}
                                                    className="w-4 h-4"
                                                />
                                                <input
                                                    type="color"
                                                    value={run.color || '#3b82f6'}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        handleColorChange(vehicle.id, run.id, e.target.value);
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-8 h-6 border-0 rounded cursor-pointer"
                                                    title="Change color"
                                                />
                                                <input
                                                    type="text"
                                                    value={run.color || '#3b82f6'}
                                                    onChange={(e) => {
                                                        e.stopPropagation();
                                                        const value = e.target.value;
                                                        handleColorChange(vehicle.id, run.id, value);
                                                    }}
                                                    onBlur={(e) => {
                                                        const value = e.target.value;
                                                        if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
                                                            handleColorChange(vehicle.id, run.id, run.color || '#3b82f6');
                                                        }
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="w-20 px-2 py-0.5 border rounded text-xs font-mono"
                                                    placeholder="#3b82f6"
                                                    maxLength={7}
                                                />
                                                <span className="flex-1">
                                                    {run.name}
                                                    <span className="text-sm text-gray-500"> ({run.date})</span>
                                                    {run.isDefault && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded" style={{backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary-text)'}}>Default</span>}
                                                </span>
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
                </div>
            </div>

            <div className="card">
                <div style={{ height: '500px' }}>
                    <canvas ref={chartRef}></canvas>
                </div>
            </div>

            {chartConfig.selectedRuns.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                    <p className="text-lg">Select runs to display on the chart</p>
                </div>
            )}
        </div>
    );
}
