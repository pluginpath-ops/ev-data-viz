/**
 * The week day by day, as bars (utils/dayBars.js), in percent of the battery.
 *
 * Owner, 2026-11-07, from the mockups: A3 the default, A behind the toggle —
 *  - `day` (A3), in time order: a gray bar for the day out, from the
 *    morning's level (the tick) to where the car gets home; each fast stop on
 *    the route inside it at the levels it charged between, striped orange over
 *    the gray since it happened during the drive; a planned fast charge solid
 *    orange; then the night at home in the series color, up to the next
 *    morning, where a dashed line hands over to the next day.
 *  - `balance` (A): charge in above zero (fast stops striped, a planned
 *    charge solid, the night at home), driving below.
 *
 * Chart.js floating bars in a PlotFrame, so it has the PNG capture, the link
 * button and the source line every chart here has. The stops in `day` are
 * drawn by the plugin over the day's bar, since two can share one bar.
 *
 * A dashed tick on each night's bar is the night's home ceiling (owner,
 * 2026-11-11): the most the plug-in window could have added at full power,
 * so the gap above the bar is the charger's margin. In `day` it stands on
 * where the car got home, in `balance` on the charge already in. Off the plot
 * it is pinned to the top edge with an arrow (utils/ceilingMark.js).
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
import { stripedFill } from '../../utils/stripedFill';
import { drawCeilingMarks, ceilingLegend } from '../../utils/ceilingMark';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
const NO_SOURCES = {};
const pctText = (v) => `${Math.round(v)}%`;
const DRIVE = withAlpha(SERIES_NEUTRAL, 0.75);

/** A fast stop on the route: orange stripes over the driving's gray. */
const routeStopFill = (callout) => stripedFill(DRIVE, callout);

/** The datasets, [low, high] per day. `legendOnly` ones carry no bars: the plugin draws them. */
function datasetsOf(bars, view, { color, callout, striped }) {
    if (view === 'day') {
        return [
            {
                label: 'The day out, morning to home', key: 'out', stack: 'out',
                backgroundColor: DRIVE, borderWidth: 0,
                data: bars.map(b => (b.miles > 0 ? [Math.min(b.start, b.arrive), Math.max(b.start, b.arrive)] : null)),
            },
            { label: 'Fast stop (during the drive)', key: 'fast', legendOnly: true, stack: 'out', backgroundColor: striped, data: bars.map(() => null) },
            { label: 'Planned fast charge', key: 'planned', legendOnly: true, stack: 'out', backgroundColor: callout, data: bars.map(() => null) },
            {
                label: 'Home overnight, to the next morning', key: 'home', stack: 'home',
                backgroundColor: color, borderWidth: 0,
                data: bars.map(b => (b.next > b.arrive + 0.05 ? [b.arrive, b.next] : null)),
            },
        ];
    }
    // Charge in, stacked from zero: fast stops, then the planned charge, then the night.
    const charge = (key, label, fill) => ({
        label, key, stack: 'day', backgroundColor: fill, borderWidth: 0,
        data: bars.map(b => {
            const base = (key === 'fast' ? 0 : b.fast) + (key === 'home' ? b.planned : 0);
            return b[key] > 0.05 ? [base, base + b[key]] : null;
        }),
    });
    return [
        charge('fast', 'Fast stops', striped),
        charge('planned', 'Planned fast charge', callout),
        charge('home', 'Home charging', color),
        {
            label: 'Used driving', key: 'used', stack: 'day', backgroundColor: DRIVE, borderWidth: 0,
            data: bars.map(b => (b.used > 0.05 ? [-b.used, 0] : null)),
        },
    ];
}

/**
 * Marks over the bars. In `day`: each stop inside the day's bar, a tick at
 * the morning's level, and a dashed hand-over to the next day. In both: the
 * fast minutes over each day.
 */
const dayMarks = (bars, view, fills) => ({
    id: 'dayMarks',
    afterDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { x, y } } = chart;
        const { ink, tick, callout } = chartTheme();
        const fonts = chartFonts();
        const metas = chart.data.datasets.map((d, i) => ({ key: d.key, meta: chart.getDatasetMeta(i) }));
        const slot = (key, i) => {
            const e = metas.find(m => m.key === key)?.meta.data[i];
            return e && Number.isFinite(e.x) && e.width ? [e.x - e.width / 2, e.x + e.width / 2] : null;
        };
        // A day's columns, left to right, from whichever slots it has.
        const span = (i) => {
            const s = ['out', 'home', 'fast', 'planned', 'used'].map(k => slot(k, i)).filter(Boolean);
            if (!s.length) { const c = x.getPixelForValue(i); return [c - 10, c + 10]; }
            return [Math.min(...s.map(r => r[0])), Math.max(...s.map(r => r[1]))];
        };
        ctx.save();
        if (view === 'day') {
            bars.forEach((b, i) => {
                // A day off has no day-out bar: its slot is the one left of the night's.
                const home = slot('home', i);
                const out = slot('out', i) ?? (home ? [2 * home[0] - home[1] - 2, home[0] - 2] : span(i));
                const [l, r] = out;
                // The stops: side by side when a day has two.
                const n = b.stopBands.length;
                b.stopBands.forEach((st, k) => {
                    const w = (r - l - (n - 1) * 2) / n;
                    const x0 = l + k * (w + 2);
                    const top = y.getPixelForValue(st.to), bottom = y.getPixelForValue(st.from);
                    ctx.fillStyle = st.planned ? callout : fills.striped;
                    ctx.fillRect(x0, top, w, bottom - top);
                });
                // The morning's level, across the day's bar.
                ctx.setLineDash([]);
                ctx.strokeStyle = ink;
                ctx.lineWidth = 2;
                const ys = y.getPixelForValue(b.start);
                ctx.beginPath(); ctx.moveTo(l - 4, ys); ctx.lineTo(r + 2, ys); ctx.stroke();
                // Tomorrow picks up where tonight left the battery.
                if (i < bars.length - 1) {
                    const [, hr] = slot('home', i) ?? out;
                    const [nl] = slot('out', i + 1) ?? span(i + 1);
                    const yn = y.getPixelForValue(b.next);
                    ctx.strokeStyle = tick;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath(); ctx.moveTo(hr, yn); ctx.lineTo(nl - 4, yn); ctx.stroke();
                }
            });
        }
        ctx.setLineDash([]);
        ctx.textAlign = 'center';
        ctx.font = `600 ${fonts.badge}px ${fonts.mono}`;
        bars.forEach((b, i) => {
            const [l, r] = span(i);
            const top = view === 'day'
                ? Math.max(b.start, b.next, ...b.stopBands.map(s => s.to))
                : b.fast + b.planned + b.home;
            ctx.fillStyle = b.minutes > 0.5 ? callout : tick;
            ctx.fillText(b.minutes > 0.5 ? `${Math.round(b.minutes)}m fast` : 'home only',
                (l + r) / 2, Math.max(a.top + fonts.badge, y.getPixelForValue(top) - 6));
        });
        ctx.restore();
        // The home ceiling over each night's bar, stood on where the night starts.
        const marks = [];
        bars.forEach((b, i) => {
            const home = slot('home', i);
            if (!home || !(b.mostAdd > 0)) return;
            const base = view === 'day' ? b.arrive : b.fast + b.planned;
            marks.push({ x: (home[0] + home[1]) / 2, half: (home[1] - home[0]) / 2 + 2, value: base + b.mostAdd });
        });
        drawCeilingMarks(chart, marks);
    },
});

/**
 * @param {Object} week                 simulateWeek's answer
 * @param {'day'|'balance'} view        A3 or A
 * @param {string} color                the vehicle's series color, for home charging
 * @param {{runs, allRuns, epa}} [sources]  what the week was priced from (useSourceLine)
 */
export default function DayBarsChart({
    week, view = 'day', color, title, subtitle, sources = NO_SOURCES, signature,
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
        const day = view === 'day';
        const fills = { striped: routeStopFill(theme.callout) };
        const ceil20 = (v) => Math.ceil(v / 20) * 20;
        const max = day ? 100 : Math.max(40, ceil20(Math.max(...bars.map(b => Math.max(b.fast + b.planned + b.home, b.used))) + 8));
        const ceilingKey = ceilingLegend(Chart, {
            // Only what this week has: a stop kind with no stops leaves the legend.
            keep: (item, data) => {
                const ds = data.datasets[item.datasetIndex];
                if (!ds.legendOnly) return ds.data.some(Boolean);
                return bars.some(b => b.stopBands.some(s => s.planned === (ds.key === 'planned')));
            },
            // No home charging, or no night charged: no ceiling drawn, no key.
            text: bars.some(b => b.mostAdd > 0 && b.home > 0.05) ? 'Most a night could add' : null,
        });
        chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
            type: 'bar',
            data: {
                labels: bars.map(b => [b.day, b.type === 'O' ? 'Off' : `${TYPE_NAMES[b.type]} · ${b.miles} mi`]),
                datasets: datasetsOf(bars, view, { color, callout: theme.callout, striped: fills.striped }),
            },
            plugins: [dayMarks(bars, view, fills)],
            options: {
                // Room over the plot for a ceiling's arrow.
                layout: { padding: { top: 14 } },
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                datasets: { bar: { categoryPercentage: 0.62, barPercentage: 0.92 } },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: theme.legend, boxWidth: 12, usePointStyle: true, generateLabels: ceilingKey.generateLabels },
                        onClick: ceilingKey.onClick,
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const b = bars[items[0]?.dataIndex];
                                return b ? `${b.day} · starts at ${pctText(b.start)}` : '';
                            },
                            label: (ctx) => {
                                const b = bars[ctx.dataIndex];
                                switch (ctx.dataset.key) {
                                case 'out': return `The day out: ${pctText(b.start)} → home at ${pctText(b.arrive)} (driving used ${pctText(b.used)})`;
                                case 'home': {
                                    const most = b.mostAdd > 0 ? ` (most it could add: ${pctText(b.mostAdd)})` : '';
                                    return day ? `Home overnight: +${pctText(b.home)}, to ${pctText(b.next)} next morning${most}` : `Home: +${pctText(b.home)}${most}`;
                                }
                                case 'used': return `Driving: −${pctText(b.used)}`;
                                default: return `${ctx.dataset.label}: +${pctText(b[ctx.dataset.key])}`;
                                }
                            },
                            afterBody: (items) => {
                                const b = bars[items[0]?.dataIndex];
                                if (!b?.stops) return '';
                                return b.stopBands.map(s => `${s.planned ? 'Planned fast charge' : 'Fast stop'}: ${pctText(s.from)} → ${pctText(s.to)}, ${minutesText(s.minutes)}`)
                                    .concat(`${dollars(b.cost)} fast`);
                            },
                        },
                    },
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: theme.tick, maxRotation: 0 } },
                    y: {
                        stacked: false,
                        min: day ? 0 : -max, max,
                        title: { display: true, text: day ? 'Battery (%)' : 'Charge in ↑ · used driving ↓ (% of the battery)', color: theme.legend },
                        ticks: { color: theme.tick, stepSize: 20, callback: (v) => (day || v <= 0 ? `${v}%` : `+${v}%`) },
                        grid: { color: (c) => (c.tick?.value === 0 && !day ? theme.axis : theme.grid) },
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
