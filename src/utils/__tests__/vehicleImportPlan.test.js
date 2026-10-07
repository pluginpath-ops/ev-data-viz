import { describe, it, expect } from 'vitest';
import { buildImportPlan, yearSpan, yearsOverlap } from '../vehicleImportPlan';
import { parseVehicleImportText } from '../parseVehicleImport';

const plan = (rows, vehicles = []) =>
    buildImportPlan(parseVehicleImportText(JSON.stringify(rows), 'x.json').rows, { vehicles });

describe('yearSpan', () => {
    it('reads one year, a range, and a short range', () => {
        expect(yearSpan('2025')).toEqual([2025, 2025]);
        expect(yearSpan('2022-2023')).toEqual([2022, 2023]);
        expect(yearSpan('2022-23')).toEqual([2022, 2023]);
        expect(yearSpan(2021)).toEqual([2021, 2021]);
    });
    it('returns null when no year is named', () => {
        expect(yearSpan('')).toBeNull();
        expect(yearSpan(null)).toBeNull();
    });
    it('treats a missing span as overlapping everything', () => {
        expect(yearsOverlap(null, [2020, 2021])).toBe(true);
        expect(yearsOverlap([2020, 2021], [2021, 2023])).toBe(true);
        expect(yearsOverlap([2020, 2021], [2022, 2023])).toBe(false);
    });
});

describe('same name, different model year', () => {
    const rows = [
        { name: 'Model 3 LR', year: '2022-2023', range: 358 },
        { name: 'Model 3 LR', year: '2021', range: 353, inherits_from: '2022-2023 Model 3 LR' },
        { name: 'Model 3 LR', year: '2020', range: 322, inherits_from: '2021 Model 3 LR' },
    ];

    it('creates each year as its own vehicle', () => {
        const { rows: out } = plan(rows);
        expect(out.map(r => r.action)).toEqual(['create', 'create', 'create']);
        expect(out.every(r => r.errors.length === 0)).toBe(true);
    });

    it('chains each year to the one before it in the file', () => {
        const { rows: out } = plan(rows);
        expect(out[1].inherit).toEqual({ rowIndex: 0 });
        expect(out[2].inherit).toEqual({ rowIndex: 1 });
    });

    it('still rejects two rows with one name in overlapping years', () => {
        const { rows: out } = plan([
            { name: 'Model 3 LR', year: '2021', range: 353 },
            { name: 'Model 3 LR', year: '2021', range: 999 },
        ]);
        expect(out[1].action).toBe('error');
        expect(out[1].errors[0]).toMatch(/same name and model year/);
    });

    it('does not match an existing vehicle sold in another year', () => {
        const existing = [{ id: 25, name: 'Model Y LR', year: '2022-2023', specs: {} }];
        const { rows: out } = plan([{ name: 'Model Y LR', year: '2024', range: 310 }], existing);
        expect(out[0].action).toBe('create');
    });

    it('matches an existing vehicle in an overlapping year', () => {
        const existing = [{ id: 25, name: 'Model Y LR', year: '2022-2023', specs: {} }];
        const { rows: out } = plan([{ name: 'Model Y LR', year: '2023', range: 330 }], existing);
        expect(out[0].action).toBe('update');
        expect(out[0].vehicleId).toBe(25);
    });

    it('keeps matching by name alone when the row names no year', () => {
        const existing = [{ id: 25, name: 'Model Y LR', year: '2022-2023', specs: {} }];
        const { rows: out } = plan([{ name: 'Model Y LR', range: 330 }], existing);
        expect(out[0].vehicleId).toBe(25);
    });

    it('calls a bare name ambiguous when several vehicles carry it', () => {
        const existing = [
            { id: 1, name: 'Model 3 LR', year: '2021', specs: {} },
            { id: 2, name: 'Model 3 LR', year: '2022-2023', specs: {} },
        ];
        const { rows: out } = plan([{ name: 'Model 3 Perf', year: '2018', inherits_from: 'Model 3 LR' }], existing);
        expect(out[0].inherit).toBeNull();
        expect(out[0].warnings.join(' ')).toMatch(/add the model year/);
    });

    it('resolves the labelled form to the one vehicle', () => {
        const existing = [
            { id: 1, name: 'Model 3 LR', year: '2021', specs: {} },
            { id: 2, name: 'Model 3 LR', year: '2022-2023', specs: {} },
        ];
        const { rows: out } = plan([{ name: 'Model 3 Perf', year: '2018', inherits_from: '2021 Model 3 LR' }], existing);
        expect(out[0].inherit).toEqual({ vehicleId: 1 });
    });
});
