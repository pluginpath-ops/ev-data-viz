/**
 * The composite range and efficiency: a vehicle's steady-state range tests,
 * each corrected to one set of conditions, averaged.
 *
 * testedRange.js reports ONE test with its conditions and refuses to compare
 * it to EPA, because a 75 mph winter test and a 65 mph summer one are not the
 * same measurement. This is the figure that earns the comparison: every test
 * re-priced to the same speed, altitude, temperature and calm air
 * (conditionCorrection.js), so what is left is about the car.
 *
 * Like the composite curve (#313) it is a mean, quoted with its conditions and
 * how many tests made it — not what the car "typically" does. Unlike the
 * curve it is never stored: the target is the reader's (the table's
 * Assumptions), so it is worked out where it is shown.
 *
 * ── Which tests ──────────────────────────────────────────────────────────────
 *
 * The range tests that count (runListing.statisticalRuns — listed and pooled,
 * none excluded), then only those a correction can honestly move:
 *
 *   · a HELD speed. A mixed cycle's average speed understates its aero load
 *     (see correctionFactor), so it cannot be re-priced to a cruise.
 *   · within COMPOSITE_RANGE_SPEED_GAP_MPH of the target speed — further out
 *     the one fleet-wide aero fraction is doing most of the work.
 *   · a temperature inside COMPOSITE_RANGE_TEMP_BAND. Temperature is corrected
 *     for air density only; a cold test's heating and battery losses are
 *     not modelled, so a cold test is left out, not "corrected".
 *
 * Altitude and wind are corrected where the test records them and taken as
 * the target's where it does not, which is correctionFactor's rule. It always
 * corrects for everything the model can (mode 'aero_wind'), whatever the
 * charts' mode: an uncorrected mean of tests at different conditions is the
 * comparison this exists to replace. Its TARGET is the reader's, shared with
 * the charts (correctionSettings.js).
 *
 * Efficiency needs any window (miles per kWh over 56→10% is still miles per
 * kWh); range needs one wide enough to scale to a full pack
 * (rangeTestSpread.rangeCoverageOk). So the two can rest on different counts,
 * and each says its own.
 *
 * Pure module — no React, no database.
 */
import { correctionFactor, runConditions } from './conditionCorrection';
import { countedRangeTests, rangeCoverageOk, spreadEfficiency } from './rangeTestSpread';
import { socWindow } from './testedRange';
import { isCompositeRun } from './runUtils';
import {
    STANDARD_CONDITIONS, COMPOSITE_RANGE_TEMP_BAND, COMPOSITE_RANGE_SPEED_GAP_MPH,
} from '../constants/epa';

/** Why a counted range test is not in the composite, as a reader is told it. */
export const COMPOSITE_RANGE_LEFT_OUT = {
    mixed:       'mixed cycle',
    noSpeed:     'no speed recorded',
    speedGap:    'speed too far from the target',
    noTemp:      'no temperature recorded',
    temperature: 'outside the temperature band',
};

const present = (v) => v != null && v !== '';
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Why this test cannot be corrected into the composite, or null when it can. */
function leftOutReason(run, temperatureF, target, { tempBand, speedGapMph }) {
    if (run.speed_basis === 'mixed') return 'mixed';
    if (!present(run.speed_mph)) return 'noSpeed';
    if (Math.abs(Number(run.speed_mph) - target.speedMph) > speedGapMph) return 'speedGap';
    if (!present(temperatureF)) return 'noTemp';
    if (temperatureF < tempBand[0] || temperatureF > tempBand[1]) return 'temperature';
    return null;
}

/**
 * @param {Object} vehicle   with `runs`, `pooledRuns` and `socWindowKwh`
 * @param {Object} [opts]
 * @param {Object} [opts.target]      { speedMph, altitudeFt, temperatureF } to correct to
 * @param {Function} [opts.sessionOf] run → its test session, which supplies conditions a run omits
 * @param {number[]} [opts.tempBand]
 * @param {number}   [opts.speedGapMph]
 * @returns {{
 *   rangeMi: number|null, nRange: number,
 *   miPerKwh: number|null, nEfficiency: number, nEstimated: number,
 *   tests: Array<{ run, factor: number, rangeMi: number|null, miPerKwh: number|null, estimated: boolean }>,
 *   leftOut: Array<{ run, reason: string }>,
 * } | null}  null when the vehicle has no counted range test at all
 */
export function compositeRange(vehicle, {
    target = STANDARD_CONDITIONS,
    sessionOf = () => null,
    tempBand = COMPOSITE_RANGE_TEMP_BAND,
    speedGapMph = COMPOSITE_RANGE_SPEED_GAP_MPH,
} = {}) {
    const counted = countedRangeTests(vehicle).filter(r => !isCompositeRun(r) && r.distance_miles > 0);
    if (!counted.length) return null;

    const tests = [];
    const leftOut = [];
    for (const run of counted) {
        // A run's own reading wins over its session's (rangeSource.correctBasis).
        const session = sessionOf(run);
        const temperatureF = present(run.temperature_f) ? Number(run.temperature_f)
            : present(session?.temperature_f) ? Number(session.temperature_f) : null;
        const reason = leftOutReason(run, temperatureF, target, { tempBand, speedGapMph });
        if (reason) { leftOut.push({ run, reason }); continue; }

        const { factor } = correctionFactor(runConditions(run, session), { mode: 'aero_wind', target });

        const window = socWindow(run);
        const rangeMi = rangeCoverageOk(run) && window ? (run.distance_miles * 100 / window) * factor : null;
        const eff = spreadEfficiency(run, vehicle?.socWindowKwh);
        tests.push({
            run,
            factor,
            rangeMi,
            miPerKwh: eff ? eff.miPerKwh * factor : null,
            estimated: !!eff?.estimated,
        });
    }

    const ranges = tests.map(t => t.rangeMi).filter(v => v != null);
    const effs = tests.filter(t => t.miPerKwh != null);
    return {
        rangeMi: mean(ranges),
        nRange: ranges.length,
        miPerKwh: mean(effs.map(t => t.miPerKwh)),
        nEfficiency: effs.length,
        nEstimated: effs.filter(t => t.estimated).length,
        tests,
        leftOut,
    };
}

/**
 * What a blank composite says beneath it: why none of the vehicle's tests
 * could be corrected — the commonest reason, or a count when they differ.
 */
export function compositeLeftOutNote(composite) {
    const out = composite?.leftOut ?? [];
    if (!out.length) return null;
    const reasons = new Set(out.map(o => o.reason));
    if (reasons.size === 1) {
        const why = COMPOSITE_RANGE_LEFT_OUT[out[0].reason];
        return out.length === 1 ? `1 test: ${why}` : `${out.length} tests: ${why}`;
    }
    return `${out.length} tests, none steady-state in band`;
}
