/**
 * When a group holds more than one multi-cycle test, which one did EPA use?
 *
 * `preferredMctTest` defaults to the most recent, and its own comment is honest
 * that this is "a defensible default and NOT a resolution" — which run
 * represents the vehicle was a curator's judgement, because nothing in the
 * record settles it.
 *
 * A linked Fuel Economy Guide row settles it. EPA published one pair of
 * unadjusted figures, those came from a test, and we hold the tests. Comparing
 * each against the published figure turns the judgement into a measurement.
 *
 * Mercedes' MY2027 CLA 350 is the case: two runs a month apart, and the default
 * picks the WRONG one.
 *
 *   TMBX10091675 (Jul 22)   highway 168.66 MPGe   published 168.7   -0.03%
 *   TMBX10092210 (Aug 19)   highway 173.18 MPGe                     +2.66%
 *
 * ── Why highway, and not city ───────────────────────────────────────────────
 *
 * Highway is where our derivation is exact: the HWY phases give the consumption
 * rate directly, and the result reproduces EPA's published figure to four
 * decimals on the Volvo EX90 and to 0.03% here. City goes through J1634's
 * weighting of the UDDS phases, which we do not reproduce exactly — on this car
 * EPA's implied city rate sits near the AVERAGE of the two tests rather than on
 * either, so city cannot separate them at all.
 *
 * ── Why the comparison is a ratio against two targets ───────────────────────
 *
 * The obvious test — whichever derived figure is numerically closest — picks the
 * wrong run, because the two sides are not always on the same basis. Our
 * derivation is wall-side. Volvo's published figures are too, so the ratio lands
 * on 1.0. Mercedes' are battery-side, so it lands on that test's charging
 * efficiency instead. Absolute distance then favours whichever test happens to
 * sit nearer the published number for reasons that have nothing to do with which
 * test was used:
 *
 *   test 1  ratio 0.8952   its own charging efficiency 0.8954   ->  0.0002 off
 *   test 2  ratio 0.9253   its own charging efficiency 0.9013   ->  0.0240 off
 *
 * So each test is scored against BOTH targets it could legitimately hit — 1.0 if
 * the label is wall-side, its own charging efficiency if battery-side — and
 * keeps the better. That is basis-agnostic without having to decide the basis
 * first, and the right test wins by two orders of magnitude.
 *
 * ── The range fallback ──────────────────────────────────────────────────────
 *
 * Range sidesteps the basis question entirely: it is energy over rate, so the
 * factor cancels and a wall-side and a battery-side derivation give the same
 * 450.56 miles. Tempting to use it throughout — but it cancels the WALL ENERGY
 * to do that, which is the one quantity the unadjusted-MPGe comparison exists to
 * test, so it is a weaker signal and not a replacement.
 *
 * It earns its place where the primary cannot score at all: a guide row with no
 * unadjusted MPGe. There the alternative is not a weaker answer but no answer.
 * See scoreAgainstGuideRanges for how it discriminates, and why it is held to a
 * stricter margin.
 *
 * Pure module: no data access, no React.
 */

import { PROC_MCT, kwh100miToMpge } from './epaDerivations';
import { ADJUSTMENT_PLAUSIBLE_MIN, ADJUSTMENT_PLAUSIBLE_MAX } from './epaMethodology';

const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Only a test that could have produced a published figure is a candidate. */
const mctsOf = (tests = []) => tests.filter(t => num(t.procedure_code) === PROC_MCT);

/**
 * The test used when nothing has selected one: the most recent, falling back to
 * test number and then to position.
 *
 * Lives here rather than inside epaRecordFromGroup because two places need the
 * same answer — the derivation, and the curator picker that has to say which
 * row "Automatic" would land on. A second copy of a tie-break is how the label
 * and the behaviour drift apart.
 *
 * Deterministic on purpose: an arbitrary pick that changes between loads is
 * worse than a wrong one that holds still.
 */
export function defaultMctTest(tests = []) {
    const mcts = mctsOf(tests);
    if (mcts.length <= 1) return mcts[0] ?? null;
    return [...mcts].sort((a, b) => {
        const date = String(b.test_date ?? '').localeCompare(String(a.test_date ?? ''));
        if (date !== 0) return date;
        return (num(b.test_number) ?? 0) - (num(a.test_number) ?? 0);
    })[0];
}

/** Wall-side highway unadjusted MPGe for one test, from its own phases. */
export function highwayUnadjustedMpge(test) {
    const phases = (test?.epa_test_phases ?? test?.phases ?? [])
        .filter(p => p.phase_type === 'HWY');
    let dc = 0, dist = 0;
    for (const p of phases) {
        const e = num(p.dc_energy_kwh), d = num(p.distance_mi);
        if (e == null || d == null || d <= 0) continue;
        dc += e; dist += d;
    }
    if (dist <= 0) return null;

    const chargeEff = chargeEfficiencyOf(test);
    if (chargeEff == null) return null;

    const dcRate = (dc / dist) * 100;          // kWh/100mi at the battery
    return kwh100miToMpge(dcRate / chargeEff); // at the wall, which is how MPGe is defined
}

/** This test's measured charging efficiency, or null when it cannot be measured. */
export function chargeEfficiencyOf(test) {
    const dc = num(test?.total_dc_energy_kwh);
    const ac = num(test?.ac_recharge_kwh);
    if (!(dc > 0) || !(ac > 0)) return null;
    const eff = dc / ac;
    return eff > 0 && eff <= 1 ? eff : null;
}

/**
 * How far this test sits from having produced the published figure.
 *
 * Lower is better; null when the test cannot be scored at all. See the header
 * for why the score is a ratio measured against two admissible targets rather
 * than a plain difference.
 */
export function scoreAgainstGuide(test, publishedHwyMpge) {
    const pub = num(publishedHwyMpge);
    const ours = highwayUnadjustedMpge(test);
    if (!(pub > 0) || !(ours > 0)) return null;

    const ratio = ours / pub;
    const eff = chargeEfficiencyOf(test);
    const wallSide = Math.abs(ratio - 1);
    const batterySide = eff == null ? Infinity : Math.abs(ratio - eff);
    return Math.min(wallSide, batterySide);
}

/**
 * How much better the winner is than the runner-up, as a plain ratio.
 *
 * A selection is only worth persisting when it was not a coin toss. Two runs of
 * the same vehicle at the same laboratory can be near-identical, and picking
 * between those on the fourth decimal is arbitrary dressed as a measurement —
 * so a weak margin declines and the most-recent default stands.
 */
export const SELECTION_MIN_MARGIN = 2;

/** Below this the winner is not credible on its own terms, whatever the margin. */
export const SELECTION_MAX_SCORE = 0.05;

/**
 * The same guard for the range fallback, and deliberately stricter.
 *
 * The range signal is blunter — 2.6x on the CLA 350 where the MPGe signal gives
 * 122x — because published ranges are whole miles. On that car ±0.5 mi puts
 * ±0.0011 on each implied factor, which is around half the spread being
 * measured. A margin that would be comfortable on the primary signal is inside
 * the noise here.
 */
export const RANGE_SELECTION_MIN_MARGIN = 2.5;

/**
 * How far this test sits from the published LABEL RANGES.
 *
 * The fallback, for guide rows carrying no unadjusted MPGe — where the primary
 * signal cannot score at all and selection would otherwise decline outright.
 *
 * Range is basis-invariant, which is the appeal: range is energy over rate, and
 * a wall-side and a battery-side derivation give the identical figure — 450.56
 * miles either way on the CLA 350. So this needs no two-target trick.
 *
 * What it costs is the adjustment factor. EPA publishes ADJUSTED ranges, and to
 * compare one against an unadjusted range you need the factor, which this row
 * does not carry either. So the discriminator is not a distance but a
 * CONSISTENCY: measured across 112 guide rows with a genuine non-0.700 factor
 * and unrounded figures, EPA applies ONE factor per configuration — median
 * difference between the city and highway factors 0.00000, largest 0.008. So
 * the right test is the one whose two implied factors agree.
 *
 *   test 1   city 315/461.373 = 0.6828   hwy 309/450.544 = 0.6858   spread 0.0031
 *   test 2   city 315/475.482 = 0.6625   hwy 309/460.354 = 0.6712   spread 0.0087
 *
 * Gated on both factors being plausible at all, because two absurd factors can
 * agree with each other perfectly.
 *
 * Uses the per-test ranges added in migration 060. Before those, every test in a
 * group carried the group's single pair and this could not discriminate at all.
 */
export function scoreAgainstGuideRanges(test, published = {}) {
    const cityUnadj = num(test?.cd_range_combined_calc);
    const hwyUnadj  = num(test?.cd_range_hwy_calc);
    const cityLabel = num(published.labelCityRangeMi);
    const hwyLabel  = num(published.labelHwyRangeMi);
    if (!(cityUnadj > 0) || !(hwyUnadj > 0) || !(cityLabel > 0) || !(hwyLabel > 0)) return null;

    const cityFactor = cityLabel / cityUnadj;
    const hwyFactor  = hwyLabel / hwyUnadj;
    const plausible = (f) => f >= ADJUSTMENT_PLAUSIBLE_MIN && f <= ADJUSTMENT_PLAUSIBLE_MAX;
    if (!plausible(cityFactor) || !plausible(hwyFactor)) return null;

    return Math.abs(cityFactor - hwyFactor);
}

/**
 * The test that best explains the published highway figure.
 *
 * @returns {{ test, testNumber, score, runnerUpScore, margin, reason }}
 *   `test` is null when nothing was selected, and `reason` says why — so a
 *   caller can record that a choice was declined rather than never attempted.
 */
export function selectTestForGuide(tests, published) {
    // A bare number is the primary signal on its own, which is how the first
    // version was called and how most callers still think about it.
    const pub = typeof published === 'number' || published == null
        ? { unadjHwyMpge: published }
        : published;

    const mcts = mctsOf(tests);
    if (!mcts.length) return declined('no-mct');
    // One test is not a choice. Recording a selection here would dress the only
    // option up as a measurement.
    if (mcts.length === 1) return declined('single-test');

    // Primary: the published unadjusted highway figure, which our derivation
    // reproduces exactly when it has the right test.
    const byMpge = rank(mcts, t => scoreAgainstGuide(t, pub.unadjHwyMpge));
    if (byMpge.length >= 2) {
        return decide(byMpge, SELECTION_MIN_MARGIN, 'unadjusted-mpge');
    }

    // Fallback: the published label ranges. Blunter, and only reached when the
    // guide row carries no unadjusted MPGe at all — where the alternative is
    // not a weaker answer but no answer.
    const byRange = rank(mcts, t => scoreAgainstGuideRanges(t, pub));
    if (byRange.length >= 2) {
        return decide(byRange, RANGE_SELECTION_MIN_MARGIN, 'label-range');
    }

    return declined(byMpge.length || byRange.length ? 'only-one-scorable' : 'not-scorable');
}

/** Score every candidate, drop the unscorable, best first. */
function rank(tests, scorer) {
    return tests
        .map(test => ({ test, score: scorer(test) }))
        .filter(x => x.score != null)
        .sort((a, b) => a.score - b.score);
}

/** Apply the guards a scored ranking has to clear before it becomes a choice. */
function decide(scored, minMargin, signal) {
    const [best, next] = scored;
    if (signal === 'unadjusted-mpge' && best.score > SELECTION_MAX_SCORE) {
        return declined('no-close-match', { signal });
    }
    // Guard the divide: an exact match scores 0, and 0 beats anything.
    const margin = best.score > 0 ? next.score / best.score : Infinity;
    if (margin < minMargin) return declined('too-close-to-call', { margin, signal });

    return {
        test: best.test,
        testNumber: best.test.test_number ?? null,
        score: best.score,
        runnerUpScore: next.score,
        margin,
        // Which evidence decided it. A selection made on the fallback rests on
        // whole-mile published ranges and deserves to be read as weaker.
        signal,
        reason: null,
    };
}

function declined(reason, extra = {}) {
    return { test: null, testNumber: null, score: null, runnerUpScore: null,
        margin: null, signal: null, reason, ...extra };
}
