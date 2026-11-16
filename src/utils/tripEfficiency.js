/**
 * The efficiency a road trip is driven on: a measured figure, priced at the
 * trip's travel speed.
 *
 * One path, through the correction model (conditionCorrection.js), whatever
 * the reader corrects for:
 *
 *   - Correction on: the reader's mode and correction target, with the TRAVEL
 *     speed as the target speed. The figure goes from the test's conditions to
 *     the trip's in one step, so the accessory load is priced per mile at the
 *     speed actually driven.
 *   - Correction off: SPEED_ONLY_MODE. Every other condition stays as tested,
 *     but a trip cannot leave its speed as tested.
 *   - Towing: SPEED_ONLY_MODE too, at the towing aero fraction, from the speed
 *     the reader says the towing efficiency was measured at.
 *
 * It used to be two speed models. rangeSource corrected the figure to the
 * correction target's speed, then the simulation re-priced it to the travel
 * speed with its own aero-only factor, which composed for aero drag but not
 * for the accessory load or air density, so a speed meaningless to a trip
 * moved its answer by 1–2%. #511 corrected straight to the travel speed,
 * leaving the simulation's factor a no-op when corrected and the only pricing
 * when not, and for towing. Now the simulation prices no speed at all, and
 * the correction target speed is never read.
 *
 * A trip basis is { miPerKwh, conditions, aeroFraction?, speedOnly? }: the
 * figure as measured, what it was measured in, and whether only its speed may
 * be re-priced.
 *
 * Pure module — no React.
 */
import { TOWING_AERO_FRACTION, AERO_FRACTION, STANDARD_CONDITIONS } from '../constants/epa';
import { correctionFactor, runConditions, SPEED_ONLY_MODE } from './conditionCorrection';

/** A range test as a trip basis: its uncorrected efficiency and its conditions. */
export const rangeTestBasis = (miPerKwh, run, session = null) =>
    (miPerKwh > 0 ? { miPerKwh, conditions: runConditions(run, session) } : null);

/**
 * A resolved range source (rangeSource.resolveRangeSource, resolved with no
 * correction) as a trip basis. EPA rated range is re-priced for speed only:
 * the correction never applies to it (it is a label figure, not a test with
 * conditions), and it records no speed, so it stands at the assumed test speed.
 */
export function sourceBasis(src, session = null) {
    if (!(src?.miPerKwh > 0)) return null;
    if (src.source === 'epa') return { miPerKwh: src.miPerKwh, conditions: {}, speedOnly: true };
    return rangeTestBasis(src.miPerKwh, src.sourceRun, session);
}

/** The reader's towing efficiency, measured at `refSpeedMph`, as a trip basis. */
export const towingBasis = (miPerKwh, refSpeedMph) => ({
    miPerKwh,
    conditions: { speedMph: refSpeedMph },
    aeroFraction: TOWING_AERO_FRACTION,
    speedOnly: true,
});

/**
 * A basis priced at a travel speed.
 *
 * A mixed cycle is the one case that takes a second look. The correction skips
 * its speed, because its mean speed understates the mean of v² and so
 * over-penalises it on the way to a faster target. That is right for comparing
 * tests at one target, but it would leave a trip unpriced for speed: an EPA
 * cycle would read the same at 55 and 85 mph. So the trip re-prices it from
 * its mean speed anyway, as Road Trip always has, knowing that it reads a fast
 * trip a little pessimistically.
 *
 * @param {Object} basis       see the module comment
 * @param {number} travelMph
 * @param {Object} [correction]  { mode, target }: the reader's setting
 * @returns {{ miPerKwh: number, factor: number, correction: Object }}
 *   `factor` multiplies the measured efficiency (> 1 better); `correction`
 *   is correctionFactor's result, for a note
 */
export function efficiencyAtSpeed(basis, travelMph, { mode = 'none', target = STANDARD_CONDITIONS } = {}) {
    const aeroFraction = basis.aeroFraction ?? AERO_FRACTION;
    const speedOnly = basis.speedOnly || !mode || mode === 'none';
    // Speed alone is priced in the reference air, as the simulation's own
    // factor always was. Leaving altitude and temperature out of the target
    // keeps both sides' air at the reference, not the reader's hidden target.
    const speedTarget = { speedMph: travelMph };
    const c = correctionFactor(basis.conditions ?? {}, {
        mode: speedOnly ? SPEED_ONLY_MODE : mode,
        target: speedOnly ? speedTarget : { ...(target ?? STANDARD_CONDITIONS), speedMph: travelMph },
        aeroFraction,
    });
    let factor = c.factor;
    if (c.skipped.some(s => s.axis === 'speed')) {
        const held = { speedMph: basis.conditions.speedMph };
        factor *= correctionFactor(held, { mode: SPEED_ONLY_MODE, target: speedTarget, aeroFraction }).factor;
    }
    return { miPerKwh: basis.miPerKwh * factor, factor, correction: c };
}
