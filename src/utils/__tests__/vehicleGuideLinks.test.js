import { describe, it, expect } from 'vitest';
import {
    configurationsFromTestedVia, namesTestVehicle, isAlternative, configurationStanding, planVehicleGuideLinks,
    couldBeVehiclesRow,
} from '../vehicleGuideLinks';

const member = (test_vehicle_id, city, hwy) => ({ test_vehicle_id, city, hwy, via: ['T'] });
const via = (verdict, members, extra = {}) => ({
    verdict, members, alternatives: [], ambiguous: false, guide: { city: 20, hwy: 25, tol: 0.01 }, ...extra,
});
// An MCT test whose point is 100 × ac ÷ range: city 20, highway 25.
const mct = (test_number) => ({ test_number, procedure_code: 77, ac_recharge_kwh: 100, cd_range_combined_calc: 500, cd_range_hwy_calc: 400 });

describe('configurationsFromTestedVia', () => {
    it('links an exact match as primary and verified', () => {
        expect(configurationsFromTestedVia(via('exact', [member('A', 20, 25)])))
            .toEqual([{ test_vehicle_id: 'A', primary: true, confidence: 'verified' }]);
    });

    it('holds an ambiguous exact or a near match to likely', () => {
        expect(configurationsFromTestedVia(via('exact', [member('A', 20, 25)], { ambiguous: true }))[0].confidence).toBe('likely');
        expect(configurationsFromTestedVia(via('near', [member('A', 20, 25.02)]))[0].confidence).toBe('likely');
    });

    it("links every member of a blend, the nearest to the row first — the owner's rule", () => {
        const out = configurationsFromTestedVia(via('blend', [member('FAR', 18, 23), member('NEAR', 20.5, 25.4)]));
        expect(out.map(c => [c.test_vehicle_id, c.primary])).toEqual([['NEAR', true], ['FAR', false]]);
        expect(out.every(c => c.confidence === 'likely')).toBe(true);
    });

    it('links nothing for an untested row — the nearest trim is a suggestion only', () => {
        expect(configurationsFromTestedVia(via('untested', []))).toEqual([]);
        expect(configurationsFromTestedVia(null)).toEqual([]);
    });
});

describe('namesTestVehicle', () => {
    it('by id, and never as an ambiguous alternative', () => {
        const v = via('exact', [member('A', 20, 25)], { alternatives: ['B'] });
        expect(namesTestVehicle(v, { test_vehicle_id: 'A' })).toBe(true);
        expect(namesTestVehicle(v, { test_vehicle_id: 'B' })).toBe(false);
        expect(isAlternative(v, { test_vehicle_id: 'B' })).toBe(true);
        expect(namesTestVehicle(v, { test_vehicle_id: 'C' })).toBe(false);
    });

    it('by the same lab point — one car stored twice is one point in Tested via', () => {
        const v = via('exact', [member('A', 20, 25)]);
        expect(namesTestVehicle(v, { test_vehicle_id: 'A-copy', tests: [mct('T1')] })).toBe(true);
    });

    it('never for a verdict that names no one', () => {
        expect(namesTestVehicle(via('untested', []), { test_vehicle_id: 'A' })).toBe(false);
    });
});

describe('configurationStanding', () => {
    const rows = [
        { rowId: 1, via: via('exact', [member('A', 20, 25)]), poolIds: new Set(['A', 'B']) },
        { rowId: 2, via: via('untested', []), poolIds: new Set(['C']) },
    ];

    it('is confirmed when a row names it', () => {
        expect(configurationStanding({ test_vehicle_id: 'A' }, rows)).toEqual({ status: 'confirmed', rowId: 1 });
    });

    it('is contradicted when a row from its pool names someone else', () => {
        expect(configurationStanding({ test_vehicle_id: 'B' }, rows)).toEqual({ status: 'contradicted', rowId: 1 });
    });

    it('is elsewhere when a sibling row of the certification names it — the Gravity GT on other wheels', () => {
        const others = [{ rowId: 3, via: via('exact', [member('B', 21, 26)]) }];
        expect(configurationStanding({ test_vehicle_id: 'B' }, rows, others)).toEqual({ status: 'elsewhere', rowId: 3 });
    });

    it('is unconfirmed, not confirmed or contradicted, as an ambiguous row\'s alternative — the Equinox under the Blazer row', () => {
        const ambiguous = [{ rowId: 1, via: via('blend', [member('A', 20, 25)], { alternatives: ['E'] }), poolIds: new Set(['A', 'E']) }];
        expect(configurationStanding({ test_vehicle_id: 'E' }, ambiguous)).toEqual({ status: 'unconfirmed', rowId: null });
    });

    it('is unconfirmed when its row is untested, or it is in no linked row\'s pool', () => {
        expect(configurationStanding({ test_vehicle_id: 'C' }, rows).status).toBe('unconfirmed');
        expect(configurationStanding({ test_vehicle_id: 'D' }, rows).status).toBe('unconfirmed');
    });
});

describe('planVehicleGuideLinks', () => {
    it('links the row a configuration points at only when its Tested via names it — the Ioniq 5 XRT', () => {
        // The XRT's AWD test vehicle points at the "Ioniq 5 RWD" row, whose
        // Tested via is the RWD test vehicle: the link is an old mistake.
        const plan = planVehicleGuideLinks({
            mappings: [{ id: 10, test_vehicle_id: 'AWD', is_primary: true }],
            guideRowsOf: { AWD: [121] },
            rows: { 121: { via: via('exact', [member('RWD', 18, 22)]), poolIds: new Set(['AWD', 'RWD']) } },
        });
        expect(plan.linkRows).toEqual([]);
        expect(plan.drop).toEqual([]);
        expect(plan.unconfirmed.map(u => u.test_vehicle_id)).toEqual(['AWD']);
        expect(plan.primary).toBeNull();
    });

    it('drops what a linked row contradicts and adds a blend\'s other members', () => {
        const plan = planVehicleGuideLinks({
            mappings: [
                { id: 1, test_vehicle_id: 'M1', is_primary: false },
                { id: 2, test_vehicle_id: 'OTHER', is_primary: true },
            ],
            guideRowsOf: { M1: [7], OTHER: [7] },
            rows: { 7: { via: via('blend', [member('M1', 19, 24), member('M2', 20.2, 25.1)]), poolIds: new Set(['M1', 'M2', 'OTHER']) } },
        });
        expect(plan.linkRows).toEqual([7]);
        expect(plan.drop).toEqual([{ mappingId: 2, test_vehicle_id: 'OTHER', rowId: 7 }]);
        expect(plan.add).toEqual([{ test_vehicle_id: 'M2', primary: true, confidence: 'likely', rowId: 7 }]);
        // The old primary went; the blend's nearest member stands for the vehicle.
        expect(plan.primary).toBe('M2');
    });

    it('keeps a configuration a sibling row names, rather than dropping it', () => {
        const plan = planVehicleGuideLinks({
            mappings: [{ id: 1, test_vehicle_id: 'A', is_primary: true }, { id: 2, test_vehicle_id: 'B', is_primary: false }],
            guideRowsOf: { A: [1], B: [1] },
            rows: { 1: { via: via('exact', [member('A', 20, 25)]), poolIds: new Set(['A', 'B']) } },
            others: [{ rowId: 9, via: via('exact', [member('B', 21, 26)]) }],
        });
        expect(plan.drop).toEqual([]);
        expect(plan.elsewhere).toEqual([{ mappingId: 2, test_vehicle_id: 'B', rowId: 9 }]);
    });

    it('keeps the primary when it survives, and is a no-op on a second run', () => {
        const input = {
            mappings: [{ id: 1, test_vehicle_id: 'A', is_primary: true }],
            guideRowsOf: { A: [1] },
            rows: { 1: { via: via('exact', [member('A', 20, 25)]), poolIds: new Set(['A']) } },
        };
        const first = planVehicleGuideLinks(input);
        expect(first).toMatchObject({ linkRows: [1], drop: [], add: [], elsewhere: [], primary: null });
        expect(planVehicleGuideLinks({ ...input, linkedRowIds: [1] }).linkRows).toEqual([]);
    });
});

describe('couldBeVehiclesRow', () => {
    const row = (id, model_year, carline) => ({ id, model_year, carline });

    it('keeps to the vehicle\'s model years', () => {
        const v = { name: 'Ioniq 6 LR RWD', model: 'Ioniq 6', year: '2025' };
        expect(couldBeVehiclesRow(v, row(1, 2025, 'Ioniq 6 Long range RWD'))).toBe(true);
        expect(couldBeVehiclesRow(v, row(2, 2023, 'Ioniq 6 Long range RWD'))).toBe(false);
        expect(couldBeVehiclesRow({ ...v, year: '2023-2025' }, row(2, 2023, 'Ioniq 6 Long range RWD'))).toBe(true);
    });

    it('wants every word of the model in the carline — a shared test vehicle is not a shared car', () => {
        expect(couldBeVehiclesRow({ name: 'R1T Dual Standard', model: 'R1T', year: '2025' }, row(1, 2025, 'R1S Dual Standard (22in)'))).toBe(false);
        expect(couldBeVehiclesRow({ name: 'Equinox EV LT FWD', model: 'Equinox EV', year: '2026' }, row(2, 2026, 'BLAZER EV FWD 22IN TIRE'))).toBe(false);
    });

    it('loses to a closer row of the same year', () => {
        const gt = row(795, 2024, 'e-tron GT');
        const rs = row(796, 2024, 'RS e-tron GT');
        const peers = [gt, rs];
        expect(couldBeVehiclesRow({ name: 'e-tron GT', model: 'e-tron GT', year: '2024' }, rs, peers)).toBe(false);
        expect(couldBeVehiclesRow({ name: 'e-tron GT', model: 'e-tron GT', year: '2024' }, gt, peers)).toBe(true);
        expect(couldBeVehiclesRow({ name: 'RS e-tron GT', model: 'e-tron GT', year: '2024' }, gt, peers)).toBe(false);
        // Another year's closer row does not count.
        expect(couldBeVehiclesRow({ name: 'RS e-tron GT', model: 'e-tron GT', year: '2024-2025' }, row(9, 2025, 'e-tron GT'), [rs])).toBe(true);
    });
});

describe('planVehicleGuideLinks with the vehicle', () => {
    it('proposes no row of another carline, but keeps one already linked', () => {
        const rows = {
            1: { via: via('exact', [member('A', 20, 25)]), poolIds: new Set(['A']), guide: { id: 1, model_year: 2025, carline: 'R1S Quad (22in)' } },
        };
        const input = {
            mappings: [{ id: 1, test_vehicle_id: 'A', is_primary: true }],
            guideRowsOf: { A: [1] }, rows,
            vehicle: { name: 'R1T Quad', model: 'R1T', year: '2025' },
        };
        expect(planVehicleGuideLinks(input).linkRows).toEqual([]);
        expect(planVehicleGuideLinks({ ...input, vehicle: { ...input.vehicle, model: 'R1S', name: 'R1S Quad' } }).linkRows).toEqual([1]);
        // A curator's link stands, and still judges the configurations.
        expect(planVehicleGuideLinks({ ...input, linkedRowIds: [1] })).toMatchObject({ linkRows: [], drop: [] });
    });
});
