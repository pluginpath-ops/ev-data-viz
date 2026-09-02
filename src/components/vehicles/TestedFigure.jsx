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
            <span className="tested-figure-value">
                {distanceValue(tested.distanceMi, units)}
                <span className="tested-figure-unit">{distanceUnit(units)}</span>
            </span>
            {!tested.isFullWindow && (
                <span className="tested-figure-window" title="Distance over a partial state-of-charge window — not a full-pack range">
                    {tested.startSoc != null
                        ? `${tested.startSoc}→${tested.endSoc}% only`
                        : 'window not stated'}
                </span>
            )}
            {conditions.length > 0 && (
                <span className="tested-figure-conditions">{conditions.join(' · ')}</span>
            )}
        </div>
    );
}
