import { describe, it, expect } from 'vitest';
import { isSlimTestVehicle, slimTestVehicles, withEpaDetail } from '../epaDetail';

const slim = (id) => ({ test_vehicle_id: id, label_range_published: 300, epa_tests: [{ test_number: 1 }] });
const vehicle = (id, ...tvs) => ({ id, epa_mappings: tvs.map((tv, i) => ({ id: i, epaTestVehicle: tv })) });

describe('epaDetail', () => {
    it('calls a record with no coefficient-set key slim, and one with an empty list whole', () => {
        expect(isSlimTestVehicle(slim('a'))).toBe(true);
        expect(isSlimTestVehicle({ ...slim('a'), epa_coefficient_sets: [] })).toBe(false);
        expect(isSlimTestVehicle(null)).toBe(false);
    });

    it('lists only the slim test vehicles', () => {
        const a = slim('a');
        const whole = { ...slim('b'), epa_coefficient_sets: [] };
        expect(slimTestVehicles([vehicle(1, a, whole), { id: 2 }])).toEqual([a]);
    });

    it('puts the detail back and keeps every other field', () => {
        const a = slim('a');
        const sets = [{ is_primary: true }];
        const tests = [{ id: 9, test_number: 1, epa_test_phases: [] }];
        const [out] = withEpaDetail([vehicle(1, a)], () => ({ epa_coefficient_sets: sets, epa_tests: tests }));
        const tv = out.epa_mappings[0].epaTestVehicle;
        expect(tv.epa_coefficient_sets).toBe(sets);
        expect(tv.epa_tests).toBe(tests);
        expect(tv.label_range_published).toBe(300);
    });

    it('returns a vehicle untouched when nothing is known for it', () => {
        const v = vehicle(1, slim('a'));
        expect(withEpaDetail([v], () => null)[0]).toBe(v);
    });
});
