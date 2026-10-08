import { describe, it, expect } from 'vitest';
import { isOlderCertification, isHeld, mergeRow, planChildren, planGroupImport, uniqueCoveredModels } from '../epaImportMerge';

const manual = { source: 'manual', at: '2026-09-01T00:00:00Z' };

describe('isHeld', () => {
    it('holds anything a person or a promotion set, never the PDF', () => {
        expect(isHeld({ a: manual }, 'a')).toBe(true);
        expect(isHeld({ a: { source: 'fe_guide' } }, 'a')).toBe(true);
        expect(isHeld({ a: { source: 'pdf' } }, 'a')).toBe(false);
        // a certificate PDF supersedes the machine ingests that came before it
        expect(isHeld({ a: { source: 'csv' } }, 'a')).toBe(false);
        expect(isHeld({ a: { source: 'j1634' } }, 'a')).toBe(false);
        expect(isHeld({}, 'a')).toBe(false);
        expect(isHeld(undefined, 'a')).toBe(false);
    });
});

describe('mergeRow', () => {
    it('writes a new row from the PDF and tags populated fields', () => {
        const m = mergeRow(null, { a: 1, b: null });
        expect(m.payload).toEqual({ a: 1, b: null });
        expect(m.overrides).toEqual({ a: { source: 'pdf' } });
    });

    it('leaves a hand-set field out of the payload and keeps its tag', () => {
        const existing = { a: 5, b: 2, overrides: { a: manual, b: { source: 'pdf' } } };
        const m = mergeRow(existing, { a: 9, b: 3 });
        expect(m.payload).toEqual({ b: 3 });          // a is untouched in the DB
        expect(m.overrides.a).toEqual(manual);
        expect(m.kept).toEqual([{ field: 'a', kept: 5, pdf: 9 }]);
    });

    it('does not report a held field when the PDF agrees or says nothing', () => {
        const existing = { a: 5, b: 2, overrides: { a: manual, b: manual } };
        expect(mergeRow(existing, { a: '5.0', b: null }).kept).toEqual([]);
    });

    it('never nulls a field the PDF cannot carry', () => {
        const m = mergeRow({ useable_kwh: 84, overrides: {} }, { useable_kwh: null, x: 1 },
            { neverNull: ['useable_kwh'] });
        expect('useable_kwh' in m.payload).toBe(false);
    });

    it('still lets an ordinary PDF null replace a PDF-sourced value', () => {
        const m = mergeRow({ a: 5, overrides: { a: { source: 'pdf' } } }, { a: null });
        expect(m.payload).toEqual({ a: null });
    });
});

describe('planChildren', () => {
    const key = r => r.k;

    it('matches by key, so the id survives', () => {
        const p = planChildren([{ id: 7, k: 'x', overrides: {} }], [{ k: 'x', v: 1 }], key);
        expect(p.update).toHaveLength(1);
        expect(p.update[0].id).toBe(7);
        expect(p.insert).toEqual([]);
        expect(p.remove).toEqual([]);
    });

    it('inserts what is new and removes what the PDF no longer has', () => {
        const p = planChildren([{ id: 1, k: 'old', overrides: {} }], [{ k: 'new' }], key);
        expect(p.insert).toEqual([{ k: 'new' }]);
        expect(p.remove).toEqual([1]);
    });

    it('never removes a row a curator added or edited', () => {
        const p = planChildren([
            { id: 1, k: 'added-by-hand', source: 'manual', overrides: {} },
            { id: 2, k: 'edited', overrides: { v: manual } },
            { id: 3, k: 'plain', overrides: { v: { source: 'pdf' } } },
        ], [], key);
        expect(p.remove).toEqual([3]);
    });
});

describe('planGroupImport', () => {
    const stored = {
        group: { test_group_id: 'G', useable_kwh: 80, model_year: 2024, overrides: { useable_kwh: manual } },
        coefficient_sets: [{ id: 10, category: 'City/Highway', target_a: 30, overrides: { target_a: { source: 'pdf' } } }],
        tests: [{
            id: 20, test_number: 'T1', total_dc_energy_kwh: 99, overrides: { total_dc_energy_kwh: manual },
            epa_test_phases: [{ id: 30, phase_index: 1, dc_energy_kwh: 1.5, distance_mi: 7.45, overrides: { dc_energy_kwh: manual } }],
        }],
    };
    const incoming = {
        group: { test_group_id: 'G', model_year: 2025, useable_kwh: null },
        coefficient_sets: [{ category: 'City/Highway', target_a: 31 }],
        tests: [{ test_number: 'T1', total_dc_energy_kwh: null, phases: [{ phase_index: 1, dc_energy_kwh: null, distance_mi: 7.5 }] }],
    };

    it('updates in place and keeps every curator-held value', () => {
        const plan = planGroupImport(stored, incoming);
        expect(plan.group.payload).toEqual({ test_group_id: 'G', model_year: 2025 });
        expect(plan.group.overrides.useable_kwh).toEqual(manual);
        expect(plan.coefficients.update[0]).toMatchObject({ id: 10, payload: { target_a: 31 } });
        const t = plan.tests.update[0];
        expect(t.id).toBe(20);
        expect('total_dc_energy_kwh' in t.payload).toBe(false);   // hand-entered, PDF had none
        expect(t.phases.update[0]).toMatchObject({ id: 30, payload: { distance_mi: 7.5 } });
        expect('dc_energy_kwh' in t.phases.update[0].payload).toBe(false);
        expect(plan.coefficients.remove).toEqual([]);
        expect(plan.tests.remove).toEqual([]);
    });

    it('reports where the PDF disagreed with a held value', () => {
        const disagree = structuredClone(incoming);
        disagree.tests[0].total_dc_energy_kwh = 101.2;
        const plan = planGroupImport(stored, disagree);
        expect(plan.kept).toEqual([{ where: 'test T1', field: 'total_dc_energy_kwh', kept: 99, pdf: 101.2 }]);
    });

    it('is a plain insert for a group that does not exist yet', () => {
        const plan = planGroupImport({ group: null, coefficient_sets: [], tests: [] }, incoming);
        expect(plan.group.overrides.model_year).toEqual({ source: 'pdf' });
        expect(plan.coefficients.insert).toHaveLength(1);
        expect(plan.tests.insert[0].phases).toHaveLength(1);
        expect(plan.kept).toEqual([]);
    });
});

describe('older certification guard (#374)', () => {
    const stored = (year) => ({
        group: {
            test_group_id: 'G', model_year: year, epa_test_family_id: `F${year}`, source_file: `${year}.pdf`,
            carryover_test_group_id: `C${year}`, carryover_model_year: year - 1, overrides: {},
        },
        coefficient_sets: [{ id: 10, category: 'City/Highway', target_a: 30, overrides: {} }],
        tests: [],
    });
    const incoming = (year) => ({
        group: {
            test_group_id: 'G', model_year: year, epa_test_family_id: `F${year}`, source_file: `${year}.pdf`,
            carryover_test_group_id: `C${year}`, carryover_model_year: year - 1, battery_kwh: 77,
        },
        coefficient_sets: [{ category: 'City/Highway', target_a: 31 }],
        tests: [],
    });
    const IDENTITY = ['model_year', 'epa_test_family_id', 'source_file', 'carryover_test_group_id', 'carryover_model_year'];

    it('keeps the newer identity when an older file arrives, but still merges lab data', () => {
        const plan = planGroupImport(stored(2025), incoming(2024));
        for (const f of IDENTITY) expect(f in plan.group.payload).toBe(false);
        expect(plan.group.payload.battery_kwh).toBe(77);
        expect(plan.coefficients.update[0].payload.target_a).toBe(31);
        expect(plan.holdIdentity).toBe(true);
        expect(plan.guarded.map(g => g.field).sort()).toEqual([...IDENTITY].sort());
        expect(plan.guarded.find(g => g.field === 'model_year')).toMatchObject({ kept: 2025, pdf: 2024 });
    });

    it('replaces the identity when a newer file arrives', () => {
        const plan = planGroupImport(stored(2024), incoming(2025));
        expect(plan.group.payload).toMatchObject({ model_year: 2025, epa_test_family_id: 'F2025', source_file: '2025.pdf' });
        expect(plan.holdIdentity).toBe(false);
        expect(plan.guarded).toEqual([]);
    });

    it('replaces the identity on a same-year re-import', () => {
        const plan = planGroupImport(stored(2025), incoming(2025));
        expect(plan.group.payload).toMatchObject({ model_year: 2025, source_file: '2025.pdf' });
        expect(plan.holdIdentity).toBe(false);
    });

    it('never blocks when either year is missing', () => {
        expect(planGroupImport(stored(null), incoming(2024)).holdIdentity).toBe(false);
        const noYear = incoming(2024);
        noYear.group.model_year = null;
        const plan = planGroupImport(stored(2025), noYear);
        expect(plan.holdIdentity).toBe(false);
        expect('epa_test_family_id' in plan.group.payload).toBe(true);
        expect(isOlderCertification({ model_year: 2025 }, {})).toBe(false);
    });

    it('does not guard a brand-new group', () => {
        const plan = planGroupImport({ group: null, coefficient_sets: [], tests: [] }, incoming(2024));
        expect(plan.holdIdentity).toBe(false);
        expect(plan.group.payload.model_year).toBe(2024);
    });

    it('tells the executor to leave the covered-models list alone only when held', () => {
        expect(planGroupImport(stored(2025), incoming(2023)).holdIdentity).toBe(true);
        expect(planGroupImport(stored(2023), incoming(2025)).holdIdentity).toBe(false);
    });
});

describe('uniqueCoveredModels', () => {
    it('keeps the first row per (carline name, region), null region counting as a value', () => {
        const rows = [
            { carline_number: '502', carline_name: 'RCV-Delivery', certification_region: null },
            { carline_number: '502', carline_name: 'RCV-Delivery', certification_region: null },
            { carline_number: '702', carline_name: 'RCV-Delivery', certification_region: null },
            { carline_number: '501', carline_name: 'EDV 500 MCA', certification_region: 'Federal' },
            { carline_number: '501', carline_name: 'EDV 500 MCA', certification_region: 'California' },
        ];
        const out = uniqueCoveredModels(rows);
        expect(out.map(r => r.carline_number)).toEqual(['502', '501', '501']);
    });

    it('treats an undefined region the same as null', () => {
        expect(uniqueCoveredModels([{ carline_name: 'A' }, { carline_name: 'A', certification_region: null }])).toHaveLength(1);
    });

    it('tolerates no rows', () => {
        expect(uniqueCoveredModels(undefined)).toEqual([]);
    });
});
