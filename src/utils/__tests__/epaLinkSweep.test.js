import { describe, it, expect } from 'vitest';
import {
    TIERS, tierOf, hasDerivableEnergy, hasCoefficients,
    classifyGroup, buildSweep, sweepProgress, batchable, NO_PROPOSAL_REASONS,
    impliedUsableKwh, groupEnergyFacts, estimatedAdjustedRange, coveredModelMatches,
    wheelMentions, coveredWheelSizes, hasCsiDetail,
} from '../epaLinkSweep';

const group = (o = {}) => ({
    test_group_id: o.id ?? 'TG1',
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
        // came from — a short cycle's DC against a full recharge — so a group
        // whose only energy sits there unlocks nothing.
        expect(hasDerivableEnergy(group({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 80 }] }))).toBe(true);
        expect(hasDerivableEnergy(group({ tests: [{ procedure_code: 84, total_dc_energy_kwh: 80 }] }))).toBe(true);
        expect(hasDerivableEnergy(group({ tests: [{ procedure_code: 86, total_dc_energy_kwh: 6 }] }))).toBe(false);
    });
    it('ignores a usable procedure with no energy recorded', () => {
        expect(hasDerivableEnergy(group({ tests: [{ procedure_code: 77, total_dc_energy_kwh: null }] }))).toBe(false);
    });
    it('reads coefficients off the target set', () => {
        expect(hasCoefficients(group({ coeffs: [{ target_a: 30 }] }))).toBe(true);
        expect(hasCoefficients(group({ coeffs: [{ target_a: null }] }))).toBe(false);
    });
    it('ranks energy above coefficients above everything else', () => {
        expect(tierOf(group({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 80 }], coeffs: [{ target_a: 30 }] }))).toBe('energy');
        expect(tierOf(group({ coeffs: [{ target_a: 30 }] }))).toBe('coefficients');
        expect(tierOf(group({}))).toBe('other');
    });
    it('every tier a group can be put in is declared', () => {
        const keys = TIERS.map(t => t.key);
        [group({ tests: [{ procedure_code: 77, total_dc_energy_kwh: 1 }] }), group({ coeffs: [{ target_a: 1 }] }), group({})]
            .forEach(g => expect(keys).toContain(tierOf(g)));
    });
});

describe('proposals', () => {
    it('proposes a clear same-year winner', () => {
        const rows = [fe({ id: 1, carline: 'R1T Dual Max (21in)' }), fe({ id: 2, carline: 'Something Else Entirely' })];
        const c = classifyGroup(group({ carline: 'R1T Dual Max' }), rows);
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
        const c = classifyGroup(group({ make: 'Hyundai', carline: 'Ioniq 5' }), rows);
        expect(c.proposal).toBeNull();
        expect(c.reason).toBe('tied');
    });
    it('declines a borrowed year but still lists it', () => {
        const rows = [fe({ id: 1, year: 2025, carline: 'R1T Dual Max' })];
        const c = classifyGroup(group({ year: 2027, carline: 'R1T Dual Max' }), rows);
        expect(c.proposal).toBeNull();
        expect(c.reason).toBe('wrong-year');
        expect(c.ranked).toHaveLength(1);
    });
    it('declines when the make matches but no carline is close', () => {
        const c = classifyGroup(group({ carline: 'R1T' }), [fe({ id: 1, carline: 'Completely Different Vehicle' })]);
        expect(c.proposal).toBeNull();
        expect(c.reason).toBe('below-floor');
    });
    it('reports no candidates when the manufacturer has none staged', () => {
        const c = classifyGroup(group({ make: 'Rivian' }), [fe({ id: 1, make: 'BMW', carline: 'i4' })]);
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
    const energyProposed = group({ id: 'A', carline: 'R1T Dual Max', tests: [{ procedure_code: 77, total_dc_energy_kwh: 80 }] });
    const energyManual   = group({ id: 'B', carline: 'Nothing Like It', tests: [{ procedure_code: 77, total_dc_energy_kwh: 80 }] });
    const coeffProposed  = group({ id: 'C', carline: 'R1T Dual Max', coeffs: [{ target_a: 30 }] });
    const plain          = group({ id: 'D', carline: 'R1T Dual Max' });

    it('orders by tier, then puts the one-click cases first inside it', () => {
        const out = buildSweep([plain, coeffProposed, energyManual, energyProposed], rows);
        expect(out.map(i => i.group.test_group_id)).toEqual(['A', 'B', 'C', 'D']);
    });
    it('counts progress per tier', () => {
        const p = sweepProgress(buildSweep([plain, coeffProposed, energyManual, energyProposed], rows));
        expect(p.energy).toEqual({ total: 2, proposed: 1, manual: 1 });
        expect(p.coefficients).toEqual({ total: 1, proposed: 1, manual: 0 });
    });
    it('batches only what has a safe proposal', () => {
        const out = buildSweep([plain, coeffProposed, energyManual, energyProposed], rows);
        expect(batchable(out).map(i => i.group.test_group_id)).toEqual(['A', 'C', 'D']);
        // The tie and wrong-year cases must never reach a batch confirm.
        expect(batchable(out).every(i => i.proposal)).toBe(true);
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

    it('reads the group’s own measured energy from a usable procedure only', () => {
        // The real group carries both: proc 86 at 6.09 kWh and proc 77 at
        // 144.23. Taking the first test would have reported 6 kWh and pointed
        // at the smallest pack — the opposite of the truth.
        const f = groupEnergyFacts({
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
    it('is all-null when the group knows nothing about its own energy', () => {
        expect(groupEnergyFacts({ epa_tests: [], epa_coefficient_sets: [] }))
            .toEqual({ dcEnergyKwh: null, procedure: null, etwLbs: null, useableKwh: null });
    });
});

describe('identifier matches and shared certifications', () => {
    const g = (o) => ({ test_group_id: o.id, make: 'Lucid', epa_carline_name: o.carline ?? 'Air Touring AWD',
        model_year: o.year ?? 2024, epa_tests: [], epa_coefficient_sets: [] });
    const row = (o) => ({ id: o.id, model_year: o.year ?? 2024, division: 'Lucid',
        carline: o.carline, smog_test_group: o.tg, label_comb_range_mi: o.range ?? 400, label_comb_mpge: 120 });

    it('takes an identifier match over any name score', () => {
        // The guide's smog test group is usually EPA's own identifier, but for
        // 10 groups in the corpus it IS our test group id. That is not a
        // similarity — it is the same string.
        const rows = [
            row({ id: 1, carline: 'Completely Different Car', tg: 'ABC123' }),
            row({ id: 2, carline: 'Air Touring AWD w/19" wheels', tg: 'ZZZ' }),
        ];
        const c = classifyGroup(g({ id: 'ABC123' }), rows);
        expect(c.exactIdMatch).toBe(true);
        expect(c.proposal.row.id).toBe(1);
    });
    it('declines an identifier match that is not unique', () => {
        // The guide's test group is not unique per configuration, so several
        // rows can carry it — that is a choice, not an answer.
        const rows = [row({ id: 1, carline: 'A', tg: 'ABC123' }), row({ id: 2, carline: 'B', tg: 'ABC123' })];
        expect(classifyGroup(g({ id: 'ABC123' }), rows).exactIdMatch).toBe(false);
    });

    it('names the case where the candidates are one certification', () => {
        // MY2024 Lucid Air Touring AWD is three rows at 411, 382 and 365 miles
        // for 19, 20 and 21 inch wheels, ALL under smog group RLMUV00.0ZA2.
        // EPA certified it once; nothing on our side picks a wheel.
        const rows = [
            row({ id: 1, carline: 'Air Touring AWD w/19" wheels', tg: 'RLMUV00.0ZA2', range: 411 }),
            row({ id: 2, carline: 'Air Touring AWD w/20" wheels', tg: 'RLMUV00.0ZA2', range: 382 }),
            row({ id: 3, carline: 'Air Touring AWD w/21" wheels', tg: 'RLMUV00.0ZA2', range: 365 }),
        ];
        const c = classifyGroup(g({ id: '202400005', carline: 'Air Touring' }), rows);
        expect(c.proposal).toBeNull();
        expect(c.shared).toEqual({ smogTestGroup: 'RLMUV00.0ZA2', count: 3 });
    });
    it('says nothing when the candidates are genuinely different certifications', () => {
        const rows = [
            row({ id: 1, carline: 'Air Touring AWD', tg: 'AAA' }),
            row({ id: 2, carline: 'Air Sapphire AWD', tg: 'BBB' }),
        ];
        expect(classifyGroup(g({ id: 'X', carline: 'Air' }), rows).shared).toBeNull();
    });
});

describe('estimated label range', () => {
    it('adjusts the unadjusted range with the group’s own factor', () => {
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
    it('is null when the group has no unadjusted range — most of them', () => {
        expect(estimatedAdjustedRange({})).toBeNull();
    });
});

describe('covered models', () => {
    const g = (covered, o = {}) => ({
        test_group_id: o.id ?? 'TG', make: 'Rivian',
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
        const c = classifyGroup(g(['R1T Performance Dual Max (20in)']), rows);
        expect(c.coveredMatch).toBe(true);
        expect(c.proposal.row.id).toBe(2);
    });
    it('ignores case, quotes and spacing', () => {
        const rows = [row(1, 'EX90 Twin Motor (21 inch Wheels)')];
        const c = classifyGroup(g(['ex90  twin motor (21 inch wheels)']), rows);
        expect(c.coveredMatch).toBe(true);
    });
    it('declines when the certificate covers several of the candidates', () => {
        // A certificate covering four configurations matches four guide rows;
        // choosing among them is still the curator's.
        const rows = [row(1, 'R1S Dual Max (20in)'), row(2, 'R1S Dual Max (22in)')];
        const c = classifyGroup(g(['R1S Dual Max (20in)', 'R1S Dual Max (22in)']), rows);
        expect(c.coveredMatch).toBe(false);
    });
    it('does not match across model years', () => {
        const rows = [row(1, 'R1T Performance Dual Max (20in)', 2024)];
        expect(classifyGroup(g(['R1T Performance Dual Max (20in)'], { year: 2025 }), rows).coveredMatch).toBe(false);
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
    it('is empty for a group with no CSI detail — a CSV-imported group', () => {
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
    it('is false for a group imported from the certification CSV', () => {
        // Neither field exists on those, and no amount of looking produces
        // them — which is the difference between "nothing to go on" and
        // "fetch this certificate".
        expect(hasCsiDetail({ epa_tests: [{ procedure_code: 77 }], epa_covered_models: [] })).toBe(false);
        expect(hasCsiDetail({})).toBe(false);
    });
});
