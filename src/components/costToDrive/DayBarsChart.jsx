/**
 * The week day by day, as bars (utils/dayBars.js), in percent of the battery.
 *
 * Owner, 2026-11-07, from the mockups (A the default since 2026-11-16) —
 *  - `day` (A3), in time order: a gray bar for the day out, from the
 *    morning's level (the tick) to where the car gets home; each fast stop on
 *    the route inside it at the levels it charged between, striped orange over
 *    the gray since it happened during the drive; a planned fast charge solid
 *    orange; then the night at home in the series color, up to the next
 *    morning, where a dashed line hands over to the next day.
 *  - `balance` (A): charge in above zero (the night at home, then fast stops
 *    striped and a planned charge solid on top), driving below; under it, on its own
 *    shorter axis, the battery's level hour by hour across the same days
 *    (owner, 2026-11-16: the default, the line beneath the bars sharing the
 *    x-axis). One chart with two stacked y-axes, so one PNG holds both; the
 *    line sits on a hidden hourly x-axis (0–168) that spans the same width as
 *    the days, a day's noon under its bars.
 *
 * Chart.js floating bars in a PlotFrame, so it has the PNG capture, the link
 * button and the source line every chart here has. The stops in `day` are
 * drawn by the plugin over the day's bar, since two can share one bar.
 *
 * In `day`, a dashed tick on each night's bar is the night's home ceiling
 * (owner, 2026-11-11): the most the plug-in window could have added at full
 * power, stood on where the car got home, so the gap above the bar is the
 * charger's margin. Off the plot it is pinned to the top edge with an arrow
 * (utils/ceilingMark.js). `balance` drops it (owner, 2026-11-17).
 */
import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { withAlpha, SERIES_NEUTRAL } from '../../utils/colorUtils';
import { chartTheme, chartFonts, applyChartDefaults } from '../../utils/chartTheme';
import { dayBars, dayParts } from '../../utils/dayBars';
import { minutesText, chargingTiers, homeTierOrder, tierWord } from '../../utils/costToDrive';
import { drawTierShading } from '../../utils/tierShading';
import { useChartPng } from '../../hooks/useChartPng';
import { useChartReadout } from '../../hooks/useChartReadout';
import { useTheme } from '../../hooks/useTheme';
import { useSourceLine } from '../../hooks/useSourceLine';
import PlotFrame from '../charts/PlotFrame';
import CopyLinkButton from '../charts/CopyLinkButton';
import PngButton from '../charts/PngButton';
import { stripedFill, homeTierFill } from '../../utils/stripedFill';
import { drawCeilingMarks, ceilingLegend } from '../../utils/ceilingMark';

const TYPE_NAMES = { D: 'Daily', L: 'Long day', O: 'Off' };
const NO_SOURCES = {};
const pctText = (v) => `${Math.round(v)}%`;
const DRIVE = withAlpha(SERIES_NEUTRAL, 0.75);
const DRIVING_LABEL = 'Daily driving battery use';
const HOME_LABEL = 'Energy added charging at home';
/** Where the everyday battery range ends, dashed on the battery's level. */
const SOC_GUIDES = [10, 80];

/** A fast stop on the route: orange stripes over the driving's gray. */
const routeStopFill = (callout) => stripedFill(DRIVE, callout);

/**
 * The home charge's parts, bottom up: the whole night at One price; on a
 * time-of-use plan the base tier first, then each dearer one (owner,
 * 2026-11-17: the base plain, the dearer striped and named).
 */
const homePart = (b, t) => (t == null ? b.home : b.homeTiers?.[t] ?? 0);

/** The night's home charge as one dataset per part, stacked from `from(b)`. */
function homeDatasets(bars, { color, theme, tiers, stack, from, yAxisID }) {
    const order = homeTierOrder(tiers);
    return order.map((t, k) => ({
        label: k === 0 ? HOME_LABEL : `Home, ${tierWord(tiers, t)}`,
        key: k === 0 ? 'home' : `home-${t}`,
        stack, ...(yAxisID ? { yAxisID } : {}),
        backgroundColor: homeTierFill(color, t, tiers?.base, theme), borderWidth: 0,
        data: bars.map(b => {
            const lo = from(b) + order.slice(0, k).reduce((a, u) => a + homePart(b, u), 0);
            const v = homePart(b, t);
            return v > 0.05 ? [lo, lo + v] : null;
        }),
    }));
}

/** The datasets, [low, high] per day. `legendOnly` ones carry no bars: the plugin draws them. */
function datasetsOf(bars, view, { color, callout, striped, week, theme }) {
    const tiers = week.rateTiers;
    if (view === 'day') {
        return [
            {
                label: DRIVING_LABEL, key: 'out', stack: 'out',
                backgroundColor: DRIVE, borderWidth: 0,
                data: bars.map(b => (b.miles > 0 ? [Math.min(b.start, b.arrive), Math.max(b.start, b.arrive)] : null)),
            },
            { label: 'Fast stop (during the drive)', key: 'fast', legendOnly: true, stack: 'out', backgroundColor: striped, data: bars.map(() => null) },
            { label: 'Planned fast charge', key: 'planned', legendOnly: true, stack: 'out', backgroundColor: callout, data: bars.map(() => null) },
            ...homeDatasets(bars, { color, theme, tiers, stack: 'home', from: b => b.arrive }),
        ];
    }
    // Charge in, stacked from zero: the night at home, then fast stops, then the
    // planned charge on top (owner, 2026-11-17).
    // The bars name `y`: unnamed, Chart.js takes the first y scale, the battery's.
    const charge = (key, label, fill) => ({
        label, key, stack: 'day', yAxisID: 'y', backgroundColor: fill, borderWidth: 0,
        data: bars.map(b => {
            const base = b.home + (key === 'planned' ? b.fast : 0);
            return b[key] > 0.05 ? [base, base + b[key]] : null;
        }),
    });
    return [
        ...homeDatasets(bars, { color, theme, tiers, stack: 'day', yAxisID: 'y', from: () => 0 }),
        charge('fast', 'Fast stops', striped),
        charge('planned', 'Planned fast charge', callout),
        {
            label: DRIVING_LABEL, key: 'used', stack: 'day', yAxisID: 'y', backgroundColor: DRIVE, borderWidth: 0,
            data: bars.map(b => (b.used > 0.05 ? [-b.used, 0] : null)),
        },
        {
            type: 'line', label: 'State of charge', key: 'soc', xAxisID: 'xh', yAxisID: 'ySoc',
            data: week.points.map(([x, y]) => ({ x, y })),
            borderColor: color, backgroundColor: withAlpha(color, 0.12), fill: 'origin',
            borderWidth: 2, pointRadius: 0, tension: 0,
        },
    ];
}

/** The battery's level under the bars: each night's plug-in window shaded (dearer tiers tinted), and the 10% and 80% guides. */
const socMarks = (week) => ({
    id: 'socMarks',
    beforeDatasetsDraw(chart) {
        const { ctx, scales: { xh, ySoc } } = chart;
        if (!xh || !ySoc) return;
        const theme = chartTheme();
        const { tick } = theme;
        ctx.save();
        ctx.fillStyle = tick;
        ctx.globalAlpha = 0.08;
        // 0–100% only: the axis is padded past both ends, a gap between the plots.
        const top = ySoc.getPixelForValue(100), bottom = ySoc.getPixelForValue(0);
        for (const w of week.windows) {
            const x0 = xh.getPixelForValue(w.from), x1 = xh.getPixelForValue(w.to);
            ctx.fillRect(x0, top, x1 - x0, bottom - top);
        }
        drawTierShading(ctx, xh, top, bottom, chargingTiers(week), theme);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = tick;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (const v of SOC_GUIDES) {
            const py = Math.round(ySoc.getPixelForValue(v)) + 0.5;
            ctx.beginPath(); ctx.moveTo(xh.left, py); ctx.lineTo(xh.right, py); ctx.stroke();
        }
        ctx.restore();
    },
});

/**
 * Marks over the bars. In `day`: each stop inside the day's bar, a tick at
 * the morning's level, and a dashed hand-over to the next day. In both: the
 * fast minutes over each day that has any.
 */
const dayMarks = (bars, view, fills, tiers) => ({
    id: 'dayMarks',
    afterDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { x, y } } = chart;
        const { ink, tick, callout } = chartTheme();
        const fonts = chartFonts();
        const metas = chart.data.datasets.map((d, i) => ({ key: d.key, meta: chart.getDatasetMeta(i) }));
        // A dataset's bar on day `i`; 'home' is the night's, whichever tier part it has.
        const slot = (key, i) => {
            for (const m of metas) {
                if (m.key !== key && !(key === 'home' && m.key?.startsWith('home-'))) continue;
                const e = m.meta.data[i];
                if (e && Number.isFinite(e.x) && e.width) return [e.x - e.width / 2, e.x + e.width / 2];
            }
            return null;
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
        // Over each day: the dearest tier its night used above the base
        // ("peak", else "off-peak"; both read as clutter — owner, 2026-11-17),
        // and above that its fast minutes. A day with neither says nothing.
        bars.forEach((b, i) => {
            const dearest = tiers && b.homeTiers
                ? [0, 1].find(t => t < tiers.base && b.homeTiers[t] > 0.05) : undefined;
            const lines = [
                b.minutes > 0.5 && { text: `${Math.round(b.minutes)}m fast`, color: callout },
                dearest != null && { text: tierWord(tiers, dearest), color: ink },
            ].filter(Boolean);
            if (!lines.length) return;
            const [l, r] = span(i);
            const top = view === 'day'
                ? Math.max(b.start, b.next, ...b.stopBands.map(s => s.to))
                : b.fast + b.planned + b.home;
            const y0 = Math.max(a.top + fonts.badge * lines.length, y.getPixelForValue(top) - 6);
            lines.forEach((ln, k) => {
                ctx.fillStyle = ln.color;
                ctx.fillText(ln.text, (l + r) / 2, y0 - (lines.length - 1 - k) * (fonts.badge + 3));
            });
        });
        ctx.restore();
        // The home ceiling over each night's bar, stood on where the car got
        // home. `day` only: in `balance` it read as clutter (owner, 2026-11-17).
        if (view !== 'day') return;
        const marks = [];
        bars.forEach((b, i) => {
            const home = slot('home', i);
            if (!home || !(b.mostAdd > 0)) return;
            marks.push({ x: (home[0] + home[1]) / 2, half: (home[1] - home[0]) / 2 + 2, value: b.arrive + b.mostAdd });
        });
        drawCeilingMarks(chart, marks);
    },
});

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const signedPct = (v) => `${v < 0 ? '−' : '+'}${Math.round(Math.abs(v))}%`;
const cents = (v) => `$${(v ?? 0).toFixed(2)}`;
/** A striped part's swatch in the readout, as CSS: the canvas fill cannot go in the DOM. */
const stripeCss = (base, stripe) => `repeating-linear-gradient(135deg, ${base} 0 3px, ${stripe} 3px 6px)`;

/** How a part looks in the readout: its color, CSS swatch, and canvas fill for the PNG. */
function partLook(p, { color, theme, tiers, fills }) {
    if (p.kind === 'home') {
        if (p.tier == null || p.tier === tiers.base) return { color };
        const ink = p.tier === 0 ? theme.danger : theme.tick;
        return { color: ink, swatch: stripeCss(color, ink), fill: homeTierFill(color, p.tier, tiers.base, theme) };
    }
    if (p.kind === 'fast') return { color: theme.callout, swatch: stripeCss(DRIVE, theme.callout), fill: fills.striped };
    if (p.kind === 'planned') return { color: theme.callout };
    if (p.kind === 'drive') return { color: DRIVE };
    return { color };
}

/**
 * The day under the cursor, in the readout every curve chart has
 * (useChartReadout): one row per part of its bars, each with its % of the
 * battery and its cost, then the battery from morning to morning (owner,
 * 2026-11-17). Click fixes it, and a fixed one goes in the PNG.
 */
function readoutConfig({ bars, view, tiers, color, theme, fills }) {
    return {
        step: 1,
        title: (x) => {
            const b = bars[x];
            if (!b) return '';
            return `${FULL_DAYS[x]} · net ${signedPct(b.next - b.start)} · ${cents((b.homeCost ?? 0) + b.cost)}`;
        },
        subtitle: 'Charge in and used, % of the battery',
        rowsAt: (chart, x) => {
            const i = Math.round(x);
            const b = bars[i];
            if (!b) return null;
            const { y, ySoc } = chart.scales;
            const rows = dayParts(b, view, tiers).map(p => ({
                key: p.key, part: p, interpolated: false,
                pixelY: p.range ? y.getPixelForValue((p.range[0] + p.range[1]) / 2) : (ySoc ?? y).getPixelForValue(b.next),
                ...partLook(p, { color, theme, tiers, fills }),
            }));
            return { x: i, rows };
        },
        describe: ({ part: p }, { x }) => {
            const b = bars[x];
            switch (p.kind) {
            case 'home': return {
                name: p.name, value: signedPct(p.pct), companion: cents(p.cost),
                detail: [
                    p.kwh > 0 && `${p.kwh.toFixed(1)} kWh at the wall, ${Math.round(p.cost / p.kwh * 100)}¢/kWh`,
                    p.warmKwh > 0.05 && `${p.warmKwh.toFixed(1)} kWh of it warming the battery`,
                    b.mostAdd > 0 && `Most the night could add: ${pctText(b.mostAdd)}`,
                ].filter(Boolean),
            };
            case 'fast':
            case 'planned': return {
                name: p.name, value: signedPct(p.pct), companion: `${minutesText(p.minutes)} · ${cents(p.cost)}`,
                detail: b.stopBands.filter(st => st.planned === (p.kind === 'planned'))
                    .map(st => `${pctText(st.from)} → ${pctText(st.to)}, ${minutesText(st.minutes)}`),
            };
            case 'drive': return { name: p.name, value: signedPct(p.pct), companion: `${p.miles} mi` };
            default: return { name: p.name, value: `${pctText(b.start)} → ${pctText(b.next)}`, companion: `home at ${pctText(b.arrive)}` };
            }
        },
    };
}

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
    const readout = useChartReadout();
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
                if (ds.key === 'soc') return false;   // the line under its own "Battery (%)" axis needs no key
                if (!ds.legendOnly) return ds.data.some(Boolean);
                return bars.some(b => b.stopBands.some(s => s.planned === (ds.key === 'planned')));
            },
            // `day` only, and only with a night charged: no ceiling drawn, no key.
            text: day && bars.some(b => b.mostAdd > 0 && b.home > 0.05) ? 'Maximum possible daily charging' : null,
        });
        chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
            type: 'bar',
            data: {
                labels: bars.map(b => [b.day, b.type === 'O' ? 'Off' : `${TYPE_NAMES[b.type]} · ${b.miles} mi`]),
                datasets: datasetsOf(bars, view, { color, callout: theme.callout, striped: fills.striped, week, theme }),
            },
            plugins: [
                ...(day ? [] : [socMarks(week)]),
                dayMarks(bars, view, fills, week.rateTiers),
                readout.plugin(readoutConfig({ bars, view, tiers: week.rateTiers, color, theme, fills })),
            ],
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
                    // The day's readout (below) in its place: the box the Range and
                    // Charging charts have, with each part's cost (owner, 2026-11-17).
                    tooltip: { enabled: false },
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { color: theme.tick, maxRotation: 0 } },
                    ...(day ? {} : {
                        // The battery's level, under the bars on its own shorter axis.
                        // Listed before `y`: a stack is laid out bottom up.
                        ySoc: {
                            stack: 'plan', stackWeight: 1.2, offset: true, min: 0, max: 100,
                            title: { display: true, text: 'Battery (%)', color: theme.legend },
                            ticks: { color: theme.tick, stepSize: 50, callback: (v) => `${v}%` },
                            grid: { color: theme.grid },
                        },
                        // Hours of the week, spanning the same width as the seven days
                        // (no bar offset: a day's noon under its bars).
                        xh: { type: 'linear', min: 0, max: 7 * 24, offset: false, display: false },
                    }),
                    y: {
                        stacked: false,
                        min: day ? 0 : -max, max,
                        title: { display: true, text: day ? 'Battery (%)' : 'Charge in ↑ · used ↓ (%)', color: theme.legend },
                        ticks: { color: theme.tick, stepSize: 20, callback: (v) => (day || v <= 0 ? `${v}%` : `+${v}%`) },
                        grid: { color: (c) => (c.tick?.value === 0 && !day ? theme.axis : theme.grid) },
                        ...(day ? {} : { stack: 'plan', stackWeight: 3 }),
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
            <div className="chart-readout-host" style={{ height }}>
                <canvas ref={canvasRef} />
                {readout.overlay}
            </div>
        </PlotFrame>
    );
}
