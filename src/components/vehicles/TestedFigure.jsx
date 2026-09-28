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
import { rangeTestReference, testHref } from '../../utils/testDetails';
import Popover from '../Popover';
import TestPeek from '../TestPeek';

/**
 * Hovering the figure restates its test (TestPeek) — which one, why, and its
 * conditions — and its conditions line links to it in Tests & Data, as a
 * tested cell of the vehicle table does. `onOpenTest` opens it in place; a
 * modified click is the browser's, so a new tab works.
 */
export default function TestedFigure({ vehicle, tested, units, onOpenTest, bare = false }) {
    if (!tested) return null;
    const test = vehicle ? rangeTestReference(vehicle, tested, units) : null;
    const href = testHref(test);

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

    const open = (e) => {
        // The card behind this selects its vehicle on click; opening a test must not.
        e.stopPropagation();
        if (!onOpenTest || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpenTest(test);
    };

    const figure = (props = {}) => (
        <div className="tested-figure" {...props}>
            {/* A list column's header already says Tested (#338). */}
            {!bare && <span className="text-micro">Tested</span>}
            <span className="tested-figure-value">
                {distanceValue(shown, units)}
                <span className="tested-figure-unit">{distanceUnit(units)}</span>
            </span>
            {/* Two different messages, because they are two different facts.
                A SCALED figure is derived and has to say so — the reader is
                looking at a number no odometer showed. An INADEQUATE window is
                a caveat: the test could not answer the question, and its raw
                distance is reported unscaled. */}
            {/* What each caveat means in full is in the peek (TestPeek). */}
            {tested.isScaled && (
                <span className="tested-figure-scaled">
                    scaled from {tested.startSoc}→{tested.endSoc}%
                </span>
            )}
            {!tested.isRepresentative && tested.startSoc != null && (
                <span className="tested-figure-window">
                    {tested.startSoc}→{tested.endSoc}% only
                </span>
            )}
            {tested.startSoc == null && (
                <span className="tested-figure-window">
                    window not stated
                </span>
            )}
            {conditions.length > 0 && (href
                ? <a className="tested-figure-conditions is-test-link" href={href} onClick={open}>{conditions.join(' · ')}</a>
                : <span className="tested-figure-conditions">{conditions.join(' · ')}</span>
            )}
        </div>
    );

    if (!test) return figure();
    return (
        <Popover
            peek={<TestPeek test={test} />}
            // Only the hover gloss: the link opens the test, so there is no
            // panel for a click to open. On touch, with no hover, the link is
            // the way in.
            trigger={({ ref, onPointerEnter, onPointerLeave, onFocus, onBlur, ...aria }) => figure({
                ref, onPointerEnter, onPointerLeave, onFocus, onBlur,
                'aria-describedby': aria['aria-describedby'],
            })}
        />
    );
}
