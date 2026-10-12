import { describe, it, expect } from 'vitest';
import { isOlderCertification, isHeld, mergeRow, planChildren, planTestVehicleImport, uniqueCoveredModels } from '../epaImportMerge';

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

describe('planTestVehicleImport', () => {
    const stored = {
        testVehicle: { test_vehicle_id: 'G', useable_kwh: 80, model_year: 2024, overrides: { useable_kwh: manual } },
        coefficient_sets: [{ id: 10, category: 'City/Highway', target_a: 30, overrides: { target_a: { source: 'pdf' } } }],
        tests: [{
            id: 20, test_number: 'T1', total_dc_energy_kwh: 99, overrides: { total_dc_energy_kwh: manual },
            epa_test_phases: [{ id: 30, phase_index: 1, dc_energy_kwh: 1.5, distance_mi: 7.45, overrides: { dc_energy_kwh: manual } }],
        }],
    };
    const incoming = {
        testVehicle: { test_vehicle_id: 'G', model_year: 2025, useable_kwh: null },
        coefficient_sets: [{ category: 'City/Highway', target_a: 31 }],
        tests: [{ test_number: 'T1', total_dc_energy_kwh: null, phases: [{ phase_index: 1, dc_energy_kwh: null, distance_mi: 7.5 }] }],
    };

    it('updates in place and keeps every curator-held value', () => {
        const plan = planTestVehicleImport(stored, incoming);
        expect(plan.testVehicle.payload).toEqual({ test_vehicle_id: 'G', model_year: 2025 });
        expect(plan.testVehicle.overrides.useable_kwh).toEqual(manual);
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
        const plan = planTestVehicleImport(stored, disagree);
        expect(plan.kept).toEqual([{ where: 'test T1', field: 'total_dc_energy_kwh', kept: 99, pdf: 101.2 }]);
    });

    describe('only the record\'s own file removes rows', () => {
        // Stored from the MY2026 file: two tests, the second with two phases,
        // and a second coefficient set. The MY2024 file lists less of it.
        const pdfTag = { source: 'pdf' };
        const fromFile = (file) => ({
            testVehicle: { test_vehicle_id: 'K', model_year: 2026, source_file: file, overrides: {} },
            coefficient_sets: [
                { id: 1, category: 'City/Highway', target_a: 30, overrides: { target_a: pdfTag } },
                { id: 2, category: 'Alt', target_a: 29, overrides: { target_a: pdfTag } },
            ],
            tests: [
                { id: 309, test_number: 'A', overrides: { test_number: pdfTag }, epa_test_phases: [] },
                { id: 310, test_number: 'B', overrides: { test_number: pdfTag }, epa_test_phases: [
                    { id: 41, phase_index: 1, overrides: {} }, { id: 42, phase_index: 2, overrides: {} },
                ] },
            ],
        });
        const file = (name) => ({
            testVehicle: { test_vehicle_id: 'K', model_year: 2024, source_file: name },
            coefficient_sets: [{ category: 'City/Highway', target_a: 30 }],
            tests: [{ test_number: 'B', phases: [{ phase_index: 1 }] }, { test_number: 'C', phases: [] }],
        });

        it('a different file adds and updates, and removes nothing', () => {
            const plan = planTestVehicleImport(fromFile('2026.pdf'), file('2024.pdf'));
            expect(plan.tests.insert.map(t => t.row.test_number)).toEqual(['C']);
            expect(plan.tests.update.map(u => u.id)).toEqual([310]);
            expect(plan.tests.remove).toEqual([]);
            expect(plan.tests.update[0].phases.remove).toEqual([]);
            expect(plan.coefficients.remove).toEqual([]);
            expect(plan.spared).toBe(3);   // test A, phase 2, the Alt set
        });

        it('the same file, re-imported, still removes what it no longer lists', () => {
            const plan = planTestVehicleImport(fromFile('2024.pdf'), file('2024.pdf'));
            expect(plan.tests.remove).toEqual([309]);
            expect(plan.tests.update[0].phases.remove).toEqual([42]);
            expect(plan.coefficients.remove).toEqual([2]);
            expect(plan.spared).toBe(0);
        });

        it('a record with no file on it behaves as before', () => {
            const plan = planTestVehicleImport(fromFile(null), file('2024.pdf'));
            expect(plan.tests.remove).toEqual([309]);
            expect(plan.spared).toBe(0);
        });
    });

    it('is a plain insert for a test vehicle that does not exist yet', () => {
        const plan = planTestVehicleImport({ testVehicle: null, coefficient_sets: [], tests: [] }, incoming);
        expect(plan.testVehicle.overrides.model_year).toEqual({ source: 'pdf' });
        expect(plan.coefficients.insert).toHaveLength(1);
        expect(plan.tests.insert[0].phases).toHaveLength(1);
        expect(plan.kept).toEqual([]);
    });
});

describe('older certification guard (#374)', () => {
    const stored = (year) => ({
        testVehicle: {
            test_vehicle_id: 'G', model_year: year, test_group: `F${year}`, source_file: `${year}.pdf`, overrides: {},
        },
        coefficient_sets: [{ id: 10, category: 'City/Highway', target_a: 30, overrides: {} }],
        tests: [],
    });
    const incoming = (year) => ({
        testVehicle: {
            test_vehicle_id: 'G', model_year: year, test_group: `F${year}`, source_file: `${year}.pdf`, battery_kwh: 77,
        },
        coefficient_sets: [{ category: 'City/Highway', target_a: 31 }],
        tests: [],
    });
    const IDENTITY = ['model_year', 'test_group', 'source_file'];

    it('keeps the newer identity when an older file arrives, and only fills blanks', () => {
        const plan = planTestVehicleImport(stored(2025), incoming(2024));
        for (const f of IDENTITY) expect(f in plan.testVehicle.payload).toBe(false);
        expect(plan.testVehicle.payload.battery_kwh).toBe(77);              // blank: filled
        expect('target_a' in plan.coefficients.update[0].payload).toBe(false); // the newer 30 stands
        expect(plan.holdIdentity).toBe(true);
        expect(plan.guarded.map(g => g.field).sort()).toEqual([...IDENTITY, 'target_a'].sort());
        expect(plan.guarded.find(g => g.field === 'model_year')).toMatchObject({ kept: 2025, pdf: 2024 });
        expect(plan.guarded.find(g => g.field === 'target_a')).toMatchObject({ where: 'coefficients City/Highway', kept: 30, pdf: 31 });
    });

    it('an older file adds the tests it lists, fills their blanks, and replaces no value', () => {
        const s = stored(2025);
        s.tests = [{ id: 5, test_number: 'T1', total_dc_energy_kwh: 80, lab_id: null, overrides: {},
                     epa_test_phases: [{ id: 6, phase_index: 1, distance_mi: 7.45, dc_energy_kwh: null, overrides: {} }] }];
        const inc = incoming(2024);
        inc.tests = [
            { test_number: 'T1', total_dc_energy_kwh: 81, lab_id: 'Lab', phases: [{ phase_index: 1, distance_mi: 7.5, dc_energy_kwh: 1.2 }] },
            { test_number: 'T0', total_dc_energy_kwh: 70, phases: [] },
        ];
        const plan = planTestVehicleImport(s, inc);
        const t = plan.tests.update[0];
        expect(t.payload).toEqual({ lab_id: 'Lab' });
        expect(t.phases.update[0].payload).toEqual({ dc_energy_kwh: 1.2 });
        expect(plan.tests.insert.map(x => x.row.test_number)).toEqual(['T0']);
        expect(plan.guarded.filter(g => g.where.startsWith('test ')).map(g => g.field)).toEqual(['total_dc_energy_kwh', 'distance_mi']);
    });

    it('a newer or same-year file still replaces values', () => {
        const s = stored(2024);
        s.tests = [{ id: 5, test_number: 'T1', total_dc_energy_kwh: 80, overrides: {}, epa_test_phases: [] }];
        const inc = incoming(2025);
        inc.tests = [{ test_number: 'T1', total_dc_energy_kwh: 81, phases: [] }];
        expect(planTestVehicleImport(s, inc).tests.update[0].payload.total_dc_energy_kwh).toBe(81);
        expect(planTestVehicleImport(s, inc).coefficients.update[0].payload.target_a).toBe(31);
    });

    it('replaces the identity when a newer file arrives', () => {
        const plan = planTestVehicleImport(stored(2024), incoming(2025));
        expect(plan.testVehicle.payload).toMatchObject({ model_year: 2025, test_group: 'F2025', source_file: '2025.pdf' });
        expect(plan.holdIdentity).toBe(false);
        expect(plan.guarded).toEqual([]);
    });

    it('replaces the identity on a same-year re-import', () => {
        const plan = planTestVehicleImport(stored(2025), incoming(2025));
        expect(plan.testVehicle.payload).toMatchObject({ model_year: 2025, source_file: '2025.pdf' });
        expect(plan.holdIdentity).toBe(false);
    });

    it('never blocks when either year is missing', () => {
        expect(planTestVehicleImport(stored(null), incoming(2024)).holdIdentity).toBe(false);
        const noYear = incoming(2024);
        noYear.testVehicle.model_year = null;
        const plan = planTestVehicleImport(stored(2025), noYear);
        expect(plan.holdIdentity).toBe(false);
        expect('test_group' in plan.testVehicle.payload).toBe(true);
        expect(isOlderCertification({ model_year: 2025 }, {})).toBe(false);
    });

    it('does not guard a brand-new test vehicle', () => {
        const plan = planTestVehicleImport({ testVehicle: null, coefficient_sets: [], tests: [] }, incoming(2024));
        expect(plan.holdIdentity).toBe(false);
        expect(plan.testVehicle.payload.model_year).toBe(2024);
    });

    it('tells the executor to leave the covered-models list alone only when held', () => {
        expect(planTestVehicleImport(stored(2025), incoming(2023)).holdIdentity).toBe(true);
        expect(planTestVehicleImport(stored(2023), incoming(2025)).holdIdentity).toBe(false);
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
