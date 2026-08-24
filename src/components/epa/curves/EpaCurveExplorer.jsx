import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import Chart from 'chart.js/auto';
import { useTheme } from '../../../hooks/useTheme';
import { useAppContext } from '../../../context/AppContext';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import { buildEpaCurveFromModel } from '../../../utils/epaDerivations';
import { curveSubjects } from '../../../utils/epaCurveSubjects';
import { PALETTE } from '../../../utils/specHelpers';
import { convSpeed, speedLabel } from '../../../utils/unitConversions';
import CurveSubjectPicker from './CurveSubjectPicker';
import LoadingSpinner from '../../LoadingSpinner';

/**
 * EPA efficiency curves anchored on certification records (#237).
 *
 * A separate variant from EPA Curves, deliberately. That one is driven by the
 * site-wide vehicle selection and plots the records those vehicles link to;
 * this one is driven by the records themselves, so there is no "Selected:" bar
 * and no vehicle need exist. 210 of 211 certification groups carry the
 * road-load coefficients a curve needs, where only ~90 belong to a vehicle in
 * the database — most of what can be plotted has no vehicle to reach it from.
 *
 * The curve maths is `buildEpaCurveFromModel`, unchanged and shared with the
 * vehicle-driven view. What differs is only what supplies the group and the
 * energy — which is the whole argument of the subject model.
 */
const Y_AXES = [
    { key: 'kwh100mi', label: 'Consumption', unit: 'kWh/100mi', needsEnergy: false },
    { key: 'miPerKwh', label: 'Efficiency',  unit: 'mi/kWh',    needsEnergy: false },
    { key: 'mpge',     label: 'MPGe',        unit: 'MPGe',      needsEnergy: false },
    { key: 'rangeMi',  label: 'Range',       unit: 'mi',        needsEnergy: true },
];

export default function EpaCurveExplorer() {
    const { getCertGroupsForCurves, units } = useAppContext();
    const { isDark } = useTheme();
    const canvasRef = useRef(null);
    const chartRef = useRef(null);

    const load = useCallback(() => getCertGroupsForCurves(), [getCertGroupsForCurves]);
    const { data: groups, loading, error } = useAsyncResource(load, []);

    const [initial] = useState(() => {
        const p = new URLSearchParams(window.location.search);
        return {
            selected: p.get('c') ? p.get('c').split(',').filter(Boolean) : [],
            yAxis: Y_AXES.some(a => a.key === p.get('cy')) ? p.get('cy') : 'kwh100mi',
        };
    });
    const [selected, setSelected] = useState(initial.selected);
    const [yAxis, setYAxis] = useState(initial.yAxis);

    const subjects = useMemo(() => curveSubjects(groups ?? []), [groups]);
    const byKey = useMemo(() => new Map(subjects.map(s => [s.key, s])), [subjects]);
    const plotted = useMemo(
        () => selected.map(k => byKey.get(k)).filter(Boolean),
        [selected, byKey],
    );

    const axis = Y_AXES.find(a => a.key === yAxis) ?? Y_AXES[0];

    // A record with no energy has no range, and saying so beats drawing a gap.
    const withoutRange = axis.needsEnergy ? plotted.filter(s => !s.canPlotRange) : [];

    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        p.set('tab', 'epa');
        p.set('sub', 'curves');
        if (selected.length) p.set('c', selected.join(','));
        if (yAxis !== 'kwh100mi') p.set('cy', yAxis);
        window.history.replaceState({ view: 'epa' }, '', `?${p.toString()}`);
    }, [selected, yAxis]);

    useEffect(() => {
        if (!canvasRef.current) return;
        chartRef.current?.destroy();
        if (!plotted.length) return;

        const datasets = plotted.map((s, i) => {
            const curve = buildEpaCurveFromModel(s.group, s.useableKwh ?? 0);
            return {
                label: s.label,
                data: curve
                    .filter(pt => pt[yAxis] != null)
                    .map(pt => ({ x: convSpeed(pt.mph, units), y: pt[yAxis] })),
                borderColor: PALETTE[i % PALETTE.length],
                backgroundColor: PALETTE[i % PALETTE.length],
                // A borrowed-energy curve is drawn dashed on the range axis
                // only. Its shape is measured, so on the consumption axes there
                // is nothing to qualify — dashing it everywhere would imply the
                // whole curve is soft when only its scale is.
                borderDash: (axis.needsEnergy && s.tier === 'nominal') ? [6, 4] : undefined,
                pointRadius: 0,
                borderWidth: 2,
                tension: 0.2,
            };
        });

        const grid = isDark ? 'rgba(148,163,184,0.15)' : 'rgba(100,116,139,0.15)';
        const text = isDark ? 'rgb(226,232,240)' : 'rgb(51,65,85)';

        chartRef.current = new Chart(canvasRef.current, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', intersect: false },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: speedLabel(units), color: text },
                        grid: { color: grid }, ticks: { color: text },
                    },
                    y: {
                        title: { display: true, text: `${axis.label} (${axis.unit})`, color: text },
                        grid: { color: grid }, ticks: { color: text },
                    },
                },
                plugins: { legend: { labels: { color: text, boxHeight: 2 } } },
            },
        });
        return () => chartRef.current?.destroy();
    }, [plotted, yAxis, axis, units, isDark]);

    if (loading) return <LoadingSpinner />;
    if (error) return <div className="empty-state">Certification records could not be loaded.</div>;

    return (
        <div className="stats-view">
            <div className="section-header">
                <div>
                    <div className="section-title">Certification curves</div>
                    <div className="text-caption text-secondary">
                        Efficiency against steady speed, computed from each record’s own road-load
                        coefficients. {subjects.length} records can be plotted — most belong to no
                        vehicle in the database, which is why this view does not use the vehicle selection.
                    </div>
                </div>
            </div>

            <CurveSubjectPicker
                subjects={subjects}
                selected={selected}
                onToggle={(key) => setSelected(prev =>
                    prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])}
                onClear={() => setSelected([])}
            />

            <div className="guide-facet">
                <div className="guide-facet-label">Y axis</div>
                <div className="guide-facet-values">
                    {Y_AXES.map(a => (
                        <button key={a.key} type="button"
                            className={`guide-chip ${yAxis === a.key ? 'active' : ''}`}
                            onClick={() => setYAxis(a.key)}
                            title={a.needsEnergy ? 'Needs usable energy — records without it cannot be drawn on this axis' : undefined}>
                            {a.label}
                        </button>
                    ))}
                </div>
            </div>

            {withoutRange.length > 0 && (
                <div className="guide-warning">
                    {withoutRange.length === 1 ? (
                        <>
                            One selected record has no usable energy, so it is absent from the range axis:
                            {' '}{withoutRange[0].label}. Its consumption curve is unaffected.
                        </>
                    ) : (
                        <>
                            {withoutRange.length} selected records have no usable energy, so they are absent
                            from the range axis: {withoutRange.map(s => s.label).join(', ')}. Their
                            consumption curves are unaffected.
                        </>
                    )}
                </div>
            )}

            {plotted.length === 0 ? (
                <div className="empty-state">Choose one or more certification records to plot.</div>
            ) : (
                <div className="curve-canvas-wrap">
                    <canvas ref={canvasRef} />
                </div>
            )}
        </div>
    );
}
