import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { useAppContext } from '../context/AppContext';
import { convValue, formatSpecValue } from '../utils/unitConversions';
import {
    makeVehicleFields, buildFieldGroups, getFieldDef, extractValue,
    vehicleColor, formatNumericLabel,
} from '../utils/specHelpers';

// ── Linear regression ─────────────────────────────────────────────────────────

function linearRegression(points) {
    const n = points.length;
    if (n < 2) return null;
    const sumX  = points.reduce((s, p) => s + p.x, 0);
    const sumY  = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    const slope     = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    return { slope, intercept };
}

// ── Vehicle name point-label plugin ──────────────────────────────────────────

const pointLabelPlugin = {
    id: 'pointLabels',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        // Last dataset is the trend line — skip it
        const vehicleDatasets = chart.data.datasets.length - 1;
        for (let di = 0; di < vehicleDatasets; di++) {
            const pts = chart.getDatasetMeta(di).data;
            if (!pts.length) continue;
            const pt = pts[0];
            ctx.save();
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = '#6b7280';
            ctx.textBaseline = 'middle';
            const x = pt.x + 10;
            const y = pt.y;
            const maxW = chart.chartArea.right - x - 4;
            if (maxW > 20) {
                let text = chart.data.datasets[di].label;
                while (text.length > 1 && ctx.measureText(text).width > maxW) {
                    text = text.slice(0, -1);
                }
                if (text !== chart.data.datasets[di].label) text += '…';
                ctx.fillText(text, x, y);
            }
            ctx.restore();
        }
    },
};

// ── SpecsScatterView ──────────────────────────────────────────────────────────

export default function SpecsScatterView({ vehicles, xField: xProp, yField: yProp, onFieldChange }) {
    const { units } = useAppContext();

    const vehicleFields = useMemo(() => makeVehicleFields(units), [units]);
    const fieldGroups   = useMemo(() => buildFieldGroups(vehicles, vehicleFields), [vehicles, vehicleFields]);

    // Numeric-only field groups (scatter only makes sense for numeric data)
    const numericGroups = useMemo(() =>
        fieldGroups
            .map(g => ({ ...g, fields: g.fields.filter(f => f.type === 'number' || f.type === 'integer') }))
            .filter(g => g.fields.length > 0),
        [fieldGroups],
    );
    const allNumericFields = useMemo(() => numericGroups.flatMap(g => g.fields), [numericGroups]);

    const [localX, setLocalX] = useState('');
    const [localY, setLocalY] = useState('');
    const [copiedUrl, setCopiedUrl] = useState(false);

    const xField = xProp || localX;
    const yField = yProp || localY;

    const setFields = (x, y) => {
        setLocalX(x);
        setLocalY(y);
        onFieldChange?.(x, y);
    };

    // Auto-select first two numeric fields that have data
    useEffect(() => {
        if (xField && yField) return;
        const withData = allNumericFields.filter(f =>
            vehicles.some(v => {
                const val = extractValue(v, f.key);
                return val !== null && val !== undefined && val !== '';
            }),
        );
        const newX = xField || withData[0]?.key || '';
        const newY = yField || withData[1]?.key || withData[0]?.key || '';
        if (newX !== xField || newY !== yField) setFields(newX, newY);
    }, [allNumericFields, vehicles]); // eslint-disable-line react-hooks/exhaustive-deps

    const canvasRef = useRef(null);
    const chartRef  = useRef(null);

    useEffect(() => {
        if (!xField || !yField || !canvasRef.current || !vehicles.length) return;

        const xDef = allNumericFields.find(f => f.key === xField) || getFieldDef(xField, vehicleFields);
        const yDef = allNumericFields.find(f => f.key === yField) || getFieldDef(yField, vehicleFields);

        const xLabel = allNumericFields.find(f => f.key === xField)?.label || xField;
        const yLabel = allNumericFields.find(f => f.key === yField)?.label || yField;

        // Convert raw values to display values
        const toNum = (raw, def) => {
            if (raw === null || raw === undefined || raw === '') return null;
            const n = parseFloat(String(raw));
            if (isNaN(n)) return null;
            return def.unitGroup ? convValue(n, def.unitGroup, units) : n;
        };

        const formatVal = (raw, def) => {
            if (raw === null || raw === undefined || raw === '') return '—';
            if (def.unitGroup) return formatSpecValue(raw, def.unitGroup, units);
            return formatNumericLabel(parseFloat(String(raw)));
        };

        // Build per-vehicle datasets (one point each)
        const vehicleDatasets = vehicles.map((v, i) => {
            const rawX = extractValue(v, xField);
            const rawY = extractValue(v, yField);
            const numX = toNum(rawX, xDef);
            const numY = toNum(rawY, yDef);
            const color = vehicleColor(v, i);
            return {
                label:           v.name,
                data:            numX != null && numY != null ? [{ x: numX, y: numY }] : [],
                backgroundColor: color,
                borderColor:     color,
                pointRadius:     8,
                pointHoverRadius: 11,
                // Store raw values for tooltip
                _rawX: rawX,
                _rawY: rawY,
            };
        });

        // Compute trend line across all vehicles that have both values
        const scatterPts = vehicleDatasets
            .filter(ds => ds.data.length > 0)
            .map(ds => ds.data[0]);

        const reg = linearRegression(scatterPts);
        let trendData = [];
        if (reg && scatterPts.length >= 2) {
            const xVals = scatterPts.map(p => p.x);
            const xMin  = Math.min(...xVals);
            const xMax  = Math.max(...xVals);
            trendData = [
                { x: xMin, y: reg.slope * xMin + reg.intercept },
                { x: xMax, y: reg.slope * xMax + reg.intercept },
            ];
        }

        const trendDataset = {
            label:       'Trend',
            data:        trendData,
            type:        'line',
            borderColor: 'rgba(156,163,175,0.6)',
            borderWidth: 1.5,
            borderDash:  [5, 4],
            pointRadius: 0,
            fill:        false,
            tension:     0,
        };

        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }

        chartRef.current = new Chart(canvasRef.current, {
            type: 'scatter',
            data: { datasets: [...vehicleDatasets, trendDataset] },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            boxWidth: 10,
                            padding: 10,
                            filter: item => item.text !== 'Trend',
                        },
                    },
                    tooltip: {
                        filter: item => item.dataset.label !== 'Trend',
                        callbacks: {
                            title: ctx => ctx[0]?.dataset.label || '',
                            label: ctx => {
                                const ds = ctx.dataset;
                                return [
                                    `${xLabel}: ${formatVal(ds._rawX, xDef)}`,
                                    `${yLabel}: ${formatVal(ds._rawY, yDef)}`,
                                ];
                            },
                        },
                    },
                },
                scales: {
                    x: { title: { display: true, text: xLabel, font: { size: 12 } } },
                    y: { title: { display: true, text: yLabel, font: { size: 12 } } },
                },
            },
            plugins: [pointLabelPlugin],
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [xField, yField, vehicles, allNumericFields, vehicleFields, units]);

    return (
        <div className="specs-chart-card">
            <div className="specs-chart-controls">
                <label className="text-sm font-medium text-gray-600">X-Axis:</label>
                <select
                    className="specs-chart-field-select"
                    value={xField}
                    onChange={e => setFields(e.target.value, yField)}
                >
                    {numericGroups.map(group => (
                        <optgroup key={group.groupLabel} label={group.groupLabel}>
                            {group.fields.map(f => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>

                <label className="text-sm font-medium text-gray-600 ml-3">Y-Axis:</label>
                <select
                    className="specs-chart-field-select"
                    value={yField}
                    onChange={e => setFields(xField, e.target.value)}
                >
                    {numericGroups.map(group => (
                        <optgroup key={group.groupLabel} label={group.groupLabel}>
                            {group.fields.map(f => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </div>

            <div style={{ height: `${Math.max(400, vehicles.length * 40)}px`, position: 'relative' }}>
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
