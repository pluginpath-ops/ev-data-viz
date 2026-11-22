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

/** The extras untouched: every input empty ("not set"), elevation closed. */
export const NO_EXTRAS = Object.freeze({
    windSpeedMph: '', windDirectionDeg: '', gradeExpanded: false, gradeGainFt: '', gradeDistanceMiles: '',
});

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
 * The raw-string-to-number handling — an empty input means "not set", not
 * zero — has one implementation, here.
 *
 * Where the extras are held:
 *   no `values`              here, for a chart that keeps them to itself
 *   `values` + `setValues`   by the caller (Modeled Efficiency: epaConfig.extras,
 *                            so the link, a featured chart and the pop-out carry them)
 *   `values` alone           driven by another window: a pop-out has no
 *                            controls, and without them a chart drawn at 20 mph
 *                            of headwind would pop out at standard conditions
 */
export function useViewingConditions({ values: outside = null, setValues = null, target = DEFAULT_CORRECTION_TARGET } = {}) {
    const [own, setOwn] = useState(NO_EXTRAS);
    const held = outside != null;
    const write = held ? setValues : setOwn;
    // Wind uses the same 0=tailwind / 180=headwind / 90|270=crosswind
    // convention as runs.wind_direction_deg (#142), applied as apparent
    // airspeed. Never persisted; η untouched.
    //
    // Elevation gain/loss is a ROUTE effect, distinct from static altitude,
    // which is an air-density one. Almost always zero, and the physics behind
    // it (weight-based potential energy, a regen approximation on descents) is
    // more involved than the others — hence its own disclosure.
    const { windSpeedMph, windDirectionDeg, gradeExpanded, gradeGainFt, gradeDistanceMiles } =
        held ? { ...NO_EXTRAS, ...outside } : own;
    const set = useMemo(() => {
        const setterOf = name => next => write?.(prev => {
            const base = { ...NO_EXTRAS, ...(prev ?? {}) };
            return { ...base, [name]: typeof next === 'function' ? next(base[name]) : next };
        });
        return {
            setWindSpeedMph: setterOf('windSpeedMph'),
            setWindDirectionDeg: setterOf('windDirectionDeg'),
            setGradeExpanded: setterOf('gradeExpanded'),
            setGradeGainFt: setterOf('gradeGainFt'),
            setGradeDistanceMiles: setterOf('gradeDistanceMiles'),
        };
    }, [write]);

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
        set,
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
