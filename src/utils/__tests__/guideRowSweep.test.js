import { describe, it, expect } from 'vitest';
import { buildGuideRowSweep, bulkLinks, applyDecisions } from '../guideRowSweep';

// MCT tests: city = 100·ac/c, highway = 100·ac/h.
let nextId = 1;
const member = (id, group, city, hwy, extra = {}) => ({
    membershipId: nextId++, test_group: group, test_vehicle_id: id, carryover_test_group: null,
    fe_guide_row_id: null, fe_guide_skipped_at: null, epa_carline_name: `Car ${id}`,
    tests: [{ test_number: `${id}-T`, procedure_code: 77, ac_recharge_kwh: 100, cd_range_combined_calc: 10000 / city, cd_range_hwy_calc: 10000 / hwy }],
    ...extra,
});
const row = (id, group, city, hwy, carline = 'Car') => ({ id, smog_test_group: group, carline, model_year: 2025, unadj_city_kwh_100mi: city.toFixed(4), unadj_hwy_kwh_100mi: hwy.toFixed(4) });

describe('buildGuideRowSweep', () => {
    it('places a certification\'s test vehicles under each of its rows, with the membership to link', () => {
        const members = [member('A', 'G1', 20, 25), member('B', 'G1', 30, 40)];
        const { items } = buildGuideRowSweep([row(1, 'G1', 20, 25), row(2, 'G1', 30, 40)], members);
        const one = items.find(i => i.row.id === 1);
        expect(one.status).toBe('ready');
        expect(one.matches.map(m => [m.test_vehicle_id, m.match, m.state])).toEqual([
            ['A', 'exact', 'awaiting'], ['B', 'other-label', 'awaiting'],
        ]);
        expect(one.matches[0].membership.membershipId).toBe(members[0].membershipId);
    });

    it('is done once every membership is decided, and says where a link went', () => {
        const members = [member('A', 'G1', 20, 25, { fe_guide_row_id: 1 }), member('B', 'G1', 30, 40, { fe_guide_skipped_at: 'x' })];
        const { items } = buildGuideRowSweep([row(1, 'G1', 20, 25)], members);
        expect(items[0].status).toBe('done');
        expect(items[0].matches.map(m => m.state)).toEqual(['here', 'skipped']);
    });

    it('needs judgment where nothing it names awaits — the Lyriq charger rows', () => {
        const { items } = buildGuideRowSweep([row(1, 'G1', 24.1, 29.6)], [member('L', 'G1', 26.4, 32.0)]);
        expect(items[0].via.verdict).toBe('untested');
        expect(items[0].status).toBe('judgment');
    });

    it('names the year of a test vehicle carried in from another certification — R1S0396R20-1', () => {
        const members = [
            member('A', 'G23', 20, 25, { model_year: 2023 }),
            member('B', 'G24', 20, 25, { model_year: 2024, carryover_test_group: 'G23' }),
        ];
        const { items } = buildGuideRowSweep([row(1, 'G23', 20, 25)], members);
        expect(items[0].matches.map(m => [m.test_vehicle_id, m.state, m.homeYears])).toEqual([
            ['A', 'awaiting', []], ['B', 'none', [2024]],
        ]);
    });

    it('lists awaiting memberships whose certification has no Guide row', () => {
        const { orphans } = buildGuideRowSweep([row(1, 'G1', 20, 25)], [member('A', 'G1', 20, 25), member('Z', 'G9', 20, 25)]);
        expect(orphans.map(o => o.test_vehicle_id)).toEqual(['Z']);
    });
});

describe('bulkLinks', () => {
    const members = [member('A', 'G1', 20, 25), member('L', 'G2', 19, 24), member('H', 'G2', 21.5, 26.5)];
    const { items } = buildGuideRowSweep([row(1, 'G1', 20, 25), row(2, 'G2', 20, 25)], members);

    it('sure: an unambiguous exact row, not a blend', () => {
        expect(bulkLinks(items, 'sure')).toEqual([{ membershipId: members[0].membershipId, testVehicleId: 'A', rowId: 1 }]);
    });

    it('named: blends too, every member for the row', () => {
        expect(bulkLinks(items, 'named').map(e => [e.testVehicleId, e.rowId]).sort()).toEqual([['A', 1], ['H', 2], ['L', 2]]);
    });

    it('gives a test vehicle two rows name to the one that is its own carline — Q6 and Q6 Sportback', () => {
        const twice = [member('A', 'G1', 20, 25, { epa_carline_name: 'Q6 e-tron quattro' })];
        const { items: two } = buildGuideRowSweep(
            [row(1, 'G1', 20, 25, 'Q6 e-tron quattro'), row(2, 'G1', 20, 25, 'Q6 Sportback e-tron quattro')], twice);
        expect(bulkLinks(two, 'named').map(e => e.rowId)).toEqual([1]);
        expect(two.find(i => i.row.id === 2).matches[0].alsoNamedBy).toEqual([{ rowId: 1, carline: 'Q6 e-tron quattro' }]);
    });

    it('failing its exact carline, gives it to the only row of its model — the R1T test behind the R1S row', () => {
        const twice = [member('A', 'G1', 20, 25, { epa_carline_name: 'R1T Performance Dual Large (22in)' })];
        const { items: two } = buildGuideRowSweep(
            [row(1, 'G1', 20, 25, 'R1S Premium (22in)'), row(2, 'G1', 20, 25, 'R1T Premium (22in)')], twice);
        expect(bulkLinks(two, 'sure').map(e => e.rowId)).toEqual([2]);
    });

    it('leaves a test vehicle two rows name to the curator when neither is its own carline', () => {
        const twice = [member('A', 'G1', 20, 25)];
        const { items: two } = buildGuideRowSweep([row(1, 'G1', 20, 25, 'Car'), row(2, 'G1', 20, 25, 'Car 19in')], twice);
        expect(bulkLinks(two, 'named')).toEqual([]);
    });
});

describe('applyDecisions', () => {
    it('links, skips, and moves a test vehicle off a row it was linked to elsewhere', () => {
        const members = [member('A', 'G1', 20, 25), member('A', 'G0', 20, 25, { fe_guide_row_id: 1 }), member('B', 'G1', 30, 40)];
        const out = applyDecisions(members, [
            { membershipId: members[0].membershipId, testVehicleId: 'A', rowId: 1 },
            { membershipId: members[2].membershipId, testVehicleId: 'B', skip: true, note: 'n' },
        ]);
        expect(out.map(m => m.fe_guide_row_id)).toEqual([1, null, null]);
        expect(out[2].fe_guide_skip_note).toBe('n');
    });
});
