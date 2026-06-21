import { deriveChargingAxis } from './deriveChargingAxis';

/**
 * Estimate elapsed time for charging data points from power, calibrated by
 * (SoC, elapsed-time) anchors.
 *
 * Thin back-compat wrapper around {@link deriveChargingAxis} (target 'time').
 * New code should call deriveChargingAxis directly; this preserves the original
 * {soc, timeMin} anchor shape and the ≥2-anchor requirement.
 *
 * @param {Object}  opts
 * @param {Array}   opts.dataPoints   - run data points [{soc, chargeRate, ...}]
 * @param {number}  opts.batteryKwh   - usable battery capacity (kWh)
 * @param {Array}   opts.anchors      - [{soc, timeMin}, ...] — ≥2 required
 * @param {boolean} opts.shiftToZero  - if true, shift output so min time = 0
 * @returns {{ points: Array<{soc, chargeRate, time}>, warnings: string[] }}
 */
export function estimateChargingTimes({ dataPoints, batteryKwh, anchors, shiftToZero = false }) {
    const valid = (anchors || []).filter(
        a => a.soc !== '' && a.timeMin !== '' && !isNaN(Number(a.soc)) && !isNaN(Number(a.timeMin))
    );
    if (valid.length < 2)
        throw new Error('At least 2 valid anchor points are required');

    const { points, warnings } = deriveChargingAxis({
        dataPoints,
        batteryKwh,
        target: 'time',
        anchors: valid.map(a => ({ x: a.soc, y: a.timeMin })),
        shiftToZero,
    });
    return { points, warnings };
}
