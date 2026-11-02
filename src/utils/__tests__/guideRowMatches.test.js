import { describe, it, expect } from 'vitest';
import { guideRowMatches } from '../guideRowMatches';
import { NO_LABEL_NOTE } from '../epaBehindNoLabel';

// MCT tests: city = 100·ac/c, highway = 100·ac/h.
const tv = (id, city, hwy, extra = {}) => ({
    test_vehicle_id: id, epa_carline_name: `Car ${id}`,
    tests: [{ test_number: `${id}-T`, procedure_code: 77, ac_recharge_kwh: 100, cd_range_combined_calc: 10000 / city, cd_range_hwy_calc: 10000 / hwy }],
    ...extra,
});
const row = (id, city, hwy) => ({ id, carline: 'Car', unadj_city_kwh_100mi: city.toFixed(4), unadj_hwy_kwh_100mi: hwy.toFixed(4) });
const member = (id, city, hwy) => ({ test_vehicle_id: id, city, hwy, via: ['T'] });
const exact = (id, city, hwy) => ({ verdict: 'exact', members: [member(id, city, hwy)], alternatives: [], ambiguous: false });

describe('guideRowMatches', () => {
    it('places every test vehicle of the pool, the named one first', () => {
        const pool = [tv('X', 30, 40), tv('A', 20, 25), tv('S', 24, 30)];
        const others = [{ rowId: 9, via: exact('S', 24, 30) }];
        const out = guideRowMatches({ guide: row(1, 20, 25), via: exact('A', 20, 25), pool }, others, new Set(['X']));
        expect(out.map(m => [m.test_vehicle_id, m.match])).toEqual([
            ['A', 'exact'], ['S', 'other-label'], ['X', 'no-match'],
        ]);
        expect(out[1].otherRowId).toBe(9);
        expect(out[2].linked).toBe(true);
        expect(out[2].delta.city).toBeCloseTo(0.5);
    });

    it('marks the blend member nearest the row, and a possible blend end', () => {
        const pool = [tv('L', 19, 24), tv('H', 21.5, 26.5), tv('P', 18.9, 23.9)];
        const via = { verdict: 'blend', members: [member('L', 19, 24), member('H', 21.5, 26.5)], alternatives: [], guide: { city: 20, hwy: 25 } };
        const out = guideRowMatches({ guide: row(1, 20, 25), via, pool });
        expect(out[0]).toMatchObject({ test_vehicle_id: 'L', match: 'blend', nearest: true });
        expect(out[1]).toMatchObject({ test_vehicle_id: 'H', match: 'blend', nearest: false });
        expect(out[2]).toMatchObject({ test_vehicle_id: 'P', match: 'possible' });
    });

    it('keeps an ambiguous row\'s other explanation apart from the members it named', () => {
        const pool = [tv('A', 20, 25), tv('B', 20.001, 25.001)];
        const via = { ...exact('A', 20, 25), ambiguous: true, alternatives: ['B'] };
        const out = guideRowMatches({ guide: row(1, 20, 25), via, pool });
        expect(out.map(m => [m.test_vehicle_id, m.match])).toEqual([['A', 'exact'], ['B', 'alternative']]);
    });

    it('is not other label where a sibling row only lists it as an alternative — the Equinox under the Blazer', () => {
        const pool = [tv('A', 20, 25), tv('E', 30, 40)];
        const others = [{ rowId: 9, via: { ...exact('S', 24, 30), ambiguous: true, alternatives: ['E'] } }];
        const out = guideRowMatches({ guide: row(1, 20, 25), via: exact('A', 20, 25), pool }, others);
        expect(out.find(m => m.test_vehicle_id === 'E').match).toBe('no-match');
    });

    it('says when a test vehicle has no lab data, and when it is marked behind no EPA Label', () => {
        const pool = [{ test_vehicle_id: 'Z', tests: [] }, tv('X', 30, 40, { fe_guide_skipped_at: '2026-10-31', fe_guide_skip_note: NO_LABEL_NOTE })];
        const out = guideRowMatches({ guide: row(1, 20, 25), via: exact('A', 20, 25), pool });
        expect(out.map(m => m.match)).toEqual(['no-match', 'no-lab-data']);
        expect(out[0].behindNoLabel).toBe(true);
        expect(out[1].delta).toBeNull();
    });
});
