import { interpolate } from './interpolate';
import { convDistance, roundTo } from './unitConversions';

// ── Constants ────────────────────────────────────────────────────────────────
const AERO_FRACTION        = 0.70; // fraction of energy from aero drag at ref speed (unladen EV)
const TOWING_AERO_FRACTION = 0.85; // higher aero fraction when towing — trailer roughly doubles Cd×A
const REFERENCE_SPEED      = 70;   // mph
const MAX_ITERATIONS       = 200;  // safety guard against infinite loops (≈ enough stops for any trip)
const MIN_DRIVE_MI         = 0.1;  // minimum driveable distance before bailing
const TAIL_END_KW          = 5;    // assumed charging power at 100% SoC for the synthetic tail
const TAIL_STEP_SOC        = 2;    // % SoC step when generating the synthetic high-SoC tail

// ── High-SoC charging tail ─────────────────────────────────────────────────────

/**
 * Extend a measured charging curve above its last data point with a synthetic
 * tail: charger power declines linearly from the curve's end power down to
 * TAIL_END_KW at 100% SoC, integrated to elapsed time. This replaces slope
 * extrapolation of the time curve (which under-reports, since charge time is
 * convex in SoC) with a physically-shaped taper. Cheap — ~a dozen points.
 *
 * @param {Array}  sortedBySoc  Measured points sorted ascending by soc, each {soc,time,chargeRate?}
 * @param {number} batteryKwh   Usable capacity (kWh)
 * @returns {Array} synthetic points {soc,time,chargeRate} above the measured max SoC (may be empty)
 */
export function buildChargeTail(sortedBySoc, batteryKwh) {
    const last = sortedBySoc[sortedBySoc.length - 1];
    if (!last || last.soc >= 100 - 1e-6 || !batteryKwh || batteryKwh <= 0) return [];

    // End power: prefer the slope of the last measured segment (kW into the pack,
    // consistent with the time curve we're extending); fall back to charge_rate.
    const prev = sortedBySoc[sortedBySoc.length - 2];
    let endKw = null;
    if (prev) {
        const dSoc = last.soc - prev.soc, dMin = last.time - prev.time;
        if (dSoc > 0 && dMin > 0) endKw = (batteryKwh * dSoc / 100) / (dMin / 60);
    }
    if (!endKw || !isFinite(endKw) || endKw <= 0) endKw = last.chargeRate ?? 50;

    const p100    = Math.min(TAIL_END_KW, endKw); // never let power rise toward 100%
    const powerAt = soc => endKw + (p100 - endKw) * (soc - last.soc) / (100 - last.soc);

    const tail = [];
    let t = last.time, prevSoc = last.soc;
    for (let soc = last.soc + TAIL_STEP_SOC; soc < 100 + TAIL_STEP_SOC; soc += TAIL_STEP_SOC) {
        const s = Math.min(soc, 100);
        const avgKw = (powerAt(prevSoc) + powerAt(s)) / 2;
        if (avgKw > 0) t += (batteryKwh * (s - prevSoc) / 100) / (avgKw / 60);
        tail.push({ soc: s, time: round1(t), chargeRate: round1(powerAt(s)) });
        prevSoc = s;
        if (s >= 100) break;
    }
    return tail;
}

// ── Speed correction ─────────────────────────────────────────────────────────

/**
 * Physics-based speed correction factor for efficiency.
 * Models energy ∝ aeroFraction×(v/v_ref)² + (1−aeroFraction).
 * Returns a multiplier on Wh/mi (>1 = worse, <1 = better).
 *
 * @param {number} travelMph  Actual travel speed
 * @param {number} testMph    Speed at which efficiency was measured
 * @param {number} [aeroFraction]  Fraction of energy from aero drag at ref speed.
 *   Use TOWING_AERO_FRACTION (~0.85) when towing, AERO_FRACTION (~0.70) unladen.
 */
export function speedCorrectionFactor(travelMph, testMph, aeroFraction = AERO_FRACTION) {
    if (!testMph || testMph <= 0) return 1;
    const travelTerm = aeroFraction * (travelMph / REFERENCE_SPEED) ** 2 + (1 - aeroFraction);
    const testTerm   = aeroFraction * (testMph   / REFERENCE_SPEED) ** 2 + (1 - aeroFraction);
    return travelTerm / testTerm;
}

// ── Simulation ───────────────────────────────────────────────────────────────

/**
 * Simulate a road trip for one vehicle.
 *
 * @param {Object} params
 * @param {number}  params.batteryKwh       Usable battery capacity
 * @param {number}  params.miPerKwh         Tested efficiency (mi/kWh)
 * @param {number}  params.testSpeedMph     Speed the range test was conducted at
 * @param {Array}   params.chargingData     Charging run data points (sorted by frame)
 * @param {number}  params.startSoc         Starting SoC (0–100)
 * @param {number}  params.minSoc           Minimum SoC before charging en route (0–100)
 * @param {number}  [params.destinationMinSoc] SoC to arrive at the destination with
 *   (defaults to minSoc). Lets the final leg keep a bigger buffer than en-route stops.
 * @param {number}  params.legDistanceMi    Miles of range added per charging stop (distance mode)
 * @param {number}  params.totalDistanceMi  Total trip distance
 * @param {number}  params.speedMph         Travel speed
 * @param {number}  params.chargeTimeMinutes Fixed charge duration per stop (mode B)
 * @param {'distance'|'time'} params.mode   Simulation mode
 * @param {number}  [params.overheadMinutes] Per-stop overhead (default 5)
 * @param {boolean} [params.towingMode]      When true, use higher aero fraction for speed correction
 *
 * @returns {{ segments, totalTimeMin, totalDistMi, chargeStops, warnings, speedFactor, correctedMiPerKwh, completed }}
 */
export function simulateRoadTrip({
    batteryKwh, miPerKwh, testSpeedMph, chargingData,
    startSoc, minSoc, destinationMinSoc, legDistanceMi, totalDistanceMi,
    speedMph, chargeTimeMinutes = 30, mode = 'distance',
    overheadMinutes = 5, towingMode = false,
}) {
    const warnings = [];
    const segments = [];

    // Arrival buffer defaults to the en-route floor (no behaviour change until set).
    const destFloor = (destinationMinSoc != null && !isNaN(destinationMinSoc)) ? destinationMinSoc : minSoc;

    // Speed correction — use higher aero fraction when towing (trailer raises Cd×A of system)
    const aeroFrac = towingMode ? TOWING_AERO_FRACTION : AERO_FRACTION;
    const factor = speedCorrectionFactor(speedMph, testSpeedMph, aeroFrac);
    const correctedMiPerKwh = miPerKwh / factor;

    // Prepare charging curve sorted by SoC, extended with a synthetic high-SoC tail
    // so charging past the measured data tapers realistically instead of via slope
    // extrapolation. Both lookup orders share the augmented curve.
    const measuredBySoc = chargingData
        .filter(p => p.soc != null && p.time != null)
        .sort((a, b) => a.soc - b.soc);

    if (measuredBySoc.length < 2) {
        warnings.push('Insufficient charging data points');
    }

    const curveBySoc  = [...measuredBySoc, ...buildChargeTail(measuredBySoc, batteryKwh)];
    const curveByTime = [...curveBySoc].sort((a, b) => a.time - b.time);

    // Range (mi) available driving from `soc` down to a given floor.
    const rangeFrom = (soc, floor) => batteryKwh * (soc - floor) / 100 * correctedMiPerKwh;
    // SoC needed now to cover `mi` of driving.
    const socForMiles = mi => (mi / (batteryKwh * correctedMiPerKwh)) * 100;

    let currentSoc  = startSoc;
    let currentDist = 0;
    let currentTime = 0;
    let chargeStops = 0;
    let iterations  = 0;

    while (currentDist < totalDistanceMi && iterations < MAX_ITERATIONS) {
        iterations++;

        // ── DRIVE ────────────────────────────────────────────────────────
        const remainingTrip = totalDistanceMi - currentDist;

        // Final leg if we can reach the destination while keeping ≥ destFloor;
        // otherwise drive down to the en-route floor (minSoc) and charge.
        const driveDist = (rangeFrom(currentSoc, destFloor) >= remainingTrip - 0.01)
            ? remainingTrip
            : Math.max(0, Math.min(rangeFrom(currentSoc, minSoc), remainingTrip));

        if (driveDist < MIN_DRIVE_MI && currentDist < totalDistanceMi) {
            warnings.push('Battery depleted: cannot drive far enough to reach next charger');
            break;
        }

        const socUsed   = socForMiles(driveDist);
        const driveTime = (driveDist / speedMph) * 60; // minutes

        segments.push({
            type: 'drive',
            startTime: currentTime,
            endTime:   currentTime + driveTime,
            startDist: currentDist,
            endDist:   currentDist + driveDist,
            startSoc:  round1(currentSoc),
            endSoc:    round1(currentSoc - socUsed),
        });

        currentTime += driveTime;
        currentDist += driveDist;
        currentSoc  -= socUsed;

        // Trip complete?
        if (currentDist >= totalDistanceMi - 0.01) break;

        // ── CHARGE ───────────────────────────────────────────────────────
        chargeStops++;
        let chargeTime, targetSoc;

        // SoC needed here to finish the whole remaining trip arriving at destFloor.
        const remaining = totalDistanceMi - currentDist;
        const arrivalRequiredSoc = destFloor + socForMiles(remaining);
        const canFinishNext = arrivalRequiredSoc <= 100 + 1e-6;

        const timeAtSoc = soc => interpolate(curveBySoc, 'soc', 'time', soc, true, true);
        const tStart = timeAtSoc(currentSoc);

        if (mode === 'distance') {
            if (canFinishNext) {
                // Last stop — charge only enough to arrive at destFloor.
                targetSoc = Math.min(100, Math.max(arrivalRequiredSoc, currentSoc + 1));
            } else {
                // Add one leg's worth of range, capped at 100%.
                targetSoc = Math.min(currentSoc + socForMiles(Math.min(legDistanceMi, remaining)), 100);
                targetSoc = Math.max(targetSoc, currentSoc + 1);
            }
            const tEnd = timeAtSoc(targetSoc);
            chargeTime = (tStart != null && tEnd != null)
                ? Math.max(0, tEnd - tStart)
                : (targetSoc - currentSoc) * 0.5; // fallback: ~0.5 min per %
        } else {
            // Fixed-time mode. On the final approach, charge only as long as needed
            // to reach the destination rather than the full fixed duration.
            const timeToArrival = (canFinishNext && tStart != null) ? (timeAtSoc(arrivalRequiredSoc) - tStart) : Infinity;
            if (canFinishNext && isFinite(timeToArrival) && timeToArrival <= chargeTimeMinutes) {
                targetSoc  = Math.min(100, Math.max(arrivalRequiredSoc, currentSoc + 1));
                chargeTime = Math.max(0, timeToArrival);
            } else {
                // Normal full-duration stop.
                if (tStart == null) {
                    warnings.push(`Charging data incomplete at SoC ${round1(currentSoc)}%`);
                    targetSoc = Math.min(currentSoc + chargeTimeMinutes * 2, 100); // rough fallback
                } else {
                    const endSoc = interpolate(curveByTime, 'time', 'soc', tStart + chargeTimeMinutes, false, true);
                    targetSoc = endSoc != null ? Math.min(endSoc, 100) : Math.min(currentSoc + chargeTimeMinutes * 2, 100);
                }
                chargeTime = chargeTimeMinutes;
            }

            if (targetSoc <= currentSoc + 1) {
                warnings.push('Charger too slow for meaningful charge');
                break;
            }
        }

        chargeTime += overheadMinutes;

        segments.push({
            type: 'charge',
            startTime: currentTime,
            endTime:   currentTime + chargeTime,
            startDist: currentDist,
            endDist:   currentDist, // no distance during charging
            startSoc:  round1(currentSoc),
            endSoc:    round1(targetSoc),
        });

        currentTime += chargeTime;
        currentSoc   = targetSoc;
    }

    const completed = currentDist >= totalDistanceMi - 0.01;
    if (iterations >= MAX_ITERATIONS && !completed) {
        warnings.push('Could not complete trip: too many charging stops required');
    }
    // Reached the destination but below the requested arrival buffer (the buffer was
    // unachievable given battery / efficiency / charging limits).
    if (completed && destFloor > minSoc && currentSoc < destFloor - 0.5) {
        warnings.push(`Arrived at ${round1(currentSoc)}% — below the ${round1(destFloor)}% destination minimum`);
    }

    return {
        segments,
        totalTimeMin: currentTime,
        totalDistMi:  currentDist,
        chargeStops,
        warnings,
        speedFactor: factor,
        correctedMiPerKwh,
        completed,
    };
}

// ── Chart helpers ────────────────────────────────────────────────────────────

/**
 * Convert simulation segments to Chart.js data points (distance mode).
 * Each segment emits its start and end point.
 * @param {boolean} [driveTimeX] When true, X = cumulative driving time (stops don't advance X).
 */
export function segmentsToChartPoints(segments, units, driveTimeX = false) {
    const points = [];
    let cumDrive = 0;
    for (const seg of segments) {
        const x1 = driveTimeX ? round1(cumDrive) : round1(seg.startTime);
        points.push({ x: x1, y: convDistance(seg.startDist, units) });
        if (seg.type === 'drive') cumDrive += seg.endTime - seg.startTime;
        const x2 = driveTimeX ? round1(cumDrive) : round1(seg.endTime);
        points.push({ x: x2, y: convDistance(seg.endDist, units) });
    }
    return points;
}

/**
 * Convert simulation segments to Chart.js data points (charge-time mode).
 * Y-axis = cumulative minutes spent charging.
 * Drive segments: Y stays flat.
 * Charge segments: Y increases by the segment duration.
 * @param {boolean} [driveTimeX] When true, X = cumulative driving time (stops don't advance X).
 */
export function segmentsToChartPointsChargeTime(segments, driveTimeX = false) {
    const points = [];
    let cumCharge = 0, cumDrive = 0;
    for (const seg of segments) {
        const x1 = driveTimeX ? round1(cumDrive) : round1(seg.startTime);
        points.push({ x: x1, y: round1(cumCharge) });
        if (seg.type === 'charge') cumCharge += seg.endTime - seg.startTime;
        if (seg.type === 'drive')  cumDrive  += seg.endTime - seg.startTime;
        const x2 = driveTimeX ? round1(cumDrive) : round1(seg.endTime);
        points.push({ x: x2, y: round1(cumCharge) });
    }
    return points;
}

/**
 * Convert simulation segments to Chart.js data points (by-test / SoC-lane mode).
 * Each run occupies its own horizontal lane; Y encodes SoC within that lane.
 * Y formula: runIndex + 0.5 + soc / 100
 *   → run 0 spans Y ∈ [0.5, 1.5], run 1 spans Y ∈ [1.5, 2.5], etc.
 */
export function segmentsToChartPointsByTest(segments, runIndex) {
    const points = [];
    for (const seg of segments) {
        points.push({ x: round1(seg.startTime), y: round1(runIndex + seg.startSoc / 100) });
        points.push({ x: round1(seg.endTime),   y: round1(runIndex + seg.endSoc   / 100) });
    }
    return points;
}

/**
 * Format minutes as "Xh Ym" or "Xm".
 */
export function formatTime(minutes) {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Internal ─────────────────────────────────────────────────────────────────
const round1 = v => roundTo(v, 1);
