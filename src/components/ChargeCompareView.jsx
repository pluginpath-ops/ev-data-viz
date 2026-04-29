import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';
import RunSelector from './RunSelector';
import { runTooltipLines } from '../utils/tooltipHelpers';
import { vehicleLabel } from '../utils/specHelpers';
import { useAppContext } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import { convDistance, distanceLabel, fmtSpeed, fmtTemp, MI_TO_KM } from '../utils/unitConversions';

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
function makeBarPlugin(flatRuns, isHorizontal, units) {
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
                    ctx2.fillStyle    = '#6b7280';
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
                    ctx2.strokeStyle = 'rgba(107,114,128,0.55)';
                    ctx2.lineWidth   = 1.5;
                    ctx2.beginPath();
                    ctx2.moveTo(area.left - 6, y1 + 3);
                    ctx2.lineTo(area.left - 6, y2 - 3);
                    ctx2.stroke();
                    ctx2.restore();

                    ctx2.save();
                    ctx2.font         = 'bold 13px sans-serif';
                    ctx2.fillStyle    = '#374151';
                    ctx2.textAlign    = 'right';
                    ctx2.textBaseline = 'middle';
                    ctx2.fillText(group.vehicleName, area.left - 10, cy);
                    ctx2.restore();

                    if (gi < groups.length - 1) {
                        const nextStartBar = meta.data[groups[gi + 1].startIdx];
                        if (nextStartBar) {
                            const sepY = (y2 + (nextStartBar.y - nextStartBar.height / 2)) / 2;
                            ctx2.save();
                            ctx2.strokeStyle = 'rgba(107,114,128,0.35)';
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
                    ctx2.strokeStyle = 'rgba(107,114,128,0.55)';
                    ctx2.lineWidth   = 1.5;
                    ctx2.beginPath();
                    ctx2.moveTo(x1 + 3, groupLabelY);
                    ctx2.lineTo(x2 - 3, groupLabelY);
                    ctx2.stroke();
                    ctx2.restore();

                    ctx2.save();
                    ctx2.font         = 'bold 13px sans-serif';
                    ctx2.fillStyle    = '#374151';
                    ctx2.textAlign    = 'center';
                    ctx2.textBaseline = 'top';
                    ctx2.fillText(group.vehicleName, cx, groupLabelY + 4);
                    ctx2.restore();

                    if (gi < groups.length - 1) {
                        const nextStartBar = meta.data[groups[gi + 1].startIdx];
                        if (nextStartBar) {
                            const sepX = (x2 + (nextStartBar.x - nextStartBar.width / 2)) / 2;
                            ctx2.save();
                            ctx2.strokeStyle = 'rgba(107,114,128,0.35)';
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
    onUpdateRunColor = null,
    presentationMode = false,
}) {
    const { units } = useAppContext();
    const { isDark } = useTheme();
    const [runDataCache,    setRunDataCache]    = useState({});
    const [loading,         setLoading]         = useState(false);
    const [copied,          setCopied]          = useState(false);
    const [orientation,     setOrientation]     = useState('horizontal');
    const [selectedRuns,    setSelectedRuns]    = useState([]);
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

    // For each range run: resolve which charging run supplies the data_points.
    // - If the range run itself has charging data → use its own ID.
    // - Otherwise → vehicle's is_default charging run, or most recent.
    const resolvedRuns = useMemo(() => {
        const result = [];
        for (const vehicle of selectedVehicles) {
            const rangeRuns    = (vehicle.runs || []).filter(r => r.has_range);
            const chargingRuns = (vehicle.runs || []).filter(r => r.has_charging !== false);
            const defaultCharging =
                chargingRuns.find(r => r.isDefault) ||
                [...chargingRuns].sort((a, b) => new Date(b.date) - new Date(a.date))[0] ||
                null;

            for (const rangeRun of rangeRuns) {
                const selfHasCharging = rangeRun.has_charging !== false;
                const chargingRun     = selfHasCharging ? rangeRun : defaultCharging;
                result.push({
                    rangeRun:        { ...rangeRun, vehicleName: vehicleLabel(vehicle), vehicleId: vehicle.id },
                    chargingRunId:   chargingRun?.id   ?? null,
                    chargingRunName: chargingRun?.name ?? null,
                });
            }
        }
        return result;
    }, [selectedVehicles]);

    const neededRunIds = useMemo(
        () => [...new Set(resolvedRuns.map(r => r.chargingRunId).filter(Boolean))],
        [resolvedRuns]
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
                            updates[runId] = await dataService.getRunData(run._realRunId, run._scalingFactor ?? 1);
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

    // ── Auto-select any new range runs when vehicles change ───────────────────
    useEffect(() => {
        const allRangeRunIds = resolvedRuns.map(r => r.rangeRun.id);
        setSelectedRuns(prev => {
            const newIds = allRangeRunIds.filter(id => !prev.includes(id));
            return newIds.length ? [...prev, ...newIds] : prev;
        });
    }, [resolvedRuns]);

    const activeResolvedRuns = resolvedRuns.filter(r => selectedRuns.includes(r.rangeRun.id));

    // ── Compute bars for one chart type ──────────────────────────────────────
    // chartType: 'range_added' | 'time_to_range'
    const buildBars = (chartType) => {
        const flatRuns = [];

        for (const { rangeRun, chargingRunId, chargingRunName } of activeResolvedRuns) {
            const base = {
                id:              rangeRun.id,
                name:            rangeRun.name,
                vehicleName:     rangeRun.vehicleName,
                vehicleId:       rangeRun.vehicleId,
                color:           rangeRun.color || '#3b82f6',
                speed_mph:       rangeRun.speed_mph,
                temperature_f:   rangeRun.temperature_f,
                source:          rangeRun.source,
                _trim:           rangeRun._trim ?? null,
                _chargingRunName: chargingRunName,
                _yUnit:          chartType === 'range_added' ? distanceLabel(units) : 'min',
                _rangeUnit:      distanceLabel(units),
            };

            // No charging run resolved, or data not yet loaded
            if (!chargingRunId || !(chargingRunId in runDataCache)) {
                flatRuns.push({ ...base, _yValue: 0, _startSoc: null, _startRange: null, _noData: true });
                continue;
            }

            // Filter to points that have all three fields we need
            const raw = (runDataCache[chargingRunId] || []).filter(
                p => p.soc != null && p.time != null && p.range != null
            );

            if (raw.length === 0) {
                flatRuns.push({ ...base, _yValue: 0, _startSoc: startSoc, _startRange: null, _noData: true });
                continue;
            }

            // Sort by each axis for clean interpolation
            const bySoc   = [...raw].sort((a, b) => a.soc   - b.soc);
            const byTime  = [...raw].sort((a, b) => a.time  - b.time);
            const byRange = [...raw].sort((a, b) => a.range - b.range);

            // Z baseline: exact interpolation (or backward extrapolation) to startSoc.
            // allowExtrapolateBefore=true lets us normalize runs whose data starts above startSoc.
            const Tz = interpolate(bySoc, 'soc', 'time',  startSoc, true);
            const Rz = interpolate(bySoc, 'soc', 'range', startSoc, true);

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
                const Rend   = interpolate(byTime, 'time', 'range', targetTime, false, true);
                const SocEnd = interpolate(byTime, 'time', 'soc',   targetTime, false, true);
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
                const targetRange  = Rz + mMiles;
                const lastRange    = byRange[byRange.length - 1].range;
                const rangeOvershoot = Math.max(0, targetRange - lastRange);
                const Tend   = interpolate(byRange, 'range', 'time', targetRange, false, true);
                const SocEnd = interpolate(byRange, 'range', 'soc',  targetRange, false, true);
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
        const tickColor   = isDark ? 'rgb(226,232,240)' : 'rgb(107,114,128)';
        const gridColor   = isDark ? 'rgba(100,116,139,0.4)' : 'rgba(229,231,235,0.8)';
        const legendColor = isDark ? 'rgb(241,245,249)' : 'rgb(55,65,81)';

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
                plugins: [makeBarPlugin(built.flatRuns, isHorizontal, units)],
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
                                    return run ? `${run.name} — ${run.vehicleName}` : undefined;
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
    }, [selectedVehicleIds, xMinutes, mMiles, startSoc, runDataCache, orientation, selectedRuns, units, isDark]);

    const hasRangeRuns = resolvedRuns.length > 0;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Controls card — hidden in presentation/pop-out mode ── */}
            {!presentationMode && <div className="card mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">Chart Options — Charge Compare</h3>
                    {loading && (
                        <span className="flex items-center gap-2 text-sm text-gray-500">
                            <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                            Loading charging data…
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-6">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        Starting SoC (%):
                        <input
                            type="number"
                            value={startSoc}
                            min={1}
                            max={80}
                            onChange={e => setStartSoc(Math.min(80, Math.max(1, Number(e.target.value))))}
                            className="w-20 px-2 py-1 border rounded text-sm"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        Charging Time (minutes):
                        <input
                            type="number"
                            value={xMinutes}
                            min={1}
                            max={120}
                            onChange={e => setXMinutes(Math.max(1, Number(e.target.value)))}
                            className="w-20 px-2 py-1 border rounded text-sm"
                        />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
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
                            className="w-20 px-2 py-1 border rounded text-sm"
                        />
                    </label>
                    <div className="flex items-center gap-1 ml-auto">
                        {['vertical', 'horizontal'].map(o => (
                            <button
                                key={o}
                                onClick={() => setOrientation(o)}
                                className={`btn btn-sm ${orientation === o ? 'btn-primary' : 'btn-secondary'}`}
                            >
                                {o === 'vertical' ? '↕ Vertical' : '↔ Horizontal'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mt-4">
                    <RunSelector
                        vehicles={selectedVehicles}
                        selectedRunIds={selectedRuns}
                        onToggleRun={runId => setSelectedRuns(prev =>
                            prev.includes(runId) ? prev.filter(id => id !== runId) : [...prev, runId]
                        )}
                        onUpdateRunColor={onUpdateRunColor}
                        runFilter={r => r.has_range}
                        emptyMessage="No range test records"
                        renderRunMeta={run => (
                            <>
                                {run.speed_mph != null && (
                                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{fmtSpeed(run.speed_mph, units)}</span>
                                )}
                                {run.temperature_f != null && (
                                    <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200">{fmtTemp(run.temperature_f, units)}</span>
                                )}
                            </>
                        )}
                    />
                </div>
            </div>}

            {!hasRangeRuns ? (
                <div className="card text-center py-12 text-gray-400">
                    <p className="text-lg font-medium">No range test runs found for selected vehicles</p>
                    <p className="text-sm mt-1">Add range test records in Tests &amp; Data to use this chart.</p>
                </div>
            ) : (
                <>
                    {/* ── Chart 1: Range Added in X Minutes ── */}
                    <div className="card mb-6">
                        <h4 className="text-base font-semibold mb-3">
                            Range Added in {xMinutes} Minutes <span className="text-gray-400 font-normal">(from ~{startSoc}% SoC, in {distanceLabel(units)})</span>
                        </h4>
                        <div style={{ height: presentationMode ? '45vh' : isHorizontal ? `${Math.max(300, activeResolvedRuns.length * 48)}px` : '450px', position: 'relative' }}>
                            <canvas ref={chart1Ref} />
                        </div>
                    </div>

                    {/* ── Chart 2: Time to Add M Miles ── */}
                    <div className="card mb-6">
                        <h4 className="text-base font-semibold mb-3">
                            Time to Add {units === 'metric' ? Math.round(mMiles * MI_TO_KM) : mMiles} {distanceLabel(units)} of Range <span className="text-gray-400 font-normal">(from ~{startSoc}% SoC)</span>
                        </h4>
                        <div style={{ height: presentationMode ? '45vh' : isHorizontal ? `${Math.max(300, activeResolvedRuns.length * 48)}px` : '450px', position: 'relative' }}>
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
        </div>
    );
}
