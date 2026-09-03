import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import Chart from 'chart.js/auto';
import { useTheme } from '../../../hooks/useTheme';
import { useAppContext } from '../../../context/AppContext';
import { useAsyncResource } from '../../../hooks/useAsyncResource';
import { buildEpaCurveFromModel } from '../../../utils/epaDerivations';
import { DEFAULT_SS_ETA, CURVE_SPEED_RANGE } from '../../../constants/epa';
import { curveSubjects, curveTooltipLines, disambiguateLabels } from '../../../utils/epaCurveSubjects';
import { PALETTE } from '../../../utils/specHelpers';
import { convSpeed, speedLabel } from '../../../utils/unitConversions';
import CurveSubjectPicker from './CurveSubjectPicker';
import ViewingConditions, { useViewingConditions } from '../ViewingConditions';
import AxisScaleControls from '../../AxisScaleControls';
import LoadingSpinner from '../../LoadingSpinner';
import { chartTheme, applyChartDefaults } from '../../../utils/chartTheme';
import PlotFrame from '../../charts/PlotFrame';
import { useChartPng } from '../../../hooks/useChartPng';
import InfoIcon from '../../InfoIcon';
import { EPA_EXPLAINERS } from '../../../utils/epaExplainers';
import { fmtTemp, fmtSpeed } from '../../../utils/unitConversions';

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
/**
 * `needsEnergy` decides whether a record without usable energy can appear at
 * all. `etaSensitive` is a different question: consumption, efficiency and MPGe
 * are all computed THROUGH the drivetrain efficiency, so a record whose η fell
 * back to the model default carries that assumption into every point on those
 * axes. Range is affected too, but its energy caveat is the larger one and is
 * reported separately.
 */
const Y_AXES = [
    { key: 'kwh100mi', label: 'Consumption', unit: 'kWh/100mi', digits: 1, needsEnergy: false, etaSensitive: true },
    { key: 'miPerKwh', label: 'Efficiency',  unit: 'mi/kWh',    digits: 3, needsEnergy: false, etaSensitive: true },
    { key: 'mpge',     label: 'MPGe',        unit: 'MPGe',      digits: 1, needsEnergy: false, etaSensitive: true },
    { key: 'rangeMi',  label: 'Range',       unit: 'mi',        digits: 0, needsEnergy: true,  etaSensitive: false },
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
    // Manual axis bounds, null = auto. Not persisted to the URL: the record
    // selection and the axis choice describe WHAT is plotted and are worth
    // sharing, where a zoom is tuning for the session.
    const [scale, setScale] = useState({ xMin: null, xMax: null, yMin: null, yMax: null });

    // The same controls the vehicle-driven curves use, from the same module —
    // two views computing air density slightly differently would be invisible
    // until someone compared one car in both.
    const conditions = useViewingConditions();
    const {
        densityRatio, accessoryOverrideWNum, windSpeedMphNum, windDirectionDegNum,
        gradeGainFtNum, gradeDistanceMilesNum,
    } = conditions.derived;

    const subjects = useMemo(() => curveSubjects(groups ?? []), [groups]);
    const byKey = useMemo(() => new Map(subjects.map(s => [s.key, s])), [subjects]);
    const plotted = useMemo(
        () => selected.map(k => byKey.get(k)).filter(Boolean),
        [selected, byKey],
    );

    const axis = Y_AXES.find(a => a.key === yAxis) ?? Y_AXES[0];

    // A record with no energy has no range, and saying so beats drawing a gap.
    const withoutRange = axis.needsEnergy ? plotted.filter(s => !s.canPlotRange) : [];
    // A different caveat, on the other axes: the curve is drawn, and every
    // point on it rests on an assumed η.
    const assumedEta = axis.etaSensitive ? plotted.filter(s => !s.etaMeasured) : [];

    const displayNames = useMemo(() => disambiguateLabels(plotted), [plotted]);

    // ── The frame's caption ─────────────────────────────────────────────────
    // Deliberately the same shape as EpaCurvesView's: a modelled curve with no
    // statement of what it was modelled AT is not a chart anyone can act on,
    // and these two screens plot the same maths from different subjects.
    const plotTitle = useMemo(
        () => `${axis.label} vs steady speed`,
        [axis],
    );

    const plotSubtitle = useMemo(() => {
        const n = plotted.length;
        const parts = [
            `${n} record${n === 1 ? '' : 's'}`,
            'from EPA road-load coefficients A, B, C',
        ];
        // Condition values are TEXT INPUT state, so an unset field is '' — and
        // `'' != null` is true, so a `!= null` guard lets the empty string
        // through and fmtTemp renders it as 0 °F. Absent has to read as absent
        // on a chart whose whole subject is the conditions it was drawn under.
        const c = conditions.values ?? {};
        const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
        const t = num(c.tempF);
        const w = num(c.windSpeedMph);
        const el = num(c.elevationFt);
        if (t != null) parts.push(fmtTemp(t, units));
        parts.push(w ? `${fmtSpeed(w, units)} wind` : 'still air');
        if (el) parts.push(`${Math.round(el)} ft`);
        parts.push(gradeGainFtNum ? 'graded' : 'level');
        parts.push(units === 'metric' ? 'metric' : 'imperial');
        return parts.join(' · ');
    }, [plotted, conditions, units, gradeGainFtNum]);

    const { copyPng, copied: pngCopied, preview, dismissPreview } =
        useChartPng(chartRef, { title: plotTitle, subtitle: plotSubtitle });
    const [urlCopied, setUrlCopied] = useState(false);

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
            const curve = buildEpaCurveFromModel(
                s.group, s.useableKwh ?? 0, densityRatio, accessoryOverrideWNum,
                windSpeedMphNum, windDirectionDegNum, gradeGainFtNum, gradeDistanceMilesNum,
            );
            return {
                label: displayNames.get(s.key) ?? s.label,
                // Read by the legend to mark a curve the current axis qualifies.
                // Kept off the label itself so the tooltip's first line stays
                // the name and nothing else.
                _flagged: axis.etaSensitive && !s.etaMeasured,
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

        // From the stylesheet, not retyped here — see utils/chartTheme.
        const { grid, legend: text } = chartTheme();
        applyChartDefaults(Chart);

        chartRef.current = new Chart(canvasRef.current, {
            type: 'line',
            data: { datasets },
            options: {
                /* The whole chart is rebuilt on every conditions change, so an
                   animation replays from scratch each time — which hides the
                   very thing the sliders are for. Without it the curves jump
                   straight to the new position and the delta is readable. */
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', intersect: false },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: speedLabel(units), color: text },
                        // The default window is the curve's own domain rather
                        // than a literal 5–120: CURVE_SPEED_RANGE is an Admin
                        // knob, and a hardcoded bound would stop tracking the
                        // data the moment someone widened it.
                        min: scale.xMin ?? convSpeed(CURVE_SPEED_RANGE[0], units),
                        max: scale.xMax ?? convSpeed(CURVE_SPEED_RANGE[1], units),
                        grid: { color: grid }, ticks: { color: text },
                    },
                    y: {
                        title: { display: true, text: `${axis.label} (${axis.unit})`, color: text },
                        min: scale.yMin ?? undefined,
                        max: scale.yMax ?? undefined,
                        grid: { color: grid }, ticks: { color: text },
                    },
                },
                plugins: {
                    legend: {
                        labels: {
                            color: text,
                            boxHeight: 2,
                            // ⚠ on the curves the current axis qualifies, so a
                            // mixed plot says which lines rest on an assumption
                            // without the reader consulting the picker.
                            generateLabels(chart) {
                                const base = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                                return base.map(item => {
                                    const ds = chart.data.datasets[item.datasetIndex];
                                    return ds?._flagged ? { ...item, text: `⚠ ${item.text}` } : item;
                                });
                            },
                        },
                    },
                    tooltip: {
                        // Three lines: the name with its colour, then each axis
                        // with its unit. The default put the x value in the
                        // title and crammed name and y value onto one line,
                        // which read differently from every other chart here.
                        callbacks: {
                            title: () => '',
                            label: (ctx) => curveTooltipLines({
                                name: ctx.dataset.label, x: ctx.parsed.x, y: ctx.parsed.y,
                                xUnit: speedLabel(units), yUnit: axis.unit, digits: axis.digits,
                            })[0],
                            afterLabel: (ctx) => curveTooltipLines({
                                name: ctx.dataset.label, x: ctx.parsed.x, y: ctx.parsed.y,
                                xUnit: speedLabel(units), yUnit: axis.unit, digits: axis.digits,
                            }).slice(1),
                        },
                    },
                },
            },
        });
        return () => chartRef.current?.destroy();
    }, [plotted, yAxis, axis, units, isDark, displayNames, scale,
        densityRatio, accessoryOverrideWNum, windSpeedMphNum, windDirectionDegNum,
        gradeGainFtNum, gradeDistanceMilesNum]);

    if (loading) return <LoadingSpinner />;
    if (error) return <div className="empty-state">Certification records could not be loaded.</div>;

    return (
        <div className="stats-view">
            {/* One line, not a section header block: the layout below is the
                screen, and the only thing worth saying up front is why this
                view ignores the vehicle selection. */}
            <p className="text-note mb-3">
                Efficiency against steady speed, computed from each record’s own road-load
                coefficients. {subjects.length} records can be plotted — most belong to no
                vehicle in the database, which is why this view does not use the vehicle selection.
            </p>

            <div className="chart-layout">
                <aside className="chart-rail">
                    {/* Every class here is Phase 4's. The controls were a stack
                        of chip walls above the plot; the maths is untouched. */}
                    <div className="chart-rail-group">
                        <span className="text-micro">Axes</span>
                        <div className="axis-rows">
                            {/* Stated as a value, not a disabled <input>: a field
                                box says "type here" and then refuses, and greying
                                it only turns that into "type here later". This
                                axis is never anything else. */}
                            <div className="axis-row">
                                <span className="axis-row-key">X</span>
                                <span className="axis-row-fixed">
                                    Steady speed ({speedLabel(units)})
                                    <span className="text-nano">fixed</span>
                                </span>
                            </div>
                            <label className="axis-row">
                                <span className="axis-row-key">Y</span>
                                <select
                                    className="form-input"
                                    value={yAxis}
                                    onChange={e => setYAxis(e.target.value)}
                                >
                                    {Y_AXES.map(a => (
                                        <option key={a.key} value={a.key}>
                                            {a.label} ({a.unit})
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        {/* The module this text comes from was already written
                            and already imported by the vehicle-driven curves.
                            This screen explained nothing at all. */}
                        <span className="text-note">
                            How this is calculated
                            <InfoIcon text={EPA_EXPLAINERS.steadyStateCurve} position="right" />
                        </span>
                    </div>

                    <div className="chart-rail-group">
                        <span className="text-micro">Viewing conditions</span>
                        <ViewingConditions conditions={conditions} />
                    </div>

                    <div className="chart-rail-group">
                        <span className="text-micro">Records</span>
                        <CurveSubjectPicker
                            subjects={subjects}
                            selected={selected}
                            onToggle={(key) => setSelected(prev =>
                                prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])}
                            onClear={() => setSelected([])}
                        />
                    </div>
                </aside>

                <div className="chart-main">
                    {plotted.length === 0 ? (
                        <div className="empty-state">Choose one or more certification records to plot.</div>
                    ) : (
                        <>
                            <PlotFrame
                                title={plotTitle}
                                subtitle={plotSubtitle}
                                preview={preview}
                                onDismissPreview={dismissPreview}
                                exportControls={(
                                    <>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(window.location.href).then(() => {
                                                    setUrlCopied(true);
                                                    setTimeout(() => setUrlCopied(false), 2000);
                                                });
                                            }}
                                            className={`chart-copy-btn ${urlCopied ? 'chart-copy-btn-active' : ''}`}
                                            title="Copy link to this chart view"
                                        >
                                            {urlCopied ? '✓ Copied' : '🔗 URL'}
                                        </button>
                                        <button
                                            onClick={copyPng}
                                            className={`chart-copy-btn ${pngCopied ? 'chart-copy-btn-active' : ''}`}
                                            title="Copy the framed chart as a PNG"
                                        >
                                            {pngCopied ? '✓ Copied' : 'PNG'}
                                        </button>
                                    </>
                                )}
                            >
                                <div style={{ height: 460, position: 'relative' }}>
                                    <canvas ref={canvasRef} />
                                </div>
                            </PlotFrame>

                            {/* Caveats below the figure, where a footnote goes.
                                Two of them, and they belong to different axes:
                                missing energy REMOVES a curve from the range
                                axis; an assumed η leaves it drawn and makes every
                                point on it an estimate. */}
                            {withoutRange.length > 0 && (
                                <div className="guide-warning">
                                    {withoutRange.length === 1 ? (
                                        <>
                                            One selected record has no usable energy, so it is absent from the range axis:
                                            {' '}<strong>{withoutRange[0].label}</strong>. Its consumption curve is unaffected.
                                        </>
                                    ) : (
                                        <>
                                            {withoutRange.length} selected records have no usable energy, so they are absent
                                            from the range axis: <strong>{withoutRange.map(s => s.label).join(', ')}</strong>.
                                            Their consumption curves are unaffected.
                                        </>
                                    )}
                                </div>
                            )}

                            {assumedEta.length > 0 && (
                                <div className="guide-warning">
                                    {/* The affected records are NOT listed. The ⚠ in the
                                        legend already points at them, and repeating the
                                        names turned a caveat into a paragraph nobody
                                        finishes. */}
                                    <strong>
                                        ⚠ {assumedEta.length} curve{assumedEta.length === 1 ? ' is' : 's are'} using
                                        an assumed drivetrain efficiency (η).
                                    </strong>
                                    <div className="mt-1">
                                        {axis.label} requires an η in addition to the EPA provided road load. These
                                        records currently do not have test data to estimate η from, so a universal
                                        estimate of {DEFAULT_SS_ETA} is used instead — the cruise-basis fallback,
                                        because every point on these curves is a constant speed.
                                    </div>
                                    <div className="mt-1">
                                        The SHAPE of each curve is real, but its magnitude scales with η.
                                        Estimated entries are marked ⚠ in the legend.
                                    </div>
                                </div>
                            )}

                            <AxisScaleControls
                                xMin={scale.xMin} xMax={scale.xMax}
                                yMin={scale.yMin} yMax={scale.yMax}
                                xAxisLabel={`Speed (${speedLabel(units)})`}
                                yAxisLabel={`${axis.label} (${axis.unit})`}
                                onChange={(key, value) => setScale(p => ({ ...p, [key]: value }))}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
