import { describe, it, expect } from 'vitest';
import {
    currentFieldKey, chartColumns, tableScopedColumns, groupColumns, plotValues, axisTitle,
    betterNote, missingNote, defaultFieldKey, isPlottableOnScatter,
} from '../specChart';
import { VEHICLE_COLUMNS, vehicleColumnByKey, buildVehicleRows, encodeAssumptionParams, displayNumber, formatVehicleCell, DEFAULT_ASSUMPTIONS } from '../vehicleTable';
import { columnMatches } from '../tableColumns';

const row = (id, values, notes = {}) => ({ id, vehicle: { id }, values: { name: `V${id}`, ...values }, notes });
const col = (key) => vehicleColumnByKey(key);

describe('currentFieldKey', () => {
    it('maps the three keys the old chart saved, and leaves every other alone', () => {
        expect(currentFieldKey('vehicle.epaRangeMi')).toBe('figures.epaRangeMi');
        expect(currentFieldKey('vehicle.socWindowKwh')).toBe('figures.socWindowKwh');
        expect(currentFieldKey('vehicle.year')).toBe('year');
        expect(currentFieldKey('performance.zero_to_sixty')).toBe('performance.zero_to_sixty');
        expect(currentFieldKey(null)).toBe(null);
    });

    it('lands on columns that exist', () => {
        for (const k of ['vehicle.year', 'vehicle.socWindowKwh', 'vehicle.epaRangeMi']) {
            expect(vehicleColumnByKey(currentFieldKey(k)), k).not.toBeNull();
        }
    });
});

describe('what the chart offers', () => {
    it('never offers the row label, and a scatter only numbers', () => {
        const all = chartColumns(VEHICLE_COLUMNS);
        expect(all.some(c => c.key === 'name')).toBe(false);
        const numbers = chartColumns(VEHICLE_COLUMNS, { numericOnly: true });
        expect(numbers.length).toBeGreaterThan(20);
        expect(numbers.every(isPlottableOnScatter)).toBe(true);
        expect(numbers.length).toBeLessThan(all.length);
    });

    it('lists the table’s columns first, in its order, with what is plotted pinned in', () => {
        const cols = chartColumns(VEHICLE_COLUMNS);
        const scoped = tableScopedColumns(cols, ['name', 'year', 'figures.epaRangeMi'], ['make']);
        expect(scoped.map(c => c.key)).toEqual(['year', 'figures.epaRangeMi', 'make']);
    });

    it('groups as the table’s column picker does, in first-seen order', () => {
        const groups = groupColumns(chartColumns(VEHICLE_COLUMNS));
        expect(groups[0].group).toBe('Vehicle');
        expect(new Set(groups.map(g => g.group)).size).toBe(groups.length);
    });

    it('filters by name, unit or group — the same matcher the column picker uses', () => {
        expect(columnMatches(col('figures.epaRangeMi'), 'epa')).toBe(true);
        expect(columnMatches(col('figures.epaRangeMi'), 'battery & range')).toBe(true);
        expect(columnMatches(col('figures.epaRangeMi'), 'zzz')).toBe(false);
        expect(columnMatches(col('figures.epaRangeMi'), '   ')).toBe(true);
    });
});

describe('plotValues', () => {
    const range = col('figures.epaRangeMi');

    it('drops a blank and counts it, but keeps a zero', () => {
        const plot = plotValues([row(1, { 'figures.epaRangeMi': 300 }), row(2, {}), row(3, { 'figures.epaRangeMi': 0 })], range);
        expect(plot.kind).toBe('numeric');
        expect(plot.points.map(p => p.row.id)).toEqual([1, 3]);
        expect(plot.missing).toBe(1);
        expect(plot.total).toBe(3);
    });

    it('plots in the reader’s units, the number the cell shows', () => {
        const plot = plotValues([row(1, { 'figures.epaRangeMi': 300 })], range, 'metric');
        expect(plot.points[0].value).toBeCloseTo(displayNumber(range, 300, 'metric'));
        expect(plot.points[0].value).toBeCloseTo(482.8, 0);
        expect(plot.points[0].text).toBe(formatVehicleCell(row(1, { 'figures.epaRangeMi': 300 }), range, 'metric'));
    });

    it('treats text and yes/no as a text column: no value, just the words', () => {
        const bool = VEHICLE_COLUMNS.find(c => c.type === 'boolean');
        const plot = plotValues([row(1, { [bool.key]: true }), row(2, { [bool.key]: false }), row(3, {})], bool);
        expect(plot.kind).toBe('text');
        expect(plot.points.map(p => p.text)).toEqual(['Yes', 'No']);
        expect(plot.points.every(p => p.value === null)).toBe(true);
        expect(plot.missing).toBe(1);
    });

    it('carries the note a figure has beneath it', () => {
        const plot = plotValues([row(1, { 'figures.epaRangeMi': 300 }, { 'figures.epaRangeMi': 'EPA label' })], range);
        expect(plot.points[0].note).toBe('EPA label');
    });
});

describe('the words around the plot', () => {
    it('names the axis with the unit the figures are shown in', () => {
        expect(axisTitle(col('figures.epaRangeMi'), 'imperial')).toBe('EPA range (mi)');
        expect(axisTitle(col('figures.epaRangeMi'), 'metric')).toBe('EPA range (km)');
    });

    it('says which way is better only where the column has a best', () => {
        expect(betterNote({ better: 'higher' })).toBe('higher is better');
        expect(betterNote({ better: 'lower' })).toBe('lower is better');
        expect(betterNote({})).toBeNull();
    });

    it('says how many vehicles dropped, and nothing when none did', () => {
        expect(missingNote(0, 5)).toBeNull();
        expect(missingNote(1, 5)).toBe('1 of 5 selected vehicles has no value and is not plotted.');
        expect(missingNote(2, 5)).toBe('2 of 5 selected vehicles have no value and are not plotted.');
        expect(missingNote(3, 3)).toMatch(/None of the selected/);
        expect(missingNote(2, 40, 'all')).toBe('2 of 40 shown vehicles have no value and are not plotted.');
    });
});

describe('defaultFieldKey', () => {
    it('opens on the first column the table shows that someone has a value for', () => {
        const cols = chartColumns(VEHICLE_COLUMNS);
        const rows = [row(1, { 'figures.epaHwyMi': 250 })];
        expect(defaultFieldKey(cols, ['name', 'figures.epaRangeMi', 'figures.epaHwyMi'], rows)).toBe('figures.epaHwyMi');
    });

    it('falls back to the first offered column when nothing has data', () => {
        const cols = chartColumns(VEHICLE_COLUMNS, { numericOnly: true });
        expect(defaultFieldKey(cols, [], [])).toBe(cols[0].key);
    });

    it('ignores a text column on a scatter', () => {
        const cols = chartColumns(VEHICLE_COLUMNS, { numericOnly: true });
        expect(defaultFieldKey(cols, ['name', 'make', 'figures.epaHwyMi'], [row(1, { make: 'Kia', 'figures.epaHwyMi': 250 })], { numericOnly: true })).toBe('figures.epaHwyMi');
    });
});

describe('the assumptions travel with the chart', () => {
    it('writes only what differs from the defaults', () => {
        expect([...encodeAssumptionParams(DEFAULT_ASSUMPTIONS)]).toEqual([]);
        const p = encodeAssumptionParams({ ...DEFAULT_ASSUMPTIONS, addDistance: 200, windowFrom: 20 });
        expect(p.get('vt_add')).toBe('200');
        expect(p.get('vt_win')).toBe('20-80');
    });

    it('is what the table writes, so one decoder reads both', () => {
        const rows = buildVehicleRows([], { assumptions: { ...DEFAULT_ASSUMPTIONS, homePrice: 0.3 } });
        expect(rows).toEqual([]);
        expect(encodeAssumptionParams({ ...DEFAULT_ASSUMPTIONS, homePrice: 0.3 }).get('vt_home')).toBe('0.3');
    });
});
