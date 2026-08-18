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
 * A group SHOULD hold one. Where it holds two, they are different runs of the
 * same procedure and they do not agree — an R2 configuration carried a pair
 * whose recharge energies differed by ~5%, and picking silently between them
 * put the derived MPGe 5.15% out while every bag still reconciled, which is a
 * confusing place to be sent looking.
 *
 * Picking the most recent is a defensible default and NOT a resolution: only a
 * curator knows whether the older run was superseded or the newer one is a
 * retest of a different build. So the count is reported alongside and the UI
 * says so, rather than the choice being invisible.
 *
 * Ordering falls back to test_number, then position, so the same group always
 * derives the same way — an arbitrary pick that changes between loads is worse
 * than a wrong one that holds still.
 */
function preferredMctTest(tests) {
    const mcts = mctTestsOf(tests);
    if (mcts.length <= 1) return mcts[0] ?? null;

    return [...mcts].sort((a, b) => {
        const date = String(b.test_date ?? '').localeCompare(String(a.test_date ?? ''));
        if (date !== 0) return date;
        return (num(b.test_number) ?? 0) - (num(a.test_number) ?? 0);
    })[0];
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
    const fail = (reason) => ({ record: null, reason, inferredPhaseTypes: 0, competingMctTests: 0 });

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

    const mct = preferredMctTest(tests);
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
        };
    }

    const sct = sctTestsOf(tests);
    if (!sct.length) return fail('no-tests');

    // ⚠ The range columns are on the GROUP, not the test, and their names lie.
    // `cd_range_combined_calc` is the CITY range on an SCT record — the epic
    // calls this out as the single most dangerous column in the schema, because
    // assigning it to the wrong cycle produces two plausible wrong ranges rather
    // than an error. Highway has its own column and is unambiguous.
    const cityMi = num(group.cd_range_combined_calc);
    const hwyMi  = num(group.cd_range_hwy_calc);
    if (!(cityMi > 0) || !(hwyMi > 0)) return fail('sct-no-ranges');

    const rangeFor = (code) => (code === PROC_CD_HWY ? hwyMi : cityMi);

    const runs = sct
        .map(t => {
            const code = num(t.procedure_code);
            return {
                cycle: code === PROC_CD_HWY ? 'HWFET' : 'UDDS',
                procedureCode: code,
                rechargeWh: kwhToWh(t.ac_recharge_kwh),
                rangeMi: rangeFor(code),
            };
        })
        .filter(r => r.rechargeWh > 0 && r.rangeMi > 0);

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
    };
}
