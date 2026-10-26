import { useEffect, useRef, useState, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { useTheme } from '../hooks/useTheme';
import { chartTheme, chartFonts, applyChartDefaults } from '../utils/chartTheme';
import { fieldFigureSource, epaCreditsForFields } from '../utils/vehicleFigures';
import { axisTitle, betterNote, missingNote } from '../utils/specChart';
import ChartInfoBubble from './ChartInfoBubble';
import PlotFrame from './charts/PlotFrame';
import { useChartPng } from '../hooks/useChartPng';
import { useSourceLine } from '../hooks/useSourceLine';
import { buildVehicleLabels } from '../utils/seriesLabel';
import FeatureChartButton from './home/FeatureChartButton';

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
        const fonts = chartFonts();
        // Last dataset is the trend line — skip it
        const vehicleDatasets = chart.data.datasets.length - 1;
        for (let di = 0; di < vehicleDatasets; di++) {
            const pts = chart.getDatasetMeta(di).data;
            if (!pts.length) continue;
            const pt = pts[0];
            ctx.save();
            ctx.font = `${fonts.badge}px ${fonts.sans}`;
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

/**
 * Two numeric columns of the vehicle table against each other, one point per
 * selected vehicle (#450). The container (SpecChart) works the figures out from
 * the table's rows; a vehicle missing either one is not drawn and is counted.
 *
 * Props:
 *   xPlot, yPlot  {object}  plotValues() of each column
 *   xCol, yCol    {object}  the table columns, labelled
 *   colorOf       {(vehicleId) => string}
 *   units         {string}
 */
export default function SpecsScatterView({ xPlot, yPlot, xCol, yCol, colorOf, units, scope = 'selection', presentationMode = false }) {
    const { isDark } = useTheme();
    const [copiedUrl, setCopiedUrl] = useState(false);

    // A point needs both axes: the vehicles that have an X and a Y.
    const pairs = useMemo(() => {
        const yById = new Map(yPlot.points.map(p => [p.row.id, p]));
        return xPlot.points
            .filter(p => yById.has(p.row.id))
            .map(x => ({ x, y: yById.get(x.row.id) }));
    }, [xPlot, yPlot]);
    const total = xPlot.total;
    const plottedVehicles = useMemo(() => pairs.map(p => p.x.row.vehicle), [pairs]);

    const canvasRef = useRef(null);
    const chartRef  = useRef(null);

    const xLabel = axisTitle(xCol, units);
    const yLabel = axisTitle(yCol, units);

    useEffect(() => {
        if (!canvasRef.current || !pairs.length) return;

        // From the stylesheet, not retyped here — see utils/chartTheme.
        const { tick: tickColor, grid: gridColor, legend: legendColor } = chartTheme();
        const fonts = applyChartDefaults(Chart);

        // Build per-vehicle datasets (one point each)
        const vehicleNames = buildVehicleLabels(plottedVehicles);
        const basis = (source) => (source ? ` (${source.basis})` : '');
        const vehicleDatasets = pairs.map(({ x, y }) => {
            const v = x.row.vehicle;
            const color = colorOf(v.id);
            return {
                label:           vehicleNames.get(v.id)?.short ?? x.row.values.name,
                data:            [{ x: x.value, y: y.value }],
                backgroundColor: color,
                borderColor:     color,
                pointRadius:     8,
                pointHoverRadius: 11,
                _textX: x.text,
                _textY: y.text,
                // Resolved figures name their source (#323, #324); null otherwise.
                _sourceX: fieldFigureSource(v, xCol.key, units),
                _sourceY: fieldFigureSource(v, yCol.key, units),
                _manufacturer: v.manufacturer?.name ?? null,
                _year: v.year ?? null,
            };
        });

        // Compute trend line across all vehicles that have both values
        const scatterPts = vehicleDatasets.map(ds => ds.data[0]);

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
                    // Off: every point is already labeled and a whole-database
                    // selection makes the legend dozens of rows tall.
                    legend: { display: false },
                    tooltip: {
                        filter: item => item.dataset.label !== 'Trend',
                        callbacks: {
                            title: ctx => {
                                const ds = ctx[0]?.dataset;
                                if (!ds) return '';
                                const parts = [ds._manufacturer, ds._year, ds.label].filter(Boolean);
                                return parts.join(' · ');
                            },
                            label: ctx => {
                                const ds = ctx.dataset;
                                return [
                                    `${xCol.label}: ${ds._textX}${basis(ds._sourceX)}`,
                                    `${yCol.label}: ${ds._textY}${basis(ds._sourceY)}`,
                                ];
                            },
                        },
                    },
                },
                scales: {
                    x: { title: { display: true, text: xLabel, font: { size: fonts.label }, color: legendColor }, ticks: { color: tickColor }, grid: { color: gridColor } },
                    y: { title: { display: true, text: yLabel, font: { size: fonts.label }, color: legendColor }, ticks: { color: tickColor }, grid: { color: gridColor } },
                },
            },
            plugins: [pointLabelPlugin],
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [pairs, plottedVehicles, xCol, yCol, xLabel, yLabel, colorOf, units, isDark]);

    // ── The frame's caption, and its export ─────────────────────────────────
    // Both axes lived in <select>s above the canvas and the export flattened
    // the canvas alone, so a pasted scatter was a cloud of dots with tick
    // numbers and no statement of what was plotted against what.
    const plotTitle = `${yCol.label} vs ${xCol.label}`;

    // Units only: the vehicle count is visible on the chart (#443). Which way
    // is better, for each axis that has a best.
    const plotSubtitle = [
        units === 'metric' ? 'metric' : 'imperial',
        ...[['X', xCol], ['Y', yCol]].map(([axis, c]) => betterNote(c) && `${axis}: ${betterNote(c)}`),
    ].filter(Boolean).join(' · ');

    // Spec values are the manufacturer's; EPA is credited when a plotted
    // column is an EPA-resolved figure.
    const sourceEpa = useMemo(() => epaCreditsForFields(plottedVehicles, [xCol.key, yCol.key]), [plottedVehicles, xCol.key, yCol.key]);
    const sourceLine = useSourceLine({ epa: sourceEpa });

    const { copyPng, copied: imageCopied, preview, dismissPreview } =
        useChartPng(chartRef, { title: plotTitle, subtitle: plotSubtitle, sources: sourceLine.text,
            signature: pairs.map(p => p.x.row.id).join(',') });

    const dropped = missingNote(total - pairs.length, total, scope);

    return (
        <>
        <PlotFrame
            title={plotTitle}
            subtitle={plotSubtitle}
            sourceLine={sourceLine}
            preview={preview}
            onDismissPreview={dismissPreview}
            exportControls={!presentationMode && (
                <>
                    <FeatureChartButton />
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
                        onClick={copyPng}
                        className={`chart-copy-btn ${imageCopied ? 'chart-copy-btn-active' : ''}`}
                        title="Copy the framed chart as a PNG"
                    >
                        {imageCopied ? '✓ Copied' : 'PNG'}
                    </button>
                </>
            )}
        >
            <div className="spec-chart-canvas is-scatter">
                <canvas ref={canvasRef} />
            </div>
        </PlotFrame>
        {dropped && <p className="text-note spec-chart-dropped">{dropped}</p>}
        {!presentationMode && <ChartInfoBubble chartKey="specscatter" />}
        </>
    );
}
