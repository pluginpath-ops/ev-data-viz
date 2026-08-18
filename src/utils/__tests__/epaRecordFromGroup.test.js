/**
 * The adapter from a stored EPA group to a methodology record.
 *
 * The load-bearing test is the round trip: a group shaped exactly as the
 * database returns one, through the adapter, through the model, landing on the
 * R2's published label. Asserting the record's fields alone would pass while
 * feeding the model something it cannot use — which is the failure this whole
 * seam exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { epaRecordFromGroup, NO_RECORD_REASONS } from '../epaRecordFromGroup';
import { buildMethodologyModel } from '../epaMethodology';
import { R2_MCT } from '../epaMethodologyFixtures';
import { PROC_MCT, PROC_CD_HWY, PROC_CD_UDDS, HWFET_MI, UDDS_MI } from '../../constants/epa';

/** The R2's phases as the DATABASE holds them: energy and distance, no consumption. */
const r2Phase = (index, phase_type, whPerMi, distance_mi) => ({
    phase_index: index,
    phase_type,
    distance_mi,
    dc_energy_kwh: (whPerMi * distance_mi) / 1000,
});

// Distances chosen so consumption divides back to the fixture's figures exactly.
// The cold phase's is derived from its reported energy (1751.46 / 235.86).
const R2_GROUP = {
    model_year: 2027,
    display_name: 'Rivian R2 Performance',
    label_range_published: 307,
    epa_tests: [{
        procedure_code: PROC_MCT,
        total_dc_energy_kwh: 89.54927,
        ac_recharge_kwh: 104.689,
        epa_test_phases: [
            r2Phase(1, 'UDDS', 235.86, 1751.46 / 235.86),
            r2Phase(2, 'HWY',  231.77, HWFET_MI),
            r2Phase(3, 'UDDS', 189.87, UDDS_MI),
            r2Phase(4, 'HWY',  225.00, HWFET_MI),
            r2Phase(5, 'UDDS', 184.62, UDDS_MI),
            r2Phase(7, 'UDDS', 183.46, UDDS_MI),
        ],
    }],
};

describe('epaRecordFromGroup — MCT', () => {
    it('produces a record the model turns into the R2 label', () => {
        const { record, reason } = epaRecordFromGroup(R2_GROUP);
        expect(reason).toBeNull();

        const fromDb = buildMethodologyModel(record);
        const fromFixture = buildMethodologyModel(R2_MCT);

        // Same numbers as the hand-transcribed record, through the database shape.
        expect(fromDb.cycles.city.whPerMi).toBeCloseTo(fromFixture.cycles.city.whPerMi, 2);
        expect(fromDb.cycles.hwy.whPerMi).toBeCloseTo(fromFixture.cycles.hwy.whPerMi, 2);
        expect(fromDb.combinedMi).toBeCloseTo(fromFixture.combinedMi, 2);
        expect(fromDb.labeledMi).toBe(307);
    });

    it('derives consumption from energy and distance rather than storing it', () => {
        const { record } = epaRecordFromGroup(R2_GROUP);
        expect(record.phases[0].whPerMi).toBeCloseTo(235.86, 2);
        expect(record.phases[0].wh).toBeCloseTo(1751.46, 1);
    });

    it('converts stored kWh to the Wh the model works in', () => {
        const { record } = epaRecordFromGroup(R2_GROUP);
        expect(record.totalDcWh).toBeCloseTo(89549.27, 1);
        expect(record.rechargeAcWh).toBeCloseTo(104689, 1);
    });

    it('carries the published adjustment factor through', () => {
        const { record } = epaRecordFromGroup({
            ...R2_GROUP,
            label_adjustment_factor: 0.7051,
            label_calc_approach: 'Electric Vehicle 5-cycle label',
        });
        expect(record.adjustmentFactor).toBe(0.7051);
        expect(record.calcApproach).toBe('Electric Vehicle 5-cycle label');
    });

    it('orders phases by index, since the cold start is identified by position', () => {
        const shuffled = {
            ...R2_GROUP,
            epa_tests: [{
                ...R2_GROUP.epa_tests[0],
                epa_test_phases: [...R2_GROUP.epa_tests[0].epa_test_phases].reverse(),
            }],
        };
        const { record } = epaRecordFromGroup(shuffled);
        expect(record.phases.map(p => p.index)).toEqual([1, 2, 3, 4, 5, 7]);
    });

    it('infers missing phase types and reports how many it had to', () => {
        // The A1 audit found most imported phases carry no type. Without the
        // fallback those tests render nothing at all.
        const untyped = {
            ...R2_GROUP,
            epa_tests: [{
                ...R2_GROUP.epa_tests[0],
                epa_test_phases: R2_GROUP.epa_tests[0].epa_test_phases
                    .map(p => ({ ...p, phase_type: null })),
            }],
        };
        const { record, inferredPhaseTypes } = epaRecordFromGroup(untyped);
        expect(record).not.toBeNull();
        expect(inferredPhaseTypes).toBe(6);
        expect(record.phases.map(p => p.cycle))
            .toEqual(['UDDS', 'HWY', 'UDDS', 'HWY', 'UDDS', 'UDDS']);
    });

    it('picks the MCT test by procedure code, not by phase count', () => {
        // An SCT record can carry several phases; only the code discriminates.
        const both = {
            ...R2_GROUP,
            epa_tests: [
                { procedure_code: PROC_CD_UDDS, ac_recharge_kwh: 100, epa_test_phases: [] },
                ...R2_GROUP.epa_tests,
            ],
        };
        expect(epaRecordFromGroup(both).record.testMethod).toBe('mct');
    });
});

describe('epaRecordFromGroup — SCT', () => {
    const SCT_GROUP = {
        model_year: 2026,
        display_name: 'Ford F-150 Lightning ER',
        label_range_published: 320,
        cd_range_combined_calc: 504.521,   // CITY on an SCT record — see the adapter
        cd_range_hwy_calc: 407.934,
        epa_tests: [
            { procedure_code: PROC_CD_UDDS, ac_recharge_kwh: 152.974, epa_test_phases: [] },
            { procedure_code: PROC_CD_HWY,  ac_recharge_kwh: 152.974, epa_test_phases: [] },
        ],
    };

    it('assigns the combined-named column to the CITY cycle', () => {
        // The trap the epic names: this column is city on SCT, and swapping it
        // yields two plausible wrong ranges rather than an error.
        const { record } = epaRecordFromGroup(SCT_GROUP);
        expect(record.runs.find(r => r.cycle === 'UDDS').rangeMi).toBe(504.521);
        expect(record.runs.find(r => r.cycle === 'HWFET').rangeMi).toBe(407.934);
    });

    it('leaves DC energy null rather than imputing it', () => {
        // An SCT record has no battery-side energy by construction.
        expect(epaRecordFromGroup(SCT_GROUP).record.totalDcWh).toBeNull();
    });

    it('builds a model that reaches the label', () => {
        const model = buildMethodologyModel(epaRecordFromGroup(SCT_GROUP).record);
        expect(model).not.toBeNull();
        expect(model.testMethod).toBe('sct');
        expect(model.labeledMi).toBe(320);
    });
});

describe('epaRecordFromGroup — why there is no record', () => {
    it('names a reason for every way it can fail', () => {
        const cases = {
            'no-group':  undefined,
            'no-tests':  { epa_tests: [] },
            'no-energy': { epa_tests: [{ procedure_code: PROC_MCT, total_dc_energy_kwh: null, epa_test_phases: [] }] },
            'no-phases': { epa_tests: [{ procedure_code: PROC_MCT, total_dc_energy_kwh: 89.5, epa_test_phases: [] }] },
            'phases-untyped': { epa_tests: [{
                procedure_code: PROC_MCT, total_dc_energy_kwh: 89.5,
                epa_test_phases: [{ phase_index: 1, distance_mi: 3, dc_energy_kwh: 1 }],
            }] },
            'missing-cycle': { epa_tests: [{
                procedure_code: PROC_MCT, total_dc_energy_kwh: 89.5,
                epa_test_phases: [{ phase_index: 1, phase_type: 'UDDS', distance_mi: UDDS_MI, dc_energy_kwh: 1.4 }],
            }] },
            'sct-no-ranges': { epa_tests: [
                { procedure_code: PROC_CD_UDDS, ac_recharge_kwh: 152.974, epa_test_phases: [] },
                { procedure_code: PROC_CD_HWY,  ac_recharge_kwh: 152.974, epa_test_phases: [] },
            ] },
        };

        for (const [expected, group] of Object.entries(cases)) {
            const { record, reason } = epaRecordFromGroup(group);
            expect(record, expected).toBeNull();
            expect(reason, expected).toBe(expected);
            // Every reason must be sayable to a curator, or the UI prints a code.
            expect(NO_RECORD_REASONS[reason], expected).toBeTruthy();
        }
    });

    it('has wording for every reason it can emit, and no orphans', () => {
        const emitted = new Set([
            'no-group', 'no-tests', 'no-energy', 'no-phases',
            'phases-untyped', 'missing-cycle', 'sct-no-ranges',
        ]);
        expect(new Set(Object.keys(NO_RECORD_REASONS))).toEqual(emitted);
    });
});
