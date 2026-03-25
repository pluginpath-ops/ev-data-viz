import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import { dataService } from '../services/DataService';
import { useAppContext } from '../context/AppContext';
import { convDistance, distanceLabel, speedLabel, fmtSpeed, MI_TO_KM } from '../utils/unitConversions';
import {
    simulateRoadTrip, segmentsToChartPoints, formatTime,
    speedCorrectionFactor,
} from '../utils/roadTripSimulation';

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
            chart.data.datasets.forEach((ds, di) => {
                const sim = simResults[di];
                if (!sim) return;

                const meta = chart.getDatasetMeta(di);
                const data = meta.data;
                if (!data.length) return;

                // ── Charging segment badges ──────────────────────────────
                let ptIdx = 0;
                for (const seg of sim.segments) {
                    if (seg.type === 'charge' && ptIdx + 1 < data.length) {
                        const startPt = data[ptIdx];
                        const endPt   = data[ptIdx + 1];
                        const segWidth = Math.abs(endPt.x - startPt.x);
                        if (segWidth > 60) {
                            const midX = (startPt.x + endPt.x) / 2;
                            const midY = startPt.y - 12;
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
                    // Each segment produces 2 chart points
                    ptIdx += 2;
                }

                // ── Finish label ─────────────────────────────────────────
                const lastPt = data[data.length - 1];
                if (lastPt) {
                    ctx.save();
                    ctx.font = 'bold 11px system-ui, sans-serif';
                    ctx.fillStyle = ds.borderColor;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    const finishLabel = `${ds.label} — ${formatTime(sim.totalTimeMin)}`;
                    ctx.fillText(finishLabel, lastPt.x + 6, lastPt.y);
                    ctx.restore();
                }
            });
        },
    };
}

// ── VehicleSelector ──────────────────────────────────────────────────────────
/**
 * Collapsible vehicle toggle panel for Road Trip — one row per vehicle pair.
 * Styled to match RunSelector for visual consistency.
 */
function VehicleSelector({ pairs, hiddenIds, onToggle, colorOverrides, onColorChange }) {
    const [expanded, setExpanded] = useState(false);
    const selectedCount = pairs.filter(p => !hiddenIds.includes(p.vehicle.id)).length;

    return (
        <div>
            <button onClick={() => setExpanded(prev => !prev)} className="run-selector-header">
                <span style={{ display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                Select Vehicles to Display
                <span className="text-sm font-normal text-gray-500">({selectedCount} of {pairs.length} shown)</span>
            </button>

            {expanded && (
                <div className="mt-3">
                    <div className="run-items">
                        {pairs.map(pair => {
                            const hidden = hiddenIds.includes(pair.vehicle.id);
                            const color = colorOverrides[pair.vehicle.id] || pair.color;
                            return (
                                <label
                                    key={pair.vehicle.id}
                                    className={`flex items-center gap-2 cursor-pointer ${hidden ? 'opacity-50 hover:opacity-100' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={!hidden}
                                        onChange={() => onToggle(pair.vehicle.id)}
                                        className="w-4 h-4 shrink-0"
                                    />
                                    <input
                                        type="color"
                                        value={color}
                                        onChange={e => { e.stopPropagation(); onColorChange(pair.vehicle.id, e.target.value); }}
                                        onClick={e => e.stopPropagation()}
                                        className="w-8 h-6 border-0 rounded cursor-pointer shrink-0"
                                        title="Change color"
                                    />
                                    <span className="run-label">
                                        <span className="font-medium">{pair.vehicle.name}</span>
                                        <span className="text-xs text-gray-400 ml-2">
                                            Range: {pair.rangeRun?.name} &middot; Charge: {pair.chargingRun?.name}
                                        </span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
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
    const [hiddenVehicleIds, setHiddenVehicleIds] = useState([]);
    const [colorOverrides, setColorOverrides] = useState({});

    const dl = distanceLabel(units);
    const sl = speedLabel(units);

    // ── Resolve selected vehicles ────────────────────────────────────────────
    const selectedVehicles = useMemo(
        () => vehicles.filter(v => selectedVehicleIds.includes(v.id)),
        [vehicles, selectedVehicleIds]
    );

    // ── Resolve run pairs (one range + one charging per vehicle) ─────────────
    const vehicleRunPairs = useMemo(() => {
        return selectedVehicles.map((vehicle, idx) => {
            const rangeRuns = (vehicle.runs || []).filter(r => r.has_range);
            const chargingRuns = (vehicle.runs || []).filter(r => r.has_charging !== false);

            const rangeRun = rangeRuns
                .filter(r => r.distance_miles && r.energy_kwh)
                .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

            const chargingRun =
                chargingRuns.find(r => r.isDefault) ||
                [...chargingRuns].sort((a, b) => new Date(b.date) - new Date(a.date))[0] ||
                null;

            const miPerKwh = rangeRun ? rangeRun.distance_miles / rangeRun.energy_kwh : null;

            return {
                vehicle,
                rangeRun,
                chargingRun,
                miPerKwh,
                testSpeedMph: rangeRun?.speed_mph ?? null,
                batteryKwh: vehicle.battery,
                color: vehicle.color || PALETTE[idx % PALETTE.length],
            };
        });
    }, [selectedVehicles]);

    const validPairs   = vehicleRunPairs.filter(p => p.rangeRun && p.chargingRun && p.miPerKwh && p.batteryKwh);
    const skippedPairs = vehicleRunPairs.filter(p => !validPairs.includes(p));

    // ── Lazy-load charging data ──────────────────────────────────────────────
    const neededRunIds = useMemo(
        () => [...new Set(validPairs.map(p => p.chargingRun.id).filter(Boolean))],
        [validPairs]
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
    }, [neededRunIds.join(',')]);

    // ── Run simulation for each vehicle ──────────────────────────────────────
    const simResults = useMemo(() => {
        const { startSoc, minSoc, legDistance, chargeTime, totalDistance, speed, mode } = roadTripConfig;

        return validPairs.map(pair => {
            const chargingData = runDataCache[pair.chargingRun.id];
            if (!chargingData || chargingData.length === 0) return null;

            const result = simulateRoadTrip({
                batteryKwh:       pair.batteryKwh,
                miPerKwh:         pair.miPerKwh,
                testSpeedMph:     pair.testSpeedMph || speed,
                chargingData,
                startSoc,
                minSoc,
                legDistanceMi:    legDistance,
                totalDistanceMi:  totalDistance,
                speedMph:         speed,
                chargeTimeMinutes: chargeTime,
                mode,
            });

            // Attach helper fields for the plugin
            result._batteryKwh = pair.batteryKwh;
            result._correctedMiPerKwh = result.correctedMiPerKwh;

            return result;
        });
    }, [validPairs, runDataCache, roadTripConfig]);

    // ── Build & render chart ─────────────────────────────────────────────────
    useEffect(() => {
        if (!canvasRef.current || !simResults.some(Boolean)) return;

        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }

        const { totalDistance } = roadTripConfig;
        const totalDistDisplay = convDistance(totalDistance, units);

        const datasets = validPairs.map((pair, i) => {
            const sim = simResults[i];
            if (!sim) return null;
            if (hiddenVehicleIds.includes(pair.vehicle.id)) return null;

            const effectiveColor = colorOverrides[pair.vehicle.id] || pair.color;
            const points = segmentsToChartPoints(sim.segments, units);

            // Mark charge-start points with larger radius
            const pointRadii = [];
            let ptIdx = 0;
            for (const seg of sim.segments) {
                pointRadii.push(seg.type === 'charge' ? 4 : 0); // start of segment
                pointRadii.push(0); // end of segment
                ptIdx += 2;
            }

            return {
                label: pair.vehicle.name,
                data: points,
                borderColor: effectiveColor,
                backgroundColor: effectiveColor + '33',
                borderWidth: 2.5,
                tension: 0,
                pointRadius: pointRadii,
                pointBackgroundColor: effectiveColor,
                pointBorderColor: effectiveColor,
                fill: false,
                _simIndex: i,
            };
        }).filter(Boolean);

        const validSims = simResults.filter(Boolean);
        const maxTime = Math.max(...validSims.map(s => s.totalTimeMin), 60);

        chartRef.current = new Chart(canvasRef.current, {
            type: 'line',
            data: { datasets },
            options: {
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
                        min: 0,
                        max: maxTime * 1.15,
                        ticks: {
                            stepSize: 30,
                            callback: val => {
                                if (val % 60 === 0) {
                                    return val === 0 ? '0' : `${val / 60}h`;
                                }
                                return null; // sub-tick at 30 min — no label
                            },
                        },
                    },
                    y: {
                        reverse: true,
                        title: { display: true, text: `Distance Traveled (${dl})`, font: { size: 13 } },
                        min: 0,
                        max: totalDistDisplay,
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
                                const sim = simResults[validPairs.findIndex((_, i) => datasets.findIndex(d => d._simIndex === i) === dsIdx)];
                                if (!sim) return '';

                                // Find which segment this point belongs to
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
                },
            },
            plugins: [makeRoadTripPlugin(simResults.map((s, i) => {
                // Only pass sims that have datasets
                return datasets.find(d => d._simIndex === i) ? s : null;
            }).filter(Boolean), units)],
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [simResults, validPairs, units, roadTripConfig.totalDistance, hiddenVehicleIds, colorOverrides]);

    // ── Config update helper ─────────────────────────────────────────────────
    const setField = (key, value) => setRoadTripConfig(prev => ({ ...prev, [key]: value }));

    // ── Render ───────────────────────────────────────────────────────────────
    const { startSoc, minSoc, legDistance, chargeTime, totalDistance, speed, mode } = roadTripConfig;

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

                    {/* Mode toggle */}
                    <div className="flex gap-1 mb-4">
                        <button
                            className={`btn btn-sm ${mode === 'distance' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setField('mode', 'distance')}
                        >
                            Fixed Stop Distance
                        </button>
                        <button
                            className={`btn btn-sm ${mode === 'time' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setField('mode', 'time')}
                        >
                            Fixed Charge Time
                        </button>
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
                                <span className="font-medium block mb-1">Between Stops ({dl})</span>
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
                    </div>

                    {/* Vehicle selector */}
                    {validPairs.length > 0 && (
                        <div className="mt-4">
                            <VehicleSelector
                                pairs={validPairs}
                                hiddenIds={hiddenVehicleIds}
                                onToggle={id => setHiddenVehicleIds(prev =>
                                    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                                )}
                                colorOverrides={colorOverrides}
                                onColorChange={(id, color) => setColorOverrides(prev => ({ ...prev, [id]: color }))}
                            />
                        </div>
                    )}

                    {/* Skipped vehicles */}
                    {skippedPairs.length > 0 && (
                        <div className="roadtrip-warning mt-2">
                            {skippedPairs.map(p => (
                                <p key={p.vehicle.id}>
                                    ⚠ {p.vehicle.name}: {!p.rangeRun ? 'No range test data' : !p.chargingRun ? 'No charging data' : !p.batteryKwh ? 'No battery size' : 'Missing efficiency data'}
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

            {!loading && validPairs.length === 0 && (
                <div className="empty-state">
                    <p className="text-lg">No vehicles with both range and charging test data.</p>
                    <p className="text-sm text-gray-500 mt-2">
                        Each vehicle needs at least one range test (with distance &amp; energy) and one charging test.
                    </p>
                </div>
            )}

            {!loading && validPairs.length > 0 && (
                <div className="card mb-6">
                    <h3 className="text-lg font-bold mb-2">
                        Road Trip — {Math.round(convDistance(totalDistance, units))} {dl} at {Math.round(convDistance(speed, units))} {sl}
                    </h3>
                    <div style={{ height: `${Math.max(400, validPairs.length * 40 + 200)}px`, position: 'relative' }}>
                        <canvas ref={canvasRef} />
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
                                    <th className="px-3 py-2 text-left font-semibold">Vehicle</th>
                                    <th className="px-3 py-2 text-left font-semibold">Total Time</th>
                                    <th className="px-3 py-2 text-left font-semibold">Stops</th>
                                    <th className="px-3 py-2 text-left font-semibold">Avg Charge</th>
                                    <th className="px-3 py-2 text-left font-semibold">Tested Eff</th>
                                    <th className="px-3 py-2 text-left font-semibold">Corrected Eff</th>
                                    <th className="px-3 py-2 text-left font-semibold">Speed Adj</th>
                                    <th className="px-3 py-2 text-left font-semibold">Runs</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {validPairs.map((pair, i) => {
                                    const sim = simResults[i];
                                    if (!sim) return null;
                                    const chargingSegments = sim.segments.filter(s => s.type === 'charge');
                                    const avgChargeTime = chargingSegments.length > 0
                                        ? chargingSegments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0) / chargingSegments.length
                                        : 0;
                                    const speedDiff = pair.testSpeedMph
                                        ? Math.abs(speed - pair.testSpeedMph)
                                        : 0;
                                    const adjPct = Math.round((sim.speedFactor - 1) * 100);

                                    const effectiveColor = colorOverrides[pair.vehicle.id] || pair.color;
                                    return (
                                        <tr key={pair.vehicle.id}>
                                            <td className="px-3 py-2">
                                                <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: effectiveColor }} />
                                                {pair.vehicle.name}
                                            </td>
                                            <td className="px-3 py-2 font-medium">{formatTime(sim.totalTimeMin)}</td>
                                            <td className="px-3 py-2">{sim.chargeStops}</td>
                                            <td className="px-3 py-2">{sim.chargeStops > 0 ? formatTime(avgChargeTime) : '—'}</td>
                                            <td className="px-3 py-2">
                                                {pair.miPerKwh.toFixed(1)} {units === 'metric' ? 'km/kWh' : 'mi/kWh'}
                                                {pair.testSpeedMph && (
                                                    <span className="text-gray-400 ml-1">@ {fmtSpeed(pair.testSpeedMph, units)}</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2">
                                                {sim.correctedMiPerKwh.toFixed(1)} {units === 'metric' ? 'km/kWh' : 'mi/kWh'}
                                            </td>
                                            <td className={`px-3 py-2 ${speedDiff > 5 ? 'roadtrip-warning' : ''}`}>
                                                {adjPct > 0 ? `+${adjPct}%` : `${adjPct}%`}
                                                {speedDiff > 5 && pair.testSpeedMph && (
                                                    <span className="block text-xs">
                                                        Test: {fmtSpeed(pair.testSpeedMph, units)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-gray-500">
                                                <div>Range: {pair.rangeRun.name}</div>
                                                <div>Charge: {pair.chargingRun.name}</div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Warnings */}
                    {simResults.some(s => s?.warnings?.length > 0) && (
                        <div className="mt-3 text-sm">
                            {validPairs.map((pair, i) => {
                                const sim = simResults[i];
                                if (!sim?.warnings?.length) return null;
                                return sim.warnings.map((w, wi) => (
                                    <p key={`${pair.vehicle.id}-${wi}`} className="roadtrip-warning">
                                        ⚠ {pair.vehicle.name}: {w}
                                    </p>
                                ));
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
