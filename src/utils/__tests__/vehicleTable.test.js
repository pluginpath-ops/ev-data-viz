import { describe, it, expect } from 'vitest';
import {
    VEHICLE_COLUMNS, DEFAULT_VEHICLE_COLUMNS, vehicleColumnByKey, unitFor, needsPerformance,
    buildVehicleRows, formatVehicleCell, filterVehicleRows, sortVehicleRows, vehicleFacets,
    vehicleBarMaxima, vehicleBarPercent, firstSortDir,
    encodeVehicleTableParams, decodeVehicleTableParams, EMPTY_VEHICLE_FILTERS,
    vehicleTableStartSearch, vehicleTableMemory,
} from '../vehicleTable';

const vehicle = (over = {}) => ({
    id: over.id ?? 1, name: 'R1S', make: 'Rivian', model: 'R1S', trim: 'Quad', year: 2025,
    specs: {}, tags: [], epa_mappings: [], ...over,
});

describe('columns', () => {
    it('has one column per key, and every default exists', () => {
        const keys = VEHICLE_COLUMNS.map(c => c.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const key of DEFAULT_VEHICLE_COLUMNS) expect(vehicleColumnByKey(key), key).toBeTruthy();
        expect(DEFAULT_VEHICLE_COLUMNS[0]).toBe('name');
    });

    it('draws bars only where a better direction is a fact', () => {
        expect(vehicleColumnByKey('powertrain.horsepower_hp').bar).toBe(true);
        expect(vehicleColumnByKey('powertrain.motors').bar).toBe(false);
        expect(vehicleColumnByKey('interior.sound_system_speakers').bar).toBe(false);
        expect(vehicleColumnByKey('tested.zero_to_60_rollout_sec')).toMatchObject({ bar: true, better: 'lower' });
    });

    it('moves a unit from the label to the header, converted by system', () => {
        expect(vehicleColumnByKey('charging.max_ac_kw')).toMatchObject({ label: 'Max AC Charge Rate', unit: 'kW' });
        expect(vehicleColumnByKey('performance.elk_test_mph').label).toMatch(/Moose Test/);
        expect(unitFor(vehicleColumnByKey('dimensions.length_in'), 'imperial')).toBe('in');
        expect(unitFor(vehicleColumnByKey('dimensions.length_in'), 'metric')).toBe('mm');
    });

    it('knows which keys need performance results', () => {
        expect(needsPerformance(DEFAULT_VEHICLE_COLUMNS)).toBe(true);
        expect(needsPerformance(['name', 'powertrain.drive_type'])).toBe(false);
    });
});

describe('rows', () => {
    it('reads specs through inheritance', () => {
        const parent = vehicle({ id: 1, specs: { dimensions: { length_in: 200 }, interior: { seating: 7 } } });
        const child = vehicle({ id: 2, name: 'R1S Dual', spec_source_vehicle_id: 1, specs: { interior: { seating: 5 } } });
        const [, row] = buildVehicleRows([parent, child]);
        expect(row.values['dimensions.length_in']).toBe(200);
        expect(row.values['interior.seating']).toBe(5);
    });

    it('carries the resolved figures with their basis', () => {
        const [row] = buildVehicleRows([vehicle({
            socWindowKwh: 140, socWindowBasis: 'usable', epaRangeMi: 300, epaRangeBasis: 'expected',
            epaRange: { expectedSource: 'Manufacturer', cityMi: null, hwyMi: null },
        })]);
        expect(row.values['figures.socWindowKwh']).toBe(140);
        expect(row.notes['figures.socWindowKwh']).toBe('Usable');
        expect(row.notes['figures.epaRangeMi']).toBe('Expected EPA (Manufacturer)');
    });

    it('takes the best tested figure and names its source; empty until results load', () => {
        const v = vehicle({ id: 5 });
        expect(buildVehicleRows([v])[0].values['tested.zero_to_60_rollout_sec']).toBeNull();
        const performance = { 5: { sessions: [], summaries: [
            { source_name: 'Car and Driver', zero_to_60_rollout_sec: 3.1 },
            { source_name: 'Out of Spec', zero_to_60_rollout_sec: 2.9 },
        ] } };
        const [row] = buildVehicleRows([v], { performance });
        expect(row.values['tested.zero_to_60_rollout_sec']).toBe(2.9);
        expect(row.notes['tested.zero_to_60_rollout_sec']).toBe('Out of Spec');
    });

    it('formats absent, boolean and converted figures', () => {
        const [row] = buildVehicleRows([vehicle({ specs: { dimensions: { length_in: 200 }, charging: { v2l: true } } })]);
        expect(formatVehicleCell(row, vehicleColumnByKey('dimensions.width_in'))).toBe('—');
        expect(formatVehicleCell(row, vehicleColumnByKey('charging.v2l'))).toBe('Yes');
        expect(formatVehicleCell(row, vehicleColumnByKey('dimensions.length_in'), 'metric')).toBe('5,080');
    });
});

describe('filtering, sorting, bars', () => {
    const rows = buildVehicleRows([
        vehicle({ id: 1, name: 'R1S', make: 'Rivian', year: 2025, specs: { powertrain: { drive_type: 'AWD', horsepower_hp: 665 } }, tags: [{ name: 'suv' }] }),
        vehicle({ id: 2, name: 'Model 3', make: 'Tesla', year: 2026, specs: { powertrain: { drive_type: 'RWD', horsepower_hp: 286 } }, tags: [{ name: 'sedan' }] }),
        vehicle({ id: 3, name: 'Lyriq', make: 'Cadillac', year: 2026, specs: {} }),
    ]);

    it('filters by facet and search', () => {
        expect(filterVehicleRows(rows, { ...EMPTY_VEHICLE_FILTERS, makes: ['Tesla'] }).map(r => r.id)).toEqual([2]);
        expect(filterVehicleRows(rows, { ...EMPTY_VEHICLE_FILTERS, tags: ['suv'] }).map(r => r.id)).toEqual([1]);
        expect(filterVehicleRows(rows, { ...EMPTY_VEHICLE_FILTERS, search: 'lyr' }).map(r => r.id)).toEqual([3]);
        expect(vehicleFacets(rows).years).toEqual(['2025', '2026']);
    });

    it('sorts with absences last in both directions, best first on the first click', () => {
        const hp = vehicleColumnByKey('powertrain.horsepower_hp');
        expect(sortVehicleRows(rows, hp.key, 'desc').map(r => r.id)).toEqual([1, 2, 3]);
        expect(sortVehicleRows(rows, hp.key, 'asc').map(r => r.id)).toEqual([2, 1, 3]);
        expect(firstSortDir(hp)).toBe('desc');
        expect(firstSortDir(vehicleColumnByKey('tested.quarter_mile_sec'))).toBe('asc');
    });

    it('scales a bar against the filtered rows, and draws none for an absence', () => {
        const hp = vehicleColumnByKey('powertrain.horsepower_hp');
        const maxima = vehicleBarMaxima(rows, [hp]);
        expect(vehicleBarPercent(rows[1], hp, maxima)).toBeCloseTo(43.0, 1);
        expect(vehicleBarPercent(rows[2], hp, maxima)).toBeNull();
        expect(vehicleBarPercent(rows[0], vehicleColumnByKey('powertrain.motors'), maxima)).toBeNull();
    });
});

describe('URL', () => {
    it('writes nothing for the defaults and round-trips the rest', () => {
        expect(encodeVehicleTableParams({ columns: DEFAULT_VEHICLE_COLUMNS, sortKey: 'name', sortDir: 'asc', filters: EMPTY_VEHICLE_FILTERS }).toString()).toBe('');
        const state = { columns: ['name', 'powertrain.horsepower_hp'], sortKey: 'powertrain.horsepower_hp', sortDir: 'desc', filters: { ...EMPTY_VEHICLE_FILTERS, makes: ['Tesla', 'Rivian'], search: 'model' } };
        expect(decodeVehicleTableParams(encodeVehicleTableParams(state).toString())).toEqual(state);
    });

    it('drops unknown columns, keeps the name, and falls back on a bad sort', () => {
        const out = decodeVehicleTableParams('vt_cols=bogus,powertrain.motors&vt_sort=bogus');
        expect(out.columns).toEqual(['name', 'powertrain.motors']);
        expect(out.sortKey).toBe('name');
        expect(decodeVehicleTableParams('vt_cols=bogus').columns).toEqual(DEFAULT_VEHICLE_COLUMNS);
    });
});

describe('vehicle table memory', () => {
    const state = {
        columns: ['name', 'powertrain.horsepower_hp'],
        sortKey: 'powertrain.horsepower_hp',
        sortDir: 'desc',
        filters: { ...EMPTY_VEHICLE_FILTERS, makes: ['Ford'], search: 'mach' },
    };

    it('keeps columns and sort apart from filters', () => {
        const memory = vehicleTableMemory(state);
        expect(memory.view).toContain('vt_cols=');
        expect(memory.view).not.toContain('vt_mk');
        expect(memory.filters).toContain('vt_mk=Ford');
        expect(memory.filters).not.toContain('vt_cols');
    });

    it('restores the whole state from memory when the URL carries none of it', () => {
        const search = vehicleTableStartSearch('?tab=specifications&v=1,2', vehicleTableMemory(state));
        expect(decodeVehicleTableParams(search)).toEqual(state);
    });

    it('lets a link with any table parameter win over memory', () => {
        const search = vehicleTableStartSearch('?tab=specifications&vt_sort=powertrain.drive_type', vehicleTableMemory(state));
        const decoded = decodeVehicleTableParams(search);
        expect(decoded.sortKey).toBe('powertrain.drive_type');
        expect(decoded.columns).toEqual(DEFAULT_VEHICLE_COLUMNS);
        expect(decoded.filters).toEqual(EMPTY_VEHICLE_FILTERS);
    });

    it('drops a remembered column that no longer exists', () => {
        const search = vehicleTableStartSearch('', { view: 'vt_cols=name,specs.retired_field,powertrain.horsepower_hp' });
        expect(decodeVehicleTableParams(search).columns).toEqual(['name', 'powertrain.horsepower_hp']);
    });
});

describe('column widths', () => {
    it('narrows yes/no and bar-less counts, widens free text, and leaves figures and enums alone', () => {
        const holds = (key) => vehicleColumnByKey(key)?.holds ?? null;
        expect(holds('compute.lidar')).toBe('short-values');
        expect(holds('compute.ultrasonics')).toBe('short-values');
        expect(holds('compute.processing_chip')).toBe('long-text');
        expect(holds('powertrain.horsepower_hp')).toBeNull();
        expect(holds('powertrain.drive_type')).toBeNull();
        expect(holds('tags')).toBe('long-text');
    });
});

describe('flags', () => {
    it('lands a community flag on its spec cell, and ignores keys that are not spec columns', () => {
        const [row] = buildVehicleRows([vehicle({
            flagged_specs: ['powertrain.horsepower_hp', 'figures.epaRangeMi', 'powertrain.no_such_field'],
        })]);
        expect([...row.flagged]).toEqual(['powertrain.horsepower_hp']);
    });

    it('has no flags for a vehicle that was never flagged', () => {
        expect(buildVehicleRows([vehicle()])[0].flagged.size).toBe(0);
    });
});
