/**
 * Weekly Charging Plan — one vehicle's week (mode `driveplan`,
 * docs/cost-to-drive-plan.md): range left over the week with every fast stop
 * where it happens, the day strip under it, an optional comparison stacked
 * below (another charger level, or the other season), the gas car's week
 * collapsed by default, and the week as a table.
 *
 * The vehicle and the comparison are picked here and are not in the link: the
 * key holds the reader's week, and every vehicle selected is in `v` already.
 */
import { useMemo, useState } from 'react';
import { vehicleLabel } from '../../utils/specHelpers';
import { filterRangeRuns } from '../../utils/runUtils';
import { SERIES_NEUTRAL } from '../../utils/colorUtils';
import { HOME_LEVELS } from '../../constants/costToDrive';
import {
    simulateWeek, dollars, minutesText, weekSummary,
} from '../../utils/costToDrive';
import { useCostToDrive } from '../../hooks/useCostToDrive';
import { PRESENTED_HALF_HEIGHT } from '../../utils/presentedHeight';
import ChartInfoBubble from '../ChartInfoBubble';
import CostToDriveSidebar from './CostToDriveSidebar';
import WeekLineChart from './WeekLineChart';
import DayStrip from './DayStrip';
import PlanTable from './PlanTable';
import { levelLabel } from './HomeLevelPicker';

const FADES_PCT = [[0, 10], [80, 100]];

/** "3 fast stops · 1 h 8 min · $23 fast + $49 home a week". */
function weekLine(week) {
    const stops = week.stopCount === 0
        ? 'No fast stops'
        : `${week.stopCount} fast stop${week.stopCount === 1 ? '' : 's'} · ${minutesText(week.fastMinutes)}`;
    return `${stops} · ${dollars(week.fastCost)} fast + ${dollars(week.homeCost)} home a week`;
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
        fades: FADES_PCT.map(([lo, hi]) => [lo * miPerPct, hi * miPerPct]),
        stops: week.stops.map(s => ({ from: s.hour, to: s.endHour, planned: s.planned, label: `${Math.round(s.minutes)}m` })),
    };
}

const seasonText = (s, season) => season === 'winter' ? `Winter, ${s.winterF}°F` : `Summer, ${s.summerF}°F`;

export default function WeeklyPlanView({ vehicles, selectedVehicleIds, settings, onChange, onOpenSetup, presentationMode = false }) {
    const priced = useCostToDrive(vehicles, selectedVehicleIds, settings);
    const shown = priced.filter(p => !p.missing);
    const [pickedId, setPickedId] = useState(null);
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
            {!presentationMode && <CostToDriveSidebar settings={settings} onChange={onChange} onOpenSetup={onOpenSetup} />}
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
                    const main = chartOf(week, entry.profile);
                    const name = vehicleLabel(entry.vehicle);
                    const level = levelLabel(HOME_LEVELS[settings.level]);
                    const subtitle = `${weekSummary(settings)} · ${seasonText(settings, settings.season)} · home ${level}`;
                    const signature = `${entry.vehicle.id}|${JSON.stringify(settings)}`;

                    let cmp = null;
                    if (compare === 'season') {
                        const w = otherSeason === 'winter' ? entry.comparison.winter : entry.comparison.summer;
                        cmp = { week: w, profile: entry.profile, title: `${name}: the same week in ${otherSeason}`,
                            subtitle: `${weekSummary(settings)} · ${seasonText(settings, otherSeason)} · home ${level}` };
                    } else if (compare === 'level' && atLevel && !atLevel.missing) {
                        const w = simulateWeek(atLevel.profile, levelSettings);
                        cmp = { week: w, profile: atLevel.profile, title: `${name}: the same week on ${levelLabel(HOME_LEVELS[compareLevel])}`,
                            subtitle: `${weekSummary(settings)} · ${seasonText(settings, settings.season)} · home ${levelLabel(HOME_LEVELS[compareLevel])}` };
                    }

                    const gas = entry.comparison.gas;
                    const gasMpg = gas.rangeMi / settings.gasTank;
                    return (
                        <>
                            {!presentationMode && (
                                <div className="plan-controls">
                                    {shown.length > 1 && (
                                        <div className="stats-segmented" role="group" aria-label="Vehicle">
                                            {shown.map(p => (
                                                <button key={p.vehicle.id} type="button"
                                                        aria-pressed={p === entry} className={p === entry ? 'active' : undefined}
                                                        onClick={() => setPickedId(p.vehicle.id)}>
                                                    {vehicleLabel(p.vehicle)}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <span className="text-secondary">{weekLine(week)}</span>
                                </div>
                            )}
                            <WeekLineChart
                                {...main}
                                color={entry.color}
                                yLabel="Range left (mi)"
                                title={`${name}: a week of charging`}
                                subtitle={subtitle}
                                sources={sources}
                                signature={signature}
                                presentationMode={presentationMode}
                                height={height}
                                linkButton
                            />
                            {!presentationMode && <DayStrip week={week} settings={settings} />}

                            {!presentationMode && (
                                <div className="plan-compare">
                                    <span className="text-label">Compare with</span>
                                    <div className="stats-segmented" role="group" aria-label="Compare with">
                                        {[['none', 'Nothing'], ['season', `${otherSeason === 'winter' ? 'Winter' : 'Summer'}`], ['level', 'Another charger']].map(([k, label]) => (
                                            <button key={k} type="button" aria-pressed={compare === k} className={compare === k ? 'active' : undefined} onClick={() => setCompare(k)}>{label}</button>
                                        ))}
                                    </div>
                                    {compare === 'level' && (
                                        <select className="form-input" value={compareLevel} aria-label="Charger to compare with"
                                                onChange={e => setCompareLevel(Number(e.target.value))}>
                                            {HOME_LEVELS.map((l, i) => i === settings.level ? null : (
                                                <option key={i} value={i}>{levelLabel(l)}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )}
                            {cmp && (
                                <div className="mt-4">
                                    <span className="text-secondary">{weekLine(cmp.week)}</span>
                                    <WeekLineChart
                                        {...chartOf(cmp.week, cmp.profile)}
                                        color={entry.color}
                                        yLabel="Range left (mi)"
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
                                        <span>Your gas car&rsquo;s week: {gas.fillsPerWeek.toFixed(1)} fill-ups, {minutesText(gas.minutesPerWeek)}, {dollars(gas.cost)}</span>
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
                                            title="Your gas car: the same week"
                                            subtitle={`${weekSummary(settings)} · ${settings.gasCity} city / ${settings.gasHwy} hwy mpg, ${settings.gasTank} gal`}
                                            signature={`gas|${JSON.stringify(settings)}`}
                                            height={height}
                                        />
                                    )}
                                </div>
                            )}

                            {!presentationMode && (
                                <div className="mt-4">
                                    <h3 className="section-title mb-2">{name}, day by day</h3>
                                    <PlanTable week={week} />
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
