/**
 * A vehicle's measured range, reported with the conditions that produced it.
 *
 * No comparison to EPA, deliberately — see utils/testedRange for the argument.
 * The short version: one vehicle's default test is 70 mph at 72 °F and
 * another's is 65 mph at 34 °F, so a grid of percentages would invite exactly
 * the comparison those conditions forbid.
 *
 * A partial state-of-charge window is labelled as the distance it is, never
 * extrapolated to a range. The arithmetic would be trivial and the result would
 * be invented: consumption is not flat across a pack, and the tail below 20% is
 * where it stops being flat.
 */
import { distanceValue, distanceUnit, fmtSpeed, fmtTemp } from '../../utils/unitConversions';

export default function TestedFigure({ tested, units }) {
    if (!tested) return null;

    // The scaled figure when there is one, because that is what the EPA number
    // beside it can be compared to. The measured distance stays reachable in
    // the title — a derived figure must never hide the one it came from.
    const shown = tested.fullPackMi ?? tested.distanceMi;

    const conditions = [
        tested.speedMph != null ? fmtSpeed(tested.speedMph, units) : null,
        // A held 70 mph and a mixed cycle averaging 70 mph are different tests,
        // so the marker rides with the speed everywhere this site prints one.
        tested.speedNote,
        tested.temperatureF != null ? fmtTemp(tested.temperatureF, units) : null,
    ].filter(Boolean);

    return (
        <div className="tested-figure">
            <span className="text-micro">Tested</span>
            <span
                className="tested-figure-value"
                title={tested.isScaled
                    ? `${distanceValue(tested.distanceMi, units)} ${distanceUnit(units)} measured over ${tested.startSoc}→${tested.endSoc}%, scaled to a full pack`
                    : undefined}
            >
                {distanceValue(shown, units)}
                <span className="tested-figure-unit">{distanceUnit(units)}</span>
            </span>
            {/* Two different messages, because they are two different facts.
                A SCALED figure is derived and has to say so — the reader is
                looking at a number no odometer showed. An INADEQUATE window is
                a caveat: the test could not answer the question, and its raw
                distance is reported unscaled. */}
            {tested.isScaled && (
                <span
                    className="tested-figure-scaled"
                    title="Scaled to a full pack from the window measured, assuming consumption is flat across the pack"
                >
                    scaled from {tested.startSoc}→{tested.endSoc}%
                </span>
            )}
            {!tested.isRepresentative && tested.startSoc != null && (
                <span
                    className="tested-figure-window"
                    title="Window too narrow to characterise the pack — reported as measured, not scaled"
                >
                    {tested.startSoc}→{tested.endSoc}% only
                </span>
            )}
            {tested.startSoc == null && (
                <span className="tested-figure-window" title="The run does not record its state-of-charge window">
                    window not stated
                </span>
            )}
            {conditions.length > 0 && (
                <span className="tested-figure-conditions">{conditions.join(' · ')}</span>
            )}
        </div>
    );
}
