import { describe, it, expect } from 'vitest';
import { resolveSocWindow, resolveEpaRange, withVehicleFigures, testedAgreement, figureSources, fieldFigureSource } from '../vehicleFigures';

let nextId = 1;
const group = (over = {}) => ({
    test_group_id: `G${nextId++}`, model_year: 2026, make: 'Make', epa_carline_name: 'Carline',
    label_range_published: null, label_city_range_mi: null, label_hwy_range_mi: null,
    preferred_test_number: null, epa_tests: [], epa_coefficient_sets: [], ...over,
});
const mct = (kwh) => ({ procedure_code: 77, total_dc_energy_kwh: kwh, test_number: `T${nextId++}`, test_date: '2026-01-01' });
const link = (g, over = {}) => ({ id: nextId++, isPrimary: false, epaGroup: g, ...over });
const vehicle = (over = {}) => ({ id: nextId++, name: 'V', specs: {}, epa_mappings: [], ...over });
const specs = ({ usable, gross, expected, basis } = {}) => ({
    charging:   { battery_usable_kwh: usable ?? null },
    powertrain: { battery_gross_kwh: gross ?? null },
    range:      { expected_epa_mi: expected ?? null, expected_epa_basis: basis ?? null },
});

describe('resolveSocWindow', () => {
    it('uses EPA tested when it sits within tolerance of the nearer label', () => {
        // Taycan: tested 89.5 against Usable 89 / Gross 97.
        const v = vehicle({ specs: specs({ usable: 89, gross: 97 }), epa_mappings: [link(group({ epa_tests: [mct(89.5)] }))] });
        expect(resolveSocWindow(v, [v])).toMatchObject({ kwh: 89.5, basis: 'epa-tested', testedSetAside: false });
    });

    it('uses EPA tested when there is no label to hold it against', () => {
        const v = vehicle({ epa_mappings: [link(group({ epa_tests: [mct(76)] }))] });
        expect(resolveSocWindow(v, [v])).toMatchObject({ kwh: 76, basis: 'epa-tested' });
    });

    it('sets EPA tested aside when it disagrees with both labels — a wrong link', () => {
        const v = vehicle({ specs: specs({ usable: 100, gross: 106 }), epa_mappings: [link(group({ epa_tests: [mct(80)] }))] });
        expect(resolveSocWindow(v, [v])).toMatchObject({ kwh: 100, basis: 'usable', testedKwh: 80, testedSetAside: true });
    });

    it('reads EPA tested from the primary configuration only', () => {
        const small = group({ epa_tests: [mct(60)] });
        const big = group({ epa_tests: [mct(100)] });
        const v = vehicle({ epa_mappings: [link(small), link(big, { isPrimary: true })] });
        expect(resolveSocWindow(v, [v]).kwh).toBe(100);
        // Several links, none primary: no EPA tested is picked.
        const none = vehicle({ epa_mappings: [link(small), link(big)], specs: specs({ gross: 90 }) });
        expect(resolveSocWindow(none, [none])).toMatchObject({ kwh: 90, basis: 'gross', testedKwh: null });
    });

    it('falls back Usable → Gross → vehicles.battery, naming each', () => {
        expect(resolveSocWindow(vehicle({ specs: specs({ usable: 77, gross: 84 }) })).basis).toBe('usable');
        expect(resolveSocWindow(vehicle({ specs: specs({ gross: 84 }) }))).toMatchObject({ kwh: 84, basis: 'gross' });
        expect(resolveSocWindow(vehicle({ battery: 82 }))).toMatchObject({ kwh: 82, basis: 'unsorted' });
        expect(resolveSocWindow(vehicle())).toMatchObject({ kwh: null, basis: null });
    });

    it('inherits Usable and Gross, never EPA tested', () => {
        const parent = vehicle({ specs: specs({ usable: 91 }), epa_mappings: [link(group({ epa_tests: [mct(91.2)] }))] });
        const child = vehicle({ spec_source_vehicle_id: parent.id });
        expect(resolveSocWindow(child, [parent, child])).toMatchObject({ kwh: 91, basis: 'usable' });
    });
});

describe('resolveEpaRange', () => {
    it('uses the primary configuration’s label, with city and highway', () => {
        const g = group({ label_range_published: 311, label_city_range_mi: 330, label_hwy_range_mi: 290 });
        const v = vehicle({ range: 337, epa_mappings: [link(g, { isPrimary: true }), link(group({ label_range_published: 280 }))] });
        expect(resolveEpaRange(v, [v])).toMatchObject({ mi: 311, basis: 'epa-label', cityMi: 330, hwyMi: 290 });
    });

    it('treats a sole link as the primary', () => {
        const v = vehicle({ epa_mappings: [link(group({ label_range_published: 300 }))] });
        expect(resolveEpaRange(v, [v])).toMatchObject({ mi: 300, basis: 'epa-label' });
    });

    it('picks nothing among several labels with no primary: a span, then the tiers below', () => {
        const v = vehicle({ range: 340, epa_mappings: [link(group({ label_range_published: 337 })), link(group({ label_range_published: 450 }))] });
        expect(resolveEpaRange(v, [v])).toMatchObject({ mi: 340, basis: 'unsorted', spanMi: [337, 450] });
    });

    it('uses the label when every configuration reads the same', () => {
        const v = vehicle({ epa_mappings: [link(group({ label_range_published: 311 })), link(group({ label_range_published: 311 }))] });
        expect(resolveEpaRange(v, [v])).toMatchObject({ mi: 311, basis: 'epa-label', spanMi: null });
    });

    it('uses an Expected EPA Range when there is no label, with its basis', () => {
        const v = vehicle({ range: 400, specs: specs({ expected: 320, basis: 'Manufacturer' }) });
        expect(resolveEpaRange(v, [v])).toMatchObject({ mi: 320, basis: 'expected', expectedSource: 'Manufacturer' });
    });

    it('lets the label win over an Expected EPA Range', () => {
        const v = vehicle({ specs: specs({ expected: 320 }), epa_mappings: [link(group({ label_range_published: 300 }))] });
        expect(resolveEpaRange(v, [v]).basis).toBe('epa-label');
    });

    it('falls back to vehicles.range as unsorted, and to nothing', () => {
        expect(resolveEpaRange(vehicle({ range: 250 }))).toMatchObject({ mi: 250, basis: 'unsorted' });
        expect(resolveEpaRange(vehicle())).toMatchObject({ mi: null, basis: null });
    });
});

describe('withVehicleFigures', () => {
    it('attaches both figures and their bases, leaving the vehicle otherwise alone', () => {
        const v = vehicle({ battery: 80, range: 300, name: 'Kept' });
        const [out] = withVehicleFigures([v]);
        expect(out).toMatchObject({
            name: 'Kept', battery: 80, range: 300,
            socWindowKwh: 80, socWindowBasis: 'unsorted', epaRangeMi: 300, epaRangeBasis: 'unsorted',
        });
        expect(out.epaRange.spanMi).toBeNull();
    });
});

describe('figureSources', () => {
    const lightning = { socWindowKwh: 125.1, socWindowBasis: 'epa-tested', epaRangeMi: 300, epaRangeBasis: 'epa-label', epaRange: {} };

    it('names only the figures asked for', () => {
        expect(figureSources(lightning)).toEqual([]);
        expect(figureSources(lightning, { capacity: true })).toEqual([
            { figure: 'capacity', basis: 'EPA tested', short: '125.1 kWh EPA tested', line: 'Capacity: 125.1 kWh, EPA tested' },
        ]);
        expect(figureSources(lightning, { capacity: true, range: true }).map(s => s.figure)).toEqual(['capacity', 'range']);
    });

    it('carries an Expected EPA Range’s basis, in the chart’s units', () => {
        const v = { epaRangeMi: 300, epaRangeBasis: 'expected', epaRange: { expectedSource: 'Manufacturer' } };
        expect(figureSources(v, { range: true })[0].short).toBe('300 mi Expected EPA (Manufacturer)');
        expect(figureSources(v, { range: true }, 'metric')[0].line).toBe('EPA range: 483 km, Expected EPA (Manufacturer)');
    });

    it('leaves out a figure the vehicle does not have', () => {
        expect(figureSources({ socWindowKwh: null }, { capacity: true, range: true })).toEqual([]);
    });

    it('names a spec field’s source only when the field is a resolved figure', () => {
        expect(fieldFigureSource(lightning, 'vehicle.socWindowKwh').basis).toBe('EPA tested');
        expect(fieldFigureSource(lightning, 'vehicle.epaRangeMi').basis).toBe('EPA');
        expect(fieldFigureSource(lightning, 'performance.weight_lbs')).toBeNull();
    });
});

describe('testedAgreement', () => {
    it('passes the nearer label but not every label across a normal buffer', () => {
        const labels = [{ name: 'Usable', kwh: 89 }, { name: 'Gross', kwh: 97 }];
        expect(testedAgreement(89.5, labels, 5).ok).toBe(true);
        expect(testedAgreement(89.5, labels, 5, 'each').ok).toBe(false);
    });
});
