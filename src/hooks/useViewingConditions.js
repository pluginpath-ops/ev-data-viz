import { useState, useMemo } from 'react';
import { airDensityRatio, temperatureDensityRatio, averageGradePercent } from '../utils/epaDerivations';
import { normalizeCorrectionTarget, DEFAULT_CORRECTION_TARGET } from '../utils/correctionSettings';
import { effectiveAccessoryW } from '../utils/accessoryLoad';
import { STANDARD_CONDITIONS } from '../constants/epa';

/**
 * How the shared correction target differs from the standard conditions, as the
 * two numbers a curve is scaled by. Pure, and exported so the identity — an
 * untouched target is density 1 and no accessory change — is asserted directly.
 *
 *   densityRatio     the target's air density over the standard's
 *   accessoryDeltaW  the target's accessory load less the standard's, in watts
 */
export function targetRatios(target = DEFAULT_CORRECTION_TARGET) {
    const t = normalizeCorrectionTarget(target);
    return {
        densityRatio: (airDensityRatio(t.altitudeFt) * temperatureDensityRatio(t.temperatureF))
            / (airDensityRatio(STANDARD_CONDITIONS.altitudeFt) * temperatureDensityRatio(STANDARD_CONDITIONS.temperatureF)),
        accessoryDeltaW: effectiveAccessoryW(t) - effectiveAccessoryW(DEFAULT_CORRECTION_TARGET),
    };
}

/**
 * What a Modeled Efficiency curve is drawn under, and everything derived from it
 * (#237, #449).
 *
 * Two sources. Altitude, temperature and accessory load are the SHARED
 * correction target, passed in: the one setting every chart and the vehicle
 * table read. Wind and net elevation gain/loss are Modeled Efficiency's own
 * extras (WindAndElevationFields) and are held here.
 *
 * Both reach the curve as ratios against the standard conditions rather than as
 * absolute values — `densityRatio` is the target's air density over the
 * standard's, and `accessoryDeltaW` the target's accessory load less the
 * standard's — so a target nobody has moved draws exactly the curve this chart
 * always drew (density 1, the record's own accessory load), whatever the Admin
 * has set the standard conditions to.
 *
 * The extras are owned here rather than by each view, so the raw-string-to-number
 * handling — an empty input means "not set", not zero — has one implementation.
 */
export function useViewingConditions({ driven = null, target = DEFAULT_CORRECTION_TARGET } = {}) {
    // Wind uses the same 0=tailwind / 180=headwind / 90|270=crosswind
    // convention as runs.wind_direction_deg (#142), applied as apparent
    // airspeed. Never persisted; η untouched.
    const [windSpeedMphState, setWindSpeedMph] = useState('');
    const [windDirectionDegState, setWindDirectionDeg] = useState('');
    // Elevation gain/loss is a ROUTE effect, distinct from static altitude,
    // which is an air-density one. Almost always zero, and the physics behind
    // it (weight-based potential energy, a regen approximation on descents) is
    // more involved than the others — hence its own disclosure.
    const [gradeExpandedState, setGradeExpanded] = useState(false);
    const [gradeGainFtState, setGradeGainFt] = useState('');
    const [gradeDistanceMilesState, setGradeDistanceMiles] = useState('');

    // A pop-out window has no controls to hold these, so it is DRIVEN by the
    // window that does: pass the other window's `values` and they replace this
    // one's own state. Without it a pop-out of a chart drawn at 20 mph of
    // headwind would draw the standard-conditions curve, silently.
    const pick = (name, own) => (driven && driven[name] !== undefined ? driven[name] : own);
    const windSpeedMph       = pick('windSpeedMph', windSpeedMphState);
    const windDirectionDeg   = pick('windDirectionDeg', windDirectionDegState);
    const gradeExpanded      = pick('gradeExpanded', gradeExpandedState);
    const gradeGainFt        = pick('gradeGainFt', gradeGainFtState);
    const gradeDistanceMiles = pick('gradeDistanceMiles', gradeDistanceMilesState);

    const { densityRatio, accessoryDeltaW } = useMemo(
        () => targetRatios(target),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the target's four numbers, not the object
        [target?.altitudeFt, target?.temperatureF, target?.accessoryW],
    );
    const densityAdjusted = Math.abs(densityRatio - 1) > 1e-6;
    const accessoryAdjusted = accessoryDeltaW !== 0;
    const windAdjusted = windSpeedMph !== '' && Number(windSpeedMph) > 0;
    const windSpeedMphNum = windAdjusted ? Number(windSpeedMph) : 0;
    const windDirectionDegNum = windDirectionDeg === '' ? 0 : Number(windDirectionDeg);
    const gradeGainFtNum = gradeGainFt === '' ? 0 : Number(gradeGainFt);
    const gradeDistanceMilesNum = gradeDistanceMiles === '' ? 0 : Number(gradeDistanceMiles);
    const gradeAdjusted = gradeGainFtNum !== 0 && gradeDistanceMilesNum > 0;
    const avgGradePercent = averageGradePercent(gradeGainFtNum, gradeDistanceMilesNum);

    return {
        // The extras only: what a pop-out is driven with. The target travels in
        // chartConfig, which the pop-out already receives.
        values: { windSpeedMph, windDirectionDeg, gradeExpanded, gradeGainFt, gradeDistanceMiles },
        set: { setWindSpeedMph, setWindDirectionDeg, setGradeExpanded, setGradeGainFt, setGradeDistanceMiles },
        derived: {
            densityRatio, densityAdjusted, accessoryDeltaW, accessoryAdjusted,
            windAdjusted, windSpeedMphNum, windDirectionDegNum,
            gradeGainFtNum, gradeDistanceMilesNum, gradeAdjusted, avgGradePercent,
        },
        /** True when the wind or the elevation change is scaling the curve — for the extras' collapsed summary. */
        get extrasAdjusted() {
            return windAdjusted || gradeAdjusted;
        },
        /** True when anything at all is scaling the curve, the target included. */
        get anyAdjusted() {
            return densityAdjusted || accessoryAdjusted || windAdjusted || gradeAdjusted;
        },
    };
}
