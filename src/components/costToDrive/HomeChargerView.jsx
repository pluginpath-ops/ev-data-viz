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
import { chartTheme, applyChartDefaults } from '../../utils/chartTheme';
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

/** One vehicle at one level: the cell's figure and the note beneath it. */
function cellOf(entry, { enough, current }) {
    if (!entry || entry.missing) return { text: DASH, note: null };
    const week = entry.comparison.week;
    const notes = [
        week.stopCount === 0 ? 'no stops' : `${week.stopCount} stop${week.stopCount === 1 ? '' : 's'} · ${dollars(week.fastCost)}`,
        entry.profile.home.capped
            ? `capped at the car's ${kwText(entry.profile.home.onboardKw)}${entry.profile.home.onboardAssumed ? ' (assumed)' : ''}`
            : null,
        enough ? 'enough from here' : null,
        current ? 'yours' : null,
    ].filter(Boolean);
    return { text: week.fastMinutes < 0.5 ? '0 min' : minutesText(week.fastMinutes), note: notes.join(' · ') };
}

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
            options: {
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
                                return w ? `${ctx.dataset.label}: ${minutesText(w.fastMinutes)}, ${w.stopCount} stops, ${dollars(w.fastCost)} fast a week` : null;
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
        { key: 'level', label: 'Home charger', holds: 'short-values' },
        ...columns.map(c => ({ key: String(c.vehicle.id), label: vehicleLabel(c.vehicle), fullLabel: vehicleLabel(c.vehicle), numeric: true, holds: 'noted-figures' })),
    ];

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
                                    Fast charging a week at each home charger, everything else as you set it.
                                    &ldquo;Enough from here&rdquo; is where a bigger charger saves less than five minutes a week.
                                </p>
                                <div className="guide-table-container">
                                    <table className="guide-table">
                                        <thead>
                                            <tr>{tableCols.map(c => <SortHeader key={c.key} col={c} />)}</tr>
                                        </thead>
                                        <tbody>
                                            {byLevel.map(l => (
                                                <tr key={l.index}>
                                                    <TableCell text={levelLabel(l.level)} />
                                                    {columns.map(c => {
                                                        const cell = cellOf(at(l.index, c.vehicle.id), {
                                                            enough: enough[c.vehicle.id] === l.index,
                                                            current: l.index === settings.level,
                                                        });
                                                        return <TableCell key={c.vehicle.id} numeric text={cell.text} note={cell.note} />;
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
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
