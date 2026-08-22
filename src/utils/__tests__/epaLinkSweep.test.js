import { describe, it, expect } from 'vitest';
import {
    TIERS, tierOf, hasDerivableEnergy, hasCoefficients,
    classifyGroup, buildSweep, sweepProgress, batchable, NO_PROPOSAL_REASONS,
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
