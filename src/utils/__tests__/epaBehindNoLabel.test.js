import { describe, it, expect } from 'vitest';
import { labelStanding, planBehindNoLabel, NO_LABEL_NOTE, isNoLabelSkip } from '../epaBehindNoLabel';
import { couldStandBehind } from '../guideTestedVia';

// MCT tests: 100 × ac ÷ range. city = 100·ac/c, highway = 100·ac/h.
const tv = (id, city, hwy) => ({
    test_vehicle_id: id,
    tests: [{ test_number: `${id}-T`, procedure_code: 77, ac_recharge_kwh: 100, cd_range_combined_calc: 10000 / city, cd_range_hwy_calc: 10000 / hwy }],
});
const row = (id, city, hwy) => ({ id, unadj_city_kwh_100mi: city.toFixed(4), unadj_hwy_kwh_100mi: hwy.toFixed(4) });
const member = (id, city, hwy) => ({ test_vehicle_id: id, city, hwy, via: ['T'] });
const exact = (id, city, hwy) => ({ verdict: 'exact', members: [member(id, city, hwy)], alternatives: [], ambiguous: false });

describe('couldStandBehind', () => {
    it('within reach of the row', () => {
        expect(couldStandBehind(row(1, 20, 25), tv('A', 20.01, 25.01))).toBe(true);
    });

    it('as one end of a blend with another test vehicle of the pool', () => {
        // The row sits halfway between A and B.
        expect(couldStandBehind(row(1, 20, 25), tv('A', 19, 24), [tv('B', 21, 26)])).toBe(true);
    });

    it('not when it is far off and lines up with nothing', () => {
        expect(couldStandBehind(row(1, 20, 25), tv('X', 30, 40), [tv('A', 20, 25)])).toBe(false);
    });
});

describe('labelStanding', () => {
    const pool = [tv('A', 20, 25), tv('X', 30, 40)];
    const rowA = { guide: row(1, 20, 25), via: exact('A', 20, 25), pool };

    it('is behind when a row names it', () => {
        expect(labelStanding(tv('A', 20, 25), [rowA]).status).toBe('behind');
    });

    it('is none when every row is reproduced by others and it fits none — a variant that never reached a label', () => {
        expect(labelStanding(tv('X', 30, 40), [rowA])).toMatchObject({ status: 'none' });
    });

    it('is unknown when a row of its certification is untested — it may be behind that one', () => {
        const untested = { guide: row(2, 31, 39), via: { verdict: 'untested', members: [] }, pool };
        expect(labelStanding(tv('X', 30, 40), [rowA, untested])).toMatchObject({ status: 'unknown' });
    });

    it('is unknown with no Guide rows imported, or no lab figures', () => {
        expect(labelStanding(tv('X', 30, 40), []).status).toBe('unknown');
        expect(labelStanding({ test_vehicle_id: 'Z', tests: [] }, [rowA]).status).toBe('unknown');
    });

    it('is unknown when it could be one end of a blend the classifier explained another way', () => {
        const rowMid = { guide: row(3, 20, 25), via: exact('A', 20, 25), pool: [tv('A', 20, 25), tv('L', 19, 24), tv('H', 21, 26)] };
        expect(labelStanding(tv('L', 19, 24), [rowMid]).status).toBe('unknown');
    });
});

describe('planBehindNoLabel', () => {
    const pool = [tv('A', 20, 25), tv('X', 30, 40)];
    const rows = { A: [{ guide: row(1, 20, 25), via: exact('A', 20, 25), pool }], X: [{ guide: row(1, 20, 25), via: exact('A', 20, 25), pool }] };
    const rowsOf = (id) => rows[id] ?? [];

    it('clears a wrong Guide link, skips, and removes vehicle links', () => {
        const plan = planBehindNoLabel([{
            ...tv('X', 30, 40),
            memberships: [{ id: 7, fe_guide_row_id: 1, fe_guide_skipped_at: null }],
            mappings: [{ id: 9, vehicle: { name: 'V' } }],
        }], rowsOf);
        expect(plan.mark).toEqual([{ test_vehicle_id: 'X', clearLinks: [7], skip: true, unlink: [{ id: 9, vehicle: { name: 'V' } }] }]);
    });

    it("never writes over a curator's own skip", () => {
        const plan = planBehindNoLabel([{
            ...tv('X', 30, 40),
            memberships: [{ id: 7, fe_guide_row_id: null, fe_guide_skipped_at: '2026-01-01', fe_guide_skip_note: 'Concept car' }],
            mappings: [],
        }], rowsOf);
        expect(plan.mark).toEqual([]);
        expect(plan.counts.marked).toBe(1);
    });

    it('is empty on a second run, and lifts its own mark when a row now names the test vehicle', () => {
        const marked = { id: 7, fe_guide_row_id: null, fe_guide_skipped_at: '2026-10-31', fe_guide_skip_note: NO_LABEL_NOTE };
        expect(isNoLabelSkip(marked)).toBe(true);
        expect(planBehindNoLabel([{ ...tv('X', 30, 40), memberships: [marked], mappings: [] }], rowsOf).mark).toEqual([]);
        const plan = planBehindNoLabel([{ ...tv('A', 20, 25), memberships: [marked], mappings: [] }], rowsOf);
        expect(plan.unmark).toEqual(['A']);
    });
});
