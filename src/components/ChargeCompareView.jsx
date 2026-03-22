import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';
import RunSelector from './RunSelector';

// ── Interpolation helper ──────────────────────────────────────────────────────
// Returns the interpolated yField value at targetX, given points sorted by xField.
// If allowExtrapolateBefore=true, extends linearly backward past the first data point
// using the slope of the first two points (useful for normalizing SoC baselines).
function interpolate(points, xField, yField, targetX, allowExtrapolateBefore = false) {
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
    return null;
}

// ── Bar label plugin (same style as RangeChartView barGroupPlugin) ────────────
function makeBarPlugin(flatRuns, isHorizontal) {
    return {
        id: 'compareBarLabels',
        afterDraw(chart) {
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
                    badges.push({ text: 'No data', primary: true });
                } else {
                    if (run._yValue != null) badges.push({ text: `${run._yValue} ${run._yUnit}`, primary: true });
                    if (run._startSoc  != null) {
                        const socText = run._endSoc != null ? `${run._startSoc}%→${run._endSoc}%` : `${run._startSoc}% SoC`;
                        badges.push({ text: socText, socDeviation: run._socDeviation ?? 0 });
                    }
                    if (run._startRange != null) badges.push({ text: run._endRange != null ? `${run._startRange}→${run._endRange} mi` : `${run._startRange} mi` });
                    if (run.speed_mph   != null) badges.push({ text: `${run.speed_mph} mph` });
                    if (run.temperature_f != null) badges.push({ text: `${run.temperature_f}°F` });
                }
                if (badges.length === 0) return;

                const pillH = 15, pillPad = 5, rr = 3;

                function drawPill(px, py, pw, text, socDeviation) {
                    const dev      = socDeviation ?? 0;
                    const alertAmt = Math.min(1, Math.max(0, (dev - 1) / 4));
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
                        b.primary || 'socDeviation' in b || (b.text && b.text.includes('mph'))
                    );
                    const gap = 4, leftPad = 6;
                    let drawX = bar.base + leftPad;

                    displayBadges.forEach(({ text, primary, socDeviation }) => {
                        ctx2.save();
                        ctx2.font = primary ? 'bold 10px sans-serif' : '9px sans-serif';
                        const tw = ctx2.measureText(text).width;
                        const pw = tw + pillPad * 2;
                        if (drawX + pw > bar.x - 4) { ctx2.restore(); return; }
                        const py = bar.y - pillH / 2;
                        drawPill(drawX, py, pw, text, socDeviation);
                        ctx2.restore();
                        drawX += pw + gap;
                    });
                } else {
                    // Vertical bars: stacked top-to-bottom
                    const barH = bar.base - bar.y;
                    const barW = bar.width;
                    const gap = 3, topPad = 6;
                    let drawY = bar.y + topPad;

                    badges.forEach(({ text, primary, socDeviation }) => {
                        if (drawY + pillH > bar.base - topPad) return;
                        ctx2.save();
                        ctx2.font = primary ? 'bold 10px sans-serif' : '9px sans-serif';
                        const tw = ctx2.measureText(text).width;
                        const pw = tw + pillPad * 2;
                        if (pw > barW - 4) { ctx2.restore(); drawY += pillH + gap; return; }
                        const px = bar.x - pw / 2;
                        drawPill(px, drawY, pw, text, socDeviation);
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
                    ctx2.font         = '11px sans-serif';
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
                    ctx2.font         = 'bold 11px sans-serif';
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
                    ctx2.font         = 'bold 12px sans-serif';
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
    presentationMode = false,
}) {
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
        const p = new URLSearchParams(window.location.search);
        p.set('cmp_soc',  startSoc);
        p.set('cmp_mins', xMinutes);
        p.set('cmp_mi',   mMiles);
        const url = `${window.location.origin}${window.location.pathname}?${p.toString()}`;
        navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const selectedVehicles = useMemo(
        () => vehicles.filter(v => selectedVehicleIds.includes(v.id)),
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
                    rangeRun:        { ...rangeRun, vehicleName: vehicle.name, vehicleId: vehicle.id },
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
            for (const runId of missing) {
                try {
                    if (dataService.useSupabase) {
                        updates[runId] = await dataService.getRunData(runId);
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
                _chargingRunName: chargingRunName,
                _yUnit:          chartType === 'range_added' ? 'mi' : 'min',
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
                const Rend   = interpolate(byTime, 'time', 'range', Tz + xMinutes);
                const SocEnd = interpolate(byTime, 'time', 'soc',   Tz + xMinutes);
                const yValue = Rend != null ? Math.round((Rend - Rz) * 10) / 10 : null;
                flatRuns.push({
                    ...base,
                    _yValue:       yValue ?? 0,
                    _startSoc:     startSoc,
                    _endSoc:       SocEnd != null ? Math.round(SocEnd * 10) / 10 : null,
                    _startRange:   Math.round(Rz),
                    _endRange:     Rend != null ? Math.round(Rend) : null,
                    _socDeviation: socDeviation,
                    _noData:       yValue == null,
                });
            } else {
                const Tend   = interpolate(byRange, 'range', 'time', Rz + mMiles);
                const SocEnd = interpolate(byRange, 'range', 'soc',  Rz + mMiles);
                const yValue = Tend != null ? Math.round((Tend - Tz) * 10) / 10 : null;
                flatRuns.push({
                    ...base,
                    _yValue:       yValue ?? 0,
                    _startSoc:     startSoc,
                    _endSoc:       SocEnd != null ? Math.round(SocEnd * 10) / 10 : null,
                    _startRange:   Math.round(Rz),
                    _endRange:     Math.round(Rz + mMiles),
                    _socDeviation: socDeviation,
                    _noData:       yValue == null,
                });
            }
        }

        if (flatRuns.length === 0) return null;

        const yLabel   = chartType === 'range_added' ? 'Range Added (mi)' : 'Time (min)';
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
                plugins: [makeBarPlugin(built.flatRuns, isHorizontal)],
                options: {
                    indexAxis: isHorizontal ? 'y' : undefined,
                    layout: { padding: isHorizontal ? { top: 0, left: 140, right: 10 } : { top: 0, bottom: 55 } },
                    animation: false,
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
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
                                    const lines = [];
                                    if (run._startSoc  != null) lines.push(run._endSoc != null ? `SoC: ${run._startSoc}% → ${run._endSoc}%` : `Start SoC: ${run._startSoc}%`);
                                    if (run._startRange != null) lines.push(run._endRange != null ? `Range: ${run._startRange} → ${run._endRange} mi` : `Start range: ${run._startRange} mi`);
                                    if (run.speed_mph   != null) lines.push(`Speed: ${run.speed_mph} mph`);
                                    if (run.temperature_f != null) lines.push(`Temp: ${run.temperature_f}°F`);
                                    if (run._chargingRunName && run._chargingRunName !== run.name)
                                        lines.push(`Charging data: ${run._chargingRunName}`);
                                    return lines;
                                },
                            },
                        },
                    },
                    scales: isHorizontal ? {
                        x: { title: { display: true, text: built.yLabel }, beginAtZero: true },
                        y: { type: 'category', grid: { display: false }, title: { display: false }, ticks: { display: false } },
                    } : {
                        x: { type: 'category', grid: { display: false }, title: { display: false } },
                        y: { title: { display: true, text: built.yLabel }, beginAtZero: true },
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
    }, [selectedVehicleIds, xMinutes, mMiles, startSoc, runDataCache, orientation, selectedRuns]);

    const hasRangeRuns = resolvedRuns.length > 0;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Controls card — hidden in presentation/pop-out mode ── */}
            {!presentationMode && <div className="card mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold">Chart Options — Charge Compare</h3>
                    <div className="flex items-center gap-3">
                        {loading && (
                            <span className="flex items-center gap-2 text-sm text-gray-500">
                                <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                                Loading charging data…
                            </span>
                        )}
                        <button onClick={handleCopyUrl} className="btn-secondary text-sm px-3 py-1">
                            {copied ? 'Copied!' : 'Copy URL'}
                        </button>
                    </div>
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
                        Range to add (miles):
                        <input
                            type="number"
                            value={mMiles}
                            min={1}
                            max={400}
                            onChange={e => setMMiles(Math.max(1, Number(e.target.value)))}
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
                        onUpdateRunColor={null}
                        runFilter={r => r.has_range}
                        emptyMessage="No range test records"
                        renderRunMeta={run => (
                            <>
                                {run.speed_mph != null && (
                                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{run.speed_mph} mph</span>
                                )}
                                {run.temperature_f != null && (
                                    <span className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded border border-orange-200">{run.temperature_f}°F</span>
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
                            Range Added in {xMinutes} Minutes <span className="text-gray-400 font-normal">(from ~{startSoc}% SoC)</span>
                        </h4>
                        <div style={{ height: presentationMode ? '45vh' : isHorizontal ? `${Math.max(300, activeResolvedRuns.length * 48)}px` : '450px', position: 'relative' }}>
                            <canvas ref={chart1Ref} />
                        </div>
                    </div>

                    {/* ── Chart 2: Time to Add M Miles ── */}
                    <div className="card mb-6">
                        <h4 className="text-base font-semibold mb-3">
                            Time to Add {mMiles} Miles of Range <span className="text-gray-400 font-normal">(from ~{startSoc}% SoC)</span>
                        </h4>
                        <div style={{ height: presentationMode ? '45vh' : isHorizontal ? `${Math.max(300, activeResolvedRuns.length * 48)}px` : '450px', position: 'relative' }}>
                            <canvas ref={chart2Ref} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
