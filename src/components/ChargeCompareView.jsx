import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';
import RunSelector from './RunSelector';
import { runTooltipLines } from '../utils/tooltipHelpers';
import { vehicleLabel } from '../utils/specHelpers';
import { useAppContext } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import { convDistance, distanceLabel, fmtSpeed, speedBasisNote, fmtTemp, MI_TO_KM } from '../utils/unitConversions';
import { filterChargingRuns, filterRangeRuns, isRangeRun, pairedChargingRun } from '../utils/runUtils';
import { resolveRangeSource, epaRangeOption, defaultRangeRun, isEpaPartnerId, EPA_PARTNER_ID } from '../utils/rangeSource';
import { pairKey, partnersFor, addPartner, replacePartner, removePartner } from '../utils/pairings';
import { buildSeriesLabels } from '../utils/seriesLabel';
import { sessionFor } from '../utils/testSessions';
import CorrectionControl from './CorrectionControl';
import VerboseLabelToggle from './VerboseLabelToggle';
import { useRunSelection } from '../hooks/useRunSelection';
import { useStickyChartColors } from '../hooks/useStickyChartColors';
import { resolvePairColors } from '../utils/colorUtils';
import LoadingSpinner from './LoadingSpinner';
import ChartInfoBubble from './ChartInfoBubble';
import { chartTheme } from '../utils/chartTheme';


/**
 * A pair's session name, but only when both halves came from the same outing.
 * One half's session says nothing about the pair, and #170's composer would
 * then label the series after an event only part of it belongs to.
 */
function sharedSessionName(rangeRun, chargingRun, sessions) {
    const id = rangeRun?.session_id;
    if (id == null || String(id) !== String(chargingRun?.session_id)) return null;
    return (sessions || []).find(s => String(s.id) === String(id))?.name?.trim() || null;
}

// ── Interpolation helper ──────────────────────────────────────────────────────
// Returns the interpolated yField value at targetX, given points sorted by xField.
// allowExtrapolateBefore — extends linearly backward past the first point (slope of first two).
// allowExtrapolateAfter  — extends linearly forward past the last point (slope of last two).
function interpolate(points, xField, yField, targetX, allowExtrapolateBefore = false, allowExtrapolateAfter = false) {
    const valid = points.filter(p => p[xField] != null && p[yField] != null);
    if (valid.length === 0) return null;
    const before = [...valid].filter(p => p[xField] <= targetX).at(-1);
    const after  = valid.find(p => p[xField] > targetX);
    if (before && after) {
        if (before[xField] === targetX) return before[yField];
        const t = (targetX - before[xField]) / (after[xField] - before[xField]);
        return before[yField] + t * (after[yField] - before[yField]);
    }
    if (!before && allowExtrapolateBefore && valid.length >= 2) {
        const [p0, p1] = valid;
        const slope = (p1[yField] - p0[yField]) / (p1[xField] - p0[xField]);
        return p0[yField] + slope * (targetX - p0[xField]);
    }
    if (!after && before && allowExtrapolateAfter && valid.length >= 2) {
        const last = valid[valid.length - 1];
        const prev = valid[valid.length - 2];
        const slope = (last[yField] - prev[yField]) / (last[xField] - prev[xField]);
        return last[yField] + slope * (targetX - last[xField]);
    }
    return null;
}

// Compute 0–1 amber alert intensity for top-end extrapolation.
// overshoot = how far past the data edge we extrapolated; total = the full requested span.
// Starts at 1% overshoot, reaches full amber at 20% overshoot.
function topAlertAmt(overshoot, total) {
    if (!total || overshoot <= 0) return 0;
    return Math.min(1, Math.max(0, (overshoot / total * 100 - 1) / 19));
}

// ── Bar label plugin (same style as RangeChartView barGroupPlugin) ────────────
function makeBarPlugin(flatRuns, isHorizontal, units, isDark) {
    return {
        id: 'compareBarLabels',
        afterDatasetsDraw(chart) {
            if (!flatRuns?.length) return;
            const ctx2   = chart.ctx;
            const meta   = chart.getDatasetMeta(0);
            const xScale = chart.scales.x;
            const area   = chart.chartArea;

            // Build consecutive vehicle groups
            const groups = [];
            flatRuns.forEach((run, i) => {
                const last = groups[groups.length - 1];
                if (last && last.vehicleName === run.vehicleName) {
                    last.endIdx = i;
                } else {
                    groups.push({ vehicleName: run.vehicleName, startIdx: i, endIdx: i });
                }
            });

            // ── Badges inside each bar ────────────────────────────────────────
            flatRuns.forEach((run, i) => {
                const bar = meta.data[i];
                if (!bar) return;

                const badges = [];
                if (run._noData) {
                    badges.push({ text: 'No data', primary: true, alertAmt: 0 });
                } else {
                    const socAlertAmt = Math.min(1, Math.max(0, ((run._socDeviation ?? 0) - 1) / 4));
                    if (run._yValue != null) badges.push({ text: `${run._yValue} ${run._yUnit}`, primary: true, alertAmt: run._topDeviationAmt ?? 0 });
                    if (run._startSoc  != null) {
                        const socText = run._endSoc != null ? `${run._startSoc}%→${run._endSoc}%` : `${run._startSoc}% SoC`;
                        badges.push({ text: socText, alertAmt: socAlertAmt });
                    }
                    if (run._startRange != null) badges.push({ text: run._endRange != null ? `${run._startRange}→${run._endRange} ${run._rangeUnit}` : `${run._startRange} ${run._rangeUnit}`, alertAmt: 0 });
                    if (run.speed_mph   != null) badges.push({ text: fmtSpeed(run.speed_mph, units), alertAmt: 0, type: 'speed' });
                    if (speedBasisNote(run))     badges.push({ text: speedBasisNote(run), alertAmt: 0, type: 'speed' });
                    if (run.temperature_f != null) badges.push({ text: fmtTemp(run.temperature_f, units), alertAmt: 0 });
                }
                if (badges.length === 0) return;

                const pillH = 15, pillPad = 5, rr = 3;

                function drawPill(px, py, pw, text, alertAmt) {
                    const bgColor  = alertAmt > 0
                        ? `rgba(217,119,6,${(alertAmt * 0.85).toFixed(2)})`
                        : 'rgba(0,0,0,0.28)';
                    ctx2.fillStyle = bgColor;
                    ctx2.beginPath();
                    ctx2.moveTo(px + rr, py);
                    ctx2.lineTo(px + pw - rr, py);
                    ctx2.quadraticCurveTo(px + pw, py,           px + pw, py + rr);
                    ctx2.lineTo(px + pw, py + pillH - rr);
                    ctx2.quadraticCurveTo(px + pw, py + pillH,   px + pw - rr, py + pillH);
                    ctx2.lineTo(px + rr, py + pillH);
                    ctx2.quadraticCurveTo(px, py + pillH,        px, py + pillH - rr);
                    ctx2.lineTo(px, py + rr);
                    ctx2.quadraticCurveTo(px, py,                px + rr, py);
                    ctx2.closePath();
                    ctx2.fill();
                    ctx2.fillStyle    = '#fff';
                    ctx2.textAlign    = 'center';
                    ctx2.textBaseline = 'middle';
                    ctx2.fillText(text, px + pw / 2, py + pillH / 2);
                }

                if (isHorizontal) {
                    // Horizontal bars: bar.x=right, bar.base=left, bar.y=center, bar.height=bar height
                    // Show only: primary value, SoC, speed (data-rich tooltip covers the rest)
                    const displayBadges = badges.filter(b =>
                        b.primary || b.alertAmt > 0 || b.type === 'speed'
                    );
                    const gap = 4, leftPad = 6;
                    let drawX = bar.base + leftPad;

                    displayBadges.forEach(({ text, primary, alertAmt }) => {
                        ctx2.save();
                        ctx2.font = primary ? 'bold 11px sans-serif' : '10px sans-serif';
                        const tw = ctx2.measureText(text).width;
                        const pw = tw + pillPad * 2;
                        if (drawX + pw > bar.x - 4) { ctx2.restore(); return; }
                        const py = bar.y - pillH / 2;
                        drawPill(drawX, py, pw, text, alertAmt);
                        ctx2.restore();
                        drawX += pw + gap;
                    });
                } else {
                    // Vertical bars: stacked top-to-bottom
                    const barH = bar.base - bar.y;
                    const barW = bar.width;
                    const gap = 3, topPad = 6;
                    let drawY = bar.y + topPad;

                    badges.forEach(({ text, primary, alertAmt }) => {
                        if (drawY + pillH > bar.base - topPad) return;
                        ctx2.save();
                        ctx2.font = primary ? 'bold 11px sans-serif' : '10px sans-serif';
                        const tw = ctx2.measureText(text).width;
                        const pw = tw + pillPad * 2;
                        if (pw > barW - 4) { ctx2.restore(); drawY += pillH + gap; return; }
                        const px = bar.x - pw / 2;
                        drawPill(px, drawY, pw, text, alertAmt);
                        ctx2.restore();
                        drawY += pillH + gap;
                    });
                }
            });

            // ── Vehicle group labels + dashed separators ──────────────────────
            if (isHorizontal) {
                // Run names drawn to the right of each bar
                flatRuns.forEach((run, i) => {
                    const bar = meta.data[i];
                    if (!bar) return;
                    ctx2.save();
                    ctx2.font         = '12px sans-serif';
                    ctx2.fillStyle    = isDark ? 'rgb(203,213,225)' : '#6b7280';
                    ctx2.textAlign    = 'left';
                    ctx2.textBaseline = 'middle';
                    ctx2.fillText(run.name, bar.x + 8, bar.y);
                    ctx2.restore();
                });

                // Left-side bracket + vehicle name, horizontal separator between groups
                groups.forEach((group, gi) => {
                    const startBar = meta.data[group.startIdx];
                    const endBar   = meta.data[group.endIdx];
                    if (!startBar || !endBar) return;

                    const y1 = startBar.y - startBar.height / 2;
                    const y2 = endBar.y   + endBar.height   / 2;
                    const cy = (y1 + y2) / 2;

                    ctx2.save();
                    ctx2.strokeStyle = isDark ? 'rgba(203,213,225,0.5)' : 'rgba(107,114,128,0.55)';
                    ctx2.lineWidth   = 1.5;
                    ctx2.beginPath();
                    ctx2.moveTo(area.left - 6, y1 + 3);
                    ctx2.lineTo(area.left - 6, y2 - 3);
                    ctx2.stroke();
                    ctx2.restore();

                    ctx2.save();
                    ctx2.font         = 'bold 13px sans-serif';
                    ctx2.fillStyle    = isDark ? 'rgb(241,245,249)' : '#374151';
                    ctx2.textAlign    = 'right';
                    ctx2.textBaseline = 'middle';
                    ctx2.fillText(group.vehicleName, area.left - 10, cy);
                    ctx2.restore();

                    if (gi < groups.length - 1) {
                        const nextStartBar = meta.data[groups[gi + 1].startIdx];
                        if (nextStartBar) {
                            const sepY = (y2 + (nextStartBar.y - nextStartBar.height / 2)) / 2;
                            ctx2.save();
                            ctx2.strokeStyle = isDark ? 'rgba(100,116,139,0.45)' : 'rgba(107,114,128,0.35)';
                            ctx2.lineWidth   = 1;
                            ctx2.setLineDash([5, 4]);
                            ctx2.beginPath();
                            ctx2.moveTo(area.left,  sepY);
                            ctx2.lineTo(area.right, sepY);
                            ctx2.stroke();
                            ctx2.restore();
                        }
                    }
                });
            } else {
                // Below x-axis: underline + label, vertical separator between groups
                const groupLabelY = xScale.bottom + 5;
                groups.forEach((group, gi) => {
                    const startBar = meta.data[group.startIdx];
                    const endBar   = meta.data[group.endIdx];
                    if (!startBar || !endBar) return;

                    const x1 = startBar.x - startBar.width / 2;
                    const x2 = endBar.x   + endBar.width  / 2;
                    const cx = (x1 + x2) / 2;

                    ctx2.save();
                    ctx2.strokeStyle = isDark ? 'rgba(203,213,225,0.5)' : 'rgba(107,114,128,0.55)';
                    ctx2.lineWidth   = 1.5;
                    ctx2.beginPath();
                    ctx2.moveTo(x1 + 3, groupLabelY);
                    ctx2.lineTo(x2 - 3, groupLabelY);
                    ctx2.stroke();
                    ctx2.restore();

                    ctx2.save();
                    ctx2.font         = 'bold 13px sans-serif';
                    ctx2.fillStyle    = isDark ? 'rgb(241,245,249)' : '#374151';
                    ctx2.textAlign    = 'center';
                    ctx2.textBaseline = 'top';
                    ctx2.fillText(group.vehicleName, cx, groupLabelY + 4);
                    ctx2.restore();

                    if (gi < groups.length - 1) {
                        const nextStartBar = meta.data[groups[gi + 1].startIdx];
                        if (nextStartBar) {
                            const sepX = (x2 + (nextStartBar.x - nextStartBar.width / 2)) / 2;
                            ctx2.save();
                            ctx2.strokeStyle = isDark ? 'rgba(100,116,139,0.45)' : 'rgba(107,114,128,0.35)';
                            ctx2.lineWidth   = 1;
                            ctx2.setLineDash([5, 4]);
                            ctx2.beginPath();
                            ctx2.moveTo(sepX, area.top);
                            ctx2.lineTo(sepX, area.bottom);
                            ctx2.stroke();
                            ctx2.restore();
                        }
                    }
                });
            }
        },
    };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ChargeCompareView({
    vehicles, selectedVehicleIds,
    // Controls — lifted to App.jsx so they can be synced to the pop-out via BroadcastChannel.
    // Default values match the URL-param fallback previously handled internally.
    xMinutes = 15, setXMinutes,
    mMiles   = 150, setMMiles,
    startSoc = 10,  setStartSoc,
    // Global chart-session pairings (utils/pairings.js). Read-only in the
    // pop-out, which receives them over BroadcastChannel and must not edit.
    pairings = {},
    setPairings = () => {},
    presentationMode = false,
    verboseLabels = false,
    correctionMode = 'none',
    setChartConfig = null,
}) {
    const { units, testSessions } = useAppContext();
    const { isDark } = useTheme();
    const [runDataCache,    setRunDataCache]    = useState({});
    const [loading,         setLoading]         = useState(false);
    const [copied,          setCopied]          = useState(false);
    const [orientation,     setOrientation]     = useState('horizontal');
    const isHorizontal = orientation === 'horizontal';

    const chart1Ref      = useRef(null);
    const chart1Instance = useRef(null);
    const chart2Ref      = useRef(null);
    const chart2Instance = useRef(null);

    const handleCopyUrl = () => {
        // App.jsx auto-syncs cmp_soc / cmp_mins / cmp_mi into the URL whenever
        // compareConfig changes, so window.location.href always has the latest state.
        navigator.clipboard.writeText(window.location.href).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    // Preserve the user's pill order
    const selectedVehicles = useMemo(
        () => selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean),
        [vehicles, selectedVehicleIds]
    );

    // Charging-primary: one series per (charging test × range test) pair.
    //
    // This chart used to iterate range runs and hunt for a charging run to supply
    // the data points, which made the range test the subject and buried the
    // pairing. Inverted, the charging curve is the subject and the range test is
    // the basis you choose for it — which is the question the chart answers.
    //
    // A charging run with no explicit pairing still gets one row, whose partner
    // the resolver picks (ranks 2-4). So an untouched chart behaves exactly as it
    // did before anyone pairs anything.
    const resolvedPairs = useMemo(() => {
        const result = [];
        for (const vehicle of selectedVehicles) {
            const chargingRuns = filterChargingRuns(vehicle.runs);
            // EPA rated range is a range basis with no test behind it, so it joins
            // the primary list rather than the partner dropdown.
            const epa = epaRangeOption(vehicle);
            const primaries = epa ? [...filterRangeRuns(vehicle.runs), epa] : filterRangeRuns(vehicle.runs);

            for (const rangeRun of primaries) {
                const pinned = partnersFor(pairings, rangeRun.id);
                const rows   = pinned.length ? pinned : [null];

                for (const partnerId of rows) {
                    // URL pairing → curator's stored pairing → vehicle default.
                    const autoCharging = pairedChargingRun(rangeRun, vehicle);
                    const chargingRun = partnerId
                        ? chargingRuns.find(r => String(r.id) === String(partnerId)) ?? autoCharging
                        : autoCharging;
                    if (!chargingRun) continue;

                    // The range side is always explicit here — it IS the row — so
                    // the resolver is entered at rank 1 and its fallbacks only
                    // matter when the chosen test carries no usable data.
                    const rangeSrc = resolveRangeSource(chargingRun, {
                        vehicle,
                        explicitPairing: isEpaPartnerId(rangeRun.id) ? EPA_PARTNER_ID : rangeRun,
                        correction: { mode: correctionMode },
                        session: sessionFor(testSessions, rangeRun),
                    });

                    result.push({
                        key:         pairKey(rangeRun.id, partnerId),
                        vehicle,
                        sessionName: sharedSessionName(rangeRun, chargingRun, testSessions),
                        rangeRun:    { ...rangeRun, vehicleName: vehicleLabel(vehicle), vehicleId: vehicle.id },
                        chargingRun,
                        rangeSrc,
                    });
                }
            }
        }

        return result;
    }, [selectedVehicles, pairings, testSessions, correctionMode]);

    const neededRunIds = useMemo(
        () => [...new Set(resolvedPairs.map(p => p.chargingRun?.id).filter(Boolean))],
        [resolvedPairs]
    );

    // ── Lazy-load data_points for resolved charging runs ──────────────────────
    useEffect(() => {
        const fetchMissing = async () => {
            const missing = neededRunIds.filter(id => !(id in runDataCache));
            if (missing.length === 0) return;
            setLoading(true);
            const updates = {};
            const allRuns = vehicles.flatMap(v => v.runs || []);
            for (const runId of missing) {
                try {
                    if (dataService.useSupabase) {
                        const run = allRuns.find(r => String(r.id) === String(runId));
                        if (run?._inherited) {
                            updates[runId] = await dataService.getRunData(run._realRunId, run._efficiencyFactor ?? 1, run._capacityFactor ?? 1);
                        } else {
                            updates[runId] = await dataService.getRunData(runId);
                        }
                    } else {
                        for (const v of vehicles) {
                            const run = v.runs?.find(r => r.id === runId);
                            if (run) { updates[runId] = run.data || []; break; }
                        }
                    }
                } catch {
                    updates[runId] = [];
                }
            }
            setRunDataCache(prev => ({ ...prev, ...updates }));
            setLoading(false);
        };
        fetchMissing();
    }, [neededRunIds.join(',')]);

    // ── Auto-select any new pairs when vehicles or pairings change ────────────
    // Selection is by pair key, so adding a second range partner to a charging
    // test brings the new series in already selected rather than requiring a
    // second click in a different part of the UI.
    // Auto-select genuinely NEW rows, never re-select ones the user turned off.
    //
    // Tracked per range test rather than per pair key, because repinning a row
    // changes its key ('70::' becomes '70::12'). Keying on the pair alone made
    // every deselected row spring back the moment any dropdown changed, and
    // meant a repinned row could not carry its selection across.
    // Selection lives in the shared hook (hooks/useRunSelection.js) so this chart,
    // Road Trip and anything added later behave identically when the data shifts
    // underneath them — pruning, repin carry-over and first-sighting bootstrap
    // were three separate implementations that each got a different part wrong.
    // Bars are coloured by the range test (the row's subject). The hook gives the
    // same session-override behaviour as the other charts without a DB write.
    const colorableRuns = useMemo(
        () => resolvedPairs.map(p => p.rangeRun),
        [resolvedPairs]
    );
    const { colorMap, setColorOverride } = useStickyChartColors(colorableRuns, {
        autoColor: false,   // this chart has no Auto Color toggle; overrides still apply
        resetKey: selectedVehicleIds.join(','),
    });

    const selectionRows = useMemo(
        () => resolvedPairs.map(p => ({
            key: p.key,
            vehicleId: p.rangeRun.vehicleId,
            // Scoped to the vehicle: the EPA row's id is a shared sentinel, so a
            // bare run id would make every vehicle's EPA row one group and the
            // hook's carry rule would select them all together.
            groupId: `${p.rangeRun.vehicleId}:${p.rangeRun.id}`,
        })),
        [resolvedPairs]
    );

    // One row per vehicle on arrival, not every range test. A car with a dozen
    // range tests buries the chart otherwise, and the per-vehicle "all" link is
    // there for when you want the rest.
    //
    // Prefers the vehicle's default range test, falling back to its first row:
    // defaultRangeRun() requires measurable distance/SoC data, and a range test
    // without it would otherwise leave the vehicle with nothing selected at all.
    const bootstrapOneRow = useCallback((vehicleId, vehicleRows) => {
        const vehicle = selectedVehicles.find(v => v.id === vehicleId);
        const preferred = vehicle ? defaultRangeRun(vehicle) : null;
        const match = preferred
            ? vehicleRows.find(r => String(r.groupId) === `${vehicleId}:${preferred.id}`)
            : null;
        const pick = match ?? vehicleRows[0];
        return pick ? [pick.key] : [];
    }, [selectedVehicles]);

    const { selected: selectedRuns, toggle: toggleRun } = useRunSelection(
        selectionRows, { shouldBootstrap: bootstrapOneRow }
    );

    // Name each bar by what distinguishes it from the OTHER BARS ON SCREEN, so
    // the labels answer the comparison you are actually looking at. Minimising
    // over every resolved pair instead would let a deselected run lengthen the
    // labels of the ones you kept.
    //
    // The vehicle atoms are declared already-supplied: this chart groups bars by
    // vehicle and prints that name under the axis, so repeating it in every bar
    // label is what made these unreadably long.
    const activePairs = useMemo(() => {
        const active = resolvedPairs.filter(p => selectedRuns.includes(p.key));
        const labels = buildSeriesLabels(active, { supplied: ['year', 'make', 'model', 'trim'] });
        // One range test paired with two charging curves used to render two bars
        // in the SAME colour, since colour came from the range test alone. Shade
        // by partner within the range test's own hue so the rows still read as
        // related — see resolvePairColors.
        const pairColors = resolvePairColors(active.map(p => ({
            key:        p.key,
            primaryId:  p.rangeRun.id,
            baseColor:  colorMap[p.rangeRun.id] || p.rangeRun.color || p.chargingRun.color,
        })));

        return active.map(p => ({
            ...p,
            label: (verboseLabels ? labels.get(p.key)?.full : labels.get(p.key)?.short) ?? p.rangeRun.name,
            fullLabel: labels.get(p.key)?.full ?? p.rangeRun.name,
            color: pairColors[p.key],
        }));
    }, [resolvedPairs, selectedRuns, verboseLabels, colorMap]);

    // ── Compute bars for one chart type ──────────────────────────────────────
    // chartType: 'range_added' | 'time_to_range'
    const buildBars = (chartType) => {
        const flatRuns = [];

        for (const { key, rangeRun, chargingRun, label, fullLabel, rangeSrc, color: pairColor } of activePairs) {
            const chargingRunId = chargingRun.id;
            const base = {
                id:              key,
                name:            label,
                // Nothing the short label elided is lost — the tooltip says it all.
                fullName:        fullLabel,
                vehicleName:     rangeRun.vehicleName,
                vehicleId:       rangeRun.vehicleId,
                color:           pairColor || colorMap[rangeRun.id] || rangeRun.color || chargingRun.color || '#3b82f6',
                // Each pill describes the half it came from: speed and conditions
                // belong to the range test, which is what this row enumerates.
                speed_mph:       rangeRun.speed_mph,
                temperature_f:   rangeRun.temperature_f,
                source:          rangeRun.source,
                _trim:           rangeRun._trim ?? null,
                _chargingRunName: chargingRun.name,
                _yUnit:          chartType === 'range_added' ? distanceLabel(units) : 'min',
                _rangeUnit:      distanceLabel(units),
                // Which range basis produced these miles, for the provenance label.
                _rangeSource:    rangeSrc?.source ?? 'none',
                _rangeSourceNote: rangeSrc?.note ?? null,
                _rangeSourceRun:  rangeSrc?.sourceRun?.name ?? null,
            };

            // No charging run resolved, or data not yet loaded
            if (!chargingRunId || !(chargingRunId in runDataCache)) {
                flatRuns.push({ ...base, _yValue: 0, _startSoc: null, _startRange: null, _noData: true });
                continue;
            }

            // Which range basis is in play (see utils/rangeSource.js).
            //
            // miPerSoc present → LINEAR: miles come from the paired range test's
            //   measured miles-per-%SoC, so the charging run only has to supply
            //   SoC against time. Runs with no recorded range column now work.
            // miPerSoc null    → RECORDED: fall back to interpolating the run's
            //   own range_value points, which is what this chart always did.
            const miPerSoc  = rangeSrc?.miPerSoc ?? null;
            const useLinear = miPerSoc != null;

            // The recorded path additionally needs the range column.
            const raw = (runDataCache[chargingRunId] || []).filter(
                p => p.soc != null && p.time != null && (useLinear || p.range != null)
            );

            if (raw.length === 0) {
                flatRuns.push({ ...base, _yValue: 0, _startSoc: startSoc, _startRange: null, _noData: true });
                continue;
            }

            // Sort by each axis for clean interpolation
            const bySoc  = [...raw].sort((a, b) => a.soc  - b.soc);
            const byTime = [...raw].sort((a, b) => a.time - b.time);

            // Absolute range at a given SoC. Linear reads it off the paired test
            // (range remaining at that SoC); recorded interpolates the run's own
            // range column.
            const rangeAtSoc = (soc) => useLinear
                ? soc * miPerSoc
                : interpolate(bySoc, 'soc', 'range', soc, true);

            // Z baseline: exact interpolation (or backward extrapolation) to startSoc.
            // allowExtrapolateBefore=true lets us normalize runs whose data starts above startSoc.
            const Tz = interpolate(bySoc, 'soc', 'time', startSoc, true);
            const Rz = rangeAtSoc(startSoc);

            if (Tz == null || Rz == null) {
                flatRuns.push({ ...base, _yValue: 0, _startSoc: startSoc, _startRange: null, _noData: true });
                continue;
            }

            // How far below the actual first data point did we extrapolate?
            const socDeviation = Math.round((bySoc[0].soc - startSoc) * 10) / 10;

            if (chartType === 'range_added') {
                const targetTime  = Tz + xMinutes;
                const lastTime    = byTime[byTime.length - 1].time;
                const timeOvershoot = Math.max(0, targetTime - lastTime);
                const SocRaw = interpolate(byTime, 'time', 'soc', targetTime, false, true);
                // A pack cannot exceed 100% SoC. Extrapolating forward past the end
                // of a short run can produce SoC well above that, and the linear
                // model has no ceiling of its own to catch it — unclamped, a run
                // whose data spans a couple of minutes yielded 4800 mi added in 15.
                const SocEnd = SocRaw != null ? Math.min(100, SocRaw) : null;
                // Linear: the SoC gained over the window, priced at the paired
                // test's miles-per-%SoC. Recorded: read the range column directly.
                const Rend = useLinear
                    ? (SocEnd != null ? SocEnd * miPerSoc : null)
                    : interpolate(byTime, 'time', 'range', targetTime, false, true);
                const yValueMi = Rend != null ? Math.round((Rend - Rz) * 10) / 10 : null;
                const yValue   = yValueMi != null ? convDistance(yValueMi, units) : null;
                flatRuns.push({
                    ...base,
                    _yValue:          yValue ?? 0,
                    _startSoc:        startSoc,
                    _endSoc:          SocEnd != null ? Math.round(SocEnd * 10) / 10 : null,
                    _startRange:      Math.round(convDistance(Rz, units)),
                    _endRange:        Rend != null ? Math.round(convDistance(Rend, units)) : null,
                    _socDeviation:    socDeviation,
                    _topDeviationAmt: topAlertAmt(timeOvershoot, xMinutes),
                    _noData:          yValue == null,
                });
            } else {
                // Linear: the miles asked for convert to a SoC target, and the
                // charging curve is read on the SoC axis. Recorded: sort by the
                // range column and read time off it, as before.
                let Tend, SocEnd, rangeOvershoot, unreachable = false;
                if (useLinear) {
                    const targetSoc = startSoc + mMiles / miPerSoc;
                    const lastSoc   = bySoc[bySoc.length - 1].soc;
                    // Asking for more miles than a full pack holds from this SoC is
                    // not a long charge, it is impossible — report no data rather
                    // than extrapolating past 100% into a fictional time.
                    unreachable = targetSoc > 100;
                    Tend   = unreachable ? null : interpolate(bySoc, 'soc', 'time', targetSoc, false, true);
                    SocEnd = Math.min(100, targetSoc);
                    // Expressed in miles so it stays comparable with mMiles.
                    rangeOvershoot = Math.max(0, targetSoc - lastSoc) * miPerSoc;
                } else {
                    const byRange     = [...raw].sort((a, b) => a.range - b.range);
                    const targetRange = Rz + mMiles;
                    const lastRange   = byRange[byRange.length - 1].range;
                    Tend   = interpolate(byRange, 'range', 'time', targetRange, false, true);
                    SocEnd = interpolate(byRange, 'range', 'soc',  targetRange, false, true);
                    rangeOvershoot = Math.max(0, targetRange - lastRange);
                }
                const yValue = Tend != null ? Math.round((Tend - Tz) * 10) / 10 : null;
                flatRuns.push({
                    ...base,
                    _yValue:          yValue ?? 0,
                    _startSoc:        startSoc,
                    _endSoc:          SocEnd != null ? Math.round(SocEnd * 10) / 10 : null,
                    _startRange:      Math.round(convDistance(Rz, units)),
                    _endRange:        Math.round(convDistance(Rz + mMiles, units)),
                    _socDeviation:    socDeviation,
                    _topDeviationAmt: topAlertAmt(rangeOvershoot, mMiles),
                    _noData:          yValue == null,
                });
            }
        }

        if (flatRuns.length === 0) return null;

        const yLabel   = chartType === 'range_added' ? `Range Added (${distanceLabel(units)})` : 'Time (min)';
        const datasets = [{
            label:           yLabel,
            data:            flatRuns.map(r => r._yValue),
            backgroundColor: flatRuns.map(r => r._noData ? 'rgba(180,180,180,0.35)' : r.color),
            borderColor:     flatRuns.map(r => r._noData ? 'rgba(180,180,180,0.6)'  : r.color),
            borderRadius:    4,
            borderSkipped:   false,
        }];

        return { data: { labels: flatRuns.map(r => r.name), datasets }, flatRuns, yLabel };
    };

    // ── Build and render both charts ──────────────────────────────────────────
    useEffect(() => {
        // From the stylesheet, not retyped here — see utils/chartTheme.
        const { tick: tickColor, grid: gridColor, legend: legendColor } = chartTheme();

        [chart1Instance, chart2Instance].forEach(inst => {
            if (inst.current) { inst.current.destroy(); inst.current = null; }
        });

        const bars1 = buildBars('range_added');
        const bars2 = buildBars('time_to_range');

        const createChart = (canvasRef, instanceRef, built) => {
            if (!canvasRef.current || !built) return;
            instanceRef.current = new Chart(canvasRef.current.getContext('2d'), {
                type:    'bar',
                data:    built.data,
                plugins: [makeBarPlugin(built.flatRuns, isHorizontal, units, isDark)],
                options: {
                    indexAxis: isHorizontal ? 'y' : undefined,
                    layout: { padding: isHorizontal ? { top: 0, left: 140, right: 10 } : { top: 0, bottom: 55 } },
                    animation: false,
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            displayColors: false,
                            callbacks: {
                                title(items) {
                                    if (!items.length) return;
                                    const run = built.flatRuns[items[0].dataIndex];
                                    return run ? (run.fullName ?? `${run.name} — ${run.vehicleName}`) : undefined;
                                },
                                label(ctx) {
                                    const run = built.flatRuns[ctx.dataIndex];
                                    if (!run)        return String(run?._yValue ?? '');
                                    if (run._noData) return 'No charging data available';
                                    return `${run._yValue} ${run._yUnit}`;
                                },
                                afterLabel(ctx) {
                                    const run = built.flatRuns[ctx.dataIndex];
                                    if (!run || run._noData) return [];
                                    const ru = run._rangeUnit;
                                    return runTooltipLines(run, [
                                        run._startSoc   != null ? (run._endSoc   != null ? `SoC: ${run._startSoc}% → ${run._endSoc}%`                   : `Start SoC: ${run._startSoc}%`)        : null,
                                        run._startRange != null ? (run._endRange != null ? `Range: ${run._startRange} → ${run._endRange} ${ru}` : `Start range: ${run._startRange} ${ru}`) : null,
                                        run._chargingRunName && run._chargingRunName !== run.name ? `Charging data: ${run._chargingRunName}` : null,
                                        // Which range basis priced these miles. Named on every
                                        // bar: a measured-efficiency figure and a guess-o-meter
                                        // readout must never be silently interchangeable.
                                        run._rangeSource === 'recorded'
                                            ? 'Range: recorded range column'
                                            : run._rangeSourceRun && run._rangeSourceRun !== run.name
                                                ? `Range basis: ${run._rangeSourceRun}`
                                                : null,
                                    ].filter(Boolean), units);
                                },
                            },
                        },
                    },
                    scales: isHorizontal ? {
                        x: { title: { display: true, text: built.yLabel, color: legendColor }, beginAtZero: true, ticks: { color: tickColor }, grid: { color: gridColor } },
                        y: { type: 'category', grid: { display: false }, title: { display: false }, ticks: { display: false } },
                    } : {
                        x: { type: 'category', grid: { display: false }, title: { display: false }, ticks: { color: tickColor } },
                        y: { title: { display: true, text: built.yLabel, color: legendColor }, beginAtZero: true, ticks: { color: tickColor }, grid: { color: gridColor } },
                    },
                },
            });
        };

        createChart(chart1Ref, chart1Instance, bars1);
        createChart(chart2Ref, chart2Instance, bars2);

        return () => {
            [chart1Instance, chart2Instance].forEach(inst => {
                if (inst.current) { inst.current.destroy(); inst.current = null; }
            });
        };
    // activePairs, not just selectedRuns: changing a row's partner can leave the
    // selection array identical (same row, different pairing) while every bar's
    // value changes, and the chart would keep the previous partner's numbers.
    // It also carries the labels and colours, so a Full Labels toggle redraws —
    // depending on resolvedPairs alone left that toggle inert, since it changes
    // neither the pairs nor the selection.
    }, [selectedVehicleIds, xMinutes, mMiles, startSoc, runDataCache, orientation, activePairs, units, isDark]);

    const hasRangeRuns = resolvedPairs.length > 0;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Controls card — hidden in presentation/pop-out mode ── */}
            {!presentationMode && <div className="card mb-6">
                {loading && <LoadingSpinner message="Loading charging data…" />}
                <div className="flex flex-wrap items-center gap-6">
                    <label className="flex items-center gap-2 text-sm font-medium text-secondary">
                        Starting SoC (%):
                        <input
                            type="number"
                            value={startSoc}
                            min={1}
                            max={80}
                            onChange={e => setStartSoc(Math.min(80, Math.max(1, Number(e.target.value))))}
                            className="form-input w-20"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-secondary">
                        Charging Time (minutes):
                        <input
                            type="number"
                            value={xMinutes}
                            min={1}
                            max={120}
                            onChange={e => setXMinutes(Math.max(1, Number(e.target.value)))}
                            className="form-input w-20"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-secondary">
                        Range to add ({distanceLabel(units)}):
                        <input
                            type="number"
                            value={units === 'metric' ? Math.round(mMiles * MI_TO_KM) : mMiles}
                            min={1}
                            max={units === 'metric' ? 650 : 400}
                            onChange={e => {
                                const v = Math.max(1, Number(e.target.value));
                                setMMiles(units === 'metric' ? Math.round(v / MI_TO_KM) : v);
                            }}
                            className="form-input w-20"
                        />
                    </label>
                    <div className="flex items-center gap-1 ml-auto">
                        {['vertical', 'horizontal'].map(o => (
                            <button
                                key={o}
                                onClick={() => setOrientation(o)}
                                className={`btn ${orientation === o ? 'btn-primary' : 'btn-secondary'}`}
                            >
                                {o === 'vertical' ? '↕ Vertical' : '↔ Horizontal'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mt-4">
                    <RunSelector
                        headerActions={setChartConfig ? <>
                            <CorrectionControl mode={correctionMode} setChartConfig={setChartConfig} />
                            <VerboseLabelToggle verbose={verboseLabels} setChartConfig={setChartConfig} />
                        </> : null}
                        vehicles={selectedVehicles}
                        selectedRunIds={selectedRuns}
                        onToggleRun={toggleRun}
                        onUpdateRunColor={(_vehicleId, runId, color) => setColorOverride(runId, color)}
                        // Without this the swatches showed each run's stored
                        // colour while the bars showed the resolved one, so the
                        // picker and the chart disagreed from the first render.
                        colorMap={colorMap}
                        runFilter={(run, vehicle) =>
                            // A range test with no charging curve to pair against
                            // cannot produce a bar, so it is not offered.
                            isRangeRun(run) && filterChargingRuns(vehicle.runs).length > 0}
                        emptyMessage="No range test records"
                        pairMode
                        pairings={pairings}
                        partnerLabel="Charging:"
                        partnerRunsFor={vehicle => filterChargingRuns(vehicle.runs)}
                        extraPrimaryRunsFor={vehicle => {
                            if (!filterChargingRuns(vehicle.runs).length) return [];
                            const epa = epaRangeOption(vehicle);
                            return epa ? [epa] : [];
                        }}
                        resolvePartner={(rangeRun, vehicle) => {
                            const run = pairedChargingRun(rangeRun, vehicle);
                            return run
                                ? { sourceRun: run, note: rangeRun?.paired_charging_run_id != null ? 'curated' : null }
                                : null;
                        }}
                        onSetPartner={(rangeId, oldChargingId, newChargingId) =>
                            setPairings(prev => replacePartner(prev, rangeId, oldChargingId, newChargingId))}
                        onAddPartner={(rangeId, chargingId) =>
                            setPairings(prev => addPartner(prev, rangeId, chargingId))}
                        onRemovePartner={(rangeId, chargingId) =>
                            setPairings(prev => removePartner(prev, rangeId, chargingId))}
                        renderRunMeta={run => (
                            // Speed and temperature stay on the left now that it
                            // enumerates range tests: they are what distinguishes
                            // one range test from another. Date is still omitted.
                            <>
                                {run.speed_mph != null && (
                                    <span className="text-xs bg-[var(--color-surface-sunken)] text-secondary px-1.5 py-0.5 rounded shrink-0">{fmtSpeed(run.speed_mph, units)}</span>
                                )}
                                {speedBasisNote(run) && (
                                    <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded shrink-0" title="Average over a varying-speed cycle. Not directly comparable to a steady-state test; speed correction is skipped.">{speedBasisNote(run)}</span>
                                )}
                                {run.temperature_f != null && (
                                    <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200 shrink-0">{fmtTemp(run.temperature_f, units)}</span>
                                )}
                            </>
                        )}
                    />
                </div>
            </div>}

            {!hasRangeRuns ? (
                <div className="card text-center py-12 text-meta">
                    <p className="text-lg font-medium">No range test runs found for selected vehicles</p>
                    <p className="text-sm mt-1">Add range test records in Tests &amp; Data to use this chart.</p>
                </div>
            ) : (
                <>
                    {/* ── Chart 1: Range Added in X Minutes ── */}
                    <div className="card mb-6">
                        <h4 className="text-base font-semibold mb-3">
                            Range Added in {xMinutes} Minutes <span className="text-meta font-normal">(from ~{startSoc}% SoC, in {distanceLabel(units)})</span>
                        </h4>
                        <div style={{ height: presentationMode ? '45vh' : isHorizontal ? `${Math.max(300, activePairs.length * 48)}px` : '450px', position: 'relative' }}>
                            <canvas ref={chart1Ref} />
                        </div>
                    </div>

                    {/* ── Chart 2: Time to Add M Miles ── */}
                    <div className="card mb-6">
                        <h4 className="text-base font-semibold mb-3">
                            Time to Add {units === 'metric' ? Math.round(mMiles * MI_TO_KM) : mMiles} {distanceLabel(units)} of Range <span className="text-meta font-normal">(from ~{startSoc}% SoC)</span>
                        </h4>
                        <div style={{ height: presentationMode ? '45vh' : isHorizontal ? `${Math.max(300, activePairs.length * 48)}px` : '450px', position: 'relative' }}>
                            <canvas ref={chart2Ref} />
                        </div>
                        <div className="mt-3 flex gap-2">
                            <button
                                onClick={handleCopyUrl}
                                className={`chart-copy-btn ${copied ? 'chart-copy-btn-active' : ''}`}
                                title="Copy link to this chart view"
                            >
                                {copied ? '✓ Copied!' : '🔗 Copy URL'}
                            </button>
                        </div>
                    </div>
                </>
            )}

            {!presentationMode && <ChartInfoBubble chartKey="compare" />}
        </div>
    );
}
