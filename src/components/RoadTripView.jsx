import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import ZoomPlugin from 'chartjs-plugin-zoom';
import { vehicleLabel } from '../utils/specHelpers';
import { dataService } from '../services/DataService';
import { useAppContext } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import { convDistance, distanceLabel, speedLabel, fmtSpeed, MI_TO_KM } from '../utils/unitConversions';
import { filterChargingRuns, filterRangeRuns, isRangeRun, pairedChargingRun } from '../utils/runUtils';
import { resolveRangeSource, epaRangeOption, EPA_PARTNER_ID } from '../utils/rangeSource';
import { pairKey, parsePairKey, partnersFor, addPartner, replacePartner, removePartner } from '../utils/pairings';
import RunSelector from './RunSelector';
import AxisScaleControls from './AxisScaleControls';
import {
    simulateRoadTrip, segmentsToChartPoints, segmentsToChartPointsChargeTime,
    segmentsToChartPointsByTest,
    formatTime, speedCorrectionFactor,
} from '../utils/roadTripSimulation';
import LoadingSpinner from './LoadingSpinner';
import { resolveChartColors } from '../utils/colorUtils';
import ChartInfoBubble from './ChartInfoBubble';

Chart.register(ZoomPlugin);

// ── Speed sweep constants ────────────────────────────────────────────────────
const SPEED_SWEEP_MIN  = 45;   // mph
const SPEED_SWEEP_MAX  = 100;  // mph
const SPEED_SWEEP_STEP = 5;    // mph
const SPEED_SWEEP_MPH  = Array.from(
    { length: Math.floor((SPEED_SWEEP_MAX - SPEED_SWEEP_MIN) / SPEED_SWEEP_STEP) + 1 },
    (_, i) => SPEED_SWEEP_MIN + i * SPEED_SWEEP_STEP,
); // [45, 50, 55, ..., 100]

// ── Leg-distance sweep constants (mi between charging stops) ─────────────────
const LEG_SWEEP_MIN  = 60;   // miles between charges
const LEG_SWEEP_MAX  = 260;  // miles between charges
const LEG_SWEEP_STEP = 20;   // miles
const LEG_SWEEP_MI   = Array.from(
    { length: Math.floor((LEG_SWEEP_MAX - LEG_SWEEP_MIN) / LEG_SWEEP_STEP) + 1 },
    (_, i) => LEG_SWEEP_MIN + i * LEG_SWEEP_STEP,
); // [60, 80, 100, ..., 200]

// ── Unrealistic simulation check ─────────────────────────────────────────────
const CHARGE_CEIL_SOC = 95; // % — charging above this marks a sim as unrealistic

/**
 * Returns true when a simulation result is considered unrealistic:
 * any charge stop exceeded CHARGE_CEIL_SOC, or the battery was depleted /
 * max iterations were hit (i.e. the vehicle couldn't complete the trip).
 */
function isSimUnrealistic(sim) {
    if (!sim) return true;
    if (sim.completed === false) return true;
    if (sim.segments.some(s => s.type === 'charge' && s.endSoc > CHARGE_CEIL_SOC)) return true;
    if (sim.warnings.some(w => /depleted|maximum iterations|complete trip/i.test(w))) return true;
    return false;
}

/** Y-value for one sweep sim result (shared by speed and distance sweeps). */
function getSweepY(sim, mph, totalDistanceMi, sweepYAxis) {
    const driveMin = (totalDistanceMi / mph) * 60;
    if (sweepYAxis === 'driveTime')  return driveMin;
    if (sweepYAxis === 'chargeTime') return sim.totalTimeMin - driveMin;
    return sim.totalTimeMin; // 'totalTime'
}

/** Compute ICE total trip time at a given travel speed (used for speed-sweep ICE line). */
function calcIceTotalTimeAtSpeed(speedMph, totalDistanceMi, overheadMin) {
    const ICE_DRIVE_INTERVAL_MIN = 180;
    let t = 0, d = 0, iter = 0;
    while (d < totalDistanceMi && iter < 100) {
        iter++;
        const rem = totalDistanceMi - d;
        const driveMi = Math.min((speedMph * ICE_DRIVE_INTERVAL_MIN) / 60, rem);
        t += (driveMi / speedMph) * 60;
        d += driveMi;
        if (d >= totalDistanceMi - 0.01) break;
        t += overheadMin;
    }
    return t;
}

// Efficiency derivation moved to utils/rangeSource.js, shared with Charge
// Compare. The mi/kWh math is unchanged (measured energy preferred, SoC-delta
// estimate as fallback); what changed is that choosing WHICH range test to
// derive from is now one ranked, user-overridable decision instead of two
// views each guessing separately.

// ── Default vehicle colors ───────────────────────────────────────────────────
const PALETTE = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444',
    '#3b82f6', '#a855f7', '#ec4899', '#14b8a6',
];

// ── Chart.js plugin: charging badges + finish labels ─────────────────────────
function makeRoadTripPlugin(simResults, units, yAxis, iceTimeMin, iceByTestInfo) {
    return {
        id: 'roadTripLabels',

        // ── Pale green charge/gas-stop region boxes (byTest mode only) ────
        beforeDatasetsDraw(chart) {
            if (yAxis !== 'byTest') return;
            const ctx = chart.ctx;
            const { left, right, top, bottom } = chart.chartArea;
            ctx.save();
            ctx.beginPath();
            ctx.rect(left, top, right - left, bottom - top);
            ctx.clip();
            ctx.fillStyle = 'rgba(134,239,172,0.22)'; // green-300 at low opacity

            // EV charge regions
            simResults.forEach((sim, runIndex) => {
                if (!sim) return;
                const yTop    = chart.scales.y.getPixelForValue(runIndex + 1); // SoC 100%
                const yBottom = chart.scales.y.getPixelForValue(runIndex);     // SoC 0%
                for (const seg of sim.segments) {
                    if (seg.type !== 'charge') continue;
                    const x1 = chart.scales.x.getPixelForValue(seg.startTime);
                    const x2 = chart.scales.x.getPixelForValue(seg.endTime);
                    ctx.fillRect(x1, yTop, x2 - x1, yBottom - yTop);
                }
            });

            // ICE gas stop regions
            if (iceByTestInfo) {
                const { laneIndex, gasStops } = iceByTestInfo;
                const yTop    = chart.scales.y.getPixelForValue(laneIndex + 1);
                const yBottom = chart.scales.y.getPixelForValue(laneIndex);
                for (const stop of gasStops) {
                    const x1 = chart.scales.x.getPixelForValue(stop.startTime);
                    const x2 = chart.scales.x.getPixelForValue(stop.endTime);
                    ctx.fillRect(x1, yTop, x2 - x1, yBottom - yTop);
                }
            }

            ctx.restore();
        },

        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;

            // ── byTest mode: draw elapsed-time + vs-ICE callout at end of each run ──
            if (yAxis === 'byTest') {
                let simIdx = 0;
                chart.data.datasets.forEach((ds, di) => {
                    if (ds._isIce) return;
                    const sim = simResults[simIdx++];
                    if (!sim || !ds.data.length) return;
                    const meta   = chart.getDatasetMeta(di);
                    const lastPt = meta.data[meta.data.length - 1];
                    if (!lastPt) return;

                    const timeLabel = sim.completed === false ? 'did not finish' : formatTime(sim.totalTimeMin);
                    const deltaMin  = (sim.completed !== false && iceTimeMin != null) ? sim.totalTimeMin - iceTimeMin : null;
                    const absDelta  = deltaMin != null ? Math.abs(deltaMin) : null;
                    const vsIce     = absDelta != null
                        ? (deltaMin > 0 ? `+${formatTime(absDelta)} vs ICE` : `−${formatTime(absDelta)} vs ICE`)
                        : null;

                    ctx.save();
                    ctx.font         = 'bold 11px system-ui, sans-serif';
                    ctx.textAlign    = 'left';
                    ctx.textBaseline = 'middle';

                    // Shift block upward so labels sit inside the lane rather than over the boundary
                    const labelY = lastPt.y - 13;

                    // Main elapsed time in vehicle color
                    ctx.fillStyle = ds.borderColor;
                    ctx.fillText(timeLabel, lastPt.x + 6, labelY);

                    // vs ICE delta below, in amber (slower) or green (faster)
                    if (vsIce) {
                        ctx.font      = '10px system-ui, sans-serif';
                        ctx.fillStyle = deltaMin > 0 ? '#d97706' : '#16a34a'; // amber-600 / green-600
                        ctx.fillText(vsIce, lastPt.x + 6, labelY + 13);
                    }
                    ctx.restore();
                });

                // ICE callout
                if (iceByTestInfo) {
                    const iceDsIdx = chart.data.datasets.findIndex(d => d._isIce);
                    if (iceDsIdx >= 0) {
                        const iceMeta = chart.getDatasetMeta(iceDsIdx);
                        const lastPt  = iceMeta.data[iceMeta.data.length - 1];
                        if (lastPt) {
                            const labelY = lastPt.y - 13;
                            ctx.save();
                            ctx.font         = 'bold 11px system-ui, sans-serif';
                            ctx.fillStyle    = '#6b7280'; // gray-500
                            ctx.textAlign    = 'left';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(`ICE — ${formatTime(iceByTestInfo.totalTimeMin)}`, lastPt.x + 6, labelY);
                            ctx.restore();
                        }
                    }
                }
                return;
            }

            // ── badge + finish label code for Distance / Charge Time modes ──

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
                        text: sim.completed === false
                            ? `${ds.label} — did not finish`
                            : `${ds.label} — ${formatTime(sim.totalTimeMin)}`,
                        color: ds.borderColor,
                    });
                }
            });

            // ── Pass 3: conflict-group spread + draw with leader lines ────
            if (!finishLabels.length) return;

            const LABEL_H = 16; // minimum px between label centres

            // Sort by natural Y position; break ties by finish time (faster → top)
            finishLabels.sort((a, b) => a.y - b.y || a.x - b.x);

            const { top, bottom } = chart.chartArea;

            // Build adjusted Y positions by finding conflict groups and spreading
            // only within each group. Labels with no close neighbours stay put.
            const adjYs = finishLabels.map(l => l.y); // start at natural positions
            let gi = 0;
            while (gi < finishLabels.length) {
                // Extend the group as long as consecutive natural-Y values are too close
                let gj = gi + 1;
                while (gj < finishLabels.length && finishLabels[gj].y - finishLabels[gj - 1].y < LABEL_H) gj++;

                if (gj > gi + 1) {
                    // Spread this conflict group around its natural centroid
                    const groupN   = gj - gi;
                    const centroid = finishLabels.slice(gi, gj).reduce((s, l) => s + l.y, 0) / groupN;
                    const span     = (groupN - 1) * LABEL_H;
                    const startY   = Math.max(top + 8, Math.min(bottom - span - 8, centroid - span / 2));
                    for (let k = gi; k < gj; k++) adjYs[k] = startY + (k - gi) * LABEL_H;
                }
                gi = gj;
            }

            ctx.save();
            ctx.font = 'bold 11px system-ui, sans-serif';

            finishLabels.forEach((l, i) => {
                const adjY      = adjYs[i];
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
    // Global chart-session pairings (utils/pairings.js). Read-only here: this
    // view consumes a pairing chosen in Charge Compare but does not set one,
    // because it is charging-primary and the pairing is keyed by range test.
    pairings = {},
    setPairings = () => {},
    onUpdateRunColor = null,
    presentationMode = false,
    autoColor = true,
    setChartConfig = null,
}) {
    const { units } = useAppContext();
    const { isDark } = useTheme();
    const canvasRef = useRef(null);
    const chartRef  = useRef(null);

    const [runDataCache, setRunDataCache] = useState({});
    const [loading, setLoading] = useState(false);
    const [selectedRunIds, setSelectedRunIds] = useState(() => {
        // Restore pair keys from the URL on first render (rt_r=70::12,71::13).
        // Strings, not numbers: a pair key is 'rangeId::chargingId'.
        const raw = new URLSearchParams(window.location.search).get('rt_r');
        return raw ? raw.split(',').filter(Boolean) : [];
    });
    const [axisScale, setAxisScale] = useState({ xMin: null, xMax: null, yMin: null, yMax: null });
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [imageCopied, setImageCopied] = useState(false);
    const [chartImage, setChartImage]   = useState(null);
    const [sortCol, setSortCol] = useState(null);   // column key or null
    const [sortDir, setSortDir] = useState('asc');  // 'asc' | 'desc'
    const onAxisChange = (key, val) => setAxisScale(prev => ({ ...prev, [key]: val }));

    const dl = distanceLabel(units);
    const sl = speedLabel(units);

    // ── Resolve selected vehicles (preserve pill order) ──────────────────────
    const selectedVehicles = useMemo(
        () => selectedVehicleIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean),
        [vehicles, selectedVehicleIds]
    );

    // ── Resolve chart colors for all charging runs ────────────────────────────
    const colorMap = useMemo(() => {
        const allRuns = selectedVehicles.flatMap(v => filterChargingRuns(v.runs));
        return resolveChartColors(allRuns, {}, autoColor ? 'auto' : 'manual');
    }, [selectedVehicles, autoColor]);

    // ── One entry per (range test × charging test) pair ───────────────────────
    // Range-primary, matching Charge Compare: a charging curve is a property of
    // the car and varies little, while a range test is a property of the day —
    // wind, temperature, HVAC, tyres, elevation, load. Each pair is its own trip
    // simulation, so the same car under two conditions is two comparable rows.
    //
    // A Map, not an object: insertion order is the display order, and the keys
    // are pair-key strings.
    const allPairsInfo = useMemo(() => {
        const map = new Map();
        let colorIdx = 0;
        for (const vehicle of selectedVehicles) {
            const chargingRuns = filterChargingRuns(vehicle.runs);
            if (!chargingRuns.length) continue;

            const epa = epaRangeOption(vehicle);
            const primaries = epa ? [...filterRangeRuns(vehicle.runs), epa] : filterRangeRuns(vehicle.runs);

            for (const rangeRun of primaries) {
                const pinned = partnersFor(pairings, rangeRun.id);
                const rows   = pinned.length ? pinned : [null];

                for (const partnerId of rows) {
                    const chargingRun = partnerId
                        ? chargingRuns.find(r => String(r.id) === String(partnerId)) ?? pairedChargingRun(rangeRun, vehicle)
                        : pairedChargingRun(rangeRun, vehicle);
                    if (!chargingRun) continue;

                    // The range side is explicit — it is the row — so the resolver
                    // enters at rank 1 and its fallbacks only matter when the chosen
                    // test carries no usable data.
                    const src = resolveRangeSource(chargingRun, {
                        vehicle,
                        batteryKwh: vehicle.battery,
                        explicitPairing: rangeRun.id === EPA_PARTNER_ID ? EPA_PARTNER_ID : rangeRun,
                    });

                    const key = pairKey(rangeRun.id, partnerId);
                    map.set(key, {
                        key,
                        vehicle,
                        rangeRun,
                        // `run` stays the CHARGING run: it is what supplies the
                        // data points the simulation walks.
                        run:            chargingRun,
                        // Only disambiguate when a range test is shown more than once.
                        label:          rows.length > 1
                            ? `${rangeRun.name} × ${chargingRun.name}`
                            : rangeRun.name,
                        miPerKwh:       src.miPerKwh,
                        // Assume 70 mph if neither the range test nor its source says
                        testSpeedMph:   rangeRun.speed_mph ?? src.sourceRun?.speed_mph ?? null,
                        batteryKwh:     vehicle.battery,
                        color:          colorMap[chargingRun.id] || rangeRun.color || chargingRun.color || PALETTE[colorIdx % PALETTE.length],
                        efficiencyNote: src.note,
                    });
                    colorIdx++;
                }
            }
        }
        return map;
    }, [selectedVehicles, colorMap, pairings]);

    // ── Sync selection when vehicles or pairings change ──────────────────────
    // Keyed by PAIR: this view enumerates range tests, because a charging curve
    // is a property of the car while a range test is a property of the day, and
    // each (range × charging) pair is its own trip simulation.
    useEffect(() => {
        setSelectedRunIds(prev => {
            const live = new Set(allPairsInfo.keys());
            const kept = prev.filter(k => live.has(k));
            const keptSet = new Set(kept);

            // Repinning a row changes its key ('70::' becomes '70::12'), so carry
            // the selection across at the range-test level. Without this the old
            // key is pruned, the new one is never added, and the row silently
            // disappears from the simulation instead of updating.
            const prevPrimaries = new Set(prev.map(k => parsePairKey(k).rangeRunId));
            for (const [key, entry] of allPairsInfo) {
                if (keptSet.has(key)) continue;
                if (prevPrimaries.has(String(entry.rangeRun.id))) {
                    kept.push(key);
                    keptSet.add(key);
                }
            }

            // A vehicle with nothing selected gets one row per range test. That
            // is a lot on arrival; narrowing it to a sensible default is worth
            // doing, but the obvious rule (defaultRangeRun) selects nothing at
            // all on this data, so the per-vehicle "all"/"none" links carry it
            // for now.
            for (const vehicle of selectedVehicles) {
                const hasAny = [...allPairsInfo.values()]
                    .some(e => e.vehicle.id === vehicle.id && keptSet.has(e.key));
                if (hasAny) continue;
                for (const entry of allPairsInfo.values()) {
                    if (entry.vehicle.id !== vehicle.id) continue;
                    kept.push(entry.key);
                    keptSet.add(entry.key);
                }
            }
            const unchanged = kept.length === prev.length && kept.every((k, i) => k === prev[i]);
            return unchanged ? prev : kept;
        });
    }, [allPairsInfo, selectedVehicles]);

    // ── Active run entries — ordered by vehicle pill position ─────────────────
    const runEntries = useMemo(() => {
        const vehicleOrder = new Map(selectedVehicles.map((v, i) => [v.id, i]));
        return selectedRunIds
            .map(k => allPairsInfo.get(k))
            .filter(Boolean)
            .sort((a, b) => (vehicleOrder.get(a.vehicle.id) ?? 999) - (vehicleOrder.get(b.vehicle.id) ?? 999));
    }, [selectedRunIds, allPairsInfo, selectedVehicles]);

    const validEntries  = runEntries.filter(e => e.miPerKwh && e.batteryKwh);
    const skippedEntries = runEntries.filter(e => !e.miPerKwh || !e.batteryKwh);

    // Vehicles with no charging runs at all (need separate warning)
    const vehiclesWithNoChargingRuns = selectedVehicles.filter(
        v => filterChargingRuns(v.runs).length === 0
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
    }, [neededRunIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Run simulation for each entry ─────────────────────────────────────────
    const simResults = useMemo(() => {
        const {
            startSoc, minSoc, destinationMinSoc, legDistance, chargeTime, totalDistance, speed, mode, overhead,
            towingMode, towingEfficiency, towingRefSpeedMph,
        } = roadTripConfig;

        return validEntries.map(entry => {
            const chargingData = runDataCache[entry.run.id];
            if (!chargingData || chargingData.length === 0) return null;

            const result = simulateRoadTrip({
                batteryKwh:        entry.batteryKwh,
                // Towing: all vehicles share the same system efficiency; battery still varies per vehicle
                miPerKwh:          towingMode ? towingEfficiency : entry.miPerKwh,
                testSpeedMph:      towingMode ? towingRefSpeedMph : (entry.testSpeedMph || 70),
                chargingData,
                startSoc,
                minSoc,
                destinationMinSoc,
                legDistanceMi:     legDistance,
                totalDistanceMi:   totalDistance,
                speedMph:          speed,
                chargeTimeMinutes: chargeTime,
                overheadMinutes:   overhead,
                mode,
                towingMode,
            });

            // Attach helper fields for the plugin
            result._batteryKwh        = entry.batteryKwh;
            result._correctedMiPerKwh = result.correctedMiPerKwh;

            return result;
        });
    }, [validEntries, runDataCache, roadTripConfig]);

    // ── Speed sweep: run simulation at every speed in SPEED_SWEEP_MPH ─────────
    const speedSweepResults = useMemo(() => {
        if (roadTripConfig.xAxis !== 'speed') return null;
        const {
            startSoc, minSoc, destinationMinSoc, legDistance, chargeTime, totalDistance, mode, overhead,
            towingMode, towingEfficiency, towingRefSpeedMph,
        } = roadTripConfig;
        return validEntries.map(entry => {
            const chargingData = runDataCache[entry.run.id] ?? [];
            return SPEED_SWEEP_MPH.map(speedMph => simulateRoadTrip({
                batteryKwh:        entry.batteryKwh,
                miPerKwh:          towingMode ? towingEfficiency : entry.miPerKwh,
                testSpeedMph:      towingMode ? towingRefSpeedMph : (entry.testSpeedMph || 70),
                chargingData,
                startSoc, minSoc, destinationMinSoc,
                legDistanceMi:     legDistance,
                totalDistanceMi:   totalDistance,
                speedMph,
                chargeTimeMinutes: chargeTime,
                overheadMinutes:   overhead,
                mode,
                towingMode,
            }));
        });
    }, [validEntries, runDataCache, roadTripConfig]);

    // ── Leg-distance sweep: run simulation at every leg distance in LEG_SWEEP_MI ─
    const distSweepResults = useMemo(() => {
        if (roadTripConfig.xAxis !== 'tripDist') return null;
        const {
            startSoc, minSoc, destinationMinSoc, chargeTime, totalDistance, speed, mode, overhead,
            towingMode, towingEfficiency, towingRefSpeedMph,
        } = roadTripConfig;
        return validEntries.map(entry => {
            const chargingData = runDataCache[entry.run.id] ?? [];
            return LEG_SWEEP_MI.map(legMi => simulateRoadTrip({
                batteryKwh:        entry.batteryKwh,
                miPerKwh:          towingMode ? towingEfficiency : entry.miPerKwh,
                testSpeedMph:      towingMode ? towingRefSpeedMph : (entry.testSpeedMph || 70),
                chargingData,
                startSoc, minSoc, destinationMinSoc,
                legDistanceMi:     legMi,
                totalDistanceMi:   totalDistance,
                speedMph:          speed,
                chargeTimeMinutes: chargeTime,
                overheadMinutes:   overhead,
                mode,
                towingMode,
            }));
        });
    }, [validEntries, runDataCache, roadTripConfig]);

    // ── Build & render chart ──────────────────────────────────────────────────
    useEffect(() => {
        if (!canvasRef.current) return;
        const { totalDistance, yAxis, xAxis, sweepYAxis, overhead, speed } = roadTripConfig;
        const isSpeedMode      = xAxis === 'speed';
        const isTripDistMode   = xAxis === 'tripDist';
        const isSweepMode      = isSpeedMode || isTripDistMode;
        const isDriveTimeXAxis = xAxis === 'driveTime';
        const isChargeTimeMode = yAxis === 'chargeTime';
        const isByTestMode     = yAxis === 'byTest';

        if (isSpeedMode) {
            if (!speedSweepResults || speedSweepResults.length === 0) return;
        } else if (isTripDistMode) {
            if (!distSweepResults || distSweepResults.length === 0) return;
        } else {
            if (!simResults.some(Boolean)) return;
        }

        const tickColor   = isDark ? 'rgb(226,232,240)' : 'rgb(107,114,128)';
        const gridColor   = isDark ? 'rgba(100,116,139,0.4)' : 'rgba(229,231,235,0.8)';
        const legendColor = isDark ? 'rgb(241,245,249)' : 'rgb(55,65,81)';

        if (chartRef.current) {
            chartRef.current.destroy();
            chartRef.current = null;
        }

        const totalDistDisplay = convDistance(totalDistance, units);

        // Label logic: include run name when multiple runs from same vehicle
        const vehicleRunCount = {};
        for (const e of validEntries) {
            vehicleRunCount[e.vehicle.id] = (vehicleRunCount[e.vehicle.id] || 0) + 1;
        }
        const entryLabel = e =>
            vehicleRunCount[e.vehicle.id] > 1
                ? `${vehicleLabel(e.vehicle)} (${e.label})`
                : vehicleLabel(e.vehicle);

        // ── Speed sweep chart ────────────────────────────────────────────────
        if (isSpeedMode) {
            const sweepMinDisplay = units === 'metric' ? Math.round(SPEED_SWEEP_MIN * MI_TO_KM) : SPEED_SWEEP_MIN;
            const sweepMaxDisplay = units === 'metric' ? Math.round(SPEED_SWEEP_MAX * MI_TO_KM) : SPEED_SWEEP_MAX;
            const sweepStepDisplay = units === 'metric' ? Math.round(SPEED_SWEEP_STEP * MI_TO_KM) : SPEED_SWEEP_STEP;
            const speedYLabel = { totalTime: 'Total Trip Time', driveTime: 'Driving Time', chargeTime: 'Charge + Stop Time' }[sweepYAxis] ?? 'Total Trip Time';

            const speedDatasets = validEntries.map((entry, i) => {
                const sweepSims = speedSweepResults[i];
                if (!sweepSims) return null;
                const data = SPEED_SWEEP_MPH.map((mph, si) => ({
                    x: units === 'metric' ? Math.round(mph * MI_TO_KM) : mph,
                    y: isSimUnrealistic(sweepSims[si]) ? null : Math.round(getSweepY(sweepSims[si], mph, totalDistance, sweepYAxis)),
                }));
                return {
                    label: entryLabel(entry),
                    data,
                    borderColor: entry.color,
                    backgroundColor: entry.color + '33',
                    borderWidth: 2.5,
                    tension: 0.3,
                    pointRadius: 3,
                    fill: false,
                };
            }).filter(Boolean);

            // ICE reference line
            const iceSpeedData = SPEED_SWEEP_MPH.map(mph => {
                const iceTotalMin = calcIceTotalTimeAtSpeed(mph, totalDistance, overhead);
                const driveMin    = (totalDistance / mph) * 60;
                const yVal = sweepYAxis === 'driveTime'  ? driveMin
                           : sweepYAxis === 'chargeTime' ? iceTotalMin - driveMin
                           : iceTotalMin;
                return { x: units === 'metric' ? Math.round(mph * MI_TO_KM) : mph, y: Math.round(yVal) };
            });
            const iceSpeedYMin = Math.floor((Math.min(...iceSpeedData.map(d => d.y)) - 30) / 60) * 60;
            speedDatasets.unshift({
                label: 'ICE Reference',
                data: iceSpeedData,
                borderColor: '#9ca3af',
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderDash: [6, 4],
                tension: 0.3,
                pointRadius: 2,
                fill: false,
                _isIce: true,
            });

            chartRef.current = new Chart(canvasRef.current, {
                type: 'line',
                data: { datasets: speedDatasets },
                options: {
                    animation: false,
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'nearest', axis: 'xy', intersect: false },
                    scales: {
                        x: {
                            type: 'linear',
                            min: axisScale.xMin ?? sweepMinDisplay,
                            max: axisScale.xMax ?? sweepMaxDisplay,
                            title: { display: true, text: `Travel Speed (${sl})`, font: { size: 13 }, color: legendColor },
                            ticks: { stepSize: sweepStepDisplay, color: tickColor },
                            grid: { color: gridColor },
                        },
                        y: {
                            min: axisScale.yMin != null ? axisScale.yMin * 60 : iceSpeedYMin,
                            max: axisScale.yMax != null ? axisScale.yMax * 60 : undefined,
                            title: { display: true, text: speedYLabel, font: { size: 13 }, color: legendColor },
                            ticks: { stepSize: 30, callback: val => formatTime(val), color: tickColor },
                            grid: { color: gridColor },
                        },
                    },
                    plugins: {
                        legend: { display: true, position: 'top', labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 40, color: legendColor } },
                        tooltip: {
                            callbacks: {
                                title: items => items[0]?.dataset.label ?? '',
                                label: ctx => [
                                    `Speed: ${ctx.parsed.x} ${sl}`,
                                    `${speedYLabel}: ${formatTime(ctx.parsed.y)}`,
                                ],
                            },
                        },
                        zoom: {
                            zoom: {
                                drag: { enabled: true, backgroundColor: 'rgba(59,130,246,0.08)', borderColor: '#3b82f6', borderWidth: 1 },
                                mode: 'xy',
                            },
                        },
                    },
                },
            });
            return () => { chartRef.current?.destroy(); chartRef.current = null; };
        }

        // ── Trip distance sweep chart ────────────────────────────────────────
        if (isTripDistMode) {
            const sweepLabel = { totalTime: 'Total Trip Time', driveTime: 'Driving Time', chargeTime: 'Charge + Stop Time' }[sweepYAxis] ?? 'Total Trip Time';
            const legMinDisplay  = units === 'metric' ? Math.round(LEG_SWEEP_MIN  * MI_TO_KM) : LEG_SWEEP_MIN;
            const legMaxDisplay  = units === 'metric' ? Math.round(LEG_SWEEP_MAX  * MI_TO_KM) : LEG_SWEEP_MAX;
            const legStepDisplay = units === 'metric' ? Math.round(LEG_SWEEP_STEP * MI_TO_KM) : LEG_SWEEP_STEP;

            const distDatasets = validEntries.map((entry, i) => {
                const sweepSims = distSweepResults[i];
                if (!sweepSims) return null;
                const data = LEG_SWEEP_MI.map((legMi, di) => ({
                    x: units === 'metric' ? Math.round(legMi * MI_TO_KM) : legMi,
                    y: isSimUnrealistic(sweepSims[di]) ? null : Math.round(getSweepY(sweepSims[di], speed, totalDistance, sweepYAxis)),
                }));
                return {
                    label: entryLabel(entry),
                    data,
                    borderColor: entry.color,
                    backgroundColor: entry.color + '33',
                    borderWidth: 2.5,
                    tension: 0.3,
                    pointRadius: 3,
                    fill: false,
                };
            }).filter(Boolean);

            // ICE reference line — ICE stops every 3 hrs regardless of leg distance setting
            const iceDistData = LEG_SWEEP_MI.map(legMi => {
                const iceTotalMin = calcIceTotalTimeAtSpeed(speed, totalDistance, overhead);
                const driveMin    = (totalDistance / speed) * 60;
                const yVal = sweepYAxis === 'driveTime'  ? driveMin
                           : sweepYAxis === 'chargeTime' ? iceTotalMin - driveMin
                           : iceTotalMin;
                return { x: units === 'metric' ? Math.round(legMi * MI_TO_KM) : legMi, y: Math.round(yVal) };
            });
            const iceDistYMin = Math.floor((Math.min(...iceDistData.map(d => d.y)) - 30) / 60) * 60;
            distDatasets.unshift({
                label: 'ICE Reference',
                data: iceDistData,
                borderColor: '#9ca3af',
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderDash: [6, 4],
                tension: 0.3,
                pointRadius: 2,
                fill: false,
                _isIce: true,
            });

            chartRef.current = new Chart(canvasRef.current, {
                type: 'line',
                data: { datasets: distDatasets },
                options: {
                    animation: false,
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'nearest', axis: 'xy', intersect: false },
                    scales: {
                        x: {
                            type: 'linear',
                            min: axisScale.xMin ?? legMinDisplay,
                            max: axisScale.xMax ?? legMaxDisplay,
                            title: { display: true, text: `${dl} Between Charges`, font: { size: 13 }, color: legendColor },
                            ticks: { stepSize: legStepDisplay, color: tickColor },
                            grid: { color: gridColor },
                        },
                        y: {
                            min: axisScale.yMin != null ? axisScale.yMin * 60 : iceDistYMin,
                            max: axisScale.yMax != null ? axisScale.yMax * 60 : undefined,
                            title: { display: true, text: sweepLabel, font: { size: 13 }, color: legendColor },
                            ticks: { stepSize: 30, callback: val => formatTime(val), color: tickColor },
                            grid: { color: gridColor },
                        },
                    },
                    plugins: {
                        legend: { display: true, position: 'top', labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 40, color: legendColor } },
                        tooltip: {
                            callbacks: {
                                title: items => items[0]?.dataset.label ?? '',
                                label: ctx => [
                                    `${dl} between charges: ${ctx.parsed.x} ${dl}`,
                                    `${sweepLabel}: ${formatTime(ctx.parsed.y)}`,
                                ],
                            },
                        },
                        zoom: {
                            zoom: {
                                drag: { enabled: true, backgroundColor: 'rgba(59,130,246,0.08)', borderColor: '#3b82f6', borderWidth: 1 },
                                mode: 'xy',
                            },
                        },
                    },
                },
            });
            return () => { chartRef.current?.destroy(); chartRef.current = null; };
        }

        // ── Timeline chart (total time or drive-time X) ──────────────────────
        const datasets = validEntries.map((entry, i) => {
            const sim = simResults[i];
            if (!sim) return null;

            const points = isByTestMode
                ? segmentsToChartPointsByTest(sim.segments, i)
                : isChargeTimeMode
                    ? segmentsToChartPointsChargeTime(sim.segments, isDriveTimeXAxis)
                    : segmentsToChartPoints(sim.segments, units, isDriveTimeXAxis);

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
        const ICE_STOP_MIN  = overhead;     // same overhead tax as EV stops
        const ICE_MIN_SOC   = 35;           // % "fuel level" at end of a 3h drive
        const iceLane       = validEntries.length; // byTest lane index for ICE

        const icePoints       = [];  // distance / chargeTime mode
        const iceByTestPoints = [];  // byTest mode (SoC lane)
        const iceGasStopSegs  = [];  // gas stop intervals for byTest green boxes
        let iceTime = 0, iceDist = 0, iceCumStop = 0, iceCumDrive = 0, iceIter = 0;

        while (iceDist < roadTripConfig.totalDistance && iceIter < 100) {
            iceIter++;
            const remainingMi = roadTripConfig.totalDistance - iceDist;
            const maxDriveMi  = (roadTripConfig.speed * ICE_DRIVE_INTERVAL_MIN) / 60;
            const driveMi     = Math.min(maxDriveMi, remainingMi);
            const driveMin    = (driveMi / roadTripConfig.speed) * 60;

            // X values: drive time or total time
            const xDS = isDriveTimeXAxis ? Math.round(iceCumDrive)            : Math.round(iceTime);
            const xDE = isDriveTimeXAxis ? Math.round(iceCumDrive + driveMin) : Math.round(iceTime + driveMin);
            if (isChargeTimeMode) {
                icePoints.push({ x: xDS, y: Math.round(iceCumStop) });
                icePoints.push({ x: xDE, y: Math.round(iceCumStop) });
            } else {
                icePoints.push({ x: xDS, y: convDistance(iceDist,           units) });
                icePoints.push({ x: xDE, y: convDistance(iceDist + driveMi, units) });
            }
            // byTest always uses total time on X
            iceByTestPoints.push({ x: Math.round(iceTime),            y: iceLane + 1.0            });
            iceByTestPoints.push({ x: Math.round(iceTime + driveMin), y: iceLane + ICE_MIN_SOC / 100 });

            iceTime      += driveMin;
            iceCumDrive  += driveMin;
            iceDist      += driveMi;
            if (iceDist >= roadTripConfig.totalDistance - 0.01) break;

            // X values for stop: drive time stays flat; only total time advances
            const xSS = isDriveTimeXAxis ? Math.round(iceCumDrive) : Math.round(iceTime);
            const xSE = isDriveTimeXAxis ? Math.round(iceCumDrive) : Math.round(iceTime + ICE_STOP_MIN);
            if (isChargeTimeMode) {
                icePoints.push({ x: xSS, y: Math.round(iceCumStop) });
                icePoints.push({ x: xSE, y: Math.round(iceCumStop + ICE_STOP_MIN) });
            } else {
                icePoints.push({ x: xSS, y: convDistance(iceDist, units) });
                icePoints.push({ x: xSE, y: convDistance(iceDist, units) });
            }
            // byTest always uses total time on X
            iceGasStopSegs.push({ startTime: iceTime, endTime: iceTime + ICE_STOP_MIN });
            iceByTestPoints.push({ x: Math.round(iceTime),                y: iceLane + ICE_MIN_SOC / 100 });
            iceByTestPoints.push({ x: Math.round(iceTime + ICE_STOP_MIN), y: iceLane + 1.0              });

            iceTime    += ICE_STOP_MIN;
            iceCumStop += ICE_STOP_MIN;
            // iceCumDrive does NOT advance during ICE stops
        }

        if (isByTestMode) {
            datasets.push({
                label: 'ICE Reference',
                data: iceByTestPoints,
                borderColor: '#9ca3af',
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderDash: [6, 4],
                tension: 0,
                pointRadius: 0,
                fill: false,
                _isIce: true,
            });
        } else {
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
        }

        const validSims = simResults.filter(Boolean);
        const maxTime = Math.max(...validSims.map(s => s.totalTimeMin), iceTime, 60);
        const maxChargeTime = isChargeTimeMode
            ? Math.max(...validSims.map(s =>
                s.segments.filter(seg => seg.type === 'charge')
                          .reduce((sum, seg) => sum + (seg.endTime - seg.startTime), 0)
              ), iceCumStop, 30)
            : 0;

        // In drive-time X mode, the max X is the total pure driving time
        const maxDriveTime = isDriveTimeXAxis
            ? Math.max(...validSims.map(s =>
                s.segments.filter(seg => seg.type === 'drive')
                          .reduce((sum, seg) => sum + (seg.endTime - seg.startTime), 0)
              ), iceCumDrive, 60)
            : 0;

        const autoXMax = isDriveTimeXAxis ? maxDriveTime * 1.15 : maxTime * 1.15;
        const autoYMax = isChargeTimeMode ? Math.ceil(maxChargeTime * 1.2 / 10) * 10 : totalDistDisplay;

        // Default X minimum is always 0 — the trip starts at the origin, not at
        // the first charging stop.
        const autoXMin = 0;

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
                        title: { display: true, text: isDriveTimeXAxis ? 'Drive Time' : 'Elapsed Time', font: { size: 13 }, color: legendColor },
                        min: axisScale.xMin != null ? axisScale.xMin * 60 : autoXMin,
                        max: axisScale.xMax != null ? axisScale.xMax * 60 : autoXMax,
                        ticks: {
                            stepSize: 30,
                            color: tickColor,
                            callback: val => {
                                const m = Math.round(val); // guard against FP imprecision (e.g. 59.9999…)
                                if (m % 60 === 0) return m === 0 ? '0' : `${m / 60}h`;
                                if (m % 30 === 0) return ''; // tick mark at 30 min, no label
                                return null;
                            },
                        },
                        grid: { color: gridColor },
                    },
                    y: isByTestMode ? {
                        reverse: false,
                        min: axisScale.yMin ?? 0,
                        max: axisScale.yMax ?? (validEntries.length + 1), // +1 for ICE lane
                        title: { display: false },
                        ticks: {
                            stepSize: 0.5,
                            color: tickColor,
                            callback: (val) => {
                                // Half-integer positions = lane centers → show label
                                const frac = val - Math.floor(val);
                                if (Math.abs(frac - 0.5) < 0.01) {
                                    const idx = Math.floor(val); // lane index
                                    if (idx >= 0 && idx < validEntries.length) {
                                        const e = validEntries[idx];
                                        return vehicleRunCount[e.vehicle.id] > 1
                                            ? `${vehicleLabel(e.vehicle)} · ${e.label}`
                                            : vehicleLabel(e.vehicle);
                                    }
                                    if (idx === validEntries.length) return 'ICE Reference';
                                }
                                return ''; // suppress integer tick labels (lane boundaries shown as gridlines)
                            },
                        },
                        grid: {
                            color: (ctx) => {
                                const v   = ctx.tick?.value;
                                const frac = v != null ? (v - Math.floor(v)) : 0;
                                return Math.abs(frac) < 0.01
                                    ? 'rgba(0,0,0,0.25)'  // heavy — lane boundary (integer)
                                    : 'rgba(0,0,0,0.07)'; // light — lane center
                            },
                            lineWidth: (ctx) => {
                                const v   = ctx.tick?.value;
                                const frac = v != null ? (v - Math.floor(v)) : 0;
                                return Math.abs(frac) < 0.01 ? 1.5 : 0.5;
                            },
                        },
                    } : isChargeTimeMode ? {
                        reverse: true,
                        title: { display: true, text: 'Cumulative Charge Time (min)', font: { size: 13 }, color: legendColor },
                        min: axisScale.yMin ?? 0,
                        max: axisScale.yMax ?? autoYMax,
                        ticks: { color: tickColor },
                        grid: { color: gridColor },
                    } : {
                        reverse: true,
                        title: { display: true, text: `Distance Traveled (${dl})`, font: { size: 13 }, color: legendColor },
                        min: axisScale.yMin ?? 0,
                        max: axisScale.yMax ?? autoYMax,
                        ticks: { color: tickColor },
                        grid: { color: gridColor },
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 40, color: legendColor },
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
            }).filter(Boolean), units, yAxis, iceTime,
                isByTestMode ? { laneIndex: iceLane, gasStops: iceGasStopSegs, totalTimeMin: iceTime } : null,
            )],
        });

        return () => {
            chartRef.current?.destroy();
            chartRef.current = null;
        };
    }, [simResults, speedSweepResults, distSweepResults, validEntries, units, roadTripConfig.totalDistance, roadTripConfig.yAxis, roadTripConfig.xAxis, roadTripConfig.sweepYAxis, roadTripConfig.speed, roadTripConfig.overhead, axisScale, isDark]);

    // ── Config update helper ─────────────────────────────────────────────────
    const setField = (key, value) => setRoadTripConfig(prev => ({ ...prev, [key]: value }));

    // ── PNG export ────────────────────────────────────────────────────────────
    const handleCopyImage = async () => {
        if (!chartRef.current) return;
        const src = chartRef.current.canvas;
        const offscreen = document.createElement('canvas');
        offscreen.width  = src.width;
        offscreen.height = src.height;
        const ctx2 = offscreen.getContext('2d');
        ctx2.fillStyle = isDark ? 'rgb(8,12,28)' : '#ffffff';
        ctx2.fillRect(0, 0, offscreen.width, offscreen.height);
        ctx2.drawImage(src, 0, 0);
        const dataUrl = offscreen.toDataURL('image/png');
        setChartImage(dataUrl);
        try {
            const blob = await (await fetch(dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setImageCopied(true);
            setTimeout(() => setImageCopied(false), 2500);
        } catch { /* Clipboard API not supported — image shown inline */ }
    };

    // ── Render ───────────────────────────────────────────────────────────────
    const {
        startSoc, minSoc, destinationMinSoc, legDistance, chargeTime, totalDistance, speed, mode, yAxis, xAxis, sweepYAxis, overhead,
        towingMode, towingEfficiency, towingRefSpeedMph,
    } = roadTripConfig;
    const isSpeedMode    = xAxis === 'speed';
    const isTripDistMode = xAxis === 'tripDist';
    const isSweepMode    = isSpeedMode || isTripDistMode;

    // Did any sweep sim get cut off due to unrealistic charging?
    const activeSweepResults = isSpeedMode ? speedSweepResults : isTripDistMode ? distSweepResults : null;
    const hasUnrealisticPoints = activeSweepResults?.some(
        entryResults => entryResults?.some(sim => isSimUnrealistic(sim))
    ) ?? false;

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
    const dispLeg          = units === 'metric' ? Math.round(legDistance * MI_TO_KM) : legDistance;
    const dispTotal        = units === 'metric' ? Math.round(totalDistance * MI_TO_KM) : totalDistance;
    const dispSpeed        = units === 'metric' ? Math.round(speed * MI_TO_KM) : speed;
    const dispTowingEff    = units === 'metric' ? (towingEfficiency * MI_TO_KM).toFixed(2) : towingEfficiency;
    const dispTowingRef    = units === 'metric' ? Math.round(towingRefSpeedMph * MI_TO_KM) : towingRefSpeedMph;
    const towingEffLabel   = units === 'metric' ? 'km/kWh' : 'mi/kWh';

    return (
        <div>
            {/* ── Controls ─────────────────────────────────────────────── */}
            {!presentationMode && (
                <div className="card mb-6">
                    {loading && <LoadingSpinner message="Loading charging data…" />}
                    {/* Toggles row */}
                    <div className="flex flex-wrap gap-6 mb-4">
                        <div>
                            <span className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Simulation</span>
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
                            <span className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">X Axis</span>
                            <div className="flex gap-1">
                                <button className={`btn btn-sm ${xAxis === 'totalTime' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('xAxis', 'totalTime')}>Total Time</button>
                                <button className={`btn btn-sm ${xAxis === 'driveTime' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('xAxis', 'driveTime')}>Drive Time</button>
                                <button className={`btn btn-sm ${xAxis === 'speed'     ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('xAxis', 'speed')}>Travel Speed</button>
                                <button className={`btn btn-sm ${xAxis === 'tripDist'  ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('xAxis', 'tripDist')}>Trip Distance</button>
                            </div>
                        </div>
                        <div>
                            {isSweepMode ? (
                                <>
                                    <span className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Y Axis</span>
                                    <div className="flex gap-1">
                                        <button className={`btn btn-sm ${sweepYAxis === 'totalTime'  ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('sweepYAxis', 'totalTime')}>Total Time</button>
                                        <button className={`btn btn-sm ${sweepYAxis === 'driveTime'  ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('sweepYAxis', 'driveTime')}>Drive Time</button>
                                        <button className={`btn btn-sm ${sweepYAxis === 'chargeTime' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('sweepYAxis', 'chargeTime')}>Charge + Stop</button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Y Axis</span>
                                    <div className="flex gap-1">
                                        <button className={`btn btn-sm ${yAxis === 'distance'   ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('yAxis', 'distance')}>Distance</button>
                                        <button className={`btn btn-sm ${yAxis === 'chargeTime' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('yAxis', 'chargeTime')}>Charge Time</button>
                                        <button className={`btn btn-sm ${yAxis === 'byTest'     ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setField('yAxis', 'byTest')}>By Test</button>
                                    </div>
                                </>
                            )}
                        </div>
                        <div>
                            <span className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Mode</span>
                            <button
                                className={`btn btn-sm ${towingMode ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => setField('towingMode', !towingMode)}
                                title="Override all vehicle efficiencies with a fixed trailer-system value. Battery capacity and charging curve still vary per vehicle."
                            >
                                🚐 Towing
                            </button>
                        </div>
                        {setChartConfig && (
                            <div className="flex items-end">
                                <label className="toggle-label" title="Override stored colors with perceptually distinct Okabe-Ito palette colors">
                                    <input
                                        type="checkbox"
                                        checked={autoColor}
                                        onChange={e => setChartConfig(prev => ({ ...prev, autoColor: e.target.checked }))}
                                        className="w-4 h-4"
                                    />
                                    <span className="text-sm font-medium">Auto Color</span>
                                </label>
                            </div>
                        )}
                    </div>

                    {/* Towing inputs — only visible when towing mode is on */}
                    {towingMode && (
                        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">Towing System Efficiency</p>
                            <div className="flex flex-wrap items-end gap-4">
                                <label className="text-sm">
                                    <span className="font-medium block mb-1">Efficiency ({towingEffLabel})</span>
                                    <input type="number" className="w-28 border rounded px-2 py-1" step="0.1" min="0.3" max="5"
                                        value={dispTowingEff}
                                        onChange={e => {
                                            const val = parseFloat(e.target.value);
                                            setField('towingEfficiency', units === 'metric' ? val / MI_TO_KM : val);
                                        }} />
                                </label>
                                <label className="text-sm">
                                    <span className="font-medium block mb-1">Measured at ({sl})</span>
                                    <input type="number" className="w-24 border rounded px-2 py-1" min="20"
                                        value={dispTowingRef}
                                        onChange={e => {
                                            const val = Number(e.target.value);
                                            setField('towingRefSpeedMph', units === 'metric' ? Math.round(val / MI_TO_KM) : val);
                                        }} />
                                </label>
                                <p className="text-xs text-amber-600 max-w-xs">
                                    Enter full system efficiency (vehicle + trailer). Battery capacity and charging speed still vary per vehicle.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                        <label className="text-sm">
                            <span className="font-medium block mb-1 whitespace-nowrap">Start SoC (%)</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={50} max={100} value={startSoc}
                                onChange={e => setField('startSoc', Number(e.target.value))} />
                        </label>
                        <label className="text-sm">
                            <span className="font-medium block mb-1 whitespace-nowrap">Min SoC (%)</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={0} max={30} value={minSoc}
                                title="Lowest SoC before charging en route"
                                onChange={e => setField('minSoc', Number(e.target.value))} />
                        </label>
                        <label className="text-sm">
                            <span className="font-medium block mb-1 whitespace-nowrap">Dest. SoC (%)</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={0} max={90} value={destinationMinSoc ?? minSoc}
                                title="SoC to arrive at the destination with. Higher than Min SoC keeps a bigger buffer for the final leg."
                                onChange={e => setField('destinationMinSoc', Number(e.target.value))} />
                        </label>
                        {mode === 'distance' && !isTripDistMode && (
                            <label className="text-sm">
                                <span className="font-medium block mb-1 whitespace-nowrap">{dl} between charges</span>
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
                                <span className="font-medium block mb-1 whitespace-nowrap">Charge Time (min)</span>
                                <input type="number" className="w-full border rounded px-2 py-1"
                                    min={5} max={120} value={chargeTime}
                                    onChange={e => setField('chargeTime', Number(e.target.value))} />
                            </label>
                        )}
                        <label className="text-sm">
                            <span className="font-medium block mb-1 whitespace-nowrap">Total Dist. ({dl})</span>
                            <input type="number" className="w-full border rounded px-2 py-1"
                                min={10} value={dispTotal}
                                onChange={e => {
                                    const val = Number(e.target.value);
                                    setField('totalDistance', units === 'metric' ? Math.round(val / MI_TO_KM) : val);
                                }} />
                        </label>
                        {!isSpeedMode && (
                            <label className="text-sm">
                                <span className="font-medium block mb-1 whitespace-nowrap">Speed ({sl})</span>
                                <input type="number" className="w-full border rounded px-2 py-1"
                                    min={20} value={dispSpeed}
                                    onChange={e => {
                                        const val = Number(e.target.value);
                                        setField('speed', units === 'metric' ? Math.round(val / MI_TO_KM) : val);
                                    }} />
                            </label>
                        )}
                        <label className="text-sm">
                            <span className="font-medium block mb-1 whitespace-nowrap">Stop Overhead (min)</span>
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
                                    <p key={`${entry.key}-${wi}`} className="roadtrip-warning">
                                        ⚠ {vehicleLabel(entry.vehicle)} – {entry.label}: {w}
                                    </p>
                                ));
                            })}
                        </div>
                    )}

                    {/* Run selector */}
                    <div className="mt-4">
                        <RunSelector
                            vehicles={selectedVehicles.filter(v =>
                                filterChargingRuns(v.runs).length > 0
                            )}
                            selectedRunIds={selectedRunIds}
                            onToggleRun={key => setSelectedRunIds(prev =>
                                prev.includes(key)
                                    ? prev.filter(x => x !== key)
                                    : [...prev, key]
                            )}
                            onUpdateRunColor={onUpdateRunColor}
                            colorMap={colorMap}
                            runFilter={(run, vehicle) =>
                                isRangeRun(run) && filterChargingRuns(vehicle.runs).length > 0}
                            emptyMessage="No range test records"
                            pairMode
                            pairings={pairings}
                            primaryLabel="Range:"
                            partnerLabel="Charging:"
                            partnerRunsFor={vehicle => filterChargingRuns(vehicle.runs)}
                            extraPrimaryRunsFor={vehicle => {
                                if (!filterChargingRuns(vehicle.runs).length) return [];
                                const epa = epaRangeOption(vehicle);
                                return epa ? [epa] : [];
                            }}
                            resolvePartner={(rangeRun, vehicle) => {
                                const run = pairedChargingRun(rangeRun, vehicle);
                                return run ? { sourceRun: run, note: null } : null;
                            }}
                            onSetPartner={(rangeId, oldChargingId, newChargingId) =>
                                setPairings(prev => replacePartner(prev, rangeId, oldChargingId, newChargingId))}
                            onAddPartner={(rangeId, chargingId) =>
                                setPairings(prev => addPartner(prev, rangeId, chargingId))}
                            onRemovePartner={(rangeId, chargingId) =>
                                setPairings(prev => removePartner(prev, rangeId, chargingId))}
                            renderRunMeta={run => {
                                const entry = [...allPairsInfo.values()].find(e => e.rangeRun.id === run.id);
                                if (!entry) return null;
                                if (!entry.miPerKwh) {
                                    return <span className="text-xs text-red-400 ml-1">⚠ No range data</span>;
                                }
                                const eff = entry.miPerKwh.toFixed(1);
                                const spd = entry.testSpeedMph
                                    ? `${fmtSpeed(entry.testSpeedMph, units)}`
                                    : '70 mph (assumed)';
                                return (
                                    <span className="text-xs text-faint ml-1">
                                        {eff} {units === 'metric' ? 'km/kWh' : 'mi/kWh'} @ {spd}
                                        {entry.efficiencyNote && ` · ${entry.efficiencyNote}`}
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
                                <p key={e.key}>
                                    ⚠ {vehicleLabel(e.vehicle)} – {e.label}: {!e.miPerKwh ? 'No range data for efficiency' : 'No battery capacity'}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── Chart ────────────────────────────────────────────────── */}
            {loading && (
                <div className="text-center py-8 text-muted">Loading charging data…</div>
            )}

            {!loading && validEntries.length === 0 && (
                <div className="empty-state">
                    <p className="text-lg">No runs with usable charging and efficiency data.</p>
                    <p className="text-sm text-muted mt-2">
                        Each run needs charging data, and either its own range test result
                        or another run from the same vehicle with distance &amp; energy data.
                    </p>
                </div>
            )}

            {!loading && validEntries.length > 0 && (
                <div className="card mb-6">
                    <h3 className="text-lg font-bold mb-2">
                        Road Trip{towingMode ? ' (Towing)' : ''}
                        {isSpeedMode   ? ` · Speed vs. Time`
                         : isTripDistMode ? ` — ${Math.round(convDistance(totalDistance, units))} ${dl} · Leg Distance vs. Time at ${Math.round(convDistance(speed, units))} ${sl}`
                         : ` — ${Math.round(convDistance(totalDistance, units))} ${dl} at ${Math.round(convDistance(speed, units))} ${sl}`}
                    </h3>
                    <div style={{ height: `${isSweepMode ? 400 : yAxis === 'byTest' ? Math.max(300, validEntries.length * 120) : Math.max(400, validEntries.length * 40 + 200)}px`, position: 'relative' }}>
                        <canvas ref={canvasRef} />
                    </div>
                    {isSweepMode && hasUnrealisticPoints && (
                        <p className="text-xs text-amber-600 mt-1 text-center">
                            Lines end where a charge stop would exceed {CHARGE_CEIL_SOC}% SoC — unrealistic at that {isSpeedMode ? 'speed' : 'leg distance'}.
                        </p>
                    )}
                    <div className="mt-3 flex gap-2 flex-wrap items-center">
                        <button
                            onClick={() => chartRef.current?.resetZoom()}
                            className="chart-copy-btn"
                            title="Reset zoom to full view"
                        >
                            🔍 Reset Zoom
                        </button>
                        <button
                            onClick={() => {
                                const p = new URLSearchParams(window.location.search);
                                if (selectedRunIds.length) p.set('rt_r', selectedRunIds.join(','));
                                else p.delete('rt_r');
                                const url = `${window.location.origin}${window.location.pathname}?${p.toString()}`;
                                navigator.clipboard.writeText(url).then(() => {
                                    setCopiedUrl(true);
                                    setTimeout(() => setCopiedUrl(false), 2000);
                                });
                            }}
                            className={`chart-copy-btn ${copiedUrl ? 'chart-copy-btn-active' : ''}`}
                            title="Copy link to this Road Trip chart"
                        >
                            {copiedUrl ? '✓ Copied!' : '🔗 Copy URL'}
                        </button>
                        <button
                            onClick={handleCopyImage}
                            className={`chart-copy-btn ${imageCopied ? 'chart-copy-btn-active' : ''}`}
                            title="Copy chart as PNG"
                        >
                            {imageCopied ? '✓ Copied to clipboard!' : '📋 Copy Chart as PNG'}
                        </button>
                        {chartImage && (
                            <button onClick={() => setChartImage(null)} className="chart-copy-btn">
                                ✕ Dismiss preview
                            </button>
                        )}
                    </div>
                    <p className="text-xs text-faint mt-1">Drag to box-zoom · Reset Zoom to restore</p>
                    {chartImage && (
                        <div className="mt-3">
                            <p className="text-xs text-faint mb-1.5">Right-click or long-press to copy / save</p>
                            <img src={chartImage} alt="Chart export" className="w-full rounded border border-[var(--color-border)]" />
                        </div>
                    )}
                </div>
            )}

            {/* ── Axis Scale Controls (card provided by AxisScaleControls) ─ */}
            {!loading && (simResults.some(Boolean) || speedSweepResults?.length > 0 || distSweepResults?.length > 0) && !presentationMode && (
                <AxisScaleControls
                    xMin={axisScale.xMin} xMax={axisScale.xMax}
                    yMin={axisScale.yMin} yMax={axisScale.yMax}
                    onChange={onAxisChange}
                    showX={true}
                    showY2={false}
                    xAxisLabel={isSpeedMode ? `X-Axis Scale (${sl})` : isTripDistMode ? `X-Axis Scale (${dl})` : 'X-Axis Scale (hrs)'}
                    yAxisLabel={isSweepMode ? 'Y-Axis Scale (hrs)' : 'Left Axis Scale'}
                />
            )}

            {/* ── Summary Table ─────────────────────────────────────────── */}
            {!loading && simResults.some(Boolean) && !presentationMode && !isSweepMode && (
                <div className="card">
                    <h3 className="text-lg font-bold mb-3">Results Summary</h3>
                    <div className="overflow-x-auto">
                        {(() => {
                            // ── Build sortable rows ───────────────────────────────
                            const handleSort = (col) => {
                                if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                                else { setSortCol(col); setSortDir('asc'); }
                            };
                            const SortTh = ({ col, children, className = '' }) => {
                                const active = sortCol === col;
                                const arrow = active ? (sortDir === 'asc' ? '↑' : '↓') : '↕';
                                return (
                                    <th
                                        className={`px-3 py-2 text-left font-semibold cursor-pointer select-none hover:bg-[var(--color-surface-sunken)] whitespace-nowrap ${active ? 'text-blue-600' : ''} ${className}`}
                                        onClick={() => handleSort(col)}
                                    >
                                        <span className="flex items-center gap-1">
                                            {children}
                                            <span className={`text-xs ${active ? 'text-blue-500' : 'text-faint'}`}>{arrow}</span>
                                        </span>
                                    </th>
                                );
                            };

                            const effLabel = units === 'metric' ? 'km/kWh' : 'mi/kWh';

                            // Zip entries+sims, compute sort keys, sort
                            const rows = validEntries
                                .map((entry, i) => {
                                    const sim = simResults[i];
                                    if (!sim) return null;
                                    const chargingSegments = sim.segments.filter(s => s.type === 'charge');
                                    const avgChargeTime = chargingSegments.length > 0
                                        ? chargingSegments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0) / chargingSegments.length
                                        : 0;
                                    const speedDiff = entry.testSpeedMph ? Math.abs(speed - entry.testSpeedMph) : 0;
                                    const adjPct = Math.round((sim.speedFactor - 1) * 100);
                                    const vsIce = sim.totalTimeMin - iceRefTimeMin;
                                    return { entry, sim, avgChargeTime, speedDiff, adjPct, vsIce };
                                })
                                .filter(Boolean);

                            if (sortCol) {
                                const dir = sortDir === 'asc' ? 1 : -1;
                                rows.sort((a, b) => {
                                    let av, bv;
                                    switch (sortCol) {
                                        case 'vehicle':
                                            av = (a.entry.vehicle.name + a.entry.label).toLowerCase();
                                            bv = (b.entry.vehicle.name + b.entry.label).toLowerCase();
                                            return dir * av.localeCompare(bv);
                                        case 'totalTime':  av = a.sim.totalTimeMin;     bv = b.sim.totalTimeMin;     break;
                                        case 'stops':      av = a.sim.chargeStops;      bv = b.sim.chargeStops;      break;
                                        case 'avgCharge':  av = a.avgChargeTime;        bv = b.avgChargeTime;        break;
                                        case 'efficiency': av = a.entry.miPerKwh;       bv = b.entry.miPerKwh;       break;
                                        case 'corrEff':    av = a.sim.correctedMiPerKwh; bv = b.sim.correctedMiPerKwh; break;
                                        case 'speedAdj':   av = a.adjPct;               bv = b.adjPct;               break;
                                        case 'vsIce':      av = a.vsIce;                bv = b.vsIce;                break;
                                        default: return 0;
                                    }
                                    return dir * (av - bv);
                                });
                            }

                            return (
                        <table className="w-full text-sm">
                            <thead className="bg-[var(--color-surface-muted)]">
                                <tr>
                                    <SortTh col="vehicle">Vehicle / Run</SortTh>
                                    <SortTh col="totalTime">Total Time</SortTh>
                                    <SortTh col="stops">Stops</SortTh>
                                    <SortTh col="avgCharge">Avg Charge</SortTh>
                                    <SortTh col="efficiency">Efficiency</SortTh>
                                    <SortTh col="corrEff">Corrected Eff</SortTh>
                                    <SortTh col="speedAdj">Speed Adj</SortTh>
                                    <SortTh col="vsIce">vs ICE</SortTh>
                                </tr>
                            </thead>
                            <tbody className="divide-y dark:divide-slate-700">
                                {rows.map(({ entry, sim, avgChargeTime, speedDiff, adjPct, vsIce }) => {

                                    return (
                                        <tr key={entry.key}>
                                            <td className="px-3 py-2">
                                                <div className="flex items-start gap-2">
                                                    <span className="inline-block w-3 h-3 rounded-full mt-1 shrink-0"
                                                          style={{ backgroundColor: entry.color }} />
                                                    <div>
                                                        <div className="font-medium">{vehicleLabel(entry.vehicle)}</div>
                                                        <div className="text-xs text-faint">{entry.label}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 font-medium">
                                                {sim.completed === false
                                                    ? <span className="text-red-500" title={`Only reached ${Math.round(convDistance(sim.totalDistMi, units))} ${dl} of ${Math.round(convDistance(totalDistance, units))} ${dl}`}>Did not finish</span>
                                                    : formatTime(sim.totalTimeMin)}
                                            </td>
                                            <td className="px-3 py-2">{sim.chargeStops}</td>
                                            <td className="px-3 py-2">{sim.chargeStops > 0 ? formatTime(avgChargeTime) : '—'}</td>
                                            <td className="px-3 py-2">
                                                {towingMode ? (
                                                    <>
                                                        <span className="text-amber-700 font-medium">{dispTowingEff} {effLabel}</span>
                                                        <span className="block text-xs text-amber-500">towing @ {dispTowingRef} {sl}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        {entry.miPerKwh.toFixed(1)} {effLabel}
                                                        {entry.testSpeedMph ? (
                                                            <span className="text-faint ml-1">@ {fmtSpeed(entry.testSpeedMph, units)}</span>
                                                        ) : (
                                                            <span className="text-amber-500 ml-1" title="Set Speed (mph) on the run in Tests &amp; Data for accurate speed correction">@ 70 mph (assumed)</span>
                                                        )}
                                                        {entry.efficiencyNote && (
                                                            <span className="block text-xs text-faint">{entry.efficiencyNote}</span>
                                                        )}
                                                    </>
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
                                                {sim.completed === false ? <span className="text-faint">—</span> : (() => {
                                                    const absDelta = Math.abs(vsIce);
                                                    const h = Math.floor(absDelta / 60);
                                                    const m = Math.round(absDelta % 60);
                                                    const label = h > 0 ? `${h}h ${m}m` : `${m}m`;
                                                    return vsIce > 0
                                                        ? <span className="text-amber-600">+{label}</span>
                                                        : <span className="text-green-600">−{label}</span>;
                                                })()}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                            );
                        })()}
                    </div>

                </div>
            )}

            {!presentationMode && <ChartInfoBubble chartKey="roadtrip" />}
        </div>
    );
}
