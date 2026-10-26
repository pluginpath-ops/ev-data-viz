import { useEffect, useRef, useMemo, useState } from 'react';
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

// ── Inside-bar label afterDraw plugin ─────────────────────────────────────────

function makeInsideLabelPlugin(getLabelFn) {
    return {
        id: 'insideBarLabels',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            const fonts = chartFonts();
            chart.data.datasets.forEach((_, di) => {
                chart.getDatasetMeta(di).data.forEach((bar, bi) => {
                    const text = getLabelFn(bi);
                    if (!text || text === '—') return;
                    // Horizontal bars: bar.x = right edge, bar.base = left edge, bar.y = center
                    const barLen = Math.abs(bar.x - bar.base);
                    if (barLen < 20) return;
                    ctx.save();
                    ctx.font = `600 ${fonts.label}px ${fonts.sans}`;
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

/**
 * One column of the vehicle table across the selected vehicles, as bars (#450).
 *
 * A numeric column draws bars with a length. A text or yes/no column has no
 * length, so every vehicle gets the same bar with its value printed inside —
 * the display the owner has not yet named (docs/vocabulary.md, Open names),
 * called `text` here.
 *
 * The figures are the table's own: the container (SpecChart) hands over
 * `plot` already worked out from the table's rows, in the reader's units.
 *
 * Props:
 *   plot     {object}  plotValues() of the column: { kind, points, missing, total }
 *   col      {object}  the table column, labelled
 *   colorOf  {(vehicleId) => string}  the vehicle's series color
 *   units    {string}
 */
export default function SpecsChartView({ plot, col, colorOf, units, scope = 'selection', presentationMode = false }) {
    const { isDark } = useTheme();
    const [copiedUrl, setCopiedUrl] = useState(false);
    const canvasRef = useRef(null);
    const chartRef  = useRef(null);

    const plottedVehicles = useMemo(() => plot.points.map(p => p.row.vehicle), [plot]);

    useEffect(() => {
        if (!canvasRef.current || !plot.points.length) return;

        // From the stylesheet, not retyped here — see utils/chartTheme.
        const { tick: tickColor, grid: gridColor } = chartTheme();
        const fonts = applyChartDefaults(Chart);

        const names  = buildVehicleLabels(plottedVehicles);
        const labels = plot.points.map(p => names.get(p.row.id)?.short ?? p.row.values.name);
        const colors = plot.points.map(p => colorOf(p.row.id));
        const numeric = plot.kind === 'numeric';

        // Battery and EPA range are resolved per vehicle, so two bars can be
        // different kinds of figure (#323, #324). Said on the bar, which is
        // what a PNG export keeps.
        const sourceOf = (p) => fieldFigureSource(p.row.vehicle, col.key, units);
        const insideLabels = plot.points.map(p => {
            const source = numeric ? sourceOf(p) : null;
            return source ? `${p.text} · ${source.basis}` : p.text;
        });

        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }

        chartRef.current = new Chart(canvasRef.current, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: col.label,
                    data: numeric ? plot.points.map(p => p.value) : plot.points.map(() => 1),
                    backgroundColor: colors,
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
                                const p = plot.points[ctx.dataIndex];
                                const source = sourceOf(p);
                                const lines = [p.text];
                                if (source) lines.push(source.line);
                                else if (p.note) lines.push(p.note);
                                return lines;
                            },
                        },
                    },
                },
                scales: {
                    x: numeric
                        ? { display: true, beginAtZero: true, ticks: { color: tickColor }, grid: { color: gridColor } }
                        : { display: false, max: 1.15 },
                    y: {
                        grid: { display: false },
                        ticks: { font: { size: fonts.axis }, color: tickColor },
                    },
                },
            },
            plugins: [makeInsideLabelPlugin(i => insideLabels[i])],
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [plot, col, colorOf, units, isDark, plottedVehicles]);

    // ── The frame's caption, and its export ─────────────────────────────────
    // The chart answered "which vehicle has the most of X" without ever saying
    // what X was: the field name lived in a <select> above the canvas, and the
    // export flattened the canvas alone, so a pasted image was a row of bars
    // with vehicle names and no measure.
    const plotTitle = axisTitle(col, units);

    // Units, and which way is better where the column has a best. The vehicle
    // count is visible on the chart (#443).
    const plotSubtitle = [units === 'metric' ? 'metric' : 'imperial', betterNote(col)].filter(Boolean).join(' · ');

    // Spec values are the manufacturer's; EPA is credited when the plotted
    // column is an EPA-resolved figure.
    const sourceEpa = useMemo(() => epaCreditsForFields(plottedVehicles, [col.key]), [plottedVehicles, col.key]);
    const sourceLine = useSourceLine({ epa: sourceEpa });

    const { copyPng, copied: imageCopied, preview, dismissPreview } =
        useChartPng(chartRef, { title: plotTitle, subtitle: plotSubtitle, sources: sourceLine.text,
            signature: plot.points.map(p => p.row.id).join(',') });

    const dropped = missingNote(plot.missing, plot.total, scope);

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
            <div className="spec-chart-canvas" style={{ height: `${Math.max(220, plot.points.length * 52)}px` }}>
                <canvas ref={canvasRef} />
            </div>
        </PlotFrame>
        {dropped && <p className="text-note spec-chart-dropped">{dropped}</p>}
        {!presentationMode && <ChartInfoBubble chartKey="specs" />}
        </>
    );
}
