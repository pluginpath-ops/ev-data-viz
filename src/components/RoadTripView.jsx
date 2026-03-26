import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import ZoomPlugin from 'chartjs-plugin-zoom';
import { dataService } from '../services/DataService';
import { useAppContext } from '../context/AppContext';
import { convDistance, distanceLabel, speedLabel, fmtSpeed, MI_TO_KM } from '../utils/unitConversions';
import RunSelector from './RunSelector';
import AxisScaleControls from './AxisScaleControls';
import {
    simulateRoadTrip, segmentsToChartPoints, segmentsToChartPointsChargeTime,
    formatTime, speedCorrectionFactor,
} from '../utils/roadTripSimulation';

Chart.register(ZoomPlugin);

// ── Efficiency helpers ───────────────────────────────────────────────────────

/**
 * Derive mi/kWh from a run record, with two fallback methods:
 *   1. Direct:    distance_miles / energy_kwh          (preferred — measured energy)
 *   2. SoC-delta: distance_miles / (ΔSoC% × battery)  (estimated — uses usable capacity)
 * Returns null when there is insufficient data.
 */
function computeMiPerKwh(run, batteryKwh) {
    if (!run?.distance_miles) return null;
    if (run.energy_kwh)
        return run.distance_miles / run.energy_kwh;
    // Estimate via SoC delta × battery capacity
    if (run.start_soc != null && run.end_soc != null && batteryKwh
            && run.start_soc > run.end_soc) {
        const energyEst = (run.start_soc - run.end_soc) / 100 * batteryKwh;
        if (energyEst > 0) return run.distance_miles / energyEst;
    }
    return null;
}

/** True when computeMiPerKwh will return a non-null value. */
function hasRangeData(run, batteryKwh) {
    return computeMiPerKwh(run, batteryKwh) !== null;
}

/** Human-readable note describing how efficiency was derived. */
function efficiencyMethod(run) {
    if (!run?.distance_miles) return null;
    return run.energy_kwh ? null : 'est. from SoC Δ';
}

// ── Default vehicle colors ───────────────────────────────────────────────────
const PALETTE = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444',
    '#3b82f6', '#a855f7', '#ec4899', '#14b8a6',
];

// ── Chart.js plugin: charging badges + finish labels ─────────────────────────
function makeRoadTripPlugin(simResults, units) {
    return {
        id: 'roadTripLabels',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;

            // ── Pass 1: charging segment badges (EV lines only) ───────────
            let simIdx = 0;
            chart.data.datasets.forEach((ds, di) => {
                if (ds._isIce) return;
                const sim = simResults[simIdx++];
                if (!sim) return;

                const meta = chart.getDatasetMeta(di);
                const data = meta.data;
                if (!data.length) return;

                let ptIdx = 0;
                for (const seg of sim.segments) {
                    if (seg.type === 'charge' && ptIdx + 1 < data.length) {
                        const startPt  = data[ptIdx];
                        const endPt    = data[ptIdx + 1];
                        const segWidth = Math.abs(endPt.x - startPt.x);
                        if (segWidth > 60) {
                            const midX = (startPt.x + endPt.x) / 2;
                            const midY = (startPt.y + endPt.y) / 2 - 12;
                            const rangeAdded = seg.endSoc !== seg.startSoc
                                ? Math.round((seg.endSoc - seg.startSoc) / 100 * sim._batteryKwh * sim._correctedMiPerKwh)
                                : 0;
                            const chargeMin = Math.round(seg.endTime - seg.startTime);
                            const label = `${seg.startSoc}→${seg.endSoc}% +${Math.round(convDistance(rangeAdded, units))}${distanceLabel(units)} ${chargeMin}m`;

                            ctx.save();
                            ctx.font = '10px system-ui, sans-serif';
                            const tw = ctx.measureText(label).width;
                            if (tw < segWidth - 8) {
                                ctx.fillStyle = ds.borderColor + '22';
                                ctx.beginPath();
                                const rx = midX - tw / 2 - 4, ry = midY - 7, rw = tw + 8, rh = 14, cr = 3;
                                ctx.moveTo(rx + cr, ry);
                                ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, cr);
                                ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, cr);
                                ctx.arcTo(rx, ry + rh, rx, ry, cr);
                                ctx.arcTo(rx, ry, rx + rw, ry, cr);
                                ctx.closePath();
                                ctx.fill();
                                ctx.fillStyle = ds.borderColor;
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                ctx.fillText(label, midX, midY);
                            }
                            ctx.restore();
                        }
                    }
                    ptIdx += 2;
                }
            });

            // ── Pass 2: collect all finish labels (EV + ICE) ─────────────
            const finishLabels = [];
            let si = 0;
            chart.data.datasets.forEach((ds, di) => {
                const meta = chart.getDatasetMeta(di);
                const pts  = meta.data;
                if (!pts.length) return;
                const lastPt = pts[pts.length - 1];
                if (!lastPt) return;

                if (ds._isIce) {
                    const lastRaw = ds.data[ds.data.length - 1];
                    if (lastRaw) finishLabels.push({
                        x: lastPt.x, y: lastPt.y,
                        text: `ICE Reference — ${formatTime(lastRaw.x)}`,
                        color: ds.borderColor,
                    });
                } else {
                    const sim = simResults[si++];
                    if (sim) finishLabels.push({
                        x: lastPt.x, y: lastPt.y,
                        text: `${ds.label} — ${formatTime(sim.totalTimeMin)}`,
                        color: ds.borderColor,
                    });
                }
            });

            // ── Pass 3: spread overlapping labels, draw with leader lines ─
            if (!finishLabels.length) return;

            const LABEL_H = 16; // minimum px between label centres
            // Fastest finisher (smallest x) → top slot; slowest → bottom
            finishLabels.sort((a, b) => a.x - b.x);

            const { top, bottom } = chart.chartArea;
            const avgNatY   = finishLabels.reduce((s, l) => s + l.y, 0) / finishLabels.length;
            const totalSpan = (finishLabels.length - 1) * LABEL_H;
            const startY    = Math.max(top + 8, Math.min(bottom - totalSpan - 8, avgNatY - totalSpan / 2));

            ctx.save();
            ctx.font = 'bold 11px system-ui, sans-serif';

            finishLabels.forEach((l, i) => {
                const adjY      = Math.min(startY + i * LABEL_H, bottom - 8);
                const displaced = Math.abs(adjY - l.y) > 4;

                // Filled dot at the actual last data point
                ctx.fillStyle = l.color;
                ctx.beginPath();
                ctx.arc(l.x, l.y, 2.5, 0, Math.PI * 2);
                ctx.fill();

                // Dashed leader from dot to label when displaced
                if (displaced) {
                    ctx.save();
                    ctx.strokeStyle = l.color;
                    ctx.lineWidth   = 0.75;
                    ctx.globalAlpha = 0.45;
                    ctx.setLineDash([3, 2]);
                    ctx.beginPath();
                    ctx.moveTo(l.x + 4, l.y);
                    ctx.lineTo(l.x + 8, adjY);
                    ctx.stroke();
                    ctx.restore();
                }

                // Label text
                ctx.fillStyle     = l.color;
                ctx.textAlign     = 'left';
                ctx.textBaseline  = 'middle';
                ctx.fillText(l.text, l.x + 8, adjY);
            });

            ctx.restore();
        },
    };
}

// ── RoadTripView ─────────────────────────────────────────────────────────────

export default function RoadTripView({
    vehicles,
    selectedVehicleIds,
    roadTripConfig,
    setRoadTripConfig,
    presentationMode = false,
}) {
    const { units } = useAppContext();
    const canvasRef = useRef(null);
    const chartRef  = useRef(null);

    const [runDataCache, setRunDataCache] = useState({});
    const [loading, setLoading] = useState(false);
    const [selectedRunIds, setSelectedRunIds] = useState([]);
    const [axisScale, setAxisScale] = useState({ xMin: null, xMax: null, yMin: null, yMax: null });
    const onAxisChange = (key, val) => setAxisScale(prev => ({ ...prev, [key]: val }));

    const dl = distanceLabel(units);
    const sl = speedLabel(units);

    // ── Resolve selected vehicles ────────────────────────────────────────────
    const selectedVehicles = useMemo(
        () => vehicles.filter(v => selectedVehicleIds.includes(v.id)),
        [vehicles, selectedVehicleIds]
    );

    // ── Sync selectedRunIds when vehicle selection changes ───────────────────
    // Keep runs from still-selected vehicles; auto-add default run for new ones.
    useEffect(() => {
        setSelectedRunIds(prev => {
            const allChargingRunIds = new Set(
                selectedVehicles.flatMap(v =>
                    (v.runs || []).filter(r => r.has_charging !== false).map(r => r.id)
                )
            );
            // Drop runs whose vehicle is no longer selected
            const kept = prev.filter(id => allChargingRunIds.has(id));
            const keptSet = new Set(kept);

            // For each vehicle with no selected runs, add its default/most-recent charging run
            for (const vehicle of selectedVehicles) {
                const chargingRuns = (vehicle.runs || []).filter(r => r.has_charging !== false);
                if (chargingRuns.some(r => keptSet.has(r.id))) continue;
                const def = chargingRuns.find(r => r.isDefault) ||
                    [...chargingRuns].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
                if (def) { kept.push(def.id); keptSet.add(def.id); }
            }
            return kept;
        });
    }, [selectedVehicleIds]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Build efficiency info for every charging run in the selection ─────────
    // Keyed by run.id. Derives mi/kWh from the run itself (if it has range data)
    // or falls back to the vehicle's best range run.
    const allChargingRunsInfo = useMemo(() => {
        const map = {};
        let colorIdx = 0;
        for (const vehicle of selectedVehicles) {
            const bestRangeRun = [...(vehicle.runs || [])]
                .filter(r => hasRangeData(r, vehicle.battery))
                .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

            for (const run of (vehicle.runs || []).filter(r => r.has_charging !== false)) {
                const hasOwnRange = hasRangeData(run, vehicle.battery);
                const rangeSource  = hasOwnRange ? run : bestRangeRun;
                const miPerKwh     = rangeSource ? computeMiPerKwh(rangeSource, vehicle.battery) : null;

                // Build a human-readable note about the efficiency source / method
                let efficiencyNote = null;
                if (!hasOwnRange && bestRangeRun) {
                    const method = efficiencyMethod(bestRangeRun);
                    efficiencyNote = method
                        ? `eff. from ${bestRangeRun.name} (${method})`
                        : `eff. from ${bestRangeRun.name}`;
                } else if (hasOwnRange && efficiencyMethod(run)) {
                    efficiencyNote = efficiencyMethod(run); // "est. from SoC Δ"
                }

                map[run.id] = {
                    vehicle,
                    run,
                    miPerKwh,
                    // Assume 70 mph if not specified on the run or its range source
                    testSpeedMph:   run.speed_mph ?? bestRangeRun?.speed_mph ?? null,
                    batteryKwh:     vehicle.battery,
                    color:          run.color || PALETTE[colorIdx % PALETTE.length],
                    efficiencyNote,
                };
                colorIdx++;
            }
        }
        return map;
    }, [selectedVehicles]);

    // ── Active run entries (in selectedRunIds order) ──────────────────────────
    const runEntries = useMemo(() =>
        selectedRunIds.map(id => allChargingRunsInfo[id]).filter(Boolean),
        [selectedRunIds, allChargingRunsInfo]
    );

    const validEntries  = runEntries.filter(e => e.miPerKwh && e.batteryKwh);
    const skippedEntries = runEntries.filter(e => !e.miPerKwh || !e.batteryKwh);

    // Vehicles with no charging runs at all (need separate warning)
    const vehiclesWithNoChargingRuns = selectedVehicles.filter(
        v => !(v.runs || []).some(r => r.has_charging !== false)
    );

    // ── Lazy-load charging data ──────────────────────────────────────────────
    const neededRunIds = useMemo(
        () => [...new Set(validEntries.map(e => e.run.id).filter(Boolean))],
        [validEntries]
    );

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
    }, [neededRunIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Run simulation for each entry ─────────────────────────────────────────
    const simResults = useMemo(() => {
        const { startSoc, minSoc, legDistance, chargeTime, totalDistance, speed, mode, overhead } = roadTripConfig;

        return validEntries.map(entry => {
            const chargingData = runDataCache[entry.run.id];
            if (!chargingData || chargingData.length === 0) return null;

            const result = simulateRoadTrip({
                batteryKwh:        entry.batteryKwh,
                miPerKwh:          entry.miPerKwh,
                // Use the run's test speed if known; otherwise assume 70 mph per spec
                testSpeedMph:      entry.testSpeedMph || 70,
                chargingData,
                startSoc,
                minSoc,
                legDistanceMi:     legDistance,
                totalDistanceMi:   totalDistance,
                speedMph:          speed,
                chargeTimeMinutes: chargeTime,
                overheadMinutes:   overhead,
                mode,
            });

            // Attach helper fields for the plugin
            result._batteryKwh        = entry.batteryKwh;
            result._correctedMiPerKwh = result.correctedMiPerKwh;

            return result;
        });
    }, [validEntries, runDataCache, roadTripConfig]);

    // ── Build & render chart ──────────────────────────────────────────────────
    useEffect(() => {
        if (!canvasRef.current || !simResults.some(Boolean)) return;

        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }

        const { totalDistance, yAxis, overhead } = roadTripConfig;
        const isChargeTimeMode = yAxis === 'chargeTime';
        const totalDistDisplay = convDistance(totalDistance, units);

        // Label logic: include run name when multiple runs from same vehicle
        const vehicleRunCount = {};
        for (const e of validEntries) {
            vehicleRunCount[e.vehicle.id] = (vehicleRunCount[e.vehicle.id] || 0) + 1;
        }
        const entryLabel = e =>
            vehicleRunCount[e.vehicle.id] > 1
                ? `${e.vehicle.name} (${e.run.name})`
                : e.vehicle.name;

        const datasets = validEntries.map((entry, i) => {
            const sim = simResults[i];
            if (!sim) return null;

            const points = isChargeTimeMode
                ? segmentsToChartPointsChargeTime(sim.segments)
                : segmentsToChartPoints(sim.segments, units);

            // Mark charge-start points with larger radius
            const pointRadii = [];
            for (const seg of sim.segments) {
                pointRadii.push(seg.type === 'charge' ? 4 : 0);
                pointRadii.push(0);
            }

            return {
                label: entryLabel(entry),
                data: points,
                borderColor: entry.color,
                backgroundColor: entry.color + '33',
                borderWidth: 2.5,
                tension: 0,
                pointRadius: pointRadii,
                pointBackgroundColor: entry.color,
                pointBorderColor: entry.color,
                fill: false,
                _simIndex: i,
            };
        }).filter(Boolean);

        // ── ICE reference line ───────────────────────────────────────────
        const ICE_DRIVE_INTERVAL_MIN = 180; // 3 hours between stops
        const ICE_STOP_MIN = overhead;      // same overhead tax as EV stops
        const icePoints = [];
        let iceTime = 0, iceDist = 0, iceCumStop = 0, iceIter = 0;
        while (iceDist < roadTripConfig.totalDistance && iceIter < 100) {
            iceIter++;
            const remainingMi = roadTripConfig.totalDistance - iceDist;
            const maxDriveMi  = (roadTripConfig.speed * ICE_DRIVE_INTERVAL_MIN) / 60;
            const driveMi     = Math.min(maxDriveMi, remainingMi);
            const driveMin    = (driveMi / roadTripConfig.speed) * 60;
            if (isChargeTimeMode) {
                icePoints.push({ x: Math.round(iceTime),            y: Math.round(iceCumStop) });
                icePoints.push({ x: Math.round(iceTime + driveMin), y: Math.round(iceCumStop) });
            } else {
                icePoints.push({ x: Math.round(iceTime),            y: convDistance(iceDist,           units) });
                icePoints.push({ x: Math.round(iceTime + driveMin), y: convDistance(iceDist + driveMi, units) });
            }
            iceTime += driveMin;
            iceDist += driveMi;
            if (iceDist >= roadTripConfig.totalDistance - 0.01) break;
            if (isChargeTimeMode) {
                icePoints.push({ x: Math.round(iceTime),                y: Math.round(iceCumStop) });
                icePoints.push({ x: Math.round(iceTime + ICE_STOP_MIN), y: Math.round(iceCumStop + ICE_STOP_MIN) });
            } else {
                icePoints.push({ x: Math.round(iceTime),                y: convDistance(iceDist, units) });
                icePoints.push({ x: Math.round(iceTime + ICE_STOP_MIN), y: convDistance(iceDist, units) });
            }
            iceTime += ICE_STOP_MIN;
            iceCumStop += ICE_STOP_MIN;
        }
        datasets.unshift({
            label: 'ICE Reference',
            data: icePoints,
            borderColor: '#9ca3af',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [6, 4],
            tension: 0,
            pointRadius: 0,
            fill: false,
            order: 1,
            _isIce: true,
        });

        const validSims = simResults.filter(Boolean);
        const maxTime = Math.max(...validSims.map(s => s.totalTimeMin), iceTime, 60);
        const maxChargeTime = isChargeTimeMode
            ? Math.max(...validSims.map(s =>
                s.segments.filter(seg => seg.type === 'charge')
                          .reduce((sum, seg) => sum + (seg.endTime - seg.startTime), 0)
              ), iceCumStop, 30)
            : 0;

        const autoXMax = maxTime * 1.15;
        const autoYMax = isChargeTimeMode ? Math.ceil(maxChargeTime * 1.2 / 10) * 10 : totalDistDisplay;

        chartRef.current = new Chart(canvasRef.current, {
            type: 'line',
            data: { datasets },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest',
                    axis: 'xy',
                    intersect: false,
                },
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: 'Elapsed Time', font: { size: 13 } },
                        min: axisScale.xMin != null ? axisScale.xMin * 60 : 0,
                        max: axisScale.xMax != null ? axisScale.xMax * 60 : autoXMax,
                        ticks: {
                            stepSize: 30,
                            callback: val => {
                                if (val % 60 === 0) return val === 0 ? '0' : `${val / 60}h`;
                                if (val % 30 === 0) return ''; // tick mark at 30 min, no label
                                return null;
                            },
                        },
                    },
                    y: isChargeTimeMode ? {
                        reverse: true,
                        title: { display: true, text: 'Cumulative Charge Time (min)', font: { size: 13 } },
                        min: axisScale.yMin ?? 0,
                        max: axisScale.yMax ?? autoYMax,
                    } : {
                        reverse: true,
                        title: { display: true, text: `Distance Traveled (${dl})`, font: { size: 13 } },
                        min: axisScale.yMin ?? 0,
                        max: axisScale.yMax ?? autoYMax,
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 40 },
                    },
                    tooltip: {
                        displayColors: true,
                        callbacks: {
                            title: (items) => {
                                if (!items.length) return '';
                                return items[0].dataset.label;
                            },
                            label: (ctx) => {
                                const dsIdx = ctx.datasetIndex;
                                const ptIdx = ctx.dataIndex;
                                const sim = simResults[
                                    validEntries.findIndex((_, i) =>
                                        datasets.findIndex(d => d._simIndex === i) === dsIdx
                                    )
                                ];
                                if (!sim) return '';

                                const segIdx = Math.floor(ptIdx / 2);
                                const seg = sim.segments[segIdx];
                                if (!seg) return '';

                                if (seg.type === 'drive') {
                                    const d1 = Math.round(convDistance(seg.startDist, units));
                                    const d2 = Math.round(convDistance(seg.endDist, units));
                                    return [
                                        `Driving: ${d1}${dl} → ${d2}${dl}`,
                                        `SoC: ${seg.startSoc}% → ${seg.endSoc}%`,
                                        `Duration: ${formatTime(seg.endTime - seg.startTime)}`,
                                    ];
                                } else {
                                    const rangeAdded = (seg.endSoc - seg.startSoc) / 100
                                        * sim._batteryKwh * sim._correctedMiPerKwh;
                                    return [
                                        `Charging: ${seg.startSoc}% → ${seg.endSoc}%`,
                                        `+${Math.round(convDistance(rangeAdded, units))} ${dl} range`,
                                        `Charge time: ${formatTime(seg.endTime - seg.startTime)}`,
                                    ];
                                }
                            },
                        },
                    },
                    zoom: {
                        zoom: {
                            drag: {
                                enabled: true,
                                backgroundColor: 'rgba(59,130,246,0.08)',
                                borderColor: '#3b82f6',
                                borderWidth: 1,
                            },
                            mode: 'xy',
                        },
                    },
                },
            },
            plugins: [makeRoadTripPlugin(simResults.map((s, i) => {
                return datasets.find(d => d._simIndex === i) ? s : null;
            }).filter(Boolean), units)],
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [simResults, validEntries, units, roadTripConfig.totalDistance, roadTripConfig.yAxis, roadTripConfig.speed, roadTripConfig.overhead, axisScale]);

    // ── Config update helper ─────────────────────────────────────────────────
    const setField = (key, value) => setRoadTripConfig(prev => ({ ...prev, [key]: value }));

    // ── Render ───────────────────────────────────────────────────────────────
    const { startSoc, minSoc, legDistance, chargeTime, totalDistance, speed, mode, yAxis, overhead } = roadTripConfig;

    // ICE reference total time (for "vs ICE" column)
    const iceRefTimeMin = useMemo(() => {
        const ICE_DRIVE_INTERVAL_MIN = 180;
        let t = 0, d = 0, iter = 0;
        while (d < totalDistance && iter < 100) {
            iter++;
            const rem = totalDistance - d;
            const driveMi = Math.min((speed * ICE_DRIVE_INTERVAL_MIN) / 60, rem);
            t += (driveMi / speed) * 60;
            d += driveMi;
            if (d >= totalDistance - 0.01) break;
            t += overhead;
        }
        return t;
    }, [totalDistance, speed, overhead]);

    // Display values in current units
    const dispLeg   = units === 'metric' ? Math.round(legDistance * MI_TO_KM) : legDistance;
    const dispTotal = units === 'metric' ? Math.round(totalDistance * MI_TO_KM) : totalDistance;
    const dispSpeed = units === 'metric' ? Math.round(speed * MI_TO_KM) : speed;

    return (
        <div>
            {/* ── Controls ─────────────────────────────────────────────── */}
            {!presentationMode && (
                <div className="card mb-6">
                    <h3 className="text-lg font-bold mb-4">Road Trip Settings</h3>

                    {/* Toggles row */}
                    <div className="flex flex-wrap gap-6 mb-4">
                        <div>
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Simulation</span>
                            <div className="flex gap-1">
                                <button
                                    className={`btn btn-sm ${mode === 'distance' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setField('mode', 'distance')}
                                >
                                    Fixed Charge Amount
                                </button>
                                <button
                                    className={`btn btn-sm ${mode === 'time' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setField('mode', 'time')}
                                >
                                    Fixed Charge Time
                                </button>
                            </div>
                        </div>
                        <div>
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Y Axis</span>
                            <div className="flex gap-1">
                                <button
                                    className={`btn btn-sm ${yAxis === 'distance' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setField('yAxis', 'distance')}
                                >
                                    Distance
                                </button>
                                <button
                                    className={`btn btn-sm ${yAxis === 'chargeTime' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={() => setField('yAxis', 'chargeTime')}
                                >
                                    Charge Time
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-4">
                        <label className="text-sm">
                            <span className="font-medium block mb-1">Start SoC (%)</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={50} max={100} value={startSoc}
                                onChange={e => setField('startSoc', Number(e.target.value))} />
                        </label>
                        <label className="text-sm">
                            <span className="font-medium block mb-1">Min SoC (%)</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={5} max={30} value={minSoc}
                                onChange={e => setField('minSoc', Number(e.target.value))} />
                        </label>
                        {mode === 'distance' && (
                            <label className="text-sm">
                                <span className="font-medium block mb-1">Miles per Stop ({dl})</span>
                                <input type="number" className="w-full border rounded px-2 py-1"
                                    min={10} value={dispLeg}
                                    onChange={e => {
                                        const val = Number(e.target.value);
                                        setField('legDistance', units === 'metric' ? Math.round(val / MI_TO_KM) : val);
                                    }} />
                            </label>
                        )}
                        {mode === 'time' && (
                            <label className="text-sm">
                                <span className="font-medium block mb-1">Charge Time (min)</span>
                                <input type="number" className="w-full border rounded px-2 py-1"
                                    min={5} max={120} value={chargeTime}
                                    onChange={e => setField('chargeTime', Number(e.target.value))} />
                            </label>
                        )}
                        <label className="text-sm">
                            <span className="font-medium block mb-1">Total Distance ({dl})</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={10} value={dispTotal}
                                onChange={e => {
                                    const val = Number(e.target.value);
                                    setField('totalDistance', units === 'metric' ? Math.round(val / MI_TO_KM) : val);
                                }} />
                        </label>
                        <label className="text-sm">
                            <span className="font-medium block mb-1">Travel Speed ({sl})</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={20} value={dispSpeed}
                                onChange={e => {
                                    const val = Number(e.target.value);
                                    setField('speed', units === 'metric' ? Math.round(val / MI_TO_KM) : val);
                                }} />
                        </label>
                        <label className="text-sm">
                            <span className="font-medium block mb-1">Stop Overhead (min)</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={0} max={60} value={overhead}
                                title="Extra minutes added to every stop (parking, walk-in, plug-in). Applies to EV charging and ICE fuel stops."
                                onChange={e => setField('overhead', Number(e.target.value))} />
                        </label>
                    </div>

                    {/* Simulation result warnings — shown here so they're near the controls that triggered them */}
                    {simResults.some(s => s?.warnings?.length > 0) && (
                        <div className="mt-3 text-sm">
                            {validEntries.map((entry, i) => {
                                const sim = simResults[i];
                                if (!sim?.warnings?.length) return null;
                                return sim.warnings.map((w, wi) => (
                                    <p key={`${entry.run.id}-${wi}`} className="roadtrip-warning">
                                        ⚠ {entry.vehicle.name} – {entry.run.name}: {w}
                                    </p>
                                ));
                            })}
                        </div>
                    )}

                    {/* Run selector */}
                    <div className="mt-4">
                        <RunSelector
                            vehicles={selectedVehicles.filter(v =>
                                (v.runs || []).some(r => r.has_charging !== false)
                            )}
                            selectedRunIds={selectedRunIds}
                            onToggleRun={runId => setSelectedRunIds(prev =>
                                prev.includes(runId)
                                    ? prev.filter(x => x !== runId)
                                    : [...prev, runId]
                            )}
                            onUpdateRunColor={null}
                            runFilter={r => r.has_charging !== false}
                            emptyMessage="No charging test data"
                            renderRunMeta={run => {
                                const info = allChargingRunsInfo[run.id];
                                if (!info) return null;
                                if (!info.miPerKwh) {
                                    return <span className="text-xs text-red-400 ml-1">⚠ No range data</span>;
                                }
                                const eff = info.miPerKwh.toFixed(1);
                                const spd = info.testSpeedMph
                                    ? `${fmtSpeed(info.testSpeedMph, units)}`
                                    : '70 mph (assumed)';
                                return (
                                    <span className="text-xs text-gray-400 ml-1">
                                        {eff} {units === 'metric' ? 'km/kWh' : 'mi/kWh'} @ {spd}
                                        {info.efficiencyNote && ` · ${info.efficiencyNote}`}
                                    </span>
                                );
                            }}
                        />
                    </div>

                    {/* Warnings for vehicles/runs that can't be simulated */}
                    {(vehiclesWithNoChargingRuns.length > 0 || skippedEntries.length > 0) && (
                        <div className="roadtrip-warning mt-3">
                            {vehiclesWithNoChargingRuns.map(v => (
                                <p key={v.id}>⚠ {v.name}: No charging test data</p>
                            ))}
                            {skippedEntries.map(e => (
                                <p key={e.run.id}>
                                    ⚠ {e.vehicle.name} – {e.run.name}: {!e.miPerKwh ? 'No range data for efficiency' : 'No battery capacity'}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Chart ────────────────────────────────────────────────── */}
            {loading && (
                <div className="text-center py-8 text-gray-500">Loading charging data…</div>
            )}

            {!loading && validEntries.length === 0 && (
                <div className="empty-state">
                    <p className="text-lg">No runs with usable charging and efficiency data.</p>
                    <p className="text-sm text-gray-500 mt-2">
                        Each run needs charging data, and either its own range test result
                        or another run from the same vehicle with distance &amp; energy data.
                    </p>
                </div>
            )}

            {!loading && validEntries.length > 0 && (
                <div className="card mb-6">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-bold">
                            Road Trip — {Math.round(convDistance(totalDistance, units))} {dl} at {Math.round(convDistance(speed, units))} {sl}
                        </h3>
                        <button
                            onClick={() => chartRef.current?.resetZoom()}
                            className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-2 py-1 transition-colors"
                            title="Reset zoom to full view"
                        >
                            Reset Zoom
                        </button>
                    </div>
                    <div style={{ height: `${Math.max(400, validEntries.length * 40 + 200)}px`, position: 'relative' }}>
                        <canvas ref={canvasRef} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1 text-center">Drag to zoom · Reset Zoom to restore</p>
                    <div className="mt-4 border-t pt-4">
                        <AxisScaleControls
                            xMin={axisScale.xMin} xMax={axisScale.xMax}
                            yMin={axisScale.yMin} yMax={axisScale.yMax}
                            onChange={onAxisChange}
                            showX={true}
                            showY2={false}
                            xAxisLabel="X-Axis Scale (hrs)"
                        />
                    </div>
                </div>
            )}

            {/* ── Summary Table ─────────────────────────────────────────── */}
            {!loading && simResults.some(Boolean) && !presentationMode && (
                <div className="card">
                    <h3 className="text-lg font-bold mb-3">Results Summary</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold">Vehicle / Run</th>
                                    <th className="px-3 py-2 text-left font-semibold">Total Time</th>
                                    <th className="px-3 py-2 text-left font-semibold">Stops</th>
                                    <th className="px-3 py-2 text-left font-semibold">Avg Charge</th>
                                    <th className="px-3 py-2 text-left font-semibold">Efficiency</th>
                                    <th className="px-3 py-2 text-left font-semibold">Corrected Eff</th>
                                    <th className="px-3 py-2 text-left font-semibold">Speed Adj</th>
                                    <th className="px-3 py-2 text-left font-semibold">vs ICE</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {validEntries.map((entry, i) => {
                                    const sim = simResults[i];
                                    if (!sim) return null;
                                    const chargingSegments = sim.segments.filter(s => s.type === 'charge');
                                    const avgChargeTime = chargingSegments.length > 0
                                        ? chargingSegments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0) / chargingSegments.length
                                        : 0;
                                    const speedDiff = entry.testSpeedMph
                                        ? Math.abs(speed - entry.testSpeedMph)
                                        : 0;
                                    const adjPct = Math.round((sim.speedFactor - 1) * 100);
                                    const effLabel = units === 'metric' ? 'km/kWh' : 'mi/kWh';

                                    return (
                                        <tr key={entry.run.id}>
                                            <td className="px-3 py-2">
                                                <div className="flex items-start gap-2">
                                                    <span className="inline-block w-3 h-3 rounded-full mt-1 shrink-0"
                                                          style={{ backgroundColor: entry.color }} />
                                                    <div>
                                                        <div className="font-medium">{entry.vehicle.name}</div>
                                                        <div className="text-xs text-gray-400">{entry.run.name}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 font-medium">{formatTime(sim.totalTimeMin)}</td>
                                            <td className="px-3 py-2">{sim.chargeStops}</td>
                                            <td className="px-3 py-2">{sim.chargeStops > 0 ? formatTime(avgChargeTime) : '—'}</td>
                                            <td className="px-3 py-2">
                                                {entry.miPerKwh.toFixed(1)} {effLabel}
                                                {entry.testSpeedMph ? (
                                                    <span className="text-gray-400 ml-1">@ {fmtSpeed(entry.testSpeedMph, units)}</span>
                                                ) : (
                                                    <span className="text-amber-500 ml-1" title="Set Speed (mph) on the run in Tests &amp; Data for accurate speed correction">@ 70 mph (assumed)</span>
                                                )}
                                                {entry.efficiencyNote && (
                                                    <span className="block text-xs text-gray-400">{entry.efficiencyNote}</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2">
                                                {sim.correctedMiPerKwh.toFixed(1)} {effLabel}
                                            </td>
                                            <td className={`px-3 py-2 ${speedDiff > 5 ? 'roadtrip-warning' : ''}`}>
                                                {adjPct > 0 ? `+${adjPct}%` : `${adjPct}%`}
                                                {speedDiff > 5 && entry.testSpeedMph && (
                                                    <span className="block text-xs">
                                                        Test: {fmtSpeed(entry.testSpeedMph, units)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 font-medium">
                                                {(() => {
                                                    const deltaMin = sim.totalTimeMin - iceRefTimeMin;
                                                    const absDelta = Math.abs(deltaMin);
                                                    const h = Math.floor(absDelta / 60);
                                                    const m = Math.round(absDelta % 60);
                                                    const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
                                                    return deltaMin > 0
                                                        ? <span className="text-amber-600">+{label}</span>
                                                        : <span className="text-green-600">−{label}</span>;
                                                })()}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                </div>
            )}
        </div>
    );
}
