import { interpolate } from './interpolate';
import { convDistance } from './unitConversions';

// ── Constants ────────────────────────────────────────────────────────────────
const AERO_FRACTION   = 0.7;   // fraction of energy from aero drag at reference speed
const REFERENCE_SPEED = 70;    // mph
const MAX_ITERATIONS  = 50;    // safety guard against infinite loops
const MIN_DRIVE_MI    = 0.1;   // minimum driveable distance before bailing

// ── Speed correction ─────────────────────────────────────────────────────────

/**
 * Physics-based speed correction factor for efficiency.
 * At 70 mph, ~70% of energy is aerodynamic drag (∝ v²).
 * Returns a multiplier on Wh/mi (>1 = worse, <1 = better).
 */
export function speedCorrectionFactor(travelMph, testMph) {
    if (!testMph || testMph <= 0) return 1;
    const travelTerm = AERO_FRACTION * (travelMph / REFERENCE_SPEED) ** 2 + (1 - AERO_FRACTION);
    const testTerm   = AERO_FRACTION * (testMph   / REFERENCE_SPEED) ** 2 + (1 - AERO_FRACTION);
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
 * @param {number}  params.legDistanceMi    Distance between charging stops (mode A)
 * @param {number}  params.totalDistanceMi  Total trip distance
 * @param {number}  params.speedMph         Travel speed
 * @param {number}  params.chargeTimeMinutes Fixed charge duration per stop (mode B)
 * @param {'distance'|'time'} params.mode   Simulation mode
 * @param {number} [params.overheadMinutes] Per-stop overhead (default 5)
 *
 * @returns {{ segments, totalTimeMin, chargeStops, warnings, speedFactor }}
 */
export function simulateRoadTrip({
    batteryKwh, miPerKwh, testSpeedMph, chargingData,
    startSoc, minSoc, legDistanceMi, totalDistanceMi,
    speedMph, chargeTimeMinutes = 30, mode = 'distance',
    overheadMinutes = 5,
}) {
    const warnings = [];
    const segments = [];

    // Speed correction
    const factor = speedCorrectionFactor(speedMph, testSpeedMph);
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

    // ── Pre-flight check (distance mode) ─────────────────────────────────────
    if (mode === 'distance') {
        const maxRange = batteryKwh * (100 - minSoc) / 100 * correctedMiPerKwh;
        if (maxRange < legDistanceMi) {
            warnings.push(
                `Insufficient range: max range from 100% SoC is ${round1(maxRange)} mi, ` +
                `but leg distance is ${round1(legDistanceMi)} mi. ` +
                `Reduce leg distance or raise minimum SoC.`
            );
            return { segments: [], totalTimeMin: 0, totalDistMi: 0, chargeStops: 0, warnings, speedFactor: factor, correctedMiPerKwh };
        }
    }

    let currentSoc  = startSoc;
    let currentDist = 0;
    let currentTime = 0;
    let chargeStops = 0;
    let iterations  = 0;

    while (currentDist < totalDistanceMi && iterations < MAX_ITERATIONS) {
        iterations++;

        // ── DRIVE ────────────────────────────────────────────────────────
        const rangeFromSoc = batteryKwh * (currentSoc - minSoc) / 100 * correctedMiPerKwh;
        const remainingTrip = totalDistanceMi - currentDist;

        let driveDist;
        if (mode === 'distance') {
            // Next charger is at the next legDistance multiple
            const distToCharger = (legDistanceMi - (currentDist % legDistanceMi)) || legDistanceMi;
            // Detect mid-leg range exhaustion (shouldn't happen after pre-flight, but guard anyway)
            if (rangeFromSoc < distToCharger - 0.1 && distToCharger <= remainingTrip) {
                warnings.push(
                    `Ran out of range ${round1(distToCharger - rangeFromSoc)} mi short of charger ` +
                    `(at ${round1(currentDist + rangeFromSoc)} mi). Increase leg distance or reduce minimum SoC.`
                );
                break;
            }
            driveDist = Math.min(rangeFromSoc, distToCharger, remainingTrip);
        } else {
            // Mode B: drive until minSoc or trip end
            driveDist = Math.min(rangeFromSoc, remainingTrip);
        }

        driveDist = Math.max(0, driveDist);

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
            // Charge enough for next leg
            const nextLeg = Math.min(legDistanceMi, totalDistanceMi - currentDist);
            const socNeeded = (nextLeg / (batteryKwh * correctedMiPerKwh)) * 100;
            targetSoc = Math.min(minSoc + socNeeded, 100);
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
 */
export function segmentsToChartPoints(segments, units) {
    const points = [];
    for (const seg of segments) {
        points.push({ x: round1(seg.startTime), y: convDistance(seg.startDist, units) });
        points.push({ x: round1(seg.endTime),   y: convDistance(seg.endDist, units)   });
    }
    return points;
}

/**
 * Convert simulation segments to Chart.js data points (charge-time mode).
 * Y-axis = cumulative minutes spent charging.
 * Drive segments: Y stays flat.
 * Charge segments: Y increases by the segment duration.
 */
export function segmentsToChartPointsChargeTime(segments) {
    const points = [];
    let cumCharge = 0;
    for (const seg of segments) {
        points.push({ x: round1(seg.startTime), y: round1(cumCharge) });
        if (seg.type === 'charge') {
            cumCharge += seg.endTime - seg.startTime;
        }
        points.push({ x: round1(seg.endTime), y: round1(cumCharge) });
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
