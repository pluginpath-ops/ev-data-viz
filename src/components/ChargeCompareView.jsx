import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';

// ── Interpolation helper ──────────────────────────────────────────────────────
// Returns the interpolated yField value at targetX, given points sorted by xField.
// Returns null if targetX is outside the data range (can't interpolate).
function interpolate(points, xField, yField, targetX) {
    const valid = points.filter(p => p[xField] != null && p[yField] != null);
    const before = [...valid].filter(p => p[xField] <= targetX).at(-1);
    const after  = valid.find(p => p[xField] > targetX);
    if (!before || !after) return null;
    if (before[xField] === targetX) return before[yField];
    const t = (targetX - before[xField]) / (after[xField] - before[xField]);
    return before[yField] + t * (after[yField] - before[yField]);
}

// ── Bar label plugin (same style as RangeChartView barGroupPlugin) ────────────
function makeBarPlugin(flatRuns) {
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
                const barH = bar.base - bar.y;
                const barW = bar.width;

                const badges = [];
                if (run._noData) {
                    badges.push({ text: 'No data', primary: true });
                } else {
                    if (run._yValue != null) badges.push({ text: `${run._yValue} ${run._yUnit}`, primary: true });
                    if (run._startSoc  != null) badges.push({ text: `${run._startSoc}% SoC` });
                    if (run._startRange != null) badges.push({ text: `${run._startRange} mi` });
                    if (run.speed_mph   != null) badges.push({ text: `${run.speed_mph} mph` });
                    if (run.temperature_f != null) badges.push({ text: `${run.temperature_f}°F` });
                }
                if (badges.length === 0) return;

                const pillH = 15, pillPad = 5, gap = 3, topPad = 6;
                let drawY = bar.y + topPad;

                badges.forEach(({ text, primary }) => {
                    if (drawY + pillH > bar.base - topPad) return;

                    ctx2.save();
                    ctx2.font = primary ? 'bold 10px sans-serif' : '9px sans-serif';
                    const tw = ctx2.measureText(text).width;
                    const pw = tw + pillPad * 2;

                    if (pw > barW - 4) { ctx2.restore(); drawY += pillH + gap; return; }

                    const px = bar.x - pw / 2;
                    const rr = 3;

                    ctx2.fillStyle = 'rgba(0,0,0,0.28)';
                    ctx2.beginPath();
                    ctx2.moveTo(px + rr, drawY);
                    ctx2.lineTo(px + pw - rr, drawY);
                    ctx2.quadraticCurveTo(px + pw, drawY,        px + pw, drawY + rr);
                    ctx2.lineTo(px + pw, drawY + pillH - rr);
                    ctx2.quadraticCurveTo(px + pw, drawY + pillH, px + pw - rr, drawY + pillH);
                    ctx2.lineTo(px + rr, drawY + pillH);
                    ctx2.quadraticCurveTo(px,       drawY + pillH, px,       drawY + pillH - rr);
                    ctx2.lineTo(px, drawY + rr);
                    ctx2.quadraticCurveTo(px, drawY, px + rr, drawY);
                    ctx2.closePath();
                    ctx2.fill();

                    ctx2.fillStyle    = '#fff';
                    ctx2.textAlign    = 'center';
                    ctx2.textBaseline = 'middle';
                    ctx2.fillText(text, bar.x, drawY + pillH / 2);
                    ctx2.restore();

                    drawY += pillH + gap;
                });
            });

            // ── Vehicle group labels + dashed separators below x-axis ─────────
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
        },
    };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ChargeCompareView({ vehicles, selectedVehicleIds }) {
    const [xMinutes, setXMinutes] = useState(15);
    const [mMiles,   setMMiles]   = useState(150);
    const [startSoc, setStartSoc] = useState(10);
    const [runDataCache, setRunDataCache] = useState({});
    const [loading,  setLoading]  = useState(false);

    const chart1Ref      = useRef(null);
    const chart1Instance = useRef(null);
    const chart2Ref      = useRef(null);
    const chart2Instance = useRef(null);

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

    // ── Compute bars for one chart type ──────────────────────────────────────
    // chartType: 'range_added' | 'time_to_range'
    const buildBars = (chartType) => {
        const flatRuns = [];

        for (const { rangeRun, chargingRunId, chargingRunName } of resolvedRuns) {
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
            const points = (runDataCache[chargingRunId] || []).filter(
                p => p.soc != null && p.time != null && p.range != null
            );

            if (points.length === 0) {
                flatRuns.push({ ...base, _yValue: 0, _startSoc: null, _startRange: null, _noData: true });
                continue;
            }

            // Z point: data point nearest to startSoc%
            const zPoint = points.reduce((best, p) =>
                Math.abs(p.soc - startSoc) < Math.abs(best.soc - startSoc) ? p : best
            );
            const Tz = zPoint.time;
            const Rz = zPoint.range;
            const Sz = zPoint.soc;

            if (chartType === 'range_added') {
                const Rend   = interpolate(points, 'time', 'range', Tz + xMinutes);
                const yValue = Rend != null ? Math.round((Rend - Rz) * 10) / 10 : null;
                flatRuns.push({
                    ...base,
                    _yValue:     yValue ?? 0,
                    _startSoc:   Math.round(Sz * 10) / 10,
                    _startRange: Math.round(Rz * 10) / 10,
                    _noData:     yValue == null,
                });
            } else {
                const Tend   = interpolate(points, 'range', 'time', Rz + mMiles);
                const yValue = Tend != null ? Math.round((Tend - Tz) * 10) / 10 : null;
                flatRuns.push({
                    ...base,
                    _yValue:     yValue ?? 0,
                    _startSoc:   Math.round(Sz * 10) / 10,
                    _startRange: Math.round(Rz * 10) / 10,
                    _noData:     yValue == null,
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
                plugins: [makeBarPlugin(built.flatRuns)],
                options: {
                    layout: { padding: { top: 0, bottom: 55 } },
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
                                    if (!run)        return `${ctx.parsed.y}`;
                                    if (run._noData) return 'No charging data available';
                                    return `${ctx.parsed.y} ${run._yUnit}`;
                                },
                                afterLabel(ctx) {
                                    const run = built.flatRuns[ctx.dataIndex];
                                    if (!run || run._noData) return [];
                                    const lines = [];
                                    if (run._startSoc  != null) lines.push(`Start SoC: ${run._startSoc}%`);
                                    if (run._startRange != null) lines.push(`Start range: ${run._startRange} mi`);
                                    if (run.speed_mph   != null) lines.push(`Speed: ${run.speed_mph} mph`);
                                    if (run.temperature_f != null) lines.push(`Temp: ${run.temperature_f}°F`);
                                    if (run._chargingRunName && run._chargingRunName !== run.name)
                                        lines.push(`Charging data: ${run._chargingRunName}`);
                                    return lines;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            type: 'category',
                            grid: { display: false },
                            title: { display: false },
                        },
                        y: {
                            title:       { display: true, text: built.yLabel },
                            beginAtZero: true,
                        },
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
    }, [selectedVehicleIds, xMinutes, mMiles, startSoc, runDataCache]);

    const hasRangeRuns = resolvedRuns.length > 0;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Controls card ── */}
            <div className="card mb-6">
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
                </div>
            </div>

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
                        <div style={{ height: '450px', position: 'relative' }}>
                            <canvas ref={chart1Ref} />
                        </div>
                    </div>

                    {/* ── Chart 2: Time to Add M Miles ── */}
                    <div className="card mb-6">
                        <h4 className="text-base font-semibold mb-3">
                            Time to Add {mMiles} Miles of Range <span className="text-gray-400 font-normal">(from ~{startSoc}% SoC)</span>
                        </h4>
                        <div style={{ height: '450px', position: 'relative' }}>
                            <canvas ref={chart2Ref} />
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
