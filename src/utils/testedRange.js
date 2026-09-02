/**
 * The one measured range figure a vehicle card can honestly show.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * It does not compare the figure to EPA. The design handoff's card carried a
 * `RANGE · TESTED vs EPA  −8.5%` row, and that number cannot go on the front
 * page of this site:
 *
 *   1. It is not comparable card to card. One vehicle's default range test is
 *      70 mph at 72 °F, another's is 65 mph at 34 °F, and a grid of percentages
 *      invites exactly the comparison those conditions forbid. The whole
 *      condition-correction subsystem exists because raw figures are not
 *      comparable.
 *   2. It is an editorial claim. The same handoff argues that best-in-row must
 *      default OFF because marking a winner "would assert an editorial position
 *      the data doesn't support" — a headline percentage on every card is that
 *      assertion promoted to the home screen.
 *   3. The correction that would earn it is not ratified: AERO_FRACTION is
 *      still an unsettled constant.
 *
 * So the figure is reported WITH the conditions that produced it, and the
 * reader draws the conclusion. That is the difference between publishing a
 * measurement and publishing a verdict.
 *
 * ── The SoC window ──────────────────────────────────────────────────────────
 *
 * `distance_miles` is the distance covered over the run's OWN state-of-charge
 * window, not the vehicle's range. A test from 100% to 0% reports both; a test
 * from 90% to 20% reports a distance that is not a range and must never be
 * labelled as one. Rather than extrapolate — which would invent precision the
 * test does not have — a partial window is reported as what it is, and the
 * window travels with the number.
 */
import { defaultRangeRun } from './rangeSource';
import { speedBasisNote } from './unitConversions';

/**
 * How much of the pack a run actually covered, as a percentage, or null when
 * the run does not say.
 */
export function socWindow(run) {
    const start = run?.start_soc;
    const end = run?.end_soc;
    if (start == null || end == null) return null;
    const span = Math.abs(start - end);
    return span > 0 ? span : null;
}

/**
 * A window this wide or wider is reported as a range; anything narrower is
 * reported as a distance over its window.
 *
 * 95 rather than 100 because a real full-pack test rarely ends at a clean zero
 * — a car driven to shutdown reports 3% as often as 0% — and treating 97→2 as
 * "not a range" would discard the best tests in the corpus on a technicality.
 */
export const FULL_WINDOW_MIN_PCT = 95;

/**
 * Which run the CARD should report, which is not always the vehicle's default.
 *
 * `defaultRangeRun` resolves to the most recent usable test, because `is_default`
 * is still scoped to charging runs. Newest is the right rule for a chart series,
 * where the reader picked the run. It is the wrong one for a summary: a vehicle
 * whose latest test covered 56→10% would show 99 mi beside a 327 mi EPA figure,
 * and a reader glancing at a grid of cards reads that as a catastrophic result
 * rather than as a partial window — even with the window printed beside it.
 *
 * So a full-pack test wins over a newer partial one, and among full-pack tests
 * the newest wins. The fallback is the default run, partial window and all: some
 * evidence, correctly qualified, beats none.
 */
function cardRangeRun(vehicle) {
    const full = (vehicle?.runs || [])
        .filter(r => r.distance_miles > 0)
        .filter(r => {
            const w = socWindow(r);
            return w != null && w >= FULL_WINDOW_MIN_PCT;
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    return full[0] ?? defaultRangeRun(vehicle);
}

/**
 * The card's tested-range line, or null when the vehicle has no usable range
 * test.
 *
 * @returns {{
 *   run: object, distanceMi: number, isFullWindow: boolean, windowPct: number|null,
 *   startSoc: number|null, endSoc: number|null,
 *   speedMph: number|null, temperatureF: number|null, speedNote: string|null,
 * }|null}
 */
export function testedRangeSummary(vehicle) {
    const run = cardRangeRun(vehicle);
    if (!run) return null;

    const distanceMi = run.distance_miles;
    if (distanceMi == null || !(distanceMi > 0)) return null;

    const windowPct = socWindow(run);

    return {
        run,
        distanceMi,
        // A missing window is NOT treated as full. An unstated window is an
        // unknown one, and calling it a range would be the same invention this
        // module exists to avoid.
        isFullWindow: windowPct != null && windowPct >= FULL_WINDOW_MIN_PCT,
        windowPct,
        startSoc: run.start_soc ?? null,
        endSoc: run.end_soc ?? null,
        speedMph: run.speed_mph ?? null,
        temperatureF: run.temperature_f ?? null,
        // A held 70 mph and a mixed cycle averaging 70 mph are different tests.
        // Wherever this site prints a test speed it prints this beside it.
        speedNote: speedBasisNote(run),
    };
}
