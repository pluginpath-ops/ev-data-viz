import { interpolate } from './interpolate';
import { convDistance } from './unitConversions';

// ── Constants ────────────────────────────────────────────────────────────────
const AERO_FRACTION        = 0.70; // fraction of energy from aero drag at ref speed (unladen EV)
const TOWING_AERO_FRACTION = 0.85; // higher aero fraction when towing — trailer roughly doubles Cd×A
const REFERENCE_SPEED      = 70;   // mph
const MAX_ITERATIONS       = 50;   // safety guard against infinite loops
const MIN_DRIVE_MI         = 0.1;  // minimum driveable distance before bailing

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
 * @param {number}  params.minSoc           Minimum SoC before charging (0–100)
 * @param {number}  params.legDistanceMi    Miles of range added per charging stop (distance mode)
 * @param {number}  params.totalDistanceMi  Total trip distance
 * @param {number}  params.speedMph         Travel speed
 * @param {number}  params.chargeTimeMinutes Fixed charge duration per stop (mode B)
 * @param {'distance'|'time'} params.mode   Simulation mode
 * @param {number}  [params.overheadMinutes] Per-stop overhead (default 5)
 * @param {boolean} [params.towingMode]      When true, use higher aero fraction for speed correction
 *
 * @returns {{ segments, totalTimeMin, chargeStops, warnings, speedFactor }}
 */
export function simulateRoadTrip({
    batteryKwh, miPerKwh, testSpeedMph, chargingData,
    startSoc, minSoc, legDistanceMi, totalDistanceMi,
    speedMph, chargeTimeMinutes = 30, mode = 'distance',
    overheadMinutes = 5, towingMode = false,
}) {
    const warnings = [];
    const segments = [];

    // Speed correction — use higher aero fraction when towing (trailer raises Cd×A of system)
    const aeroFrac = towingMode ? TOWING_AERO_FRACTION : AERO_FRACTION;
    const factor = speedCorrectionFactor(speedMph, testSpeedMph, aeroFrac);
    const correctedMiPerKwh = miPerKwh / factor;

    // Prepare charging curve sorted by SoC and by time
    const chargingBySoc = chargingData
        .filter(p => p.soc != null && p.time != null)
        .sort((a, b) => a.soc - b.soc);

    const chargingByTime = chargingData
        .filter(p => p.soc != null && p.time != null)
        .sort((a, b) => a.time - b.time);

    if (chargingBySoc.length < 2) {
        warnings.push('Insufficient charging data points');
    }

    let currentSoc  = startSoc;
    let currentDist = 0;
    let currentTime = 0;
    let chargeStops = 0;
    let iterations  = 0;

    while (currentDist < totalDistanceMi && iterations < MAX_ITERATIONS) {
        iterations++;

        // ── DRIVE ────────────────────────────────────────────────────────
        const rangeFromSoc  = batteryKwh * (currentSoc - minSoc) / 100 * correctedMiPerKwh;
        const remainingTrip = totalDistanceMi - currentDist;

        // Both modes: drive until minSoc (or trip end).
        // Distance mode adds a fixed amount of charge at each stop rather than stopping at fixed intervals.
        const driveDist = Math.max(0, Math.min(rangeFromSoc, remainingTrip));

        if (driveDist < MIN_DRIVE_MI && currentDist < totalDistanceMi) {
            warnings.push('Battery depleted: cannot drive far enough to reach next charger');
            break;
        }

        const socUsed   = (driveDist / (batteryKwh * correctedMiPerKwh)) * 100;
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

        if (mode === 'distance') {
            // Add a fixed number of miles of range per stop (legDistanceMi), capped at
            // what's needed for the remaining trip and at 100% SoC.
            // If the leftover after one legDistanceMi charge would be tiny (< 2 mi),
            // extend this stop to cover the whole remaining distance — avoids phantom stops
            // when the trip distance doesn't divide evenly by the leg size.
            const remaining  = totalDistanceMi - currentDist;
            const leftover   = remaining - legDistanceMi;
            const chargeMi   = (leftover > 0 && leftover < 2.0) ? remaining : Math.min(legDistanceMi, remaining);
            const socToAdd   = (chargeMi / (batteryKwh * correctedMiPerKwh)) * 100;
            targetSoc = Math.min(currentSoc + socToAdd, 100);
            targetSoc = Math.max(targetSoc, currentSoc + 1);

            const tStart = interpolate(chargingBySoc, 'soc', 'time', currentSoc, true, true);
            const tEnd   = interpolate(chargingBySoc, 'soc', 'time', targetSoc,  true, true);

            if (tStart == null || tEnd == null) {
                warnings.push(`Charging data incomplete for SoC ${round1(currentSoc)}%-${round1(targetSoc)}%`);
                chargeTime = (targetSoc - currentSoc) * 0.5; // fallback: ~0.5 min per %
            } else {
                chargeTime = Math.max(0, tEnd - tStart);
            }
        } else {
            // Mode B: charge for fixed time
            const tStart = interpolate(chargingBySoc, 'soc', 'time', currentSoc, true, true);
            if (tStart == null) {
                warnings.push(`Charging data incomplete at SoC ${round1(currentSoc)}%`);
                targetSoc = Math.min(currentSoc + chargeTimeMinutes * 2, 100); // rough fallback
            } else {
                const tEnd = tStart + chargeTimeMinutes;
                const endSoc = interpolate(chargingByTime, 'time', 'soc', tEnd, false, true);
                targetSoc = endSoc != null ? Math.min(endSoc, 100) : Math.min(currentSoc + chargeTimeMinutes * 2, 100);
            }
            chargeTime = chargeTimeMinutes;

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

    if (iterations >= MAX_ITERATIONS) {
        warnings.push('Simulation reached maximum iterations');
    }

    return {
        segments,
        totalTimeMin: currentTime,
        totalDistMi:  currentDist,
        chargeStops,
        warnings,
        speedFactor: factor,
        correctedMiPerKwh,
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
function round1(v) { return Math.round(v * 10) / 10; }
