import { describe, it, expect } from 'vitest';
import { testVehiclePoint, guidePoint, sameCarline, coversCarline, testedVia, guideTestedViaPool } from '../guideTestedVia';

// A test vehicle whose multi-cycle test reads `city` and `hwy` kWh/100mi on
// 100 kWh of AC recharge.
const tv = (id, city, hwy, extra = {}) => ({
    test_vehicle_id: id, epa_carline_name: 'BLAZER EV AWD',
    tests: [{ test_number: `${id}-T`, procedure_code: 77, ac_recharge_kwh: 100, cd_range_combined_calc: 10000 / city, cd_range_hwy_calc: 10000 / hwy }],
    ...extra,
});
const row = (city, hwy, extra = {}) => ({ carline: 'BLAZER EV AWD', unadj_city_kwh_100mi: city, unadj_hwy_kwh_100mi: hwy, ...extra });

describe('testVehiclePoint', () => {
    it('is 100 × AC ÷ CD range from the multi-cycle test', () => {
        const p = testVehiclePoint(tv('A', 23.1078, 27.2));
        expect(p.city).toBeCloseTo(23.1078, 6);
        expect(p.hwy).toBeCloseTo(27.2, 6);
    });

    it('falls back to the UDDS and highway charge-depleting tests', () => {
        const p = testVehiclePoint({ tests: [
            { test_number: 'U', procedure_code: 81, ac_recharge_kwh: 90, cd_range_combined_calc: 300 },
            { test_number: 'H', procedure_code: 84, ac_recharge_kwh: 90, cd_range_combined_calc: 250 },
        ] });
        expect(p).toEqual({ city: 30, hwy: 36, via: ['U', 'H'] });
    });

    it('is null without AC energy — a placeholder test', () => {
        expect(testVehiclePoint({ tests: [{ procedure_code: 77, ac_recharge_kwh: null, cd_range_combined_calc: 300, cd_range_hwy_calc: 250 }] })).toBeNull();
    });
});

describe('guidePoint', () => {
    it('reads the kWh/100mi line, held to its printed precision', () => {
        const g = guidePoint(row(23.1078, 27.2001));
        expect(g.city).toBe(23.1078);
        expect(g.tol).toBeCloseTo(0.00005 + 0.006, 6);
    });

    it('is looser when the Guide printed 1 decimal — Ford, Dodge, VinFast', () => {
        expect(guidePoint(row(26.2, 30.5)).tol).toBeCloseTo(0.05 + 0.006, 6);
    });

    it('takes the finer of the two cycles — a stored 27.2000 reads back as 27.2', () => {
        expect(guidePoint(row(23.1078, 27.2)).tol).toBeCloseTo(0.00005 + 0.006, 6);
    });

    it('falls back to the MPGe line for a row imported before migration 094', () => {
        const g = guidePoint({ unadj_city_mpge: 145.9, unadj_hwy_mpge: 123.8 });
        expect(g.city).toBeCloseTo(3370.5 / 145.9, 6);
        // 0.05 MPGe at 145.9 is ~0.008 kWh/100mi, plus both slacks
        expect(g.tol).toBeGreaterThan(0.02);
    });

    it('is null without figures', () => {
        expect(guidePoint({})).toBeNull();
    });
});

describe('carline matching', () => {
    it('ignores case and punctuation, and a trailing qualifier', () => {
        expect(sameCarline('BLAZER EV AWD', 'Blazer EV AWD, 22 inch tire')).toBe(true);
        expect(sameCarline('Model Y', 'F-150 Lightning')).toBe(false);
    });

    it('counts the certificate\'s covered models, entities and all', () => {
        expect(coversCarline('R1T All-Terrain Dual Large (20in)', {
            epa_carline_name: 'R1S 20in All-Terrain Performance',
            covered_models: [{ carline_name: 'R1T All-Terrain Dual Large (20in)' }],
        })).toBe(true);
        expect(coversCarline('Air G Touring XR AWD w/19" wheels', {
            covered_models: ['Air G Touring XR AWD w/19&quot; wheels'],
        })).toBe(true);
    });
});

describe('testedVia', () => {
    it('exact: one test vehicle reproduces the row', () => {
        const r = testedVia(row(23.1078, 27.2), [tv('A', 23.1078, 27.2), tv('B', 22.5, 26.5)]);
        expect(r.verdict).toBe('exact');
        expect(r.members.map(m => m.test_vehicle_id)).toEqual(['A']);
        expect(r.ambiguous).toBe(false);
    });

    it('tells siblings 0.4% apart apart, which the ±1% MPGe check cannot', () => {
        // R1S configurations: 0.4% apart, the Guide printed to 4 decimals.
        const r = testedVia(row(30.0123, 33.0456), [tv('A', 30.0123, 33.0456), tv('B', 30.1323, 33.1756)]);
        expect(r.members.map(m => m.test_vehicle_id)).toEqual(['A']);
        expect(r.ambiguous).toBe(false);
    });

    it('ambiguous when the printed precision cannot separate two', () => {
        const r = testedVia(row(30.0123, 33.0456), [tv('A', 30.0123, 33.0456), tv('B', 30.0153, 33.0476)]);
        expect(r.verdict).toBe('exact');
        expect(r.ambiguous).toBe(true);
        expect(r.alternatives).toEqual(['B']);
    });

    it('blend: between two test vehicles, reported as the span of their figures', () => {
        const r = testedVia(row(22.75, 26.80), [tv('A', 22.5, 26.5), tv('B', 23.0, 27.1)]);
        expect(r.verdict).toBe('blend');
        expect(r.span.city[0]).toBeCloseTo(22.5, 6);
        expect(r.span.city[1]).toBeCloseTo(23.0, 6);
        expect(r.span.hwy[1]).toBeCloseTo(27.1, 6);
    });

    it('near: a blend weighted almost all to one end is that end', () => {
        const r = testedVia(row(22.51, 26.512), [tv('A', 22.5, 26.5), tv('B', 23.0, 27.1)]);
        expect(r.verdict).toBe('near');
        expect(r.members.map(m => m.test_vehicle_id)).toEqual(['A']);
    });

    it('blend of three: inside the triangle they make', () => {
        const r = testedVia(row(23.0001, 27.0001), [tv('A', 22.0, 26.0), tv('B', 24.0, 26.5), tv('C', 23.0, 28.5)]);
        expect(r.verdict).toBe('blend');
        expect(r.members).toHaveLength(3);
    });

    it('untested: offers the nearest tested trim, never links it', () => {
        const r = testedVia(row(25.5, 29.9), [tv('A', 22.8478, 26.8532)]);
        expect(r.verdict).toBe('untested');
        expect(r.members).toEqual([]);
        expect(r.closest.test_vehicle_id).toBe('A');
        expect(r.closest.cityShare).toBeCloseTo(25.5 / 22.8478 - 1, 6);
    });

    it('prefers the row\'s own carline, and says when it had to go outside it', () => {
        const other = tv('X', 23.1078, 27.2, { epa_carline_name: 'EQUINOX EV AWD' });
        expect(testedVia(row(23.1078, 27.2), [other]).otherCarline).toBe(true);
        expect(testedVia(row(23.1078, 27.2), [other, tv('A', 23.1078, 27.2)]).otherCarline).toBe(false);
    });

    it('counts one test once, however many records hold it', () => {
        const r = testedVia(row(30.0123, 33.0456), [tv('A', 30.0123, 33.0456), tv('A-0', 30.0123, 33.0456)]);
        expect(r.ambiguous).toBe(false);
    });

    it('no-lab-data and no-guide-figures', () => {
        expect(testedVia(row(30, 33), [{ test_vehicle_id: 'Z', tests: [] }]).verdict).toBe('no-lab-data');
        expect(testedVia({ carline: 'x' }, [tv('A', 30, 33)]).verdict).toBe('no-guide-figures');
    });
});

describe('guideTestedViaPool', () => {
    const m = (id, test_group, carryover_test_group = null) => ({ test_vehicle_id: id, test_group, carryover_test_group });

    it('takes the original Test Group\'s members for a carryover row — the Blazer EV', () => {
        const members = [
            m('1SMV5028-0', 'SGMXT00.0014'), m('1SMV5028-1', 'SGMXT00.0014'), m('1SMV5028-2', 'SGMXT00.0014'),
            m('1SMV5028-0', 'TGMXT00.0914', 'SGMXT00.0014'),
        ];
        expect(guideTestedViaPool('TGMXT00.0914', members).map(t => t.test_vehicle_id).sort())
            .toEqual(['1SMV5028-0', '1SMV5028-1', '1SMV5028-2']);
    });

    it('takes a later file\'s configurations originally certified under it — the BMW i7', () => {
        const members = [
            m('CL34779-0', 'RBMXV00.0G7S'),
            m('CL34779-0', 'TBMXV00.0G7A', 'RBMXV00.0G7S'), m('CL34779-3', 'TBMXV00.0G7A', 'RBMXV00.0G7S'),
        ];
        expect(guideTestedViaPool('RBMXV00.0G7S', members).map(t => t.test_vehicle_id).sort())
            .toEqual(['CL34779-0', 'CL34779-3']);
    });

    it('nothing else', () => {
        expect(guideTestedViaPool('A', [m('x', 'B')])).toEqual([]);
        expect(guideTestedViaPool(null, [m('x', 'B')])).toEqual([]);
    });
});
