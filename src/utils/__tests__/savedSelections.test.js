import { describe, it, expect } from 'vitest';
import {
    cleanName, normalizeSavedSelection, normalizeSavedSelections, sameVehicles,
    findByName, uniqueName, matchSavedSelection, resolvableIds, planMove,
    SAVED_SELECTION_NAME_MAX,
} from '../savedSelections';

describe('cleanName', () => {
    it('trims, collapses space and caps', () => {
        expect(cleanName('  Mid   size  SUVs ')).toBe('Mid size SUVs');
        expect(cleanName(null)).toBe('');
        expect(cleanName('x'.repeat(80))).toHaveLength(SAVED_SELECTION_NAME_MAX);
    });
});

describe('normalizeSavedSelection', () => {
    it('reads a row and a stored entry alike', () => {
        expect(normalizeSavedSelection({ id: 4, name: 'Trucks', vehicle_ids: [3, 1] }))
            .toEqual({ id: 4, name: 'Trucks', vehicleIds: [3, 1] });
        expect(normalizeSavedSelection({ id: 'l1', name: 'Trucks', vehicleIds: ['3', 1, 1, 'x'] }))
            .toEqual({ id: 'l1', name: 'Trucks', vehicleIds: [3, 1] });
    });
    it('drops entries with no name', () => {
        expect(normalizeSavedSelection({ name: '  ', vehicleIds: [1] })).toBeNull();
        expect(normalizeSavedSelection('junk')).toBeNull();
    });
    it('sorts a list by name, ignoring case', () => {
        const out = normalizeSavedSelections([{ name: 'trucks' }, { name: 'Abc' }, null]);
        expect(out.map(s => s.name)).toEqual(['Abc', 'trucks']);
    });
});

describe('sameVehicles', () => {
    it('ignores order, not membership', () => {
        expect(sameVehicles([1, 2, 3], [3, 1, 2])).toBe(true);
        expect(sameVehicles([1, 2], [1, 2, 3])).toBe(false);
        expect(sameVehicles([1, 1], [1, 2])).toBe(false);
    });
});

describe('names', () => {
    const saved = [{ id: 1, name: 'Trucks', vehicleIds: [1] }];
    it('finds by name ignoring case', () => {
        expect(findByName(saved, ' trucks ')).toBe(saved[0]);
        expect(findByName(saved, 'SUVs')).toBeNull();
    });
    it('numbers a taken name', () => {
        expect(uniqueName('SUVs', ['Trucks'])).toBe('SUVs');
        expect(uniqueName('trucks', ['Trucks'])).toBe('trucks (2)');
        expect(uniqueName('Trucks', ['Trucks', 'Trucks (2)'])).toBe('Trucks (3)');
    });
    it('keeps a numbered long name within the cap', () => {
        const long = 'x'.repeat(SAVED_SELECTION_NAME_MAX);
        expect(uniqueName(long, [long])).toHaveLength(SAVED_SELECTION_NAME_MAX);
    });
});

describe('matchSavedSelection', () => {
    const saved = [
        { id: 1, name: 'Trucks', vehicleIds: [1, 2, 3] },
        { id: 2, name: 'Trucks again', vehicleIds: [3, 2, 1] },
        { id: 3, name: 'SUVs', vehicleIds: [4, 5] },
    ];
    it('names the saved selection the chips exactly are', () => {
        expect(matchSavedSelection([5, 4], saved).current.id).toBe(3);
    });
    it('prefers the last loaded one when two match', () => {
        expect(matchSavedSelection([1, 2, 3], saved, 2).current.id).toBe(2);
    });
    it('marks the loaded one modified once a vehicle changes', () => {
        expect(matchSavedSelection([4, 5, 6], saved, 3)).toEqual({ current: null, modifiedFrom: saved[2] });
    });
    it('says nothing for an empty selection', () => {
        expect(matchSavedSelection([], saved, 3)).toEqual({ current: null, modifiedFrom: null });
    });
    it('forgets a loaded id that no longer exists', () => {
        expect(matchSavedSelection([9], saved, 99)).toEqual({ current: null, modifiedFrom: null });
    });
});

describe('resolvableIds', () => {
    it('skips vehicles the reader cannot see, keeping order', () => {
        expect(resolvableIds([3, 9, 1], [{ id: 1 }, { id: 3 }])).toEqual([3, 1]);
    });
});

describe('planMove', () => {
    const account = [{ id: 1, name: 'Trucks', vehicleIds: [1, 2] }];
    it('skips one the account already holds', () => {
        expect(planMove([{ name: 'trucks', vehicleIds: [2, 1] }], account)).toEqual([]);
    });
    it('renames a clash with different vehicles', () => {
        expect(planMove([{ name: 'Trucks', vehicleIds: [7] }], account))
            .toEqual([{ name: 'Trucks (2)', vehicleIds: [7] }]);
    });
    it('keeps two local clashes apart from each other', () => {
        const out = planMove([
            { name: 'Trucks', vehicleIds: [7] },
            { name: 'Trucks', vehicleIds: [8] },
        ], account);
        expect(out.map(s => s.name)).toEqual(['Trucks (2)', 'Trucks (3)']);
    });
});
