/**
 * Performance Compare — four category charts stacked, so a vehicle can be read
 * across acceleration, drag, passing and braking without touching a control.
 *
 * Comparing cars means looking at several of those at once. A single chart
 * behind a metric dropdown turned that into a sequence of clicks and a memory
 * test, so each category gets its own chart with a picker scoped to it.
 *
 * Every bar is a TESTED figure and they all rank together: a result derived
 * from a session imported here and one published by a magazine are the same
 * kind of claim. Each bar names its source and marks the ones backed by full
 * run data. Manufacturer claims are excluded — a marketing figure is not a test
 * result, and mixing one in would misrepresent the rest.
 */
import { useState, useEffect, useMemo } from 'react';
import { dataService } from '../services/DataService';
import { vehicleLabel } from '../utils/specHelpers';
import { buildSeriesLabels, buildVehicleLabels } from '../utils/seriesLabel';
import { useTheme } from '../hooks/useTheme';
import { resolveChartColors, VEHICLE_PALETTE } from '../utils/colorUtils';
import LoadingSpinner from './LoadingSpinner';
import ChartInfoBubble from './ChartInfoBubble';
import PerformanceCompareChart from './performance/PerformanceCompareChart';
import { groupIntervals } from '../utils/performanceDerivations';
import { PERFORMANCE_SCALARS as SCALARS, metricEntries, brakingGEntries as brakingGEntriesOf } from '../utils/performanceCompare';
import PerformanceMath from './calcTrace/PerformanceMath';


// What distinguishes two performance bars beyond the vehicle itself: who
// produced the figure. Same shape as the range/charging atoms the charging
// charts pass — the composer does not care which subsystem they come from.
const SOURCE_ATOMS = [{ key: 'source', of: s => s.sourceName }];

const CATEGORIES = [
    {
        key: 'accel', title: 'Acceleration',
        defaultMetric: 'zero_to_60_sec',
        note: 'Badge is the average acceleration over the window.',
    },
    {
        key: 'drag', title: 'Drag strip',
        defaultMetric: 'quarter_mile_sec',
        note: 'Badge is the trap speed at that distance.',
    },
    {
        key: 'passing', title: 'Passing',
        defaultMetric: null,   // first available window
        note: 'Badge is the average acceleration over the window.',
    },
    {
        key: 'braking', title: 'Braking',
        defaultMetric: null,
        valueModes: [
            { key: 'distance', label: 'Distance' },
            { key: 'g', label: 'Average g (all windows)' },
        ],
        note: 'In g, every braking window is comparable — grip is near-constant across a stop, ' +
              'so a 70–0 and a 75–0 can be ranked together even though their distances can’t.',
    },
];

export default function PerformanceCompareView({ vehicles, selectedVehicleIds, presentationMode }) {
    const { isDark } = useTheme();

    const [sortDir, setSortDir]   = useState('best');
    // 'best' — one bar per vehicle; 'source' — one per vehicle+source
    const [barMode, setBarMode]   = useState('best');
    const [origin, setOrigin]     = useState('all');   // all | session | published
    const [metrics, setMetrics]   = useState({});      // per-category metric key
    const [brakingMode, setBrakingMode] = useState('distance');
    const [data, setData]         = useState(null);
    const [loading, setLoading]   = useState(true);

    const selected = useMemo(
        () => selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean),
        [selectedVehicleIds, vehicles],
    );
    // Curated name, widened only where two selected vehicles read the same.
    const vehicleNames = useMemo(() => buildVehicleLabels(selected), [selected]);
    const nameOf = v => vehicleNames.get(v.id)?.short ?? vehicleLabel(v);

    useEffect(() => {
        let canceled = false;
        setLoading(true);
        (async () => {
            const ids = selected.map(v => v.id);
            const [allSessions, allSummaries] = await Promise.all([
                dataService.getPerformanceSessions(ids),
                dataService.getPerformanceSummaries(ids),
            ]);
            const next = {};
            for (const id of ids) next[id] = { sessions: [], summaries: [] };
            for (const s of allSessions)  next[s.vehicle_id]?.sessions.push(s);
            for (const s of allSummaries) next[s.vehicle_id]?.summaries.push(s);
            if (!canceled) { setData(next); setLoading(false); }
        })();
        return () => { canceled = true; };
    }, [selected.map(v => v.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Every speed window any selected vehicle has, split by kind. */
    const windows = useMemo(() => {
        const byKind = { accel: [], passing: [], braking: [] };
        if (!data) return byKind;
        const seen = new Set();
        for (const v of selected) {
            for (const b of groupIntervals(data[v.id]?.summaries || [])) {
                if (seen.has(b.key)) continue;
                seen.add(b.key);
                byKind[b.kind]?.push({ key: b.key, label: b.label, kind: b.kind });
            }
        }
        return byKind;
    }, [data, selected]);

    /** Metric options offered in each category's picker. */
    const optionsFor = (cat) => {
        if (cat === 'accel')   return [...SCALARS.accel, ...windows.accel];
        if (cat === 'drag')    return SCALARS.drag;
        if (cat === 'passing') return windows.passing;
        return windows.braking;
    };

    const metricFor = (cat, def) => {
        const opts = optionsFor(cat);
        const chosen = metrics[cat] ?? def;
        if (chosen && opts.some(o => o.key === chosen)) return chosen;
        return opts[0]?.key ?? null;
    };

    /**
     * Color per vehicle, shared across all four charts so a car is the same
     * color everywhere — the whole point of stacking them. A vehicle's own
     * color (curated, or the session base set from its chip) is the color; the
     * palette only assigns to cars that have none. The vehicle stands in as its
     * own single "run", which is what makes the resolver treat it as a car.
     */
    const vehicleColors = useMemo(
        () => resolveChartColors(
            selected.map(v => ({ id: v.id, created_at: v.created_at })),
            {},
            VEHICLE_PALETTE,
            selected.map(v => ({ ...v, runs: [{ id: v.id }] })),
        ),
        [selected],
    );

    /** Tested entries for one metric, per vehicle, honoring the origin filter (performanceCompare.js). */
    const entriesFor = (metricKey, category) => {
        if (!data || !metricKey) return [];
        return selected.map(v => ({
            id: v.id, vehicle: v, name: nameOf(v),
            entries: metricEntries(data[v.id] || { sessions: [], summaries: [] }, metricKey, category, origin),
        }));
    };

    /**
     * Braking in g mode: every window collapses into one comparison.
     * Grip is near-constant across a stop, so a 70–0 and a 75–0 normalize to the
     * same quantity — measured at 0.920 and 0.921 g on the same car. Distances
     * can't be compared across windows; g can.
     */
    const brakingGEntries = () => {
        if (!data) return [];
        return selected.map(v => ({
            id: v.id, vehicle: v, name: nameOf(v),
            entries: brakingGEntriesOf(data[v.id] || { summaries: [] }, origin),
        }));
    };

    /** Flatten per-vehicle entries into bars, honoring bar mode and sort. */
    const rowsFrom = (byVehicle, lowerIsBest) => {
        // Flatten first: a bar is a (vehicle, source) pair, and the labels can
        // only be minimized once the full set of bars is known.
        const flat = [];
        for (const v of byVehicle) {
            if (v.entries.length === 0) { flat.push({ v, e: null }); continue; }
            for (const e of (barMode === 'source' ? v.entries : [v.entries[0]])) flat.push({ v, e });
        }

        // "One per source" declares the source REQUIRED rather than letting
        // minimality drop it: a vehicle with a single source would otherwise
        // show no source at all, in the one mode whose whole point is to name it.
        const labels = buildSeriesLabels(
            flat.map((f, i) => ({ key: i, vehicle: f.v.vehicle, sourceName: f.e?.sourceName })),
            { atoms: SOURCE_ATOMS, required: barMode === 'source' ? ['source'] : [] },
        );

        const out = [];
        flat.forEach(({ v, e }, i) => {
            const name = labels.get(i)?.short ?? v.name;
            if (!e) { out.push({ id: v.id, name, value: null }); return; }
            out.push({
                id: `${v.id}-${e.sourceName}-${e.origin}`,
                name,
                fullName: labels.get(i)?.full ?? v.name,
                value: e.value, display: e.display, badge: e.badge,
                sub: barMode === 'source' ? null : e.sourceName,
                sourceName: e.sourceName,
                fullData: e.origin === 'session',
                sourceCount: v.entries.length,
                flags: e.flags || [], windowLabel: e.windowLabel,
                color: vehicleColors[v.id],
            });
        });
        const withValue = out.filter(r => r.value != null);
        const bestFirst = sortDir === 'best' ? lowerIsBest : !lowerIsBest;
        withValue.sort((a, b) => bestFirst ? a.value - b.value : b.value - a.value);
        return [...withValue, ...out.filter(r => r.value == null)];
    };

    if (loading) return <LoadingSpinner />;

    return (
        <>
            {!presentationMode && <div className="card mb-6">
                <div className="axis-selectors">
                    <div>
                        <label className="block font-medium mb-2">Bars:</label>
                        <select value={barMode} onChange={e => setBarMode(e.target.value)}
                            className="form-input w-full">
                            <option value="best">Best per vehicle</option>
                            <option value="source">One per source</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Source type:</label>
                        <select value={origin} onChange={e => setOrigin(e.target.value)}
                            className="form-input w-full">
                            <option value="all">All tested</option>
                            <option value="session">Session-backed only</option>
                            <option value="published">Published only</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-medium mb-2">Sort:</label>
                        <select value={sortDir} onChange={e => setSortDir(e.target.value)}
                            className="form-input w-full">
                            <option value="best">Best first</option>
                            <option value="worst">Worst first</option>
                        </select>
                    </div>
                </div>
                <p className="text-xs text-secondary">
                    Every bar is a tested figure, whoever produced it — results derived from
                    imported sessions rank alongside published ones, marked ✦. Manufacturer
                    claims are excluded. A vehicle keeps its color across all four charts.
                </p>
            </div>}

            {CATEGORIES.map(cat => {
                const isBrakingG = cat.key === 'braking' && brakingMode === 'g';
                const opts = optionsFor(cat.key);
                const metricKey = metricFor(cat.key, cat.defaultMetric);
                const scalar = [...SCALARS.accel, ...SCALARS.drag].find(m => m.key === metricKey);

                const byVehicle = isBrakingG ? brakingGEntries() : entriesFor(metricKey, cat.key);
                // Higher is better only for braking-in-g; every other metric here
                // is a time or a distance.
                const rows = rowsFrom(byVehicle, !isBrakingG);

                const axisLabel = isBrakingG ? 'Average deceleration (g)'
                    : cat.key === 'braking' ? 'Distance (ft)'
                    : scalar ? `${scalar.label} (${scalar.unit})`
                    : 'Time (s)';

                if (opts.length === 0 && !isBrakingG) {
                    return (
                        <div key={cat.key} className="card mb-4">
                            <h3 className="text-lg font-semibold mb-1">{cat.title}</h3>
                            <p className="text-sm text-secondary">
                                None of the selected vehicles has {cat.title.toLowerCase()} data yet.
                            </p>
                        </div>
                    );
                }

                return (
                    <PerformanceCompareChart
                        key={cat.key}
                        title={cat.title}
                        metricOptions={opts}
                        metric={metricKey}
                        onMetricChange={k => setMetrics(m => ({ ...m, [cat.key]: k }))}
                        valueModes={cat.valueModes}
                        valueMode={brakingMode}
                        onValueModeChange={setBrakingMode}
                        rows={rows}
                        axisLabel={axisLabel}
                        barMode={barMode}
                        isDark={isDark}
                        presentationMode={presentationMode}
                        note={cat.note}
                    />
                );
            })}

            {!presentationMode && data && (
                <PerformanceMath
                    data={data} selected={selected} categories={CATEGORIES} metricFor={metricFor}
                    origin={origin} brakingMode={brakingMode}
                />
            )}
            {!presentationMode && <ChartInfoBubble chartKey="perfcompare" />}
        </>
    );
}
