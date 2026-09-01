import { useState, useMemo } from 'react';
import InfoIcon from '../InfoIcon';
import {
    airDensityRatio, temperatureDensityRatio, averageGradePercent,
    STANDARD_TEMP_F, DEFAULT_ACCESSORY_W,
} from '../../utils/epaDerivations';
import { AccessoryLoadReferenceTable, MIN_TEMP_F, MAX_TEMP_F } from './accessoryReference';

/**
 * The viewing conditions an EPA curve can be re-plotted under (#237).
 *
 * Altitude, ambient temperature, accessory load, wind and road grade. All are
 * DISPLAY-TIME scalings: they change the curve on screen and never touch stored
 * coefficients, accessory fields, or the standard-condition η.
 *
 * Extracted from EpaCurvesView so the certification-anchored curves get the same
 * controls rather than a second, drifting copy of them. Two views computing
 * air density slightly differently would be invisible until someone compared
 * the same car in both.
 *
 * Deliberately NOT included: the real-world test overlay. That plots a
 * VEHICLE's own range runs, and the certification view has no vehicle — the
 * whole point of it is that most records belong to none.
 */

/**
 * The state behind the controls, and everything derived from it.
 *
 * Owned here rather than by each view, so the raw-string-to-number handling —
 * an empty input means "not set", not zero — has one implementation. `''` and
 * `0` are different for temperature especially, where 0°F is a real value.
 */
export function useViewingConditions() {
    const [elevationFt, setElevationFt] = useState(0);
    const [tempF, setTempF] = useState('');
    const [accessoryOverrideW, setAccessoryOverrideW] = useState('');
    // Wind uses the same 0=tailwind / 180=headwind / 90|270=crosswind
    // convention as runs.wind_direction_deg (#142), applied as apparent
    // airspeed. Never persisted; η untouched.
    const [windSpeedMph, setWindSpeedMph] = useState('');
    const [windDirectionDeg, setWindDirectionDeg] = useState('');
    // Elevation gain/loss is a ROUTE effect, distinct from static altitude,
    // which is an air-density one. Almost always zero, and the physics behind
    // it (weight-based potential energy, a regen approximation on descents) is
    // more involved than the others — hence its own disclosure.
    const [gradeExpanded, setGradeExpanded] = useState(false);
    const [gradeGainFt, setGradeGainFt] = useState('');
    const [gradeDistanceMiles, setGradeDistanceMiles] = useState('');

    const clampTempF = (raw) => {
        if (raw === '' || raw === '-') return raw; // mid-typing a negative
        const n = Number(raw);
        if (isNaN(n)) return raw;
        return String(Math.min(MAX_TEMP_F, Math.max(MIN_TEMP_F, n)));
    };
    const clampWindDirection = (raw) => {
        if (raw === '') return raw;
        const n = Number(raw);
        if (isNaN(n)) return raw;
        return String(Math.min(360, Math.max(0, n)));
    };

    const densityRatio = useMemo(
        () => airDensityRatio(elevationFt) * temperatureDensityRatio(tempF === '' ? null : Number(tempF)),
        [elevationFt, tempF],
    );
    const densityAdjusted = Math.abs(densityRatio - 1) > 1e-6;
    const accessoryAdjusted = accessoryOverrideW !== '';
    const accessoryOverrideWNum = accessoryAdjusted ? Number(accessoryOverrideW) : null;
    const windAdjusted = windSpeedMph !== '' && Number(windSpeedMph) > 0;
    const windSpeedMphNum = windAdjusted ? Number(windSpeedMph) : 0;
    const windDirectionDegNum = windDirectionDeg === '' ? 0 : Number(windDirectionDeg);
    const gradeGainFtNum = gradeGainFt === '' ? 0 : Number(gradeGainFt);
    const gradeDistanceMilesNum = gradeDistanceMiles === '' ? 0 : Number(gradeDistanceMiles);
    const gradeAdjusted = gradeGainFtNum !== 0 && gradeDistanceMilesNum > 0;
    const avgGradePercent = averageGradePercent(gradeGainFtNum, gradeDistanceMilesNum);

    return {
        values: { elevationFt, tempF, accessoryOverrideW, windSpeedMph, windDirectionDeg,
                  gradeExpanded, gradeGainFt, gradeDistanceMiles },
        set: { setElevationFt, setTempF, setAccessoryOverrideW, setWindSpeedMph,
               setWindDirectionDeg, setGradeExpanded, setGradeGainFt, setGradeDistanceMiles },
        helpers: { clampTempF, clampWindDirection },
        derived: {
            densityRatio, densityAdjusted, accessoryAdjusted, accessoryOverrideWNum,
            windAdjusted, windSpeedMphNum, windDirectionDegNum,
            gradeGainFtNum, gradeDistanceMilesNum, gradeAdjusted, avgGradePercent,
        },
        /** True when anything is scaling the curve — for a collapsed summary. */
        get anyAdjusted() {
            return densityAdjusted || accessoryAdjusted || windAdjusted || gradeAdjusted;
        },
    };
}

export default function ViewingConditions({ conditions }) {
    const { values, set, helpers, derived } = conditions;
    const { elevationFt, tempF, accessoryOverrideW, windSpeedMph, windDirectionDeg,
            gradeExpanded, gradeGainFt, gradeDistanceMiles } = values;
    const { setElevationFt, setTempF, setAccessoryOverrideW, setWindSpeedMph,
            setWindDirectionDeg, setGradeExpanded, setGradeGainFt, setGradeDistanceMiles } = set;
    const { clampTempF, clampWindDirection } = helpers;
    const { densityRatio, densityAdjusted, windAdjusted,
            gradeAdjusted, avgGradePercent } = derived;

    return (
        <>
            <div className="chart-viewing-conditions">
                {/* Altitude — viewing condition, applies to all curves */}
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium flex items-center" style={{ color: 'var(--color-text-secondary)' }}>
                        Altitude
                        <InfoIcon
                            text="Adjusts aerodynamic drag for air density at this elevation. Models air density only — does not capture battery, regen, or cabin-heating effects. Curve is the standard-condition baseline scaled for thinner air."
                            position="right"
                            className="ml-1"
                        />
                    </span>
                    <input
                        type="number"
                        step="100"
                        value={elevationFt}
                        onChange={e => setElevationFt(Number(e.target.value) || 0)}
                        className="form-input form-input w-24 text-right"
                        aria-label="Elevation in feet"
                    />
                    <span className="text-sm text-meta">ft</span>
                </div>

                {/* Temperature — viewing condition, applies to all curves */}
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium flex items-center" style={{ color: 'var(--color-text-secondary)' }}>
                        Temp
                        <InfoIcon
                            text={`Adjusts aerodynamic drag for air density at this ambient temperature (colder air is denser). Standard condition is ${STANDARD_TEMP_F}°F. Models air density only — does not capture battery, HVAC, or cold-tire effects.`}
                            position="right"
                            className="ml-1"
                        />
                    </span>
                    <input
                        type="number"
                        step="5"
                        min={MIN_TEMP_F}
                        max={MAX_TEMP_F}
                        value={tempF}
                        onChange={e => setTempF(clampTempF(e.target.value))}
                        placeholder={String(STANDARD_TEMP_F)}
                        className="form-input form-input w-20 text-right"
                        aria-label="Ambient temperature in °F"
                    />
                    <span className="text-sm text-meta">°F</span>
                    <span
                        className={`text-xs whitespace-nowrap ${densityAdjusted ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-meta'}`}
                        title="Combined air-density ratio (altitude × temperature) applied to the aerodynamic (C) term"
                    >
                        → ρ {densityRatio.toFixed(2)}{densityAdjusted ? ' ▲' : ''}
                    </span>
                </div>

                {/* Accessory load — viewing condition, applies to all curves */}
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium flex items-center" style={{ color: 'var(--color-text-secondary)' }}>
                        Accessory Load
                        <InfoIcon
                            tooltipClassName="info-icon-tooltip--wide"
                            position="right"
                            className="ml-1"
                        >
                            <AccessoryLoadReferenceTable />
                        </InfoIcon>
                    </span>
                    <input
                        type="number"
                        step="50"
                        min="0"
                        value={accessoryOverrideW}
                        onChange={e => setAccessoryOverrideW(e.target.value)}
                        placeholder={String(DEFAULT_ACCESSORY_W)}
                        className="form-input form-input w-24 text-right"
                        aria-label="Accessory load override in watts"
                    />
                    <span className="text-sm text-meta">W</span>
                </div>

                {/* Wind — viewing condition, applies to all curves */}
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium flex items-center" style={{ color: 'var(--color-text-secondary)' }}>
                        Wind
                        <InfoIcon
                            text="Scales aerodynamic drag by apparent (relative) airspeed — a headwind raises effective drag speed, a tailwind lowers it, a pure crosswind raises it slightly. Direction is relative to travel: 0°=tailwind, 180°=headwind, 90°/270°=crosswind. Models relative-airspeed magnitude only — does not capture yaw-angle sensitivity of drag coefficient."
                            position="right"
                            className="ml-1"
                        />
                    </span>
                    <input
                        type="number"
                        step="5"
                        min="0"
                        value={windSpeedMph}
                        onChange={e => setWindSpeedMph(e.target.value)}
                        placeholder="0"
                        className="form-input form-input w-16 text-right"
                        aria-label="Wind speed in mph"
                    />
                    <span className="text-sm text-meta">mph @</span>
                    <input
                        type="number"
                        step="15"
                        min="0"
                        max="360"
                        value={windDirectionDeg}
                        onChange={e => setWindDirectionDeg(clampWindDirection(e.target.value))}
                        placeholder="180"
                        className="form-input form-input w-16 text-right"
                        aria-label="Wind direction relative to travel, in degrees"
                    />
                    <span className="text-sm text-meta">°{windAdjusted ? ' ▲' : ''}</span>
                </div>

                {/* The elevation-gain disclosure. Turning it OFF clears the inputs
                    rather than only hiding them — a hidden adjustment that keeps
                    applying is the worst of both. */}
                <button
                    type="button"
                    className={`btn ${gradeExpanded ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setGradeExpanded(e => {
                        const next = !e;
                        if (!next) {
                            setGradeGainFt('');
                            setGradeDistanceMiles('');
                        }
                        return next;
                    })}
                    title="Adjust for a net elevation gain/loss over a route (advanced — usually 0)"
                >
                    Adj. Elevation
                </button>
            </div>

            {/* Elevation gain/loss panel — a route/grade effect (distinct from static
                altitude). Its own row, toggled by the "Adj. Elevation" button above, so
                opening/closing it never reflows the altitude/temp/wind row. */}
            {gradeExpanded && (
                <div className="chart-viewing-conditions">
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium flex items-center" style={{ color: 'var(--color-text-secondary)' }}>
                            Elevation Gain/Loss
                            <InfoIcon
                                text="Adds a fixed energy cost/credit for a net climb or descent over a given distance — a route effect, distinct from static altitude (air density). Climbing: full physics based on vehicle weight. Descending: only ~70% of the theoretical energy is assumed recovered via regen. Usually 0 — most tests are round trips or flat routes."
                                position="right"
                                className="ml-1"
                            />
                        </span>
                        <input
                            type="number"
                            step="50"
                            value={gradeGainFt}
                            onChange={e => setGradeGainFt(e.target.value)}
                            placeholder="0"
                            className="form-input form-input w-20 text-right"
                            aria-label="Net elevation gain in feet (negative for net descent)"
                        />
                        <span className="text-sm text-meta">ft over</span>
                        <input
                            type="number"
                            step="5"
                            min="0"
                            value={gradeDistanceMiles}
                            onChange={e => setGradeDistanceMiles(e.target.value)}
                            placeholder="0"
                            className="form-input form-input w-16 text-right"
                            aria-label="Distance in miles the elevation change is spread over"
                        />
                        <span className="text-sm text-meta">mi</span>
                        <span
                            className={`text-xs whitespace-nowrap ${gradeAdjusted ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-meta'}`}
                            title="Average grade over the distance above"
                        >
                            → {avgGradePercent.toFixed(1)}% grade{gradeAdjusted ? ' ▲' : ''}
                        </span>
                    </div>
                </div>
            )}

        </>
    );
}
