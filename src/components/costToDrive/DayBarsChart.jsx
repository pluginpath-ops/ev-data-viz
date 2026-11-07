/**
 * The week day by day, as bars (utils/dayBars.js): the charge each day put in,
 * split into fast stops, the planned fast charge and the night at home, and
 * what its driving used, in percent of the battery.
 *
 * Owner, 2026-11-07: "Build A2", with A behind a toggle —
 *  - `morning` (A2): each day starts at that morning's level (the tick), the
 *    charge rises from it, and the driving falls from there to the next
 *    morning's level, where a dashed line hands over to the next day. Charge
 *    is stacked before the driving it came during or after, so a column can
 *    pass 100%; that part is faded, as the line chart fades its ends.
 *  - `balance` (A): charge in above zero, driving below.
 *
 * Chart.js floating bars in a PlotFrame, so it has the PNG capture, the link
 * button and the source line every chart here has.
 */
import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { withAlpha, SERIES_NEUTRAL } from '../../utils/colorUtils';
import { chartTheme, chartFonts, applyChartDefaults } from '../../utils/chartTheme';
import { dayBars } from '../../utils/dayBars';
import { dollars, minutesText } from '../../utils/costToDrive';
import { useChartPng } from '../../hooks/useChartPng';
import { useTheme } from '../../hooks/useTheme';
import { useSourceLine } from '../../hooks/useSourceLine';
import PlotFrame from '../charts/PlotFrame';
import CopyLinkButton from '../charts/CopyLinkButton';
import PngButton from '../charts/PngButton';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
const NO_SOURCES = {};
const pctText = (v) => `${Math.round(v)}%`;

/** The datasets: [low, high] per day, so one shape serves both readings. */
function datasetsOf(bars, view, { color, callout }) {
    const morning = view === 'morning';
    const charge = (key, label, fill, border) => ({
        label,
        key,
        stack: 'in',
        backgroundColor: fill,
        borderColor: border ?? fill,
        borderWidth: border ? 1.5 : 0,
        data: bars.map(b => {
            // Fast stops first (they happen in the day), then planned, then the night.
            const base = (morning ? b.start : 0)
                + (key === 'fast' ? 0 : b.fast)
                + (key === 'home' ? b.planned : 0);
            return b[key] > 0.05 ? [base, base + b[key]] : null;
        }),
    });
    return [
        charge('fast', 'Fast stops', callout),
        charge('planned', 'Planned fast charge', withAlpha(callout, 0.4), callout),
        charge('home', 'Home charging', color),
        {
            label: morning ? 'Driving, down to the next morning' : 'Used driving',
            key: 'used',
            stack: morning ? 'out' : 'in',
            backgroundColor: withAlpha(SERIES_NEUTRAL, 0.75),
            borderWidth: 0,
            data: bars.map(b => (b.used > 0.05 ? (morning ? [b.next, b.top] : [-b.used, 0]) : null)),
        },
    ];
}

/**
 * Marks over the bars: in `morning`, a tick at each morning's level, a dashed
 * hand-over to the next day, and everything past a full battery faded; in
 * both, the fast minutes over each day.
 */
const dayMarks = (bars, view) => ({
    id: 'dayMarks',
    afterDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { x, y } } = chart;
        const { ink, tick, background, callout, axis } = chartTheme();
        const fonts = chartFonts();
        const metas = chart.data.datasets.map((_, i) => chart.getDatasetMeta(i));
        // Each day's columns, from whichever datasets drew there.
        const span = (i) => {
            const els = metas.map(m => m.data[i]).filter(e => e && !e.skip && Number.isFinite(e.x) && e.width);
            if (!els.length) { const c = x.getPixelForValue(i); return [c - 10, c + 10]; }
            return [Math.min(...els.map(e => e.x - e.width / 2)), Math.max(...els.map(e => e.x + e.width / 2))];
        };
        ctx.save();
        if (view === 'morning') {
            const full = y.getPixelForValue(100);
            if (full > a.top) {
                ctx.globalAlpha = 0.6;
                ctx.fillStyle = background;
                ctx.fillRect(a.left, a.top, a.right - a.left, full - a.top);
                ctx.globalAlpha = 1;
                ctx.strokeStyle = axis;
                ctx.setLineDash([4, 3]);
                ctx.beginPath(); ctx.moveTo(a.left, full); ctx.lineTo(a.right, full); ctx.stroke();
            }
            bars.forEach((b, i) => {
                const [l, r] = span(i);
                ctx.setLineDash([]);
                ctx.strokeStyle = ink;
                ctx.lineWidth = 2;
                const ys = y.getPixelForValue(b.start);
                ctx.beginPath(); ctx.moveTo(l - 4, ys); ctx.lineTo(r + 4, ys); ctx.stroke();
                if (i < bars.length - 1) {
                    const [nl] = span(i + 1);
                    const yn = y.getPixelForValue(b.next);
                    ctx.strokeStyle = tick;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath(); ctx.moveTo(r, yn); ctx.lineTo(nl - 4, yn); ctx.stroke();
                }
            });
        }
        ctx.setLineDash([]);
        ctx.textAlign = 'center';
        ctx.font = `600 ${fonts.badge}px ${fonts.mono}`;
        bars.forEach((b, i) => {
            const [l, r] = span(i);
            const top = view === 'morning' ? Math.max(b.top, b.start) : b.fast + b.planned + b.home;
            ctx.fillStyle = b.minutes > 0.5 ? callout : tick;
            ctx.fillText(b.minutes > 0.5 ? `${Math.round(b.minutes)}m fast` : 'home only',
                (l + r) / 2, Math.max(a.top + fonts.badge, y.getPixelForValue(top) - 6));
        });
        ctx.restore();
    },
});

/**
 * @param {Object} week                 simulateWeek's answer
 * @param {'morning'|'balance'} view    A2 or A
 * @param {string} color                the vehicle's series color, for home charging
 * @param {{runs, allRuns, epa}} [sources]  what the week was priced from (useSourceLine)
 */
export default function DayBarsChart({
    week, view = 'morning', color, title, subtitle, sources = NO_SOURCES, signature,
    presentationMode = false, height = '340px', linkButton = false,
}) {
    const sourceLine = useSourceLine(sources);
    const canvasRef = useRef(null);
    const chartRef = useRef(null);
    const { isDark } = useTheme();
    const redraw = `${signature}|${view}|${color}|${isDark}`;

    useEffect(() => {
        if (!canvasRef.current) return undefined;
        applyChartDefaults(Chart);
        const theme = chartTheme();
        const bars = dayBars(week);
        const morning = view === 'morning';
        const topOf = morning ? Math.max(...bars.map(b => b.top)) : Math.max(...bars.map(b => b.fast + b.planned + b.home));
        const ceil20 = (v) => Math.ceil(v / 20) * 20;
        const max = morning ? Math.max(100, ceil20(topOf + 8)) : Math.max(40, ceil20(Math.max(topOf, ...bars.map(b => b.used)) + 8));
        chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
            type: 'bar',
            data: {
                labels: bars.map(b => [b.day, b.type === 'O' ? 'Off' : `${TYPE_NAMES[b.type]} · ${b.miles} mi`]),
                datasets: datasetsOf(bars, view, { color, callout: theme.callout }),
            },
            plugins: [dayMarks(bars, view)],
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                datasets: { bar: { categoryPercentage: 0.62, barPercentage: 0.92 } },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: theme.legend, boxWidth: 12,
                            // A dataset with nothing this week leaves the legend.
                            filter: (item, data) => data.datasets[item.datasetIndex].data.some(Boolean),
                        },
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const b = bars[items[0]?.dataIndex];
                                return b ? `${b.day} · starts at ${pctText(b.start)}` : '';
                            },
                            label: (ctx) => {
                                const b = bars[ctx.dataIndex];
                                const key = ctx.dataset.key;
                                if (key === 'used') return `Driving: −${pctText(b.used)}${morning ? `, to ${pctText(b.next)} next morning` : ''}`;
                                if (key === 'home') return `Home: +${pctText(b.home)}`;
                                return `${ctx.dataset.label}: +${pctText(b[key])}`;
                            },
                            afterBody: (items) => {
                                const b = bars[items[0]?.dataIndex];
                                return b && b.stops ? `${b.stops} fast stop${b.stops === 1 ? '' : 's'} · ${minutesText(b.minutes)} · ${dollars(b.cost)}` : '';
                            },
                        },
                    },
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: theme.tick, maxRotation: 0 } },
                    y: {
                        stacked: false,
                        min: morning ? 0 : -max, max,
                        title: { display: true, text: morning ? 'Battery (%)' : 'Charge in ↑ · used driving ↓ (% of the battery)', color: theme.legend },
                        ticks: { color: theme.tick, stepSize: 20, callback: (v) => (morning || v <= 0 ? `${v}%` : `+${v}%`) },
                        grid: { color: (c) => (c.tick?.value === 0 && !morning ? theme.axis : theme.grid) },
                    },
                },
            },
        });
        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [redraw]); // eslint-disable-line react-hooks/exhaustive-deps -- `redraw` names everything the chart is built from

    const png = useChartPng(chartRef, { title, subtitle, sources: sourceLine.text, signature: `${signature}|${view}` });
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
