/**
 * Home Charger — each home charger level against each selected vehicle (mode
 * `drivecharger`, docs/cost-to-drive-plan.md): what the reader's week costs in
 * fast charging at every level, where a bigger charger stops helping ("enough
 * from here"), and where the car's own onboard charger caps it.
 *
 * Every other setting is the reader's; only the level moves. The chart is
 * Chart.js in a PlotFrame (PNG capture, URL button, source line), the table the
 * shared table parts.
 */
import { useEffect, useMemo, useRef } from 'react';
import Chart from 'chart.js/auto';
import { vehicleLabel } from '../../utils/specHelpers';
import { filterRangeRuns } from '../../utils/runUtils';
import { chartTheme, chartFonts, applyChartDefaults } from '../../utils/chartTheme';
import { PRESENTED_HALF_HEIGHT } from '../../utils/presentedHeight';
import { dollars, minutesText, weekSummary, enoughLevel } from '../../utils/costToDrive';
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
import { hourText } from './DriveFields';

const DASH = '—';
const kwText = (kw) => `${Math.round(kw * 10) / 10} kW`;

/**
 * The total cost a week (home + fast) over each bar (owner, 2026-11-07), so
 * the chart answers what the bigger charger saves in money as well as time.
 * `totalOf(level, dataset)` gives the figure; null draws nothing.
 */
const totalLabels = (totalOf) => ({
    id: 'totalLabels',
    afterDatasetsDraw(chart) {
        const { ctx, chartArea: a } = chart;
        const { ink } = chartTheme();
        const fonts = chartFonts();
        ctx.save();
        ctx.font = `600 ${fonts.badge}px ${fonts.mono}`;
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        chart.data.datasets.forEach((_, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;
            meta.data.forEach((bar, li) => {
                const total = totalOf(li, di);
                if (total == null || !Number.isFinite(bar.x)) return;
                const text = dollars(total);
                const y = Math.max(a.top + fonts.badge, Math.min(bar.y, a.bottom) - 3);
                // Too wide for its bar (many vehicles at once): stand it on end.
                if (ctx.measureText(text).width > bar.width + 2) {
                    ctx.save();
                    ctx.translate(bar.x, y);
                    ctx.rotate(-Math.PI / 2);
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text, 0, 0);
                    ctx.restore();
                    return;
                }
                ctx.fillText(text, bar.x, y);
            });
        });
        ctx.restore();
    },
});

/**
 * The table, transposed (owner, 2026-11-07): a column a home charger level, a
 * group of rows a vehicle — its fast charging a week, then its total cost a
 * week (home and fast). Every cell is one plain line; what used to be notes
 * are marks, explained under the table:
 *  - "enough from here" is the cell in bold;
 *  - a level the car's onboard charger caps carries a †.
 */
const weekOf = (entry) => (entry && !entry.missing ? entry.comparison.week : null);
const fastText = (w) => (!w ? DASH : w.fastMinutes < 0.5 ? '0 min' : minutesText(w.fastMinutes));
const totalText = (w) => (!w ? DASH : dollars(w.fastCost + w.homeCost));

export default function HomeChargerView({ vehicles, selectedVehicleIds, settings, onChange, onOpenSetup, presentationMode = false }) {
    const byLevel = useCostToDriveByLevel(vehicles, selectedVehicleIds, settings);
    // The vehicles as priced at the reader's own level: the columns, and what the
    // source line credits.
    const columns = useMemo(() => (byLevel[settings.level]?.priced ?? []).filter(p => !p.missing), [byLevel, settings.level]);
    const missing = (byLevel[settings.level]?.priced ?? []).filter(p => p.missing);
    const at = (levelIndex, vehicleId) => byLevel[levelIndex].priced.find(p => p.vehicle.id === vehicleId);
    const enough = useMemo(() => Object.fromEntries(columns.map(c => [
        c.vehicle.id,
        enoughLevel(byLevel.map(l => {
            const e = l.priced.find(p => p.vehicle.id === c.vehicle.id);
            return e && !e.missing ? e.comparison.week.fastMinutes : null;
        })),
    ])), [byLevel, columns]);

    const canvasRef = useRef(null), chartRef = useRef(null);
    const { isDark } = useTheme();
    const signature = `${columns.map(c => c.vehicle.id).join(',')}|${JSON.stringify(settings)}`;
    const redraw = `${signature}|${columns.map(c => c.color).join(',')}|${isDark}`;

    useEffect(() => {
        if (!canvasRef.current || !columns.length) return undefined;
        applyChartDefaults(Chart);
        const { tick, grid, legend } = chartTheme();
        chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
            type: 'bar',
            data: {
                labels: byLevel.map(l => levelLabel(l.level)),
                datasets: columns.map(c => ({
                    label: vehicleLabel(c.vehicle),
                    data: byLevel.map(l => at(l.index, c.vehicle.id)?.comparison?.week.fastMinutes ?? null),
                    backgroundColor: c.color,
                })),
            },
            plugins: [totalLabels((li, di) => {
                const w = at(li, columns[di].vehicle.id)?.comparison?.week;
                return w ? w.fastCost + w.homeCost : null;
            })],
            options: {
                // Room over the tallest bar for its label.
                layout: { padding: { top: 18 } },
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: legend, boxWidth: 12 } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const e = at(ctx.dataIndex, columns[ctx.datasetIndex].vehicle.id);
                                const w = e?.comparison?.week;
                                return w ? `${ctx.dataset.label}: ${minutesText(w.fastMinutes)}, ${w.stopCount} stops, ${dollars(w.fastCost)} fast, ${dollars(w.fastCost + w.homeCost)} total a week` : null;
                            },
                        },
                    },
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: tick } },
                    y: { beginAtZero: true, title: { display: true, text: 'Fast charging a week (min)', color: legend }, ticks: { color: tick }, grid: { color: grid } },
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
    const title = 'Fast charging a week, by home charger';
    const subtitle = `${weekSummary(settings)} · ${season} · plugged in ${hourText(settings.plugFrom)} to ${hourText(settings.plugUntil)}`;
    const png = useChartPng(chartRef, { title, subtitle, sources: sourceLine.text, signature });

    const tableCols = [
        { key: 'figure', label: '', holds: 'noted-figures' },
        ...byLevel.map(l => ({ key: String(l.index), label: `${levelLabel(l.level)}${l.index === settings.level ? ' (yours)' : ''}`, numeric: true })),
    ];
    // The onboard chargers that cap a level, for the † footnote.
    const cappedBy = columns
        .map(c => byLevel.map(l => at(l.index, c.vehicle.id)).find(e => e && !e.missing && e.profile.home.capped))
        .filter(Boolean)
        .map(e => `${vehicleLabel(e.vehicle)} ${kwText(e.profile.home.onboardKw)}${e.profile.home.onboardAssumed ? ' (assumed)' : ''}`);

    return (
        <div className="chart-layout">
            {!presentationMode && <CostToDriveSidebar settings={settings} onChange={onChange} onOpenSetup={onOpenSetup} />}
            <div className="chart-main">
                {missing.length > 0 && (
                    <p className="text-note drive-missing">
                        Can&rsquo;t price {missing.map(p => `${vehicleLabel(p.vehicle)} (${p.missing})`).join('; ')}.
                    </p>
                )}
                {columns.length > 0 && (
                    <>
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
                                <p className="text-secondary mb-2">
                                    Fast charging and total cost a week (home and fast) at each home charger, everything else as you set it.
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
                                                {[['Fast charging a week', fastText], ['Total cost a week', totalText]].map(([label, text]) => (
                                                    <tr key={label}>
                                                        <TableCell text={label} className="plan-table-label" />
                                                        {byLevel.map(l => {
                                                            const e = at(l.index, c.vehicle.id);
                                                            const capped = e && !e.missing && e.profile.home.capped;
                                                            return (
                                                                <TableCell key={l.index} numeric text={text(weekOf(e))}
                                                                           mark={capped ? '†' : ''}
                                                                           className={enough[c.vehicle.id] === l.index ? 'is-enough' : ''} />
                                                            );
                                                        })}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        ))}
                                    </table>
                                    <p className="text-note plan-table-footnote">
                                        <b>Bold</b>: enough from here — a bigger charger saves less than five minutes of fast charging a week.
                                        {cappedBy.length > 0 && <> † Capped by the car&rsquo;s onboard charger: {cappedBy.join(', ')}.</>}
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
