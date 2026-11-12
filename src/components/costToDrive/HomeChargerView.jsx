/**
 * Home Charger — each home charger level against each selected vehicle (mode
 * `drivecharger`, docs/cost-to-drive-plan.md): what the reader's driving costs a month at
 * every level, home and fast charging stacked in one column a car (owner,
 * 2026-11-07), and how many minutes of fast charging it takes, where a bigger charger stops helping ("enough
 * from here"), and where the car's own onboard charger caps it.
 *
 * Two charts of the same figures, a [Cost | Time] switch above the plot: the
 * cost per month (the default), and the minutes of fast charging per month, a
 * column a car, which the cost chart replaced on 2026-11-07 and which comes back
 * beside it. Time is only the fast part: home charging is overnight, not time
 * the reader spends. The choice is `chartConfig.homeChargerChart`, so a link and
 * the pop-out draw the chart the sender saw (utils/chartUrlState.js, `hc`).
 *
 * Every other setting is the reader's; only the level moves. The chart is
 * Chart.js in a PlotFrame (image capture, Link button, source line), the table the
 * shared table parts.
 */
import { useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { vehicleLabel } from '../../utils/specHelpers';
import { fastChargingFill } from '../../utils/stripedFill';
import { filterRangeRuns } from '../../utils/runUtils';
import { chartTheme, chartFonts, applyChartDefaults } from '../../utils/chartTheme';
import { drawCeilingMarks, ceilingLegend } from '../../utils/ceilingMark';
import { PRESENTED_HALF_HEIGHT } from '../../utils/presentedHeight';
import { dollars, minutesText, perMonth, percentText, weekSummary, enoughLevel, chargingText, homeCostCeiling } from '../../utils/costToDrive';
import { useCostToDriveByLevel } from '../../hooks/useCostToDrive';
import { useChartPng } from '../../hooks/useChartPng';
import { useSourceLine } from '../../hooks/useSourceLine';
import { useTheme } from '../../hooks/useTheme';
import PlotFrame from '../charts/PlotFrame';
import CopyLinkButton from '../charts/CopyLinkButton';
import PngButton from '../charts/PngButton';
import ChartInfoBubble from '../ChartInfoBubble';
import SortHeader from '../tables/SortHeader';
import TableCell from '../tables/TableCell';
import CostToDriveSidebar from './CostToDriveSidebar';
import { levelLabel } from './HomeLevelPicker';
import { HOME_LEVEL_ORDER, WALL_OUTLET_CHARGER_EFF } from '../../constants/costToDrive';
import { ASSUMED_CHARGER_EFF } from '../../constants/epa';
import { hourText } from './DriveFields';
import PackWarmingNote from './PackWarmingNote';

const DASH = '—';
const kwText = (kw) => `${Math.round(kw * 10) / 10} kW`;

/**
 * The total cost per month over each car's column (owner, 2026-11-07). The
 * column is two bars stacked, home under fast, so the label goes over the
 * top one: `isTop(dataset)` picks it, `totalOf(level, dataset)` gives the
 * figure, null draws nothing. Where the column has fast charging, the home
 * part carries its own figure too (`homeOf`, null where there is no fast
 * charging): one label for a column that is all home, two where it is split.
 */
const totalLabels = (isTop, totalOf, homeOf, format = dollars) => ({
    id: 'totalLabels',
    afterDatasetsDraw(chart) {
        const { ctx, chartArea: a } = chart;
        const { ink, background } = chartTheme();
        const fonts = chartFonts();
        ctx.save();
        ctx.font = `600 ${fonts.badge}px ${fonts.mono}`;
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        // A figure over a column sits on the panel, where a home ceiling's
        // dashed line can run through it: an outline in the panel's color
        // keeps it legible. (Not the home figure inside a bar: there the
        // outline would box it.)
        const overPanel = (text, x, y) => {
            ctx.save();
            ctx.lineJoin = 'round';
            ctx.lineWidth = 4;
            ctx.strokeStyle = background;
            ctx.strokeText(text, x, y);
            ctx.restore();
            ctx.fillText(text, x, y);
        };
        chart.data.datasets.forEach((ds, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden || !isTop(ds)) return;
            meta.data.forEach((bar, li) => {
                const total = totalOf(li, ds);
                if (total == null || !Number.isFinite(bar.x)) return;
                const text = format(total);
                const y = Math.max(a.top + fonts.badge, Math.min(bar.y, a.bottom) - 3);
                // Too wide for its bar (many vehicles at once): stand it on end.
                if (ctx.measureText(text).width > bar.width + 2) {
                    ctx.save();
                    ctx.translate(bar.x, y);
                    ctx.rotate(-Math.PI / 2);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    overPanel(text, 0, 0);
                    ctx.restore();
                    return;
                }
                overPanel(text, bar.x, y);
            });
        });
        // The home part's own figure, only where fast charging sits on it:
        // with no fast charging the total over the column is the home cost.
        chart.data.datasets.forEach((ds, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden || ds.part !== 'home') return;
            meta.data.forEach((bar, li) => {
                const home = homeOf(li, ds);
                if (home == null || !Number.isFinite(bar.x)) return;
                const text = format(home);
                if (ctx.measureText(text).width > bar.width + 2) return;
                const room = Math.abs(bar.base - bar.y);
                // Inside the home part under its top; above it when too short.
                if (room >= fonts.badge + 6) {
                    ctx.textBaseline = 'top';
                    ctx.fillText(text, bar.x, bar.y + 3);
                } else {
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(text, bar.x, bar.y - 3);
                }
            });
        });
        ctx.restore();
    },
});

/**
 * The most each car's home charging could cost a month at the level, a dashed
 * line across its column (owner, 2026-11-11): `ceilingOf(levelIndex,
 * vehicleIndex)` gives the figure, null draws nothing (no home charging).
 * Drawn by a plugin, not as a dataset (utils/ceilingMark.js), so a line above
 * the plot never moves the y-axis — the axis stays as tall as the tallest
 * column. A line above it is pinned to the top edge with an up-arrow; its figure is in the tooltip only
 * (a dollar figure on each arrow read as clutter, owner, 2026-11-11; the
 * labelled version is commit b0b296e if it is wanted back).
 */
const homeCeilings = (ceilingOf) => ({
    id: 'homeCeilings',
    afterDatasetsDraw(chart) {
        const marks = [];
        chart.data.datasets.forEach((ds, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden || ds.part !== 'home') return;
            meta.data.forEach((bar, li) => {
                const value = ceilingOf(li, ds.vehicleIndex);
                if (value != null && Number.isFinite(bar.x)) marks.push({ x: bar.x, half: bar.width / 2 + 2, value });
            });
        });
        drawCeilingMarks(chart, marks);
    },
});

/**
 * The table, transposed (owner, 2026-11-07): a column a home charger level, a
 * group of rows a vehicle — its fast charging per month, then its cost per
 * month: home, fast and the total. Every cell is one plain line; what used to be notes
 * are marks, explained under the table:
 *  - "enough from here" is the cell in bold orange: "No further time or cost
 *    savings with a faster home charger" (owner's wording, 2026-11-07);
 *  - a level the car's onboard charger caps carries a ^, "Limited by vehicle
 *    charger", each car's onboard kW in the line's tooltip.
 */
/**
 * A week's figures as a month's (the week × 52 ÷ 12), the way Compare shows
 * them, so the two tabs read in one unit (owner, 2026-11-07). "Enough" is still
 * found on the week's minutes, which is the same answer.
 */
const monthOf = (w) => (w ? {
    homeCost: perMonth(w.homeCost),
    fastCost: perMonth(w.fastCost),
    fastMinutes: perMonth(w.fastMinutes),
    stopCount: perMonth(w.stopCount),
} : null);
const monthOfEntry = (entry) => (entry && !entry.missing ? monthOf(entry.comparison.week) : null);
const fastText = (w) => (!w ? DASH : w.fastMinutes < 0.5 ? '0 min' : minutesText(w.fastMinutes));
const homeCostText = (w) => (!w ? DASH : dollars(w.homeCost));
const fastCostText = (w) => (!w ? DASH : dollars(w.fastCost));
const totalText = (w) => (!w ? DASH : dollars(w.fastCost + w.homeCost));

/** Minutes over a time column; "0 min" below half a minute, as the table says. */
const minutesLabel = (m) => (m < 0.5 ? '0 min' : minutesText(m));

const HOME_CHARGER_VIEWS = [['cost', 'Cost'], ['time', 'Time']];

export default function HomeChargerView({ vehicles, selectedVehicleIds, settings, onChange, chart: view = 'cost', onChartChange, presentationMode = false }) {
    const timeView = view === 'time';
    const byLevel = useCostToDriveByLevel(vehicles, selectedVehicleIds, settings);
    // The vehicles as priced at the reader's own level: the columns, and what the
    // source line credits.
    const columns = useMemo(() => (byLevel[settings.level]?.priced ?? []).filter(p => !p.missing), [byLevel, settings.level]);
    const missing = (byLevel[settings.level]?.priced ?? []).filter(p => p.missing);
    const at = (levelIndex, vehicleId) => byLevel[levelIndex].priced.find(p => p.vehicle.id === vehicleId);
    // The levels as the chart and table show them (HOME_LEVEL_ORDER): no home
    // charging first. A bar's or column's place is not its level index, so
    // each looks its level up through `shown`.
    const shown = HOME_LEVEL_ORDER.map(i => byLevel[i]);
    const enough = useMemo(() => Object.fromEntries(columns.map(c => [
        c.vehicle.id,
        enoughLevel(byLevel.map(l => {
            const e = l.priced.find(p => p.vehicle.id === c.vehicle.id);
            return e && !e.missing ? e.comparison.week.fastMinutes : null;
        })),
    ])), [byLevel, columns]);

    const canvasRef = useRef(null), chartRef = useRef(null);
    const { isDark } = useTheme();
    const signature = `${columns.map(c => c.vehicle.id).join(',')}|${JSON.stringify(settings)}|${view}`;
    const redraw = `${signature}|${columns.map(c => c.color).join(',')}|${isDark}`;

    useEffect(() => {
        if (!canvasRef.current || !columns.length) return undefined;
        applyChartDefaults(Chart);
        const { tick, grid, legend } = chartTheme();
        const cost = !timeView;
        const monthAt = (li, c) => monthOf(at(shown[li].index, c.vehicle.id)?.comparison?.week);
        // Level by place on the chart (`shown`), car by place in `columns`.
        const ceilingOf = (li, ci) => {
            const e = at(shown[li].index, columns[ci].vehicle.id);
            return e && !e.missing ? homeCostCeiling(e.profile, settings) : null;
        };
        // A car once in the legend, by its home bar's full color (its one bar on
        // the time chart), then the ceiling's key — the cost chart only.
        const ceilingKey = ceilingLegend(Chart, {
            keep: (item, data) => data.datasets[item.datasetIndex].part === (cost ? 'home' : 'fast'),
            text: cost ? 'Most it could cost at home' : null,
            // Hiding a car hides both its bars.
            onClick: (e, item, leg) => {
                const ch = leg.chart;
                const vi = ch.data.datasets[item.datasetIndex].vehicleIndex;
                const show = !ch.isDatasetVisible(item.datasetIndex);
                ch.data.datasets.forEach((d, i) => { if (d.vehicleIndex === vi) ch.setDatasetVisibility(i, show); });
                ch.update();
            },
        });
        chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
            type: 'bar',
            data: {
                labels: shown.map(l => levelLabel(l.level)),
                // Cost: two bars a car, stacked on the car's own stack — home cost
                // underneath in the full color, fast cost on top striped in it over
                // its desaturated shade, the Compare cost chart's style. Time: one
                // bar a car, the fast charging alone.
                datasets: cost
                    ? columns.flatMap((c, ci) => ['home', 'fast'].map(part => ({
                        label: vehicleLabel(c.vehicle),
                        part,
                        vehicleIndex: ci,
                        stack: String(c.vehicle.id),
                        data: shown.map(l => {
                            const w = monthOf(at(l.index, c.vehicle.id)?.comparison?.week);
                            return w ? (part === 'home' ? w.homeCost : w.fastCost) : null;
                        }),
                        backgroundColor: part === 'home' ? c.color : fastChargingFill(c.color),
                    })))
                    : columns.map((c, ci) => ({
                        label: vehicleLabel(c.vehicle),
                        part: 'fast',
                        vehicleIndex: ci,
                        data: shown.map((l, li) => monthAt(li, c)?.fastMinutes ?? null),
                        backgroundColor: c.color,
                    })),
            },
            plugins: cost
                ? [homeCeilings(ceilingOf), totalLabels(ds => ds.part === 'fast', (li, ds) => {
                    const w = monthAt(li, columns[ds.vehicleIndex]);
                    return w ? w.fastCost + w.homeCost : null;
                }, (li, ds) => {
                    const w = monthAt(li, columns[ds.vehicleIndex]);
                    // No "$0" under a bar with no home charging.
                    return w && w.fastCost >= 0.5 && w.homeCost >= 0.5 ? w.homeCost : null;
                })]
                // The ceiling is a cost figure: not drawn over minutes.
                : [totalLabels(() => true, (li, ds) => monthAt(li, columns[ds.vehicleIndex])?.fastMinutes ?? null, () => null, minutesLabel)],
            options: {
                // Room over the tallest column for its label.
                layout: { padding: { top: 18 } },
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: legend, boxWidth: 12, usePointStyle: true, generateLabels: ceilingKey.generateLabels },
                        onClick: ceilingKey.onClick,
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const ds = ctx.dataset;
                                const w = monthAt(ctx.dataIndex, columns[ds.vehicleIndex]);
                                if (!w) return null;
                                if (!cost) return `${ds.label}: ${minutesLabel(w.fastMinutes)} of fast charging (about ${Math.round(w.stopCount)} stops) per month`;
                                const ceiling = ds.part === 'home' ? ceilingOf(ctx.dataIndex, ds.vehicleIndex) : null;
                                return ds.part === 'home'
                                    ? `${ds.label}: ${dollars(w.homeCost)} home${ceiling == null ? '' : ` (most it could cost: ${dollars(ceiling)})`}`
                                    : `${ds.label}: ${dollars(w.fastCost)} fast (${minutesText(w.fastMinutes)}, about ${Math.round(w.stopCount)} stops), ${dollars(w.fastCost + w.homeCost)} total per month`;
                            },
                        },
                    },
                },
                scales: {
                    x: { stacked: cost, grid: { display: false }, ticks: { color: tick } },
                    y: cost
                        ? { stacked: true, beginAtZero: true, title: { display: true, text: '$ per month, home + fast', color: legend }, ticks: { color: tick, callback: (v) => dollars(v) }, grid: { color: grid } }
                        : { beginAtZero: true, title: { display: true, text: 'Fast charging per month', color: legend }, ticks: { color: tick, callback: (v) => minutesText(v) }, grid: { color: grid } },
                },
            },
        });
        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [redraw]); // eslint-disable-line react-hooks/exhaustive-deps -- `redraw` names everything the chart is built from

    const allRuns = useMemo(() => vehicles.flatMap(v => v.runs ?? []), [vehicles]);
    const sourceRuns = useMemo(() => columns.flatMap(p => [
        ...(p.profile.highwayFrom === 'tested' ? filterRangeRuns(p.vehicle.runs ?? []) : []),
        ...(p.profile.fast?.run ? [p.profile.fast.run] : []),
    ]), [columns]);
    const usesEpa = columns.some(p => p.profile.highwayFrom === 'epa' || p.profile.cityFrom === 'epa');
    const sourceLine = useSourceLine({ runs: sourceRuns, allRuns, epa: { label: usesEpa } });

    const season = settings.season === 'winter' ? `Winter, ${settings.winterF}°F` : `Summer, ${settings.summerF}°F`;
    const title = timeView ? 'Fast charging per month, by home charger' : 'Charging cost per month, by home charger';
    const subtitle = `${weekSummary(settings)} · ${season} · plugged in ${hourText(settings.plugFrom)} to ${hourText(settings.plugUntil)} · ${chargingText(settings)}`;
    const png = useChartPng(chartRef, { title, subtitle, sources: sourceLine.text, signature });

    const tableCols = [
        { key: 'figure', label: '', holds: 'noted-figures' },
        ...shown.map(l => ({ key: String(l.index), label: `${levelLabel(l.level)}${l.index === settings.level ? ' (yours)' : ''}`, numeric: true })),
    ];
    // The onboard chargers that cap a level, for the ^ footnote's tooltip.
    const cappedBy = columns
        .map(c => byLevel.map(l => at(l.index, c.vehicle.id)).find(e => e && !e.missing && e.profile.home.capped))
        .filter(Boolean)
        .map(e => `${vehicleLabel(e.vehicle)} ${kwText(e.profile.home.onboardKw)}${e.profile.home.onboardAssumed ? ' (assumed)' : ''}`);

    return (
        <div className="chart-layout">
            {!presentationMode && <CostToDriveSidebar settings={settings} onChange={onChange} />}
            <div className="chart-main">
                {missing.length > 0 && (
                    <p className="text-note drive-missing">
                        Can&rsquo;t price {missing.map(p => `${vehicleLabel(p.vehicle)} (${p.missing})`).join('; ')}.
                    </p>
                )}
                {columns.length > 0 && (
                    <>
                        {!presentationMode && onChartChange && (
                            <div className="plan-controls">
                                <span className="text-label">Chart</span>
                                <div className="segmented" role="group" aria-label="Chart">
                                    {HOME_CHARGER_VIEWS.map(([k, label]) => (
                                        <button key={k} type="button" aria-pressed={view === k} className={view === k ? 'active' : undefined} onClick={() => onChartChange(k)}>{label}</button>
                                    ))}
                                </div>
                            </div>
                        )}
                        <PlotFrame
                            title={title}
                            subtitle={subtitle}
                            sourceLine={sourceLine}
                            preview={png.preview}
                            onDismissPreview={png.dismissPreview}
                            exportControls={!presentationMode && (<><CopyLinkButton /><PngButton png={png} /></>)}
                        >
                            <div style={{ height: presentationMode ? PRESENTED_HALF_HEIGHT : '360px', position: 'relative' }}>
                                <canvas ref={canvasRef} />
                            </div>
                        </PlotFrame>
                        {!presentationMode && (
                            <div className="mt-4">
                                {settings.season === 'winter' && <div className="mb-2"><PackWarmingNote settings={settings} /></div>}
                                <p className="text-secondary mb-2">
                                    Fast charging and cost per month at each home charger, everything else as you set it.
                                </p>
                                <div className="guide-table-container">
                                    <table className="guide-table plan-table">
                                        <thead>
                                            <tr>{tableCols.map(c => <SortHeader key={c.key} col={c} />)}</tr>
                                        </thead>
                                        {columns.map(c => (
                                            <tbody key={c.vehicle.id}>
                                                <tr className="plan-table-group">
                                                    <td colSpan={tableCols.length}>{vehicleLabel(c.vehicle)}</td>
                                                </tr>
                                                {[['Fast charging per month', fastText], ['Home cost per month', homeCostText], ['Fast cost per month', fastCostText], ['Total cost per month', totalText]].map(([label, text]) => (
                                                    <tr key={label}>
                                                        <TableCell text={label} className="plan-table-label" />
                                                        {shown.map(l => {
                                                            const e = at(l.index, c.vehicle.id);
                                                            const capped = e && !e.missing && e.profile.home.capped;
                                                            return (
                                                                <TableCell key={l.index} numeric text={text(monthOfEntry(e))}
                                                                           mark={capped ? '^' : ''}
                                                                           className={enough[c.vehicle.id] === l.index ? 'is-enough' : ''} />
                                                            );
                                                        })}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        ))}
                                    </table>
                                    <p className="text-note plan-table-footnote">
                                        <span className="is-enough">Bold</span> — No further time or cost savings with a faster home charger.
                                        <br />At 240 V, reaching the pack: {columns.map(c => `${vehicleLabel(c.vehicle)} ${percentText(c.profile.home.eff240)} (${c.profile.home.effFrom === 'epa' ? 'EPA' : 'site-wide'})`).join(' · ')}. On 120 V, each × {percentText(WALL_OUTLET_CHARGER_EFF)} ÷ {percentText(ASSUMED_CHARGER_EFF)}.
                                        {cappedBy.length > 0 && (
                                            <><br /><span title={`Onboard chargers: ${cappedBy.join(', ')}`}>^ — Limited by vehicle charger</span></>
                                        )}
                                    </p>
                                </div>
                            </div>
                        )}
                    </>
                )}
                {!presentationMode && <ChartInfoBubble chartKey="drivecharger" />}
            </div>
        </div>
    );
}
