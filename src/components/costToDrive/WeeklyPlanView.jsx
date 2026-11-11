/**
 * Weekly Charging Plan — one vehicle's week (mode `driveplan`,
 * docs/cost-to-drive-plan.md): the week day by day as bars (DayBarsChart),
 * or as a line of range left with every fast stop where it happens
 * (WeekLineChart); the week as a table under it, a column a day; an optional
 * comparison stacked below (another charger level, or the other season), and
 * the gas car's week collapsed by default.
 *
 * Owner, 2026-11-07: the bars day by day in time order first (mockup A3), the
 * bars as charge in and used behind the same picker, the line kept as the third. The
 * vehicle is a dropdown, which holds any number of them.
 *
 * The vehicle, the chart and the comparison are picked here and are not in
 * the link: the key holds the reader's week, and every vehicle selected is in
 * `v` already.
 */
import { useMemo, useState } from 'react';
import { vehicleLabel } from '../../utils/specHelpers';
import { filterRangeRuns } from '../../utils/runUtils';
import { SERIES_NEUTRAL } from '../../utils/colorUtils';
import { HOME_LEVELS, HOME_LEVEL_ORDER } from '../../constants/costToDrive';
import {
    simulateWeek, dollars, minutesText, weekSummary, gasCarName, chargingText, chargerText,
} from '../../utils/costToDrive';
import { useCostToDrive } from '../../hooks/useCostToDrive';
import { PRESENTED_HALF_HEIGHT } from '../../utils/presentedHeight';
import ChartInfoBubble from '../ChartInfoBubble';
import CostToDriveSidebar from './CostToDriveSidebar';
import WeekLineChart from './WeekLineChart';
import DayBarsChart from './DayBarsChart';
import PlanTable from './PlanTable';
import { levelLabel } from './HomeLevelPicker';

/** Where the everyday battery range ends, drawn dashed on the week's line. */
const GUIDES_PCT = [10, 80];

/** "3 fast stops · 1 h 8 min · $23 fast + $49 home per week". */
function weekLine(week) {
    const stops = week.stopCount === 0
        ? 'No fast stops'
        : `${week.stopCount} fast stop${week.stopCount === 1 ? '' : 's'} · ${minutesText(week.fastMinutes)}`;
    return `${stops} · ${dollars(week.fastCost)} fast + ${dollars(week.homeCost)} home per week`;
}

/** What one week of a car draws: its points in miles, its stops as bands. */
function chartOf(week, profile) {
    // Miles a percent of battery covers, over the week as driven (detours in).
    const miPerPct = week.usedKwh > 0 ? week.miles / week.usedKwh * profile.usableKwh / 100 : 1;
    return {
        points: week.points.map(([h, soc]) => [h, soc * miPerPct]),
        max: 100 * miPerPct,
        format: (v) => `${Math.round(v)} mi left`,
        right: (v) => `${Math.round(v / miPerPct)}%`,
        guides: GUIDES_PCT.map(p => p * miPerPct),
        stops: week.stops.map(s => ({ from: s.hour, to: s.endHour, planned: s.planned, label: `${Math.round(s.minutes)}m` })),
    };
}

/** The plan's charts, first the default. */
const PLAN_CHARTS = [
    ['day', 'Day by day'],
    ['balance', 'Day by day, charge in and used'],
    ['line', 'The week as a line'],
];

const seasonText = (s, season) => season === 'winter' ? `Winter, ${s.winterF}°F` : `Summer, ${s.summerF}°F`;

/** The week as the picked chart: bars (either reading) or the line. */
function PlanChart({ kind, week, profile, ...chart }) {
    if (kind === 'line') return <WeekLineChart {...chartOf(week, profile)} yLabel="Range left (mi)" {...chart} />;
    return <DayBarsChart week={week} view={kind} {...chart} />;
}

export default function WeeklyPlanView({ vehicles, selectedVehicleIds, settings, onChange, presentationMode = false }) {
    const priced = useCostToDrive(vehicles, selectedVehicleIds, settings);
    const shown = priced.filter(p => !p.missing);
    const [pickedId, setPickedId] = useState(null);
    const [chartKind, setChartKind] = useState('day');
    const entry = shown.find(p => p.vehicle.id === pickedId) ?? shown[0] ?? null;

    // The comparison: none, the other season, or another charger level.
    const [compare, setCompare] = useState('none');
    const [compareLevel, setCompareLevel] = useState(settings.level === 0 ? 4 : 0);
    const otherSeason = settings.season === 'winter' ? 'summer' : 'winter';
    const levelSettings = useMemo(() => ({ ...settings, level: compareLevel }), [settings, compareLevel]);
    const atLevel = useCostToDrive(vehicles, entry ? [entry.vehicle.id] : [], levelSettings)[0] ?? null;
    const [gasOpen, setGasOpen] = useState(false);

    const allRuns = useMemo(() => vehicles.flatMap(v => v.runs ?? []), [vehicles]);
    const sourceRuns = useMemo(() => entry ? [
        ...(entry.profile.highwayFrom === 'tested' ? filterRangeRuns(entry.vehicle.runs ?? []) : []),
        ...(entry.profile.fast?.run ? [entry.profile.fast.run] : []),
    ] : [], [entry]);
    const usesEpa = entry ? (entry.profile.highwayFrom === 'epa' || entry.profile.cityFrom === 'epa') : false;
    const sources = useMemo(() => ({ runs: sourceRuns, allRuns, epa: { label: usesEpa } }), [sourceRuns, allRuns, usesEpa]);

    const height = presentationMode ? PRESENTED_HALF_HEIGHT : '340px';
    const missing = priced.filter(p => p.missing);

    return (
        <div className="chart-layout">
            {!presentationMode && <CostToDriveSidebar settings={settings} onChange={onChange} />}
            <div className="chart-main">
                {!entry && (
                    <p className="text-note">
                        {missing.length
                            ? `Can't price ${missing.map(p => `${vehicleLabel(p.vehicle)} (${p.missing})`).join('; ')}.`
                            : 'Select a vehicle to see its week.'}
                    </p>
                )}
                {entry && (() => {
                    const week = entry.comparison.week;
                    const name = vehicleLabel(entry.vehicle);
                    const charging = chargingText(settings, HOME_LEVELS[settings.level]);
                    const subtitle = `${weekSummary(settings)} · ${seasonText(settings, settings.season)} · ${charging}`;
                    const signature = `${entry.vehicle.id}|${JSON.stringify(settings)}`;

                    let cmp = null;
                    if (compare === 'season') {
                        const w = otherSeason === 'winter' ? entry.comparison.winter : entry.comparison.summer;
                        cmp = { week: w, profile: entry.profile, title: `${name}: the same week in ${otherSeason}`,
                            subtitle: `${weekSummary(settings)} · ${seasonText(settings, otherSeason)} · ${charging}` };
                    } else if (compare === 'level' && atLevel && !atLevel.missing) {
                        const w = simulateWeek(atLevel.profile, levelSettings);
                        cmp = { week: w, profile: atLevel.profile, title: `${name}: the same week ${HOME_LEVELS[compareLevel].none ? 'with' : 'on'} ${chargerText(HOME_LEVELS[compareLevel])}`,
                            subtitle: `${weekSummary(settings)} · ${seasonText(settings, settings.season)} · ${chargingText(settings, HOME_LEVELS[compareLevel])}` };
                    }

                    const gas = entry.comparison.gas;
                    const gasMpg = gas.rangeMi / settings.gasTank;
                    return (
                        <>
                            {!presentationMode && (
                                <div className="plan-controls">
                                    {shown.length > 1 && (
                                        <label className="plan-control">
                                            <span className="text-label">Vehicle</span>
                                            <select className="form-input" value={entry.vehicle.id}
                                                    onChange={e => setPickedId(Number(e.target.value))}>
                                                {shown.map(p => (
                                                    <option key={p.vehicle.id} value={p.vehicle.id}>{vehicleLabel(p.vehicle)}</option>
                                                ))}
                                            </select>
                                        </label>
                                    )}
                                    <label className="plan-control">
                                        <span className="text-label">Chart</span>
                                        <select className="form-input" value={chartKind} onChange={e => setChartKind(e.target.value)}>
                                            {PLAN_CHARTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                                        </select>
                                    </label>
                                    <span className="text-secondary">{weekLine(week)}</span>
                                </div>
                            )}
                            <PlanChart
                                kind={chartKind}
                                week={week}
                                profile={entry.profile}
                                color={entry.color}
                                title={`${name}: a week of charging`}
                                subtitle={subtitle}
                                sources={sources}
                                signature={signature}
                                presentationMode={presentationMode}
                                height={height}
                                linkButton
                            />
                            {!presentationMode && (
                                <div className="mt-3">
                                    <PlanTable week={week} settings={settings} />
                                </div>
                            )}

                            {!presentationMode && (
                                <div className="plan-compare">
                                    <span className="text-label">Compare with</span>
                                    <div className="segmented" role="group" aria-label="Compare with">
                                        {[['none', 'Nothing'], ['season', `${otherSeason === 'winter' ? 'Winter' : 'Summer'}`], ['level', 'Another charger']].map(([k, label]) => (
                                            <button key={k} type="button" aria-pressed={compare === k} className={compare === k ? 'active' : undefined} onClick={() => setCompare(k)}>{label}</button>
                                        ))}
                                    </div>
                                    {compare === 'level' && (
                                        <select className="form-input" value={compareLevel} aria-label="Charger to compare with"
                                                onChange={e => setCompareLevel(Number(e.target.value))}>
                                            {HOME_LEVEL_ORDER.map(i => i === settings.level ? null : (
                                                <option key={i} value={i}>{levelLabel(HOME_LEVELS[i])}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )}
                            {cmp && (
                                <div className="mt-4">
                                    <span className="text-secondary">{weekLine(cmp.week)}</span>
                                    <PlanChart
                                        kind={chartKind}
                                        week={cmp.week}
                                        profile={cmp.profile}
                                        color={entry.color}
                                        title={cmp.title}
                                        subtitle={cmp.subtitle}
                                        sources={sources}
                                        signature={`${signature}|${compare}|${compareLevel}`}
                                        presentationMode={presentationMode}
                                        height={height}
                                    />
                                </div>
                            )}

                            {!presentationMode && (
                                <div className="mt-4 flex flex-col gap-3">
                                    <button type="button" className={`subgroup-header${gasOpen ? ' is-open' : ''}`}
                                            aria-expanded={gasOpen} onClick={() => setGasOpen(o => !o)}>
                                        <span aria-hidden="true">{gasOpen ? '▼' : '▶'}</span>
                                        <span>{gasCarName(settings)}, the same week: {gas.fillsPerWeek.toFixed(1)} fill-ups, {minutesText(gas.minutesPerWeek)}, {dollars(gas.cost)}</span>
                                    </button>
                                    {gasOpen && (
                                        <WeekLineChart
                                            points={gas.points.map(([h, gal]) => [h, gal * gasMpg])}
                                            max={settings.gasTank * gasMpg}
                                            format={(v) => `${Math.round(v)} mi left`}
                                            right={(v) => `${Math.round(v / gasMpg / settings.gasTank * 100)}%`}
                                            stops={gas.fills.map(f => ({ from: f.hour, to: f.hour + settings.gasFillMin / 60, label: `${settings.gasFillMin}m` }))}
                                            color={SERIES_NEUTRAL}
                                            yLabel="Range left (mi)"
                                            title={`${gasCarName(settings)}: the same week`}
                                            subtitle={`${weekSummary(settings)} · ${Math.round(gas.cityMpg)} city / ${Math.round(gas.hwyMpg)} hwy mpg in ${settings.season}, ${settings.gasTank} gal`}
                                            signature={`gas|${JSON.stringify(settings)}`}
                                            height={height}
                                        />
                                    )}
                                </div>
                            )}

                        </>
                    );
                })()}
                {!presentationMode && <ChartInfoBubble chartKey="driveplan" />}
            </div>
        </div>
    );
}
