import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { useAppContext } from '../context/AppContext';
import { convValue, formatSpecValue } from '../utils/unitConversions';
import {
    makeVehicleFields, buildFieldGroups, getFieldDef, extractValue,
    detectMode, formatNumericLabel, vehicleColor,
} from '../utils/specHelpers';

// ── Inside-bar label afterDraw plugin ─────────────────────────────────────────

function makeInsideLabelPlugin(getLabelFn) {
    return {
        id: 'insideBarLabels',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            chart.data.datasets.forEach((_, di) => {
                chart.getDatasetMeta(di).data.forEach((bar, bi) => {
                    const text = getLabelFn(bi);
                    if (!text || text === '—') return;
                    // Horizontal bars: bar.x = right edge, bar.base = left edge, bar.y = center
                    const barLen = Math.abs(bar.x - bar.base);
                    if (barLen < 20) return;
                    ctx.save();
                    ctx.font = 'bold 12px system-ui, sans-serif';
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const maxW = barLen - 8;
                    let label = text;
                    while (label.length > 1 && ctx.measureText(label).width > maxW) {
                        label = label.slice(0, -1);
                    }
                    if (label !== text) label += '…';
                    ctx.fillText(label, (bar.x + bar.base) / 2, bar.y);
                    ctx.restore();
                });
            });
        },
    };
}

// ── SpecsChartView ────────────────────────────────────────────────────────────

export default function SpecsChartView({ vehicles, selectedField: controlledField = null, onFieldChange }) {
    const { units } = useAppContext();

    const vehicleFields = useMemo(() => makeVehicleFields(units), [units]);

    const fieldGroups = useMemo(() => buildFieldGroups(vehicles, vehicleFields), [vehicles, vehicleFields]);
    const allFields   = useMemo(() => fieldGroups.flatMap(g => g.fields), [fieldGroups]);

    const [localField,  setLocalField]  = useState('');
    const [copiedUrl,   setCopiedUrl]   = useState(false);
    const selectedField = controlledField || localField;

    const setSelectedField = (field) => {
        setLocalField(field);
        onFieldChange?.(field);
    };

    // Auto-select the first field that has any data across vehicles
    useEffect(() => {
        if (selectedField) return;
        const first = allFields.find(f =>
            vehicles.some(v => {
                const val = extractValue(v, f.key);
                return val !== null && val !== undefined && val !== '';
            })
        );
        if (first) setSelectedField(first.key);
    }, [allFields, vehicles, selectedField]);

    const canvasRef = useRef(null);
    const chartRef  = useRef(null);

    useEffect(() => {
        if (!selectedField || !canvasRef.current || !vehicles.length) return;

        const fieldDef  = allFields.find(f => f.key === selectedField) || getFieldDef(selectedField, vehicleFields);
        const mode      = detectMode(vehicles, selectedField, fieldDef);
        const rawValues = vehicles.map(v => extractValue(v, selectedField));
        const labels    = vehicles.map(v => v.name);

        let barData, bgColors, insideLabelFn, valueAxisOptions;

        if (mode === 'boolean') {
            barData = rawValues.map(v =>
                v === null || v === undefined || v === '' ? 0.08 :
                v ? 1.0 : 0.25
            );
            bgColors = rawValues.map(v =>
                v === null || v === undefined || v === '' ? '#d1d5db' :
                v ? '#22c55e' : '#ef4444'
            );
            const insideLabels = rawValues.map(v =>
                v === null || v === undefined || v === '' ? '—' : v ? 'Yes' : 'No'
            );
            insideLabelFn = i => insideLabels[i];
            valueAxisOptions = { display: false, max: 1.15 };

        } else if (mode === 'categorical') {
            barData = rawValues.map(() => 1.0);
            bgColors = vehicles.map((v, i) => vehicleColor(v, i));
            const insideLabels = rawValues.map(v =>
                v === null || v === undefined || v === '' ? '—' : String(v)
            );
            insideLabelFn = i => insideLabels[i];
            valueAxisOptions = { display: false, max: 1.15 };

        } else {
            // numeric
            barData = rawValues.map(v => {
                if (v === null || v === undefined || v === '') return null;
                const n = parseFloat(String(v));
                return isNaN(n) ? null : convValue(n, fieldDef.unitGroup, units);
            });
            bgColors = rawValues.map((v, i) =>
                (v === null || v === undefined || v === '') ? '#d1d5db' : vehicleColor(vehicles[i], i)
            );
            const insideLabels = barData.map((n, i) => {
                if (n === null) return null;
                if (fieldDef.unitGroup) return formatSpecValue(rawValues[i], fieldDef.unitGroup, units);
                return formatNumericLabel(n);
            });
            insideLabelFn = i => insideLabels[i];
            valueAxisOptions = { display: true, beginAtZero: true };
        }

        // Destroy previous instance
        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }

        const fieldLabel = allFields.find(f => f.key === selectedField)?.label || selectedField;

        chartRef.current = new Chart(canvasRef.current, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: fieldLabel,
                    data: barData,
                    backgroundColor: bgColors,
                    borderRadius: 4,
                    borderSkipped: false,
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            label: ctx => {
                                const raw = rawValues[ctx.dataIndex];
                                if (raw === null || raw === undefined || raw === '') return 'N/A';
                                if (mode === 'boolean') return raw ? 'Yes' : 'No';
                                if (fieldDef.unitGroup) return formatSpecValue(raw, fieldDef.unitGroup, units);
                                return String(raw);
                            },
                        },
                    },
                },
                scales: {
                    x: valueAxisOptions,
                    y: {
                        grid: { display: false },
                        ticks: { font: { size: 13 } },
                    },
                },
            },
            plugins: [makeInsideLabelPlugin(insideLabelFn)],
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [selectedField, vehicles, allFields, units]);

    return (
        <div className="specs-chart-card">
            <div className="specs-chart-controls">
                <label className="text-sm font-medium text-gray-600">Compare:</label>
                <select
                    className="specs-chart-field-select"
                    value={selectedField}
                    onChange={e => setSelectedField(e.target.value)}
                >
                    {fieldGroups.map(group => (
                        <optgroup key={group.groupLabel} label={group.groupLabel}>
                            {group.fields.map(f => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </div>

            <div style={{ height: `${Math.max(220, vehicles.length * 52)}px`, position: 'relative' }}>
                <canvas ref={canvasRef} />
            </div>
            <div className="mt-3 flex gap-2">
                <button
                    onClick={() => {
                        navigator.clipboard.writeText(window.location.href).then(() => {
                            setCopiedUrl(true);
                            setTimeout(() => setCopiedUrl(false), 2000);
                        });
                    }}
                    className={`chart-copy-btn ${copiedUrl ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                    title="Copy link to this chart view"
                >
                    {copiedUrl ? '✓ Copied!' : '🔗 Copy URL'}
                </button>
            </div>
        </div>
    );
}
