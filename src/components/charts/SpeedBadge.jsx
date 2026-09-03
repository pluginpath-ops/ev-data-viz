/**
 * A run's test speed, carrying its own basis.
 *
 * A held 70 mph and a mixed cycle averaging 70 mph are different tests, and the
 * second is not directly comparable to the first — speed correction is skipped
 * for it. That caveat used to be a SEPARATE chip reading "mixed cycle" beside
 * the speed, which is where the trouble was: it broke the rhythm of a row of
 * short readings, and it sat next to the figure it qualifies rather than on it.
 *
 * Here the qualification is the figure's own styling plus a dagger. Not colour
 * alone — a marker that only exists as a hue is invisible to a reader who
 * cannot see the hue, and this project already picks colourblind-safe series
 * palettes for exactly that reason.
 *
 * One component because three views print a test speed, and the wiring suite
 * asserts the marker travels with it wherever it appears. Keeping the pair in
 * one place is what makes that true by construction rather than by everyone
 * remembering.
 */
import { fmtSpeed, speedBasisNote } from '../../utils/unitConversions';

export default function SpeedBadge({ run, units }) {
    if (run?.speed_mph == null) return null;
    const basis = speedBasisNote(run);

    return (
        <span
            className={`badge-micro${basis ? ' is-qualified' : ''}`}
            title={basis
                ? `Average over a varying-speed cycle, not a held speed. Not directly comparable to a steady-state test; speed correction is skipped.`
                : `Held speed`}
        >
            {fmtSpeed(run.speed_mph, units)}{basis ? ' †' : ''}
        </span>
    );
}
