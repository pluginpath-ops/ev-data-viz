import { describe, it, expect } from 'vitest';
import {
    VEHICLE_COLUMNS, DEFAULT_VEHICLE_COLUMNS, vehicleColumnByKey, unitFor, needsPerformance,
    buildVehicleRows, formatVehicleCell, filterVehicleRows, sortVehicleRows, vehicleFacets,
    vehicleBarMaxima, vehicleBarPercent, firstSortDir,
    encodeVehicleTableParams, decodeVehicleTableParams, EMPTY_VEHICLE_FILTERS,
    vehicleTableStartSearch, vehicleTableMemory, PRESETS, vehiclePresetByKey, presetMatching,
    DEFAULT_ASSUMPTIONS, labelledColumn, needsAssumptions,
} from '../vehicleTable';
import { VEHICLE_TABLE_PRESETS } from '../vehicleTablePresets';

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
        const state = { columns: ['name', 'powertrain.horsepower_hp'], sortKey: 'powertrain.horsepower_hp', sortDir: 'desc', filters: { ...EMPTY_VEHICLE_FILTERS, makes: ['Tesla', 'Rivian'], search: 'model' }, modifiedFrom: null, assumptions: DEFAULT_ASSUMPTIONS };
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
        modifiedFrom: null,
        assumptions: { addDistance: 200 },
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
    it('narrows yes/no, bar-less counts and short enums, widens free text, and leaves figures alone', () => {
        const holds = (key) => vehicleColumnByKey(key)?.holds ?? null;
        expect(holds('compute.lidar')).toBe('short-values');
        expect(holds('compute.ultrasonics')).toBe('short-values');
        expect(holds('compute.processing_chip')).toBe('long-text');
        expect(holds('powertrain.horsepower_hp')).toBeNull();
        expect(holds('powertrain.drive_type')).toBe('short-values');   // FWD / RWD / AWD
        expect(holds('powertrain.motor_type')).toBeNull();             // "Switched Reluctance"
        expect(holds('charging.charge_port')).toBe('short-values');   // CHAdeMO is the longest
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

describe('calculated columns (#335)', () => {
    const full = vehicle({
        socWindowKwh: 100, epaRangeMi: 300,
        specs: {
            pricing: { base_price_usd: 60000 },
            powertrain: { horsepower_hp: 500, battery_gross_kwh: 105 },
            performance: { weight_lbs: 5000 },
            charging: { charge_time_10_to_80_pct_min: 20, max_dc_kw: 250, battery_usable_kwh: 100, battery_nominal_voltage_v: 800 },
            interior: { cargo_cuft: 30, frunk_cuft: 5 },
        },
    });
    const value = (row, key) => row.values[key];

    it('works each ratio out from the row, with the resolved battery', () => {
        const [row] = buildVehicleRows([full]);
        expect(value(row, 'calc.efficiency')).toBe(3);
        expect(value(row, 'calc.rangePerChargeMin')).toBeCloseTo(10.5);   // 300 × 0.7 ÷ 20
        expect(value(row, 'calc.avgKw10to80')).toBeCloseTo(210);          // 70 kWh in a third of an hour
        expect(value(row, 'calc.peakCRate')).toBe(2.5);
        expect(value(row, 'calc.pricePerMile')).toBe(200);
        expect(value(row, 'calc.pricePerKwh')).toBe(600);
        expect(value(row, 'calc.weightPerHp')).toBe(10);
        expect(value(row, 'calc.totalCargo')).toBe(35);
        expect(value(row, 'calc.batteryBuffer')).toBeCloseTo(4.76, 2);
        expect(value(row, 'calc.is800v')).toBe(true);
    });

    it('blanks a ratio when an input is missing or zero, rather than guessing', () => {
        const [row] = buildVehicleRows([vehicle({ socWindowKwh: 0, epaRangeMi: 300, specs: {} })]);
        expect(value(row, 'calc.efficiency')).toBeNull();
        expect(value(row, 'calc.pricePerMile')).toBeNull();
        expect(value(row, 'calc.is800v')).toBeNull();
        expect(formatVehicleCell(row, vehicleColumnByKey('calc.efficiency'))).toBe('—');
    });

    it('counts cargo without a frunk figure, and says so', () => {
        const [row] = buildVehicleRows([vehicle({ specs: { interior: { cargo_cuft: 30 } } })]);
        expect(value(row, 'calc.totalCargo')).toBe(30);
        expect(row.notes['calc.totalCargo']).toBe('no frunk figure');
    });

    it('converts a rate by one factor in metric, and draws bars only with a direction', () => {
        const [row] = buildVehicleRows([full]);
        const eff = vehicleColumnByKey('calc.efficiency');
        expect(unitFor(eff, 'metric')).toBe('km/kWh');
        expect(formatVehicleCell(row, eff, 'metric')).toBe('4.83');
        expect(unitFor(vehicleColumnByKey('calc.pricePerMile'), 'metric')).toBe('$/km');
        expect(formatVehicleCell(row, vehicleColumnByKey('calc.pricePerMile'), 'metric')).toBe('124');
        expect(eff.bar).toBe(true);
        expect(vehicleColumnByKey('calc.batteryBuffer').bar).toBe(false);
        expect(formatVehicleCell(row, vehicleColumnByKey('calc.is800v'))).toBe('Yes');
    });
});

describe('presets (#335)', () => {
    it('refers only to columns that exist, leads with the name, and sorts by one of its own', () => {
        for (const p of VEHICLE_TABLE_PRESETS) {
            for (const key of p.columns) expect(vehicleColumnByKey(key), `${p.key}: ${key}`).toBeTruthy();
            expect(p.columns[0]).toBe('name');
            expect(p.columns, `${p.key} sorts by a column it shows`).toContain(p.sortKey);
        }
        expect(new Set(PRESETS.map(p => p.key)).size).toBe(PRESETS.length);
    });

    it('opens on Overview, and a URL with no table parameters is Overview', () => {
        expect(DEFAULT_VEHICLE_COLUMNS).toEqual(vehiclePresetByKey('overview').columns);
        expect(presetMatching(decodeVehicleTableParams('').columns)?.key).toBe('overview');
    });

    it('writes a preset as its name, and implies its sort', () => {
        const rt = vehiclePresetByKey('road-trips');
        const state = { columns: rt.columns, sortKey: rt.sortKey, sortDir: rt.sortDir, filters: EMPTY_VEHICLE_FILTERS };
        const search = encodeVehicleTableParams(state).toString();
        expect(search).toBe('vt_preset=road-trips');
        expect(decodeVehicleTableParams(search)).toEqual({ ...state, modifiedFrom: null, assumptions: DEFAULT_ASSUMPTIONS });
    });

    it('re-sorting a preset keeps it the preset', () => {
        const rt = vehiclePresetByKey('road-trips');
        const search = encodeVehicleTableParams({ columns: rt.columns, sortKey: 'figures.epaRangeMi', sortDir: 'desc' }).toString();
        const out = decodeVehicleTableParams(search);
        expect(presetMatching(out.columns)?.key).toBe('road-trips');
        expect(out).toMatchObject({ sortKey: 'figures.epaRangeMi', sortDir: 'desc', modifiedFrom: null });
    });

    it('carries "modified from" with a changed column set', () => {
        const columns = [...vehiclePresetByKey('value').columns, 'dimensions.length_in'];
        const search = encodeVehicleTableParams({ columns, sortKey: 'name', sortDir: 'asc', modifiedFrom: 'value' }).toString();
        expect(search).toContain('vt_cols=');
        expect(search).toContain('vt_preset=value');
        expect(decodeVehicleTableParams(search)).toMatchObject({ columns, modifiedFrom: 'value' });
        // Hand-built columns with no origin say nothing about one.
        expect(decodeVehicleTableParams('vt_cols=name,powertrain.motors').modifiedFrom).toBeNull();
    });

    it('ignores an unknown preset rather than breaking', () => {
        expect(decodeVehicleTableParams('vt_preset=bogus').columns).toEqual(DEFAULT_VEHICLE_COLUMNS);
    });
});

describe('assumptions (#335)', () => {
    const car = (range, min) => vehicle({ epaRangeMi: range, specs: { charging: { charge_time_10_to_80_pct_min: min } } });
    const time = (row) => row.values['calc.timeToAdd'];

    it('times a stop to add the reader\'s distance at the 10→80% average rate', () => {
        const [row] = buildVehicleRows([car(300, 21)]);                        // 210 mi in 21 min
        expect(time(row)).toBeCloseTo(15);                                     // 150 mi at 10 mi/min
        const [far] = buildVehicleRows([car(300, 21)], { assumptions: { addDistance: 200 } });
        expect(time(far)).toBeCloseTo(20);
    });

    it('leaves a stop blank, and says why, when 10→80% adds less than asked', () => {
        const [row] = buildVehicleRows([car(250, 20)], { assumptions: { addDistance: 200 } });  // 175 mi window
        expect(time(row)).toBeNull();
        expect(row.notes['calc.timeToAdd']).toBe('more than a 10→80% stop adds');
        expect(buildVehicleRows([car(null, 20)])[0].notes['calc.timeToAdd']).toBeNull();
    });

    it('reads the distance in the reader\'s units, and names the column from it', () => {
        const [row] = buildVehicleRows([car(300, 21)], { assumptions: { addDistance: 150 }, units: 'metric' });
        expect(time(row)).toBeCloseTo(150 / 1.60934 / 10);
        const col = vehicleColumnByKey('calc.timeToAdd');
        expect(labelledColumn(col, { addDistance: 200 }, 'imperial').label).toBe('Time to add 200 mi');
        expect(labelledColumn(col, { addDistance: 250 }, 'metric').label).toBe('Time to add 250 km');
        expect(needsAssumptions(['name', 'calc.timeToAdd'])).toBe(true);
        expect(needsAssumptions(['name', 'calc.efficiency'])).toBe(false);
    });

    it('round-trips through the URL only when changed, snapped to the slider\'s steps', () => {
        const base = { columns: DEFAULT_VEHICLE_COLUMNS, sortKey: 'name', sortDir: 'asc' };
        expect(encodeVehicleTableParams({ ...base, assumptions: DEFAULT_ASSUMPTIONS }).toString()).toBe('');
        expect(encodeVehicleTableParams({ ...base, assumptions: { addDistance: 200 } }).toString()).toBe('vt_add=200');
        expect(decodeVehicleTableParams('vt_add=210').assumptions.addDistance).toBe(200);
        expect(decodeVehicleTableParams('vt_add=9999').assumptions.addDistance).toBe(300);
        expect(decodeVehicleTableParams('vt_add=nope').assumptions.addDistance).toBe(150);
    });
});

describe('tested charging columns (#346)', () => {
    const best = { kw: 187.4, startSoc: 9, endSoc: 48, temperatureF: 41, timeDerived: true };
    it('reads the vehicle\'s best window, with where it sat and how warm it was beneath', () => {
        const [row] = buildVehicleRows([vehicle({ chargeBest: { 5: null, 10: null, 15: best } })]);
        expect(row.values['tested.charge_best_15min_kw']).toBe(187.4);
        expect(row.notes['tested.charge_best_15min_kw']).toBe('9→48% · 41°F · time derived');
        expect(row.values['tested.charge_best_5min_kw']).toBeNull();
        const [metric] = buildVehicleRows([vehicle({ chargeBest: { 15: best } })], { units: 'metric' });
        expect(metric.notes['tested.charge_best_15min_kw']).toBe('9→48% · 5°C · time derived');
        expect(formatVehicleCell(row, vehicleColumnByKey('tested.charge_best_15min_kw'))).toBe('187');
    });

    it('arrives with the vehicle, so it never triggers the performance fetch', () => {
        expect(needsPerformance(['name', 'tested.charge_best_15min_kw'])).toBe(false);
        expect(needsPerformance(['name', 'tested.quarter_mile_sec'])).toBe(true);
    });
});
