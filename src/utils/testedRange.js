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
 * ── The SoC window, and scaling ─────────────────────────────────────────────
 *
 * `distance_miles` is the distance covered over the run's OWN state-of-charge
 * window, not the vehicle's range. A test from 100% to 0% reports both; a test
 * over 80→10% reports 70% of a pack — and the EPA figure sitting beside it on
 * the same card is a full-pack number, so the two are not comparable as they
 * stand.
 *
 * So an adequately characterised window IS scaled to 100%, and the figure is
 * marked as scaled wherever it is shown. That is a deliberate trade and it
 * should be named: scaling assumes consumption is FLAT across the pack, which
 * it is not exactly. The error is small over a wide window and grows as the
 * window narrows, which is precisely why scaling is gated on
 * `coversPracticalPack` rather than applied to anything with two SoC readings.
 *
 * A window too narrow to characterise the pack is NOT scaled. Multiplying a
 * 56→10% test by 2.17 would not be a measurement with a caveat, it would be a
 * guess with a decimal point. Those are reported as measured, with the window
 * named, and the reader is told the test cannot answer the question.
 */
import { defaultRangeRun, miPerKwhFrom } from './rangeSource';
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
 * What counts as an adequately characterised test.
 *
 * ANCHORED AT BOTH ENDS, rather than a minimum span, and the difference
 * matters. A bare span cannot tell 100→15 (stopped a little early, 85 points)
 * from 90→20 (missed the top AND the bottom of the pack, 70 points) from 56→10
 * (only ever saw the middle, 46 points). Anchoring says what the test actually
 * has to have seen: the top of the pack, and the bottom of the usable range.
 *
 * The corpus arrives in three shapes, and the rule is drawn to sort them:
 *
 *   · 100→0, or at least to single digits — the full tests
 *   · the "10% challenge" — driven down to 10% from wherever the car happened
 *     to be, so the START is whatever it was, often well under 80
 *   · one-off tests at assorted speeds, with no consistent window at all
 *
 * 80→10 is the practical driving band and characterises a vehicle adequately.
 * 56→10 saw half a pack. Both end at 10; only one is a test you can report a
 * figure from — which is why the START bound is the one doing the real work.
 *
 * See WIDE_SPAN_MIN_PCT below for the second clause, and why anchoring alone is
 * not enough.
 */
export const WINDOW_START_MIN_PCT = 80;
export const WINDOW_END_MAX_PCT = 10;

/**
 * The second way a test can be adequate: it simply saw most of the pack.
 *
 * Anchoring alone rejects 100→15 — a real shape in the corpus, 85 points of
 * coverage including the entire top of the pack, where most driving happens —
 * while accepting 80→10 at 70 points. That is the wrong way round, and the
 * cause is that anchoring answers "did it see the right PARTS" and says nothing
 * about "did it see ENOUGH". Both questions are worth asking, so both are.
 *
 * 85 rather than 80, so that 90→20 — anchored at neither end and the weakest of
 * the four shapes — still fails on both counts.
 */
export const WIDE_SPAN_MIN_PCT = 85;

/**
 * A window this wide is near enough to a full pack that its distance IS the
 * vehicle's range, rather than a distance over part of one.
 *
 * 95 rather than 100 because a real full-pack test rarely ends at a clean zero
 * — a car driven to shutdown reports 3% as often as 0% — and treating 97→2 as
 * "not a range" would discard the best tests in the corpus on a technicality.
 */
export const FULL_WINDOW_MIN_PCT = 95;

/**
 * Did this run see the top of the pack and the bottom of the usable range?
 *
 * Direction-agnostic: a range test discharges, but nothing stops a row storing
 * its window either way round, and a rule that silently inverted would be worse
 * than one that errs.
 */
export function coversPracticalPack(run) {
    const a = run?.start_soc;
    const b = run?.end_soc;
    if (a == null || b == null) return false;
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);

    // Did it see the right parts of the pack?
    const anchored = hi >= WINDOW_START_MIN_PCT && lo <= WINDOW_END_MAX_PCT;
    // Or, failing that, did it simply see enough of it?
    const wide = (hi - lo) >= WIDE_SPAN_MIN_PCT;
    return anchored || wide;
}

/**
 * The range test a vehicle's tested figures come from — on its card, and in
 * the vehicle table's Tested range and Tested efficiency columns (#335). One
 * rule for both, so the card and the table never show two different tests.
 *
 *   1. the curator's default range test. `is_default` is scoped per kind
 *      (migrations 046, 049/050), so this is a deliberate choice for range,
 *      independent of the charging default. Choosing it is the curator saying
 *      "these are the conditions to report", and it wins even over a newer
 *      full-pack test.
 *   2. the newest full-pack test
 *   3. the newest adequately characterised one (coversPracticalPack)
 *   4. whatever defaultRangeRun resolves to — the newest usable test, partial
 *      window and all: some evidence, correctly qualified, beats none.
 *
 * Without a curated default, a full-pack test beats a newer partial one. Newest
 * is the right rule for a chart series, where the reader picked the run; it is
 * the wrong one for a summary. A vehicle whose latest test covered 56→10% would
 * show 99 mi beside a 327 mi EPA figure, and a reader glancing down a column
 * reads that as a catastrophic result rather than as a partial window.
 */
export function reportedRangeRun(vehicle) {
    return reportedRangeChoice(vehicle).run;
}

/** Why the reported range test was the one chosen, as a reader is told it. */
export const REPORTED_RANGE_REASON = {
    default:        'The curator’s default range test',
    'full-pack':    'The newest full-pack test',
    representative: 'The newest test that saw most of the pack',
    newest:         'The newest test — none saw enough of the pack to report a range',
};

/** reportedRangeRun, with which rule chose it (a key of REPORTED_RANGE_REASON). */
export function reportedRangeChoice(vehicle) {
    const usable = (vehicle?.runs || []).filter(r => r.distance_miles > 0);
    const curated = usable.find(r => r.isDefault || r.is_default);
    if (curated) return { run: curated, reason: 'default' };
    const byNewest = (a, b) => new Date(b.date) - new Date(a.date);
    const fullPack = usable
        .filter(r => { const w = socWindow(r); return w != null && w >= FULL_WINDOW_MIN_PCT; })
        .sort(byNewest);
    if (fullPack[0]) return { run: fullPack[0], reason: 'full-pack' };
    const representative = usable.filter(coversPracticalPack).sort(byNewest);
    if (representative[0]) return { run: representative[0], reason: 'representative' };
    const fallback = defaultRangeRun(vehicle);
    return { run: fallback, reason: fallback ? 'newest' : null };
}

/**
 * The card's tested-range line, or null when the vehicle has no usable range
 * test.
 *
 * @returns {{
 *   run: object, distanceMi: number, fullPackMi: number|null, isScaled: boolean,
 *   isRepresentative: boolean, isFullPack: boolean, windowPct: number|null,
 *   startSoc: number|null, endSoc: number|null,
 *   speedMph: number|null, temperatureF: number|null, speedNote: string|null,
 * }|null}
 */
export function testedRangeSummary(vehicle) {
    const { run, reason } = reportedRangeChoice(vehicle);
    if (!run) return null;

    const distanceMi = run.distance_miles;
    if (distanceMi == null || !(distanceMi > 0)) return null;

    const windowPct = socWindow(run);
    const isRepresentative = coversPracticalPack(run);

    // Linear in state of charge. See the header: the assumption is why this is
    // gated on an adequate window rather than applied to any two SoC readings.
    const fullPackMi = isRepresentative && windowPct
        ? Math.round((distanceMi * 100 / windowPct) * 10) / 10
        : null;
    // Half a mile, so a 97→2 test is not annotated for a rounding difference
    // while a 100→15 one is.
    const isScaled = fullPackMi != null && Math.abs(fullPackMi - distanceMi) >= 0.5;

    return {
        run,
        reason,
        distanceMi,
        // Two separate questions, and conflating them is what the old single
        // threshold did:
        //   isRepresentative — did the test see enough of the pack to be worth
        //     reporting at all?
        //   isFullPack — is its distance the vehicle's RANGE, or a distance
        //     over part of one?
        // An 80→10 test is the first and not the second.
        //
        // A missing window is neither. An unstated window is an unknown one,
        // and treating it as adequate would be the same invention this module
        // exists to avoid.
        isRepresentative,
        isFullPack: windowPct != null && windowPct >= FULL_WINDOW_MIN_PCT,
        // Scaled to a full pack, so the figure is comparable to the EPA number
        // beside it. Null when the window is unknown or too narrow to scale
        // from — see the header for why that gate exists.
        fullPackMi,
        isScaled,
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

/**
 * The vehicle's tested efficiency, from the same test its tested range comes
 * from (reportedRangeRun), or null.
 *
 * Measured energy first; without it, the SoC window priced at the vehicle's
 * capacity, which is an estimate and says so (`estimated`). Unlike a range, an
 * efficiency needs no full pack — miles per kWh over 56→10% is still miles per
 * kWh — so a narrow window is reported, with the window named.
 *
 * @returns {{ run, miPerKwh: number, estimated: boolean, windowPct: number|null,
 *             isRepresentative: boolean, startSoc, endSoc, speedMph, temperatureF,
 *             speedNote: string|null }|null}
 */
export function testedEfficiency(vehicle) {
    const { run, reason } = reportedRangeChoice(vehicle);
    if (!run) return null;
    const { miPerKwh, method } = miPerKwhFrom(run, vehicle?.socWindowKwh);
    if (!(miPerKwh > 0) || !Number.isFinite(miPerKwh)) return null;
    return {
        run,
        reason,
        miPerKwh,
        estimated: method === 'soc-delta-estimate',
        windowPct: socWindow(run),
        isRepresentative: coversPracticalPack(run),
        startSoc: run.start_soc ?? null,
        endSoc: run.end_soc ?? null,
        speedMph: run.speed_mph ?? null,
        temperatureF: run.temperature_f ?? null,
        speedNote: speedBasisNote(run),
    };
}
