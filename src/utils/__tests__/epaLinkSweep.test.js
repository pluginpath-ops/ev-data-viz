import { describe, it, expect } from 'vitest';
import {
    TIERS, tierOf, hasDerivableEnergy, hasCoefficients,
    classifyTestVehicle, buildSweep, sweepProgress, batchable, NO_PROPOSAL_REASONS,
    impliedUsableKwh, testVehicleEnergyFacts, estimatedAdjustedRange, coveredModelMatches,
    wheelMentions, coveredWheelSizes, hasCsiDetail,
} from '../epaLinkSweep';
import { epaRecordFromTestVehicle } from '../epaRecordFromTestVehicle';
import { buildMethodologyModel } from '../epaMethodology';
import { PROC_MCT, HWFET_MI, UDDS_MI } from '../../constants/epa';

const testVehicle = (o = {}) => ({
    test_vehicle_id: o.id ?? 'TG1',
    make: o.make ?? 'Rivian',
    epa_carline_name: o.carline ?? 'R1T',
    model_year: o.year ?? 2026,
    epa_tests: o.tests ?? [],
    epa_coefficient_sets: o.coeffs ?? [],
});
const fe = (o) => ({
    id: o.id, model_year: o.year ?? 2026, division: o.make ?? 'Rivian',
    carline: o.carline, label_comb_range_mi: o.range ?? 300, motor_count: o.motors ?? 2,
});

describe('tiering', () => {
    it('counts DC energy only on a test the derivations would use', () => {
        // Procedure code decides. Proc 86 is where the 0.037 charger efficiency
        // came from — a short cycle's DC against a full recharge — so a test vehicle
        // whose only energy sits there unlocks nothing.
        expect(hasDerivableEnergy(testVehicle({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 80 }] }))).toBe(true);
        expect(hasDerivableEnergy(testVehicle({ tests: [{ procedure_code: 84, total_dc_energy_kwh: 80 }] }))).toBe(true);
        expect(hasDerivableEnergy(testVehicle({ tests: [{ procedure_code: 86, total_dc_energy_kwh: 6 }] }))).toBe(false);
    });
    it('ignores a usable procedure with no energy recorded', () => {
        expect(hasDerivableEnergy(testVehicle({ tests: [{ procedure_code: 77, total_dc_energy_kwh: null }] }))).toBe(false);
    });
    it('reads coefficients off the target set', () => {
        expect(hasCoefficients(testVehicle({ coeffs: [{ target_a: 30 }] }))).toBe(true);
        expect(hasCoefficients(testVehicle({ coeffs: [{ target_a: null }] }))).toBe(false);
    });
    it('ranks energy above coefficients above everything else', () => {
        expect(tierOf(testVehicle({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 80 }], coeffs: [{ target_a: 30 }] }))).toBe('energy');
        expect(tierOf(testVehicle({ coeffs: [{ target_a: 30 }] }))).toBe('coefficients');
        expect(tierOf(testVehicle({}))).toBe('other');
    });
    it('every tier a test vehicle can be put in is declared', () => {
        const keys = TIERS.map(t => t.key);
        [testVehicle({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 1 }] }), testVehicle({ coeffs: [{ target_a: 1 }] }), testVehicle({})]
            .forEach(g => expect(keys).toContain(tierOf(g)));
    });
});

describe('proposals', () => {
    it('proposes a clear same-year winner', () => {
        const rows = [fe({ id: 1, carline: 'R1T Dual Max (21in)' }), fe({ id: 2, carline: 'Something Else Entirely' })];
        const c = classifyTestVehicle(testVehicle({ carline: 'R1T Dual Max' }), rows);
        expect(c.proposal.row.id).toBe(1);
        expect(c.reason).toBeNull();
    });
    it('declines a tie, because our carline does not distinguish the variants', () => {
        // Ioniq 5 scores identically against `Ioniq 5 N` and `Ioniq 5 RWD`,
        // cars 221 and ~300 miles apart. Any tie-break is arbitrary.
        const rows = [
            fe({ id: 1, make: 'Hyundai', carline: 'Ioniq 5 N' }),
            fe({ id: 2, make: 'Hyundai', carline: 'Ioniq 5 X' }),
        ];
        const c = classifyTestVehicle(testVehicle({ make: 'Hyundai', carline: 'Ioniq 5' }), rows);
        expect(c.proposal).toBeNull();
        expect(c.reason).toBe('tied');
    });
    it('declines a borrowed year but still lists it', () => {
        const rows = [fe({ id: 1, year: 2025, carline: 'R1T Dual Max' })];
        const c = classifyTestVehicle(testVehicle({ year: 2027, carline: 'R1T Dual Max' }), rows);
        expect(c.proposal).toBeNull();
        expect(c.reason).toBe('wrong-year');
        expect(c.ranked).toHaveLength(1);
    });
    it('declines when the make matches but no carline is close', () => {
        const c = classifyTestVehicle(testVehicle({ carline: 'R1T' }), [fe({ id: 1, carline: 'Completely Different Vehicle' })]);
        expect(c.proposal).toBeNull();
        expect(c.reason).toBe('below-floor');
    });
    it('reports no candidates when the manufacturer has none staged', () => {
        const c = classifyTestVehicle(testVehicle({ make: 'Rivian' }), [fe({ id: 1, make: 'BMW', carline: 'i4' })]);
        expect(c.reason).toBe('no-candidates');
        expect(c.candidateCount).toBe(0);
    });
    it('every reason it can produce has wording for a curator', () => {
        Object.keys(NO_PROPOSAL_REASONS).forEach(k => expect(NO_PROPOSAL_REASONS[k]).toBeTruthy());
        const produced = ['no-candidates', 'below-floor', 'wrong-year', 'tied'];
        produced.forEach(r => expect(NO_PROPOSAL_REASONS).toHaveProperty(r));
    });
});

describe('ordering', () => {
    const rows = [fe({ id: 1, carline: 'R1T Dual Max' })];
    const energyProposed = testVehicle({ id: 'A', carline: 'R1T Dual Max', tests: [{ procedure_code: 77, total_dc_energy_kwh: 80 }] });
    const energyManual   = testVehicle({ id: 'B', carline: 'Nothing Like It', tests: [{ procedure_code: 77, total_dc_energy_kwh: 80 }] });
    const coeffProposed  = testVehicle({ id: 'C', carline: 'R1T Dual Max', coeffs: [{ target_a: 30 }] });
    const plain          = testVehicle({ id: 'D', carline: 'R1T Dual Max' });

    it('orders by tier, then puts the one-click cases first inside it', () => {
        const out = buildSweep([plain, coeffProposed, energyManual, energyProposed], rows);
        expect(out.map(i => i.testVehicle.test_vehicle_id)).toEqual(['A', 'B', 'C', 'D']);
    });
    it('counts progress per tier', () => {
        const p = sweepProgress(buildSweep([plain, coeffProposed, energyManual, energyProposed], rows));
        expect(p.energy).toEqual({ total: 2, proposed: 1, manual: 1 });
        expect(p.coefficients).toEqual({ total: 1, proposed: 1, manual: 0 });
    });
    it('never batches a proposal on its name alone', () => {
        // These records have proposals but no lab data, so the check cannot
        // confirm one — and a name match is not enough to link unseen (#374).
        const out = buildSweep([plain, coeffProposed, energyManual, energyProposed], rows);
        expect(out.filter(i => i.proposal).map(i => i.testVehicle.test_vehicle_id)).toEqual(['A', 'C', 'D']);
        expect(batchable(out)).toEqual([]);
    });
});

describe('the batch links only what the check confirms (#374)', () => {
    const phase = (index, phase_type, whPerMi, distance_mi) => ({
        phase_index: index, phase_type, distance_mi, dc_energy_kwh: (whPerMi * distance_mi) / 1000,
    });
    // The Rivian R2 as the database holds it (see epaRecordFromTestVehicle.test).
    const r2 = {
        test_vehicle_id: 'R2-159XR20AT', model_year: 2027, overrides: {},
        epa_tests: [{
            procedure_code: PROC_MCT, total_dc_energy_kwh: 89.54927, ac_recharge_kwh: 104.689,
            epa_test_phases: [
                phase(1, 'UDDS', 235.86, 1751.46 / 235.86), phase(2, 'HWY', 231.77, HWFET_MI),
                phase(3, 'UDDS', 189.87, UDDS_MI), phase(4, 'HWY', 225.00, HWFET_MI),
                phase(5, 'UDDS', 184.62, UDDS_MI), phase(7, 'UDDS', 183.46, UDDS_MI),
            ],
        }],
    };
    const model = buildMethodologyModel(epaRecordFromTestVehicle(r2).record);
    const item = (over = {}) => ({
        testVehicle: r2,
        proposal: { score: 1, exactYear: true, row: {
            id: 1, model_year: 2027, carline: 'R2 Performance', label_comb_range_mi: 300,
            unadj_city_mpge: model.cycles.city.mpgeUnadj, unadj_hwy_mpge: model.cycles.hwy.mpgeUnadj, ...over,
        } },
    });

    it('batches a proposal whose MPGe matches EPA', () => {
        expect(batchable([item()])).toHaveLength(1);
    });
    it('gives a matching MPGe with an impossible label a batch of its own', () => {
        // The MPGe says it is the right record; the label is an error to look
        // at, not a wrong match (owner, #374).
        const impossible = item({ label_comb_range_mi: Math.round(model.combinedMi) + 40 });
        expect(batchable([impossible])).toEqual([]);
        expect(batchable([impossible, item()], 'impossible-label')).toEqual([impossible]);
    });
    it('leaves a disagreeing or uncheckable proposal for a curator', () => {
        const disagrees = item({ unadj_city_mpge: model.cycles.city.mpgeUnadj * 1.15 });
        const unchecked = item({ unadj_city_mpge: null, unadj_hwy_mpge: null });
        expect(batchable([disagrees, unchecked])).toEqual([]);
        expect(batchable([disagrees, unchecked], 'impossible-label')).toEqual([]);
    });
    it('never batches an item without a proposal', () => {
        expect(batchable([{ testVehicle: r2, proposal: null }])).toEqual([]);
    });
});

describe('telling near-identical candidates apart', () => {
    // The real case: `R1T All-Terrain Performance Dual` scores 71% against
    // three MY2025 Rivian rows and the name says nothing about which pack.
    const large     = { label_comb_range_mi: 289, label_comb_mpge: 76, nominal_pack_kwh: 116.116 };
    const largePlus = { label_comb_range_mi: 292, label_comb_mpge: 72, nominal_pack_kwh: 149.744 };
    const max       = { label_comb_range_mi: 370, label_comb_mpge: 78, nominal_pack_kwh: 149.744 };

    it('separates trims a carline name cannot', () => {
        expect(impliedUsableKwh(large)).toBeCloseTo(128.2, 1);
        expect(impliedUsableKwh(largePlus)).toBeCloseTo(136.7, 1);
        expect(impliedUsableKwh(max)).toBeCloseTo(159.9, 1);
    });
    it('is null without both inputs, rather than dividing by zero', () => {
        expect(impliedUsableKwh({ label_comb_range_mi: 300 })).toBeNull();
        expect(impliedUsableKwh({ label_comb_range_mi: 300, label_comb_mpge: 0 })).toBeNull();
        expect(impliedUsableKwh(null)).toBeNull();
    });

    it('reads the test vehicle’s own measured energy from a usable procedure only', () => {
        // The real test vehicle carries both: proc 86 at 6.09 kWh and proc 77 at
        // 144.23. Taking the first test would have reported 6 kWh and pointed
        // at the smallest pack — the opposite of the truth.
        const f = testVehicleEnergyFacts({
            epa_tests: [
                { procedure_code: 86, total_dc_energy_kwh: 6.093 },
                { procedure_code: 77, total_dc_energy_kwh: 144.232 },
            ],
            epa_coefficient_sets: [{ equiv_test_weight_lbs: 7000 }],
        });
        expect(f.dcEnergyKwh).toBeCloseTo(144.232, 3);
        expect(f.procedure).toBe(77);
        expect(f.etwLbs).toBe(7000);
    });
    it('is all-null when the test vehicle knows nothing about its own energy', () => {
        expect(testVehicleEnergyFacts({ epa_tests: [], epa_coefficient_sets: [] }))
            .toEqual({ dcEnergyKwh: null, procedure: null, etwLbs: null, useableKwh: null });
    });
});

describe('identifier matches and shared certifications', () => {
    const g = (o) => ({ test_vehicle_id: o.id, make: 'Lucid', epa_carline_name: o.carline ?? 'Air Touring AWD',
        model_year: o.year ?? 2024, epa_tests: [], epa_coefficient_sets: [] });
    const row = (o) => ({ id: o.id, model_year: o.year ?? 2024, division: 'Lucid',
        carline: o.carline, smog_test_group: o.tg, label_comb_range_mi: o.range ?? 400, label_comb_mpge: 120 });

    it('takes an identifier match over any name score', () => {
        // The guide's smog Test Group is usually EPA's own identifier, but for
        // 10 test vehicles in the corpus it IS our test vehicle id. That is not a
        // similarity — it is the same string.
        const rows = [
            row({ id: 1, carline: 'Completely Different Car', tg: 'ABC123' }),
            row({ id: 2, carline: 'Air Touring AWD w/19" wheels', tg: 'ZZZ' }),
        ];
        const c = classifyTestVehicle(g({ id: 'ABC123' }), rows);
        expect(c.exactIdMatch).toBe(true);
        expect(c.proposal.row.id).toBe(1);
    });
    it('matches the certification\'s own Test Group in its year (#374)', () => {
        // The Guide's key is (year, smog Test Group) — the certification's.
        // Compared with a Vehicle ID it matched 1 linked record in 87.
        const rows = [
            row({ id: 1, carline: 'Completely Different Car', tg: 'RHYXV00.0W51', year: 2024 }),
            row({ id: 2, carline: 'Air Touring AWD', tg: 'SHYXV00.0W51', year: 2025 }),
        ];
        const c = classifyTestVehicle({ ...g({ id: 'NE-U168EA135R', year: 2024 }), test_group: 'RHYXV00.0W51' }, rows);
        expect(c.exactIdMatch).toBe(true);
        expect(c.proposal.row.id).toBe(1);
    });
    it('does not take the same Test Group from another year', () => {
        const rows = [row({ id: 1, carline: 'X', tg: 'RHYXV00.0W51', year: 2025 })];
        expect(classifyTestVehicle({ ...g({ id: 'NE-U168EA135R', year: 2024 }), test_group: 'RHYXV00.0W51' }, rows).exactIdMatch)
            .toBe(false);
    });
    it('declines an identifier match that is not unique', () => {
        // The guide's Test Group is not unique per configuration, so several
        // rows can carry it — that is a choice, not an answer.
        const rows = [row({ id: 1, carline: 'A', tg: 'ABC123' }), row({ id: 2, carline: 'B', tg: 'ABC123' })];
        expect(classifyTestVehicle(g({ id: 'ABC123' }), rows).exactIdMatch).toBe(false);
    });

    it('names the case where the candidates are one certification', () => {
        // MY2024 Lucid Air Touring AWD is three rows at 411, 382 and 365 miles
        // for 19, 20 and 21 inch wheels, ALL under smog Test Group RLMUV00.0ZA2.
        // EPA certified it once; nothing on our side picks a wheel.
        const rows = [
            row({ id: 1, carline: 'Air Touring AWD w/19" wheels', tg: 'RLMUV00.0ZA2', range: 411 }),
            row({ id: 2, carline: 'Air Touring AWD w/20" wheels', tg: 'RLMUV00.0ZA2', range: 382 }),
            row({ id: 3, carline: 'Air Touring AWD w/21" wheels', tg: 'RLMUV00.0ZA2', range: 365 }),
        ];
        const c = classifyTestVehicle(g({ id: '202400005', carline: 'Air Touring' }), rows);
        expect(c.proposal).toBeNull();
        expect(c.shared).toEqual({ smogTestGroup: 'RLMUV00.0ZA2', count: 3 });
    });
    it('says nothing when the candidates are genuinely different certifications', () => {
        const rows = [
            row({ id: 1, carline: 'Air Touring AWD', tg: 'AAA' }),
            row({ id: 2, carline: 'Air Sapphire AWD', tg: 'BBB' }),
        ];
        expect(classifyTestVehicle(g({ id: 'X', carline: 'Air' }), rows).shared).toBeNull();
    });
});

describe('estimated label range', () => {
    it('adjusts the unadjusted range with the test vehicle’s own factor', () => {
        const e = estimatedAdjustedRange({ cd_range_combined_calc: 500, derived_5cycle_coefficient: 0.7294 });
        expect(e.miles).toBeCloseTo(364.7, 1);
        expect(e.factorIsDerived).toBe(true);
    });
    it('falls back to the fixed factor and says it did', () => {
        const e = estimatedAdjustedRange({ cd_range_combined_calc: 500 });
        expect(e.miles).toBeCloseTo(350, 1);
        expect(e.factor).toBe(0.7);
        expect(e.factorIsDerived).toBe(false);
    });
    it('is null when the test vehicle has no unadjusted range — most of them', () => {
        expect(estimatedAdjustedRange({})).toBeNull();
    });
});

describe('covered models', () => {
    const g = (covered, o = {}) => ({
        test_vehicle_id: o.id ?? 'TG', make: 'Rivian',
        epa_carline_name: o.carline ?? 'R1T All-Terrain Performance Dual',
        model_year: o.year ?? 2025, epa_tests: [], epa_coefficient_sets: [],
        epa_covered_models: covered.map(n => ({ carline_name: n })),
    });
    const row = (id, carline, year = 2025) => ({
        id, carline, division: 'Rivian', model_year: year,
        label_comb_range_mi: 370, label_comb_mpge: 78,
    });

    it('matches a guide carline the certificate names as covered', () => {
        // The represented-vehicle name says "R1T All-Terrain Performance Dual"
        // and scores 71% against three trims. The covered-models table names
        // the exact one, wheels and all.
        const rows = [
            row(1, 'R1T Performance Dual Large (20in)'),
            row(2, 'R1T Performance Dual Max (20in)'),
        ];
        const c = classifyTestVehicle(g(['R1T Performance Dual Max (20in)']), rows);
        expect(c.coveredMatch).toBe(true);
        expect(c.proposal.row.id).toBe(2);
    });
    it('ignores case, quotes and spacing', () => {
        const rows = [row(1, 'EX90 Twin Motor (21 inch Wheels)')];
        const c = classifyTestVehicle(g(['ex90  twin motor (21 inch wheels)']), rows);
        expect(c.coveredMatch).toBe(true);
    });
    it('declines when the certificate covers several of the candidates', () => {
        // A certificate covering four configurations matches four guide rows;
        // choosing among them is still the curator's.
        const rows = [row(1, 'R1S Dual Max (20in)'), row(2, 'R1S Dual Max (22in)')];
        const c = classifyTestVehicle(g(['R1S Dual Max (20in)', 'R1S Dual Max (22in)']), rows);
        expect(c.coveredMatch).toBe(false);
    });
    it('does not match across model years', () => {
        const rows = [row(1, 'R1T Performance Dual Max (20in)', 2024)];
        expect(classifyTestVehicle(g(['R1T Performance Dual Max (20in)'], { year: 2025 }), rows).coveredMatch).toBe(false);
    });
    it('returns every covered match for a caller that wants them all', () => {
        const rows = [row(1, 'A'), row(2, 'B'), row(3, 'C')];
        expect(coveredModelMatches(g(['A', 'C']), rows).map(r => r.id)).toEqual([1, 3]);
    });
    it('is empty when the certificate lists nothing — the pre-#250 state', () => {
        expect(coveredModelMatches({ epa_covered_models: [] }, [row(1, 'A')])).toEqual([]);
    });
});

describe('wheel sizes distilled from free text', () => {
    it('pulls both sizes out of the Volvo note', () => {
        // The clause that settles the case, inside a paragraph of axle ratios.
        expect(wheelMentions('Tested on 20 inch tire, covering 22 inch tire as worst case. Average N/V 106.8 (Front 101.0 and Rear 112.7).'))
            .toEqual([20, 22]);
    });
    it('reads the notations the corpus actually uses', () => {
        expect(wheelMentions('EX90 Twin Motor (21 inch Wheels)')).toEqual([21]);
        expect(wheelMentions('R1T Performance Dual Max (20in)')).toEqual([20]);
        expect(wheelMentions("iX3 50 xDrive (20'' Summer Tires)")).toEqual([20]);
    });
    it('reads Lucid’s front/rear pair as two sizes, not one number', () => {
        expect(wheelMentions('Gravity GT w/20F21R wheels (3R)')).toEqual([20, 21]);
    });
    it('does not mistake a year, a power or an N/V figure for a wheel', () => {
        expect(wheelMentions('Model Y Long Range AWD; Front Motor Power - 87 kW; 2026 model')).toEqual([]);
        expect(wheelMentions('Average N/V 106.8 (Front 101.0 and Rear 112.7)')).toEqual([]);
    });
    it('collects every size a certificate’s covered models name', () => {
        expect(coveredWheelSizes({ epa_covered_models: [
            { carline_name: 'EX90 Twin Motor' },
            { carline_name: 'EX90 Twin Motor (21 inch Wheels)' },
            { carline_name: 'EX90 Twin Motor Performance (21 inch Wheels)' },
        ] })).toEqual([21]);
    });
    it('is empty for a test vehicle with no CSI detail — a CSV-imported test vehicle', () => {
        expect(coveredWheelSizes({})).toEqual([]);
    });
});

describe('whether a certificate was ever imported', () => {
    it('is true when the covered-models table came through', () => {
        expect(hasCsiDetail({ epa_covered_models: [{ carline_name: 'X' }] })).toBe(true);
    });
    it('is true when only the manufacturer note came through', () => {
        expect(hasCsiDetail({ epa_tests: [{ mfr_test_vehicle_comments: 'Tested on 20 inch tire' }] })).toBe(true);
    });
    it('is false for a test vehicle imported from the certification CSV', () => {
        // Neither field exists on those, and no amount of looking produces
        // them — which is the difference between "nothing to go on" and
        // "fetch this certificate".
        expect(hasCsiDetail({ epa_tests: [{ procedure_code: 77 }], epa_covered_models: [] })).toBe(false);
        expect(hasCsiDetail({})).toBe(false);
    });
});
