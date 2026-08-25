/**
 * Turning a stored EPA test group into a methodology record (#222).
 *
 * `buildMethodologyModel` was written against two hand-transcribed fixtures. It
 * is correct — it reproduces both published labels — but it has never been fed a
 * row out of the database, so the diagram still renders sample vehicles. This is
 * the missing half: the adapter from what we store to what the model expects.
 *
 * Kept apart from the model deliberately. The model is arithmetic on a clean
 * record and its tests read as statements about EPA's method; the shape of our
 * tables is a separate concern that changes for separate reasons. Mixing them
 * would put column names into the file that explains the physics.
 *
 * ── Why a reason, and not just null ─────────────────────────────────────────
 *
 * Most groups cannot produce a model, and for several different reasons: no
 * test rows, an SCT record with no phase detail by construction, phases whose
 * cycle nobody has recorded. "No diagram" is the same output for all of them
 * and tells a curator nothing about whether it is fixable or what to fix.
 *
 * So this returns `{ record, reason }` and every caller is expected to say the
 * reason out loud. The unfixable cases are as important as the fixable ones:
 * an SCT record has no bag-level detail because of how the test is run, and
 * telling someone that is different from telling them something is missing.
 */
import { PROC_MCT, PROC_CD_HWY, PROC_CD_UDDS } from '../constants/epa';
import { resolvePhaseTypes } from './phaseTypes';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/** Why a group produced no record. Rendered to a curator, so worded for one. */
export const NO_RECORD_REASONS = {
    'no-group':      'No EPA test group is linked to this vehicle.',
    'no-tests':      'The linked group has no test records yet.',
    'no-energy':     'The test reports no total DC energy, so range cannot be computed from consumption.',
    'no-phases':     'The test has no phase rows, so city and highway cannot be separated.',
    'phases-untyped':'The test’s phases have no cycle recorded, and their distances do not identify one.',
    'missing-cycle': 'The test has phases for only one cycle, and the label needs both.',
    'sct-no-ranges': 'This is a single-cycle test pair and its per-cycle ranges are not recorded.',
};

/** kWh as stored → Wh as the model works in. */
const kwhToWh = (v) => { const n = num(v); return n == null ? null : n * 1000; };

/**
 * The test that carries the multi-cycle run, if there is one.
 *
 * Procedure code decides, not phase count: an SCT record can carry several
 * phases and still not be an MCT, and the epic is explicit that the code is the
 * only reliable discriminator.
 */
function mctTestsOf(tests) {
    return tests.filter(t => num(t.procedure_code) === PROC_MCT);
}

/**
 * The multi-cycle test to derive from, when a group holds more than one.
 *
 * Two is not a data error. The R2 21" was tested at two laboratories — FEV
 * Michigan and Ann Arbor — and both runs are legitimate. They simply do not
 * agree: their recharge energies differ by about 5%, so choosing silently put
 * the derived MPGe 5.15% out while every bag still reconciled. Deriving from
 * the other run brings it to +0.01%.
 *
 * Picking the most recent is a defensible default and NOT a resolution. Which
 * run represents the vehicle is a curator's judgement, and the wrong reading of
 * this — that one must be deleted — would destroy a valid test. So the count is
 * carried out and the UI states that a choice was made.
 *
 * ⚠ `cd_range_*` is stored on the GROUP, set at import from whichever proc-77
 * test was seen first. When a group holds two, the stated ranges the bag check
 * compares against may belong to the OTHER test — which reads as a ~0.6%
 * disagreement that is really two labs, not an error. Per-test CD ranges would
 * be needed to compare like with like.
 *
 * Ordering falls back to test_number, then position, so the same group always
 * derives the same way — an arbitrary pick that changes between loads is worse
 * than a wrong one that holds still.
 */
function preferredMctTest(tests, preferredTestNumber = null) {
    const mcts = mctTestsOf(tests);
    if (mcts.length <= 1) return mcts[0] ?? null;

    // A selection beats the default. It is set from the linked guide row, whose
    // published highway figure identifies the run EPA used — and on Mercedes'
    // CLA 350 that is the OLDER of the two, so the default was picking the test
    // EPA did not use. A curator may also set it by hand. Either way it is a
    // stated choice and this is a fallback for when none was made.
    if (preferredTestNumber) {
        const chosen = mcts.find(t => t.test_number === preferredTestNumber);
        if (chosen) return chosen;
        // Named a test that is not here — a re-import that dropped it, or a
        // typo. Fall through rather than failing: the default is still a
        // reasonable answer, and epaAudit reports the dangling reference.
    }

    return [...mcts].sort((a, b) => {
        const date = String(b.test_date ?? '').localeCompare(String(a.test_date ?? ''));
        if (date !== 0) return date;
        return (num(b.test_number) ?? 0) - (num(a.test_number) ?? 0);
    })[0];
}

/**
 * Which stated ranges a check should compare against, and where they came from.
 *
 * Per-test when the row has them — that is the same test the phases came from,
 * so the comparison is like with like. Group-level otherwise, which is what
 * every caller did before migration 060 and is still right for a group holding
 * one test.
 */
function statedRangesFor(test, group) {
    const cityMi = num(test?.cd_range_combined_calc);
    const hwyMi  = num(test?.cd_range_hwy_calc);
    if (cityMi != null || hwyMi != null) {
        return { cityMi, hwyMi, source: 'test', testNumber: test?.test_number ?? null };
    }
    return {
        cityMi: num(group?.cd_range_combined_calc),
        hwyMi:  num(group?.cd_range_hwy_calc),
        source: 'group',
        testNumber: null,
    };
}

const sctTestsOf = (tests) => tests.filter(t => {
    const code = num(t.procedure_code);
    return code === PROC_CD_HWY || code === PROC_CD_UDDS;
});

/**
 * Phases in the shape the model reads, with their cycle resolved.
 *
 * `whPerMi` is derived here rather than stored: a phase records energy and
 * distance, and consumption is their quotient. Deriving it keeps one number of
 * record instead of two that can disagree.
 */
function phasesFor(test) {
    const rows = (test.epa_test_phases ?? [])
        .slice()
        .sort((a, b) => num(a.phase_index) - num(b.phase_index));

    return resolvePhaseTypes(rows)
        .map(p => {
            const wh   = kwhToWh(p.dc_energy_kwh);
            const dist = num(p.distance_mi);
            return {
                cycle: p.cycle,
                typeSource: p.typeSource,
                index: num(p.phase_index),
                wh,
                // Carried through, because a bag's LENGTH decides whether its
                // consumption is usable: the final bag of a depletion run ends
                // mid-cycle and its Wh/mi is not a cycle's Wh/mi. See
                // isCompleteCycle in epaMethodology.
                distanceMi: dist,
                whPerMi: (wh != null && dist > 0) ? wh / dist : null,
            };
        })
        // A phase with no consumption contributes nothing and would divide into
        // the cold-start energy share as a zero.
        .filter(p => p.whPerMi > 0);
}

/**
 * Build a methodology record from one stored group.
 *
 * @param {Object} group  an epa_test_groups row with nested epa_tests →
 *                        epa_test_phases, as `getVehicles` fetches it
 * @param {Object} [meta] { vehicleName, configuration } for display
 * @returns {{ record: Object|null, reason: string|null, inferredPhaseTypes: number }}
 */
export function epaRecordFromGroup(group, meta = {}) {
    const fail = (reason) => ({ record: null, reason, inferredPhaseTypes: 0,
        competingMctTests: 0, derivedFrom: null, statedRanges: null });

    if (!group) return fail('no-group');
    const tests = group.epa_tests ?? [];
    if (!tests.length) return fail('no-tests');

    // Shared across both test methods: what the label says, and what EPA
    // actually adjusted by. Both come off the group rather than the test.
    const common = {
        vehicleName:   meta.vehicleName ?? group.display_name ?? group.epa_carline_name ?? null,
        modelYear:     num(group.model_year),
        configuration: meta.configuration ?? group.vehicle_config_number ?? null,
        labeledRangeMi: num(group.label_range_published),
        // Read, not assumed — see epaMethodology.resolveAdjustment. Absent here
        // simply falls back to the flat factor there.
        adjustmentFactor: num(group.label_adjustment_factor),
        calcApproach:     group.label_calc_approach ?? null,
        adjustmentMethod: group.label_calc_approach ?? null,
    };

    const mct = preferredMctTest(tests, group?.preferred_test_number);
    const competingMctTests = mctTestsOf(tests).length;
    if (mct) {
        const totalDcWh = kwhToWh(mct.total_dc_energy_kwh);
        if (!(totalDcWh > 0)) return fail('no-energy');

        const phases = phasesFor(mct);
        if (!phases.length) return fail('no-phases');
        if (!phases.some(p => p.cycle)) return fail('phases-untyped');

        const hasCity = phases.some(p => p.cycle === 'UDDS');
        const hasHwy  = phases.some(p => p.cycle === 'HWY');
        if (!hasCity || !hasHwy) return fail('missing-cycle');

        return {
            record: {
                ...common,
                testMethod: 'mct',
                totalDcWh,
                rechargeAcWh: kwhToWh(mct.ac_recharge_kwh),
                phases,
            },
            reason: null,
            inferredPhaseTypes: phases.filter(p => p.typeSource === 'inferred').length,
            // >1 means the derivation used one of several and the others were
            // ignored. Surfaced, because that choice changes every figure.
            competingMctTests,
            // WHICH one, so the UI can name it. A message saying a choice was
            // made without saying which leaves the curator to work out from the
            // test list what the code already knows.
            derivedFrom: mct.test_number
                ? {
                    testNumber: mct.test_number,
                    testDate: mct.test_date ?? null,
                    // Which rule chose it. "Selected" means a guide row or a
                    // curator settled it; "most-recent" means nothing did, and
                    // the figures rest on a default.
                    basis: group?.preferred_test_number === mct.test_number
                        ? 'selected' : 'most-recent',
                }
                : null,
            // The ranges to check the recomputed ones against, belonging to the
            // test the phases above came from (#227).
            //
            // Callers used to read these off the GROUP, where they are set at
            // import from the first procedure-77 test. The derivation uses the
            // most RECENT, so on a group holding two the check compared one
            // test's phases against the other test's stated figures and called
            // the difference a fault. Mercedes' CLA 350 holds two a month
            // apart: 461.373/450.544 and 475.482/460.354.
            //
            // Falling back to the group keeps every record imported before
            // migration 060 behaving exactly as it did, and `source` says which
            // happened so nothing has to infer it from a null.
            statedRanges: statedRangesFor(mct, group),
        };
    }

    const sct = sctTestsOf(tests);
    if (!sct.length) return fail('no-tests');

    // The group's range columns are ambiguous on an SCT record and the epic
    // called them the single most dangerous pair in the schema: assigning one to
    // the wrong cycle produces two plausible wrong ranges rather than an error.
    //
    // Migration 060 removes the ambiguity where it can. A single-cycle test
    // states the range for the cycle IT drove, so procedure 81 carries the UDDS
    // range and 84 the highway one, each on its own row — BMW's i7 reads 409.29
    // and 445.14. Read per test first; the group columns stay as the fallback
    // for rows imported before that, where the old assignment still applies.
    const cityMi = num(group.cd_range_combined_calc);
    const hwyMi  = num(group.cd_range_hwy_calc);

    const runs = sct
        .map(t => {
            const code = num(t.procedure_code);
            return {
                cycle: code === PROC_CD_HWY ? 'HWFET' : 'UDDS',
                procedureCode: code,
                rechargeWh: kwhToWh(t.ac_recharge_kwh),
                // This test's own figure when it has one; otherwise the group's,
                // split by procedure exactly as before.
                rangeMi: num(t.cd_range_combined_calc)
                    ?? (code === PROC_CD_HWY ? hwyMi : cityMi),
                testNumber: t.test_number ?? null,
            };
        })
        .filter(r => r.rechargeWh > 0 && r.rangeMi > 0);

    // Said as "no ranges" only when that is what happened. A record whose runs
    // are missing their recharge energy is a different fault and reads as one.
    if (!runs.length) return fail('sct-no-ranges');
    if (runs.length < 2) return fail('missing-cycle');

    return {
        record: {
            ...common,
            testMethod: 'sct',
            // No DC-side energy in an SCT record — inherent to the method. The
            // model already reports this rather than imputing it.
            totalDcWh: null,
            rechargeAcWh: kwhToWh(sct[0].ac_recharge_kwh),
            runs,
        },
        reason: null,
        inferredPhaseTypes: 0,
        competingMctTests: 0,
        derivedFrom: null,
        // An SCT record is checked run by run against each run's own range, so
        // there is no single pair to compare a recomputed total against.
        statedRanges: null,
    };
}
