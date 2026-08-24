import { describe, it, expect } from 'vitest';
import {
    CURVE_TIERS, tierByKey, curveSubject, curveSubjects, tierCounts, resolveCurveEnergy,
    curveTooltipLines, disambiguateLabels,
} from '../epaCurveSubjects';

const coeffs = [{ is_primary: true, target_a: 37, target_b: 0.2, target_c: 0.02, equiv_test_weight_lbs: 5500 }];
/** A test with phases, which is what lets η be derived. */
const derivableTest = {
    procedure_code: 77, total_dc_energy_kwh: 90,
    epa_test_phases: [
        { phase_type: 'HWY', distance_mi: 10.26, dc_energy_kwh: 3.1 },
        { phase_type: 'HWY', distance_mi: 10.26, dc_energy_kwh: 3.0 },
    ],
};
const group = (o = {}) => ({
    test_group_id: o.id ?? 'TG1', model_year: 2025, make: 'Rivian',
    epa_carline_name: o.carline ?? 'R1S',
    useable_kwh: o.useable ?? null,
    epa_coefficient_sets: 'coeffs' in o ? o.coeffs : coeffs,
    epa_tests: o.tests ?? [],
    epa_fe_guide: 'guide' in o ? o.guide : null,
});

describe('what can be a subject at all', () => {
    it('refuses a group with no coefficients rather than offering an empty curve', () => {
        // One of 211 has none. Returning a subject that draws nothing would let
        // a caller list it and then plot a blank.
        expect(curveSubject(group({ coeffs: [] }))).toBeNull();
    });
    it('accepts a group with coefficients and nothing else', () => {
        const s = curveSubject(group());
        expect(s).not.toBeNull();
        expect(s.tier).toBe('shape');
        expect(s.canPlotRange).toBe(false);
    });
});

describe('where the energy comes from', () => {
    it('prefers a curator value', () => {
        expect(resolveCurveEnergy(group({ useable: 141, tests: [derivableTest] })))
            .toEqual({ kwh: 141, source: 'curator' });
    });
    it('then the DC discharged on a procedure the model uses', () => {
        expect(resolveCurveEnergy(group({ tests: [derivableTest] })))
            .toEqual({ kwh: 90, source: 'measured' });
    });
    it('ignores a procedure the model does not use', () => {
        // Proc 86 is a short cycle — its DC energy is not a pack capacity, and
        // it is where the 0.037 charger efficiency came from.
        expect(resolveCurveEnergy(group({ tests: [{ procedure_code: 86, total_dc_energy_kwh: 6 }] })).kwh)
            .toBeNull();
    });
    it('falls back to the guide’s gross pack, which needs the link', () => {
        expect(resolveCurveEnergy(group({ guide: { nominal_pack_kwh: 149.7 } })))
            .toEqual({ kwh: 149.7, source: 'nominal' });
    });
});

describe('tiers say how much of a curve is measurement', () => {
    it('measured needs BOTH a derived η and a measured energy', () => {
        expect(curveSubject(group({ tests: [derivableTest] })).tier).toBe('measured');
    });
    it('a borrowed pack is nominal even though the shape is measured', () => {
        // Road load is the lab's own number either way; only the scale is
        // borrowed, which is why the distinction is named rather than scored.
        const s = curveSubject(group({ guide: { nominal_pack_kwh: 149.7 } }));
        expect(s.tier).toBe('nominal');
        expect(s.canPlotRange).toBe(true);
        expect(s.etaMeasured).toBe(false);
    });
    it('no energy at all means no range', () => {
        expect(curveSubject(group()).canPlotRange).toBe(false);
    });
    it('every tier a subject can be given is declared', () => {
        const keys = CURVE_TIERS.map(t => t.key);
        [group({ tests: [derivableTest] }), group({ guide: { nominal_pack_kwh: 100 } }), group()]
            .forEach(g => expect(keys).toContain(curveSubject(g).tier));
        keys.forEach(k => expect(tierByKey(k)).not.toBeNull());
    });
});

describe('ordering and counts', () => {
    const set = [
        group({ id: 'C' }),                                        // shape
        group({ id: 'B', guide: { nominal_pack_kwh: 100 } }),      // nominal
        group({ id: 'A', tests: [derivableTest] }),                // measured
    ];
    it('puts the best-grounded first', () => {
        expect(curveSubjects(set).map(s => s.tier)).toEqual(['measured', 'nominal', 'shape']);
    });
    it('counts each tier for the filter', () => {
        expect(tierCounts(curveSubjects(set))).toEqual({ measured: 1, nominal: 1, shape: 1 });
    });
    it('drops the unplottable from the list entirely', () => {
        expect(curveSubjects([...set, group({ id: 'D', coeffs: [] })])).toHaveLength(3);
    });
});

describe('labels', () => {
    it('prefers the guide carline, which names the wheel variant', () => {
        const s = curveSubject(group({
            carline: 'R1T All-Terrain Performance Dual',
            guide: { carline: 'R1T Performance Dual Max (20in)', nominal_pack_kwh: 149.7, division: 'Rivian' },
        }));
        expect(s.label).toBe('R1T Performance Dual Max (20in)');
    });
    it('falls back to the certification name when unlinked', () => {
        expect(curveSubject(group({ carline: 'R1S' })).label).toBe('R1S');
    });
});

describe('chart labelling', () => {
    it('builds the three tooltip lines: name, x with unit, y with unit', () => {
        expect(curveTooltipLines({
            name: 'Blazer EV AWD', x: 60, y: 3.1163, xUnit: 'mph', yUnit: 'mi/kWh', digits: 3,
        })).toEqual(['Blazer EV AWD', '60 mph', '3.116 mi/kWh']);
    });
    it('rounds the speed and honours the axis precision', () => {
        expect(curveTooltipLines({ name: 'X', x: 96.56, y: 41.53, xUnit: 'km/h', yUnit: 'kWh/100mi', digits: 1 }))
            .toEqual(['X', '97 km/h', '41.5 kWh/100mi']);
    });

    it('leaves distinct names alone', () => {
        const subs = [
            { key: 'a', label: 'R1S Dual Max', group: { model_year: 2025 } },
            { key: 'b', label: 'R1T Dual Max', group: { model_year: 2025 } },
        ];
        expect([...disambiguateLabels(subs).values()]).toEqual(['R1S Dual Max', 'R1T Dual Max']);
    });
    it('appends the year ONLY to the names that collide', () => {
        // The same car certified in consecutive years is the common case, and a
        // legend with two identical entries cannot be read.
        const subs = [
            { key: 'a', label: 'Model Y Long Range AWD', group: { model_year: 2025 } },
            { key: 'b', label: 'Model Y Long Range AWD', group: { model_year: 2026 } },
            { key: 'c', label: 'Cybertruck AWD', group: { model_year: 2026 } },
        ];
        const out = disambiguateLabels(subs);
        expect(out.get('a')).toBe('Model Y Long Range AWD (2025)');
        expect(out.get('b')).toBe('Model Y Long Range AWD (2026)');
        expect(out.get('c')).toBe('Cybertruck AWD');
    });
});
