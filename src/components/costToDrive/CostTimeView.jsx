/**
 * Compare — the selected vehicles against the reader's gas car (mode
 * `drivecost`, docs/cost-to-drive-plan.md).
 *
 * A card per car with the two answers (what it saves a month, the time it costs
 * a month) and the stops behind them, then the same two as bar charts: cost per
 * month, home and fast charging stacked, and time per month, fast charging against
 * fill-ups. Both charts are Chart.js in a PlotFrame, so the PNG capture, the
 * copy-link button (which carries the Cost to Drive key) and the source line
 * work here exactly as on every other chart.
 */
import { useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { vehicleLabel } from '../../utils/specHelpers';
import { filterRangeRuns } from '../../utils/runUtils';
import { withAlpha, SERIES_NEUTRAL } from '../../utils/colorUtils';
import { chartTheme, chartFonts, applyChartDefaults } from '../../utils/chartTheme';
import { PRESENTED_HALF_HEIGHT } from '../../utils/presentedHeight';
import {
    dollars, minutesText, savedText, perMonth, weekSummary,
} from '../../utils/costToDrive';
import { HOME_LEVELS } from '../../constants/costToDrive';
import { useCostToDrive } from '../../hooks/useCostToDrive';
import { useTheme } from '../../hooks/useTheme';
import { useChartPng } from '../../hooks/useChartPng';
import { useSourceLine } from '../../hooks/useSourceLine';
import PlotFrame from '../charts/PlotFrame';
import CopyLinkButton from '../charts/CopyLinkButton';
import ChartInfoBubble from '../ChartInfoBubble';
import CostToDriveSidebar from './CostToDriveSidebar';
import { levelLabel } from './HomeLevelPicker';

const GAS_LABEL = 'Your gas car';

/**
 * Everything on this tab is a month (owner, 2026-11-07): the simulated week ×
 * 52 ÷ 12, as the cost always was. Stops round to whole ones.
 */
/** "13 fast stops a month · 4 h 51 min · $100 fast", or that home charging covers it. */
function stopLine(week) {
    if (week.stopCount === 0) return 'No fast stops: home charging covers the month';
    const n = Math.max(1, Math.round(perMonth(week.stopCount)));
    return `About ${n} fast stop${n === 1 ? '' : 's'} a month · ${minutesText(perMonth(week.fastMinutes))} · ${dollars(perMonth(week.fastCost))} fast`;
}

/** Extra time a month against the gas car: "+2 h 58 min/mo", "−52 min/mo". */
const extraMonthText = (extraPerWeek) => `${extraPerWeek >= 0 ? '+' : '−'}${minutesText(perMonth(extraPerWeek))}/mo`;

/** One car's answer, above the charts. */
function CostTimeCard({ entry, settings }) {
    const { vehicle, color, comparison: c } = entry;
    return (
        <section className="drive-result">
            <div className="flex items-center gap-2 min-w-0">
                {/* The vehicle's series color: a runtime value, so inline. */}
                <span className="drive-dot" style={{ backgroundColor: color }} aria-hidden="true" />
                <h3 className="section-title truncate">{vehicleLabel(vehicle)}</h3>
            </div>
            <div className="drive-result-figures">
                <span className={`drive-figure ${c.monthly.saved >= 0 ? 'is-saving' : 'is-costing'}`}>{savedText(c.monthly.saved)}</span>
                {/* Less time than the gas car is a saving, green like money saved. */}
                <span className={`drive-figure ${c.extraMinutesPerWeek < 0 ? 'is-saving' : 'is-time'}`}>{extraMonthText(c.extraMinutesPerWeek)}</span>
            </div>
            <span className="text-secondary">{stopLine(c.week)}</span>
            <span className="text-note">
                {dollars(c.monthly.ev)}/mo to charge against {dollars(c.monthly.gas)}/mo in gas, in {settings.season}.
                Over a year, {dollars(c.yearly.saved)} {c.yearly.saved >= 0 ? 'less' : 'more'}.
            </span>
        </section>
    );
}

/** A horizontal bar chart on a canvas, rebuilt when its data changes. */
function useBarChart(canvasRef, instanceRef, build, deps) {
    useEffect(() => {
        if (!canvasRef.current) return undefined;
        applyChartDefaults(Chart);
        const config = build();
        if (!config) return undefined;
        instanceRef.current = new Chart(canvasRef.current.getContext('2d'), config);
        return () => { instanceRef.current?.destroy(); instanceRef.current = null; };
    }, deps); // eslint-disable-line react-hooks/exhaustive-deps -- `build` is rebuilt each render; deps name what it reads
}

/** Draws each row's total past the end of its bar: "$231", "1 h 8 min". */
const totalLabels = (totals, format) => ({
    id: 'driveTotals',
    afterDatasetsDraw(chart) {
        const { ctx, scales: { x, y } } = chart;
        const { ink } = chartTheme();
        const fonts = chartFonts();
        ctx.save();
        ctx.font = `600 ${fonts.label}px ${fonts.mono}`;
        ctx.fillStyle = ink;
        ctx.textBaseline = 'middle';
        totals.forEach((t, i) => {
            if (t == null) return;
            ctx.fillText(format(t), x.getPixelForValue(t) + 6, y.getPixelForValue(i));
        });
        ctx.restore();
    },
});

function barOptions({ stacked, xTitle, totals, tooltipLabel }) {
    const { tick, grid, legend } = chartTheme();
    const max = Math.max(1, ...totals.filter(t => t != null));
    return {
        indexAxis: 'y',
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 8 } },
        plugins: {
            legend: { display: stacked, position: 'bottom', labels: { color: legend, boxWidth: 12 } },
            tooltip: { callbacks: { label: tooltipLabel } },
        },
        scales: {
            // Room past the longest bar for its total.
            x: { stacked, beginAtZero: true, suggestedMax: max * 1.18, title: { display: true, text: xTitle, color: legend }, ticks: { color: tick }, grid: { color: grid } },
            y: { stacked, grid: { display: false }, ticks: { color: tick } },
        },
    };
}

export default function CostTimeView({ vehicles, selectedVehicleIds, settings, onChange, onOpenSetup, presentationMode = false }) {
    const priced = useCostToDrive(vehicles, selectedVehicleIds, settings);
    const shown = useMemo(() => priced.filter(p => !p.missing), [priced]);
    const missing = priced.filter(p => p.missing);
    const gas = shown[0]?.comparison.gas ?? null;

    const costRef = useRef(null), costChart = useRef(null);
    const timeRef = useRef(null), timeChart = useRef(null);

    const labels = [...shown.map(p => vehicleLabel(p.vehicle)), GAS_LABEL];
    // What is plotted, for the PNG preview's staleness check; with the theme and
    // the series colors, what the charts are rebuilt on.
    const signature = `${labels.join('|')}|${JSON.stringify(settings)}`;
    const { isDark } = useTheme();
    const redraw = `${signature}|${shown.map(p => p.color).join(',')}|${isDark}`;

    // Cost per month: home and fast charging stacked per car, the gas car beside.
    const costTotals = [...shown.map(p => p.comparison.monthly.ev), gas ? perMonth(gas.cost) : null];
    useBarChart(costRef, costChart, () => {
        if (!shown.length) return null;
        const pad = (arr) => [...arr, null];
        return {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Home charging', data: pad(shown.map(p => perMonth(p.comparison.week.homeCost))), backgroundColor: pad(shown.map(p => p.color)) },
                    { label: 'Fast charging', data: pad(shown.map(p => perMonth(p.comparison.week.fastCost))), backgroundColor: pad(shown.map(p => withAlpha(p.color, 0.45))) },
                    { label: 'Gas', data: [...shown.map(() => null), perMonth(gas.cost)], backgroundColor: SERIES_NEUTRAL },
                ],
            },
            plugins: [totalLabels(costTotals, dollars)],
            options: barOptions({
                stacked: true, xTitle: '$ per month', totals: costTotals,
                tooltipLabel: (ctx) => ctx.raw == null ? null : `${ctx.dataset.label}: ${dollars(ctx.raw)}/mo`,
            }),
        };
    }, [redraw]);

    // Time per month: fast-charging minutes per car against fill-ups, the
    // simulated week scaled to a month like the cost (owner, 2026-11-07).
    const timeTotals = [...shown.map(p => perMonth(p.comparison.week.fastMinutes)), gas ? perMonth(gas.minutesPerWeek) : null];
    useBarChart(timeRef, timeChart, () => {
        if (!shown.length) return null;
        return {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Minutes per month',
                    data: timeTotals,
                    backgroundColor: [...shown.map(p => p.color), SERIES_NEUTRAL],
                }],
            },
            plugins: [totalLabels(timeTotals, minutesText)],
            options: barOptions({
                stacked: false, xTitle: 'Minutes per month', totals: timeTotals,
                tooltipLabel: (ctx) => {
                    const p = shown[ctx.dataIndex];
                    if (!p) return `${perMonth(gas.fillsPerWeek).toFixed(1)} fill-ups a month · ${minutesText(ctx.raw)}`;
                    return `${perMonth(p.comparison.week.stopCount).toFixed(1)} fast stops a month · ${minutesText(ctx.raw)}`;
                },
            }),
        };
    }, [redraw]);

    // What the figures came from: the range tests a tested car was priced by,
    // its charging curve, and the EPA label for the rest.
    const allRuns = useMemo(() => vehicles.flatMap(v => v.runs ?? []), [vehicles]);
    const sourceRuns = useMemo(() => shown.flatMap(p => [
        ...(p.profile.highwayFrom === 'tested' ? filterRangeRuns(p.vehicle.runs ?? []) : []),
        ...(p.profile.fast?.run ? [p.profile.fast.run] : []),
    ]), [shown]);
    const usesEpa = shown.some(p => p.profile.highwayFrom === 'epa' || p.profile.cityFrom === 'epa');
    const sourceLine = useSourceLine({ runs: sourceRuns, allRuns, epa: { label: usesEpa } });

    const season = settings.season === 'winter' ? `Winter, ${settings.winterF}°F` : `Summer, ${settings.summerF}°F`;
    const subtitle = `${weekSummary(settings)} · ${season} · home ${levelLabel(HOME_LEVELS[settings.level])}`;
    const costTitle = 'Cost per month, against your gas car';
    const timeTitle = 'Time per month: fast charging against fill-ups';
    const costPng = useChartPng(costChart, { title: costTitle, subtitle, sources: sourceLine.text, signature });
    const timePng = useChartPng(timeChart, { title: timeTitle, subtitle, sources: sourceLine.text, signature });

    const height = presentationMode ? PRESENTED_HALF_HEIGHT : `${Math.max(180, labels.length * 52 + 70)}px`;
    const pngButton = (png) => (
        <button type="button" onClick={png.copyPng}
                className={`chart-copy-btn ${png.copied ? 'chart-copy-btn-active' : ''}`}
                title="Copy the framed chart as a PNG">
            {png.copied ? '✓ Copied' : 'PNG'}
        </button>
    );

    return (
        <div className="chart-layout">
            {!presentationMode && <CostToDriveSidebar settings={settings} onChange={onChange} onOpenSetup={onOpenSetup} />}
            <div className="chart-main">
                {missing.length > 0 && (
                    <p className="text-note drive-missing">
                        Can&rsquo;t price {missing.map(p => `${vehicleLabel(p.vehicle)} (${p.missing})`).join('; ')}.
                    </p>
                )}
                {shown.length > 0 && (
                    <>
                        <PlotFrame
                            title={costTitle}
                            subtitle={subtitle}
                            sourceLine={sourceLine}
                            preview={costPng.preview}
                            onDismissPreview={costPng.dismissPreview}
                            exportControls={!presentationMode && (<><CopyLinkButton />{pngButton(costPng)}</>)}
                        >
                            <div style={{ height, position: 'relative' }}>
                                <canvas ref={costRef} />
                            </div>
                        </PlotFrame>
                        <div className="mt-4">
                            <PlotFrame
                                title={timeTitle}
                                subtitle={subtitle}
                                sourceLine={sourceLine}
                                preview={timePng.preview}
                                onDismissPreview={timePng.dismissPreview}
                                exportControls={!presentationMode && pngButton(timePng)}
                            >
                                <div style={{ height, position: 'relative' }}>
                                    <canvas ref={timeRef} />
                                </div>
                            </PlotFrame>
                        </div>
                    </>
                )}
                {/* Chart first, then the cards (owner, 2026-11-07: "we're a chart-first site"). */}
                {!presentationMode && shown.length > 0 && (
                    <div className="drive-results mt-4">
                        {shown.map(p => <CostTimeCard key={p.vehicle.id} entry={p} settings={settings} />)}
                    </div>
                )}
                {!presentationMode && <ChartInfoBubble chartKey="drivecost" />}
            </div>
        </div>
    );
}
