import { describe, it, expect } from 'vitest';
import { reorderSelectionBySort } from '../sortSelection';
import { buildVehicleRows } from '../vehicleTable';

const vehicle = (id, name, hp) => ({
    id, name, make: 'Make', model: name, trim: '', year: 2025,
    specs: hp == null ? {} : { powertrain: { horsepower_hp: hp } }, tags: [], epa_mappings: [],
});

// hp: 1 = 300, 2 = 500, 3 = 100, 4 = 500 (ties with 2), 5 and 6 blank
const rows = buildVehicleRows([
    vehicle(1, 'Alpha', 300), vehicle(2, 'Bravo', 500), vehicle(3, 'Charlie', 100),
    vehicle(4, 'Delta', 500), vehicle(5, 'Echo', null), vehicle(6, 'Foxtrot', null),
]);
const HP = 'powertrain.horsepower_hp';

describe('reorderSelectionBySort (#457)', () => {
    it("puts the selection in the table's order, in the sort direction", () => {
        expect(reorderSelectionBySort([3, 1, 2], rows, HP, 'desc')).toEqual([2, 1, 3]);
        expect(reorderSelectionBySort([2, 1, 3], rows, HP, 'asc')).toEqual([3, 1, 2]);
    });

    it('puts blanks last in either direction', () => {
        expect(reorderSelectionBySort([5, 3, 1], rows, HP, 'desc')).toEqual([1, 3, 5]);
        expect(reorderSelectionBySort([5, 1, 3], rows, HP, 'asc')).toEqual([3, 1, 5]);
    });

    it('keeps equal values, and blanks, in their current relative order', () => {
        expect(reorderSelectionBySort([4, 3, 2], rows, HP, 'desc')).toEqual([4, 2, 3]);
        expect(reorderSelectionBySort([2, 3, 4], rows, HP, 'desc')).toEqual([2, 4, 3]);
        expect(reorderSelectionBySort([6, 1, 5], rows, HP, 'desc')).toEqual([1, 6, 5]);
    });

    it('orders by text columns too', () => {
        expect(reorderSelectionBySort([3, 1, 2], rows, 'name', 'asc')).toEqual([1, 2, 3]);
        expect(reorderSelectionBySort([1, 2, 3], rows, 'name', 'desc')).toEqual([3, 2, 1]);
    });

    it('sorts every selected row it is given, so a filter-hidden vehicle still takes part', () => {
        // The table keeps a selected vehicle through filters, so the caller passes
        // every row, not the filtered ones.
        expect(reorderSelectionBySort([1, 3, 2], rows, HP, 'desc')).toEqual([2, 1, 3]);
    });

    it('returns the same array when the order would not change', () => {
        const sel = [2, 1, 3];
        expect(reorderSelectionBySort(sel, rows, HP, 'desc')).toBe(sel);
    });

    it('is a no-op for a selection of none or one', () => {
        const none = [];
        const one = [3];
        expect(reorderSelectionBySort(none, rows, HP, 'desc')).toBe(none);
        expect(reorderSelectionBySort(one, rows, HP, 'desc')).toBe(one);
    });

    it('is a no-op for a column it does not know', () => {
        const sel = [3, 1, 2];
        expect(reorderSelectionBySort(sel, rows, 'not.a.column', 'asc')).toBe(sel);
    });

    it('keeps a selected id with no row, after the sorted ones', () => {
        expect(reorderSelectionBySort([99, 3, 1], rows, HP, 'desc')).toEqual([1, 3, 99]);
    });

    it('does not mutate its inputs', () => {
        const sel = [3, 1, 2];
        const copy = [...sel];
        const rowIds = rows.map(r => r.id);
        reorderSelectionBySort(sel, rows, HP, 'desc');
        expect(sel).toEqual(copy);
        expect(rows.map(r => r.id)).toEqual(rowIds);
    });
});
