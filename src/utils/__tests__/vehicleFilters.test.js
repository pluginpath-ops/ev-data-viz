/**
 * One filter model for Vehicles & Specs (#338): what Cards, List and Table all
 * show, and the URL a filtered view is shared by.
 */
import { describe, it, expect } from 'vitest';
import {
    EMPTY_VEHICLE_FILTERS, filtersActive, facetState, toggleInclude, toggleExclude, setMatchAll, clearFacet, setSearch,
    vehicleFilterContext, filterVehicles, vehicleFacetCounts, activeFilterChips, removeChip,
    encodeVehicleFilters, decodeVehicleFilters, searchMatches, VEHICLE_FILTER_PARAMS,
} from '../vehicleFilters';

const fleet = [
    { id: 1, name: 'R1S', make: 'Rivian', model: 'R1S', year: 2025, specs: { powertrain: { drive_type: 'AWD' } },
      tags: [{ name: 'SUV' }, { name: '800 V' }], runs: [{ kind: 'charging' }, { kind: 'range' }] },
    { id: 2, name: 'Model 3', make: 'Tesla', model: 'Model 3', year: 2026, specs: { powertrain: { drive_type: 'RWD' } },
      tags: [{ name: 'Sedan' }], runs: [{ kind: 'charging' }] },
    { id: 3, name: 'Lyriq', make: 'Cadillac', model: 'Lyriq', year: '2024-2026', specs: {},
      tags: [{ name: 'SUV' }], runs: [] },
    { id: 4, name: 'F-150 Lightning', make: 'Ford', model: 'F-150', year: 2024, specs: { powertrain: { drive_type: 'AWD' } },
      tags: [{ name: 'Truck' }], runs: [{ kind: 'range' }] },
];
const ctx = vehicleFilterContext(fleet, {});
const ids = (filters) => filterVehicles(fleet, filters, ctx).map(v => v.id);

describe('matching', () => {
    it('includes, excludes, and matches any or all', () => {
        expect(ids(toggleInclude(EMPTY_VEHICLE_FILTERS, 'make', 'Tesla'))).toEqual([2]);
        expect(ids(toggleExclude(EMPTY_VEHICLE_FILTERS, 'tags', 'SUV'))).toEqual([2, 4]);
        const suvOr800 = toggleInclude(toggleInclude(EMPTY_VEHICLE_FILTERS, 'tags', 'SUV'), 'tags', '800 V');
        expect(ids(suvOr800)).toEqual([1, 3]);
        expect(ids(setMatchAll(suvOr800, 'tags', true))).toEqual([1]);
    });

    it('reads drive type through the resolved specs', () => {
        expect(ids(toggleInclude(EMPTY_VEHICLE_FILTERS, 'drive', 'AWD'))).toEqual([1, 4]);
    });

    it('matches test data all-by-default: "has both charging and range"', () => {
        const both = toggleInclude(toggleInclude(EMPTY_VEHICLE_FILTERS, 'data', 'charging'), 'data', 'range');
        expect(facetState(both, 'data').all).toBe(true);
        expect(ids(both)).toEqual([1]);
        expect(ids(toggleExclude(EMPTY_VEHICLE_FILTERS, 'data', 'charging'))).toEqual([3, 4]);
    });

    it('including a value clears its exclusion, and the other way round', () => {
        const out = toggleExclude(EMPTY_VEHICLE_FILTERS, 'make', 'Ford');
        const back = toggleInclude(out, 'make', 'Ford');
        expect(facetState(back, 'make')).toMatchObject({ in: ['Ford'], out: [] });
        expect(facetState(toggleExclude(back, 'make', 'Ford'), 'make')).toMatchObject({ in: [], out: ['Ford'] });
        expect(filtersActive(clearFacet(back, 'make'))).toBe(false);
    });

    it('searches name, make, model, trim, year and tags, and a year inside a span', () => {
        expect(ids(setSearch(EMPTY_VEHICLE_FILTERS, 'lyr'))).toEqual([3]);
        expect(ids(setSearch(EMPTY_VEHICLE_FILTERS, 'truck'))).toEqual([4]);
        expect(searchMatches(fleet[2], '2025')).toBe(true);    // 2024-2026
        expect(searchMatches(fleet[1], '2025')).toBe(false);
    });
});

describe('counts', () => {
    it('counts each facet with its own selection removed', () => {
        const tesla = toggleInclude(EMPTY_VEHICLE_FILTERS, 'make', 'Tesla');
        const counts = vehicleFacetCounts(fleet, tesla, ctx);
        // Make ignores its own choice: every make still shows what it would leave.
        expect(counts.make.counts.get('Rivian')).toBe(1);
        // Other facets count within Tesla.
        expect(counts.tags.counts.get('SUV') ?? 0).toBe(0);
        expect(counts.tags.counts.get('Sedan')).toBe(1);
        expect(counts.make.values).toEqual(expect.arrayContaining(['Rivian', 'Tesla', 'Cadillac', 'Ford']));
    });
});

describe('chips', () => {
    it('lists each active value, says "not" for an exclusion, and removes it', () => {
        let f = toggleInclude(EMPTY_VEHICLE_FILTERS, 'make', 'Kia');
        f = toggleExclude(f, 'tags', 'Truck');
        const chips = activeFilterChips(f);
        expect(chips.map(c => c.text)).toEqual(['Kia', 'not Truck']);
        expect(filtersActive(removeChip(removeChip(f, chips[0]), chips[1]))).toBe(false);
    });

    it('names a test-data value by its label', () => {
        expect(activeFilterChips(toggleInclude(EMPTY_VEHICLE_FILTERS, 'data', 'charging'))[0].text).toBe('Charging');
    });
});

describe('URL', () => {
    it('writes one parameter per facet, a "-" for an exclusion, and _all for all', () => {
        let f = toggleInclude(EMPTY_VEHICLE_FILTERS, 'make', 'Kia');
        f = toggleInclude(f, 'make', 'Hyundai');
        f = toggleExclude(f, 'tags', 'Truck');
        f = toggleInclude(f, 'tags', 'SUV');
        f = setMatchAll(f, 'tags', true);
        f = setSearch(f, 'ioniq');
        const p = encodeVehicleFilters(f);
        expect(p.get('mk')).toBe('Kia,Hyundai');
        expect(p.get('tg')).toBe('SUV,-Truck');
        expect(p.get('tg_all')).toBe('1');
        expect(p.get('q')).toBe('ioniq');
        expect(decodeVehicleFilters(p.toString())).toEqual(f);
        expect([...p.keys()].every(k => VEHICLE_FILTER_PARAMS.has(k))).toBe(true);
    });

    it('writes nothing when nothing is set, and reads the table\'s old parameters', () => {
        expect(encodeVehicleFilters(EMPTY_VEHICLE_FILTERS).toString()).toBe('');
        const old = decodeVehicleFilters('vt_q=model&vt_mk=Tesla&vt_mk=Rivian&vt_tg=SUV');
        expect(old.search).toBe('model');
        expect(facetState(old, 'make').in).toEqual(['Tesla', 'Rivian']);
        expect(facetState(old, 'tags').in).toEqual(['SUV']);
    });

    it('decodes anything a URL holds without throwing', () => {
        expect(decodeVehicleFilters('mk=,,,-&tg_all=yes&dt=-')).toEqual({ search: '', facets: {} });
    });
});
