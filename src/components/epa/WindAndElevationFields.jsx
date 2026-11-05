import InfoIcon from '../InfoIcon';
import NumberInput from '../NumberInput';

/**
 * Modeled Efficiency's own two extras: wind, and net elevation gain/loss.
 *
 * Altitude, temperature and accessory load are the shared correction target
 * (CorrectionTargetFields), the same sliders every chart and the vehicle table
 * read (#449). What is left here has no counterpart in the correction: the
 * correction is for the days range TESTS were driven in, calm air on a round
 * trip, where this chart draws a modelled curve and a reader can ask what a
 * headwind or a climb would do to it. Both are DISPLAY-TIME scalings: they
 * change the curve on screen and never touch stored coefficients, accessory
 * fields, or the standard-condition η.
 *
 * The state and what is derived from it live in hooks/useViewingConditions.js,
 * shared by the vehicle-driven curves and the certification-anchored ones so
 * the two cannot compute air density slightly differently.
 *
 * Deliberately NOT included: the real-world test overlay. That plots a
 * VEHICLE's own range runs, and the certification view has no vehicle — the
 * whole point of it is that most records belong to none.
 */

export default function WindAndElevationFields({ conditions }) {
    const { values, set, derived } = conditions;
    const { windSpeedMph, windDirectionDeg, gradeExpanded, gradeGainFt, gradeDistanceMiles } = values;
    const { setWindSpeedMph, setWindDirectionDeg, setGradeExpanded, setGradeGainFt, setGradeDistanceMiles } = set;
    const { windAdjusted, gradeAdjusted, avgGradePercent } = derived;

    return (
        <>
            <div className="chart-viewing-conditions">
                {/* Wind — viewing condition, applies to all curves */}
                <div className="viewing-row">
                    <span className="viewing-label">
                        Wind
                        <InfoIcon
                            text="Scales aerodynamic drag by apparent (relative) airspeed — a headwind raises effective drag speed, a tailwind lowers it, a pure crosswind raises it slightly. Direction is relative to travel: 0°=tailwind, 180°=headwind, 90°/270°=crosswind. Models relative-airspeed magnitude only — does not capture yaw-angle sensitivity of drag coefficient."
                            className="ml-1" />
                    </span>
                    <NumberInput
                        step="5"
                        min={0}
                        allowEmpty
                        value={windSpeedMph === '' ? null : Number(windSpeedMph)}
                        onChange={v => setWindSpeedMph(v == null ? '' : String(v))}
                        placeholder="0"
                        className="form-input form-input w-16 text-right"
                        aria-label="Wind speed in mph"
                    />
                    <span className="viewing-unit">mph @</span>
                    <NumberInput
                        step="15"
                        min={0}
                        max={360}
                        allowEmpty
                        value={windDirectionDeg === '' ? null : Number(windDirectionDeg)}
                        onChange={v => setWindDirectionDeg(v == null ? '' : String(v))}
                        placeholder="180"
                        className="form-input form-input w-16 text-right"
                        aria-label="Wind direction relative to travel, in degrees"
                    />
                    <span className="viewing-unit">°{windAdjusted ? ' ▲' : ''}</span>
                </div>

                {/* The elevation-gain disclosure. Turning it OFF clears the inputs
                    rather than only hiding them — a hidden adjustment that keeps
                    applying is the worst of both. */}
            </div>

            {/* A disclosure, not a button. It reveals two fields rather than
                doing something, and as a filled primary button it read as an
                action — and as the only accent-colored control in the row, as
                the most important one. Orange when open, because an elevation
                adjustment IS changing the curve. */}
            {/* The glyph sits OUTSIDE the toggle, not inside it. A button
                inside a button is invalid HTML — but the reason to move it is
                older than that: clicking the ⓘ used to toggle the section,
                because the click reached the disclosure it was sitting in. */}
            <div className="subgroup-header-row">
                <button
                    type="button"
                    className={`subgroup-header${gradeExpanded ? ' is-open' : ''}`}
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
                    <span style={{ display: 'inline-block', transform: gradeExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>&#9660;</span>
                    Elevation gain / loss
                </button>
                <InfoIcon
                    text="Adds a fixed energy cost or credit for a net climb or descent over a given distance — a route effect, distinct from static altitude, which is air density. Climbing uses full physics from vehicle weight; descending assumes only ~70% of the theoretical energy comes back through regen. Usually 0 — most tests are round trips or flat routes." />
            </div>

            {/* Elevation gain/loss panel — a route/grade effect (distinct from static
                altitude). Its own row, toggled by the "Adj. Elevation" button above, so
                opening/closing it never reflows the altitude/temp/wind row. */}
            {gradeExpanded && (
                <div className="chart-viewing-conditions">
                    {/* The inputs read as the sentence they are — "gain N ft
                        over M mi" — rather than a label followed by two boxes.
                        The grade they imply is a RESULT, so it gets its own row
                        below rather than trailing the fields it is derived
                        from. */}
                    <div className="viewing-row">
                        <span className="viewing-label">Gain</span>
                        <NumberInput
                            step="50"
                            allowEmpty
                            value={gradeGainFt === '' ? null : Number(gradeGainFt)}
                            onChange={v => setGradeGainFt(v == null ? '' : String(v))}
                            placeholder="0"
                            className="form-input w-20 text-right"
                            aria-label="Net elevation gain in feet (negative for net descent)"
                        />
                        <span className="viewing-unit">ft over</span>
                        <NumberInput
                            step="5"
                            min={0}
                            allowEmpty
                            value={gradeDistanceMiles === '' ? null : Number(gradeDistanceMiles)}
                            onChange={v => setGradeDistanceMiles(v == null ? '' : String(v))}
                            placeholder="0"
                            className="form-input w-16 text-right"
                            aria-label="Distance in miles the elevation change is spread over"
                        />
                        <span className="viewing-unit">mi</span>
                    </div>
                    <div className="viewing-row">
                        <span className="viewing-label">Grade</span>
                        <span
                            className={`text-sm whitespace-nowrap ${gradeAdjusted ? 'viewing-derived is-active' : 'viewing-derived'}`}
                            title="Average grade over the distance above"
                        >
                            {avgGradePercent.toFixed(1)}%{gradeAdjusted ? ' ▲' : ''}
                        </span>
                    </div>
                </div>
            )}

        </>
    );
}
