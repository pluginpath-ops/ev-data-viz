/**
 * A week as a line: range left over the 168 hours from Monday 0:00, with the
 * stops drawn as bands where they happen. The Weekly Charging Plan draws three
 * of these — the car's week, the comparison below it, and the gas car's — so
 * the chart is one component and each is the same Chart.js chart in the same
 * PlotFrame, with the PNG capture and source line every chart here has.
 *
 * Owner, 2026-11-07: range in miles on the left, the battery's percent on the
 * right, and a dashed line at 10% and at 80% where the battery's everyday
 * range ends. Those two were fades over 0–10% and 80–100% until the owner
 * found them distracting (2026-11-07).
 */
import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { WEEKDAYS } from '../../constants/costToDrive';
import { withAlpha } from '../../utils/colorUtils';
import { chartTheme, chartFonts, applyChartDefaults } from '../../utils/chartTheme';
import { weekTimeText } from '../../utils/costToDrive';
import { useChartPng } from '../../hooks/useChartPng';
import { useTheme } from '../../hooks/useTheme';
import { useSourceLine } from '../../hooks/useSourceLine';
import PlotFrame from '../charts/PlotFrame';
import CopyLinkButton from '../charts/CopyLinkButton';
import PngButton from '../charts/PngButton';

const WEEK_HOURS = 7 * 24;
/** The gas car's week is the reader's own figures: nothing to credit. */
const NO_SOURCES = {};

/**
 * Marks over the plot: plug-in windows (a quiet vertical shading a night, its
 * last part, after the charger finished, a shade darker: the spare time —
 * owner, 2026-11-11), stops (vertical bands, over their minutes) and guides
 * (horizontal dashed lines at left-axis values), the guides drawn after the
 * line so they read across it.
 */
const weekMarks = ({ stops, guides, windows }) => ({
    id: 'weekMarks',
    beforeDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { x } } = chart;
        const { callout, ink, tick } = chartTheme();
        const fonts = chartFonts();
        ctx.save();
        ctx.fillStyle = tick;
        for (const w of windows) {
            const x0 = x.getPixelForValue(w.from), x1 = x.getPixelForValue(w.to), xs = x.getPixelForValue(w.spareFrom);
            ctx.globalAlpha = 0.08;
            ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
            ctx.fillRect(xs, a.top, x1 - xs, a.bottom - a.top);
        }
        ctx.globalAlpha = 1;
        for (const s of stops) {
            const x0 = x.getPixelForValue(s.from);
            // A stop is minutes long, a hairline at this scale; a few pixels so it shows.
            const x1 = Math.max(x.getPixelForValue(s.to), x0 + 4);
            ctx.globalAlpha = s.planned ? 0.18 : 0.3;
            ctx.fillStyle = callout;
            ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
            ctx.globalAlpha = 1;
            if (s.label) {
                ctx.font = `600 ${fonts.badge}px ${fonts.mono}`;
                ctx.fillStyle = ink;
                ctx.textAlign = 'center';
                ctx.fillText(s.label, (x0 + x1) / 2, a.top + fonts.badge + 2);
            }
        }
        ctx.restore();
    },
    afterDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { y } } = chart;
        const { tick } = chartTheme();
        ctx.save();
        ctx.strokeStyle = tick;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (const v of guides) {
            const py = Math.round(y.getPixelForValue(v)) + 0.5;
            ctx.beginPath();
            ctx.moveTo(a.left, py);
            ctx.lineTo(a.right, py);
            ctx.stroke();
        }
        ctx.restore();
    },
});

/**
 * @param {Array<[number, number]>} points  [hour of the week, value on the left axis]
 * @param {number} max                      the left axis's top (a full battery or tank)
 * @param {string} yLabel                   the left axis's title
 * @param {(v: number) => string} format    a left-axis value as the tooltip says it
 * @param {(v: number) => string} [right]   a left-axis value on the right axis ("46%")
 * @param {Array<{from, to, label?, planned?}>} [stops]  bands, in hours of the week
 * @param {Array<{from, to, spareFrom}>} [windows]  each night's plug-in window, in hours of the week (plugWindows)
 * @param {number[]} [guides]             left-axis values drawn as dashed lines
 * @param {string} color                    the series color
 * @param {{runs, allRuns, epa}} [sources]  what the line was priced from, for its source line (useSourceLine)
 */
export default function WeekLineChart({
    points, max, yLabel, format, right = null, stops = [], windows = [], guides = [], color,
    title, subtitle, sources = NO_SOURCES, signature, presentationMode = false, height = '340px', linkButton = false,
}) {
    const sourceLine = useSourceLine(sources);
    const canvasRef = useRef(null);
    const chartRef = useRef(null);
    const { isDark } = useTheme();
    const redraw = `${signature}|${color}|${isDark}|${max}`;

    useEffect(() => {
        if (!canvasRef.current) return undefined;
        applyChartDefaults(Chart);
        const { tick, grid, legend } = chartTheme();
        chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
            type: 'line',
            data: {
                datasets: [{
                    data: points.map(([x, y]) => ({ x, y })),
                    borderColor: color,
                    backgroundColor: withAlpha(color, 0.12),
                    fill: 'origin',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0,
                }],
            },
            plugins: [weekMarks({ stops, guides, windows })],
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        callbacks: {
                            title: (items) => items.length ? weekTimeText(items[0].parsed.x) : '',
                            label: (ctx) => [format(ctx.parsed.y), right?.(ctx.parsed.y)].filter(Boolean).join(' · '),
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear', min: 0, max: WEEK_HOURS,
                        // Day names in the middle of each day, lines at midnight.
                        ticks: { stepSize: 12, autoSkip: false, maxRotation: 0, color: tick,
                            callback: (v) => (v % 24 === 12 ? WEEKDAYS[Math.floor(v / 24)] : '') },
                        grid: { color: (c) => (c.tick?.value % 24 === 0 ? grid : 'transparent') },
                    },
                    y: {
                        min: 0, max,
                        title: { display: true, text: yLabel, color: legend },
                        ticks: { color: tick },
                        grid: { color: grid },
                    },
                    ...(right ? {
                        y2: {
                            position: 'right', min: 0, max,
                            ticks: { color: tick, stepSize: max / 5, callback: (v) => right(v) },
                            grid: { display: false },
                        },
                    } : {}),
                },
            },
        });
        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [redraw]); // eslint-disable-line react-hooks/exhaustive-deps -- `redraw` names everything the chart is built from

    const png = useChartPng(chartRef, { title, subtitle, sources: sourceLine.text, signature });
    return (
        <PlotFrame
            title={title}
            subtitle={subtitle}
            sourceLine={sourceLine}
            preview={png.preview}
            onDismissPreview={png.dismissPreview}
            exportControls={!presentationMode && (
                <>
                    {linkButton && <CopyLinkButton />}
                    <PngButton png={png} />
                </>
            )}
        >
            <div style={{ height, position: 'relative' }}>
                <canvas ref={canvasRef} />
            </div>
        </PlotFrame>
    );
}
