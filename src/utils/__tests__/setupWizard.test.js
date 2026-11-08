import { describe, it, expect } from 'vitest';
import {
    planFromAnswers, planSummary, starterSetIds, isCompleteVehicle,
    STARTER_SET_SIZE, DEFAULT_STARTER_SET, EMPTY_ANSWERS,
} from '../setupWizard';
import { compareCuratedOrder } from '../vehicleOrder';

const CHARGE = { id: 'c', kind: 'charging' };
const RANGE = { id: 'r', kind: 'range' };

/** A vehicle with all three kinds of data unless told otherwise. */
const car = (id, { tag = 'SUV', order = id, make = `Make${id}`, model = `Model${id}`, epa = true, charging = true, range = true, price } = {}) => ({
    id, name: `Car ${id}`, make, model, sort_order: order, created_at: '2026-01-01',
    tags: [{ id: tag, name: tag }],
    epa_mappings: epa ? [{ id: 1 }] : [],
    runs: [...(charging ? [{ ...CHARGE, id: `c${id}` }] : []), ...(range ? [{ ...RANGE, id: `r${id}` }] : [])],
    specs: price != null ? { pricing: { base_price_usd: price } } : {},
});

describe('isCompleteVehicle', () => {
    it('needs EPA data, a charging test and a range test', () => {
        expect(isCompleteVehicle(car(1))).toBe(true);
        expect(isCompleteVehicle(car(1, { epa: false }))).toBe(false);
        expect(isCompleteVehicle(car(1, { charging: false }))).toBe(false);
        expect(isCompleteVehicle(car(1, { range: false }))).toBe(false);
    });

    it('does not count a stored composite as a charging test', () => {
        const v = { ...car(1, { charging: false }), runs: [{ id: 'x', kind: 'charging', composite: true }, RANGE] };
        expect(isCompleteVehicle(v)).toBe(false);
    });
});

describe('starterSetIds', () => {
    const fleet = Array.from({ length: 10 }, (_, i) => car(i + 1, { order: 10 - i }));

    it('caps the set, never selecting every match', () => {
        expect(starterSetIds('suv', fleet)).toHaveLength(STARTER_SET_SIZE);
        expect(STARTER_SET_SIZE).toBeGreaterThanOrEqual(4);
        expect(STARTER_SET_SIZE).toBeLessThanOrEqual(6);
    });

    it('follows the curated vehicle order (Vehicles & Specs default sort)', () => {
        const expected = [...fleet].sort(compareCuratedOrder).slice(0, STARTER_SET_SIZE).map(v => v.id);
        expect(starterSetIds('suv', fleet)).toEqual(expected);
        expect(expected[0]).toBe(10);   // sort_order 1
    });

    it('leaves out vehicles missing EPA, charging or range data', () => {
        const mixed = [car(1, { order: 1, epa: false }), car(2, { order: 2, charging: false }), car(3, { order: 3, range: false }), car(4, { order: 4 })];
        expect(starterSetIds('suv', mixed)).toEqual([4]);
    });

    it('matches on tags', () => {
        const mixed = [car(1, { tag: 'Truck' }), car(2, { tag: 'Sedan' }), car(3, { tag: 'Truck' })];
        expect(starterSetIds('pickup', mixed)).toEqual([1, 3]);
    });

    it('takes one trim per make and model from the order', () => {
        const trims = [car(1, { make: 'Kia', model: 'EV6', order: 1 }), car(2, { make: 'Kia', model: 'EV6', order: 2 }), car(3, { order: 3 })];
        expect(starterSetIds('suv', trims)).toEqual([1, 3]);
    });

    it('puts a curated list first, in its own order, then fills from the order', () => {
        const sets = [{ key: 'suv', label: 'SUV', curated: [7, 3, 99], match: () => true }];
        const ids = starterSetIds('suv', fleet, { sets });
        expect(ids.slice(0, 2)).toEqual([7, 3]);   // 99 is not in the fleet: skipped
        expect(ids).toHaveLength(STARTER_SET_SIZE);
        expect(ids[2]).toBe(10);
    });

    it('drops a curated vehicle that is not complete', () => {
        const sets = [{ key: 'suv', label: 'SUV', curated: [1], match: () => true }];
        expect(starterSetIds('suv', [car(1, { range: false }), car(2)], { sets })).toEqual([2]);
    });

    it('ranks price sets by the curated order too, not by price', () => {
        const cheap = [car(1, { price: 30000, order: 2 }), car(2, { price: 40000, order: 1 }), car(3, { price: 90000, order: 0 })];
        expect(starterSetIds('affordable', cheap)).toEqual([2, 1]);
        expect(starterSetIds('luxury', cheap)).toEqual([3]);
    });
});

describe('planFromAnswers', () => {
    const fleet = [car(1), car(2), car(3)];

    it('opens Cost & Time Compare and a starter set when everything is skipped', () => {
        const plan = planFromAnswers(EMPTY_ANSWERS, { vehicles: fleet, selectedIds: [] });
        expect(plan.mode).toBe('drivecost');
        expect(plan.setKey).toBe(DEFAULT_STARTER_SET);
        expect(plan.vehicleIds).toEqual([1, 2, 3]);
        expect(plan.correction).toEqual({});
        expect(plan.costToDrive).toEqual({});
    });

    it('keeps the selection when cars are skipped and something is selected', () => {
        const plan = planFromAnswers({ goal: 'charging' }, { vehicles: fleet, selectedIds: [2] });
        expect(plan.vehicleIds).toBeNull();
        expect(plan.mode).toBe('charging');
    });

    it('uses picked cars as given', () => {
        const plan = planFromAnswers({ cars: { how: 'pick', ids: [3, 1] } }, { vehicles: fleet });
        expect(plan.vehicleIds).toEqual([3, 1]);
    });

    it('writes driving, weather and money through to each setting', () => {
        const plan = planFromAnswers({
            dailyMi: 40, highway: 'highway', speedMph: 75, climate: 'cold', mountains: true,
            home: 'charger', homePrice: 0.15, gasMpg: 28, gasPrice: 3.5, trips: 'weekly', tripMi: 700,
        }, { vehicles: fleet, selectedIds: [1] });
        expect(plan.correction).toEqual({ speedMph: 75, temperatureF: 30, altitudeFt: 5000 });
        expect(plan.costToDrive).toMatchObject({
            dailyMi: 40, dailyCity: 20, dailyMph: 75, longMph: 75, week: 'DDDDDLO',
            winterF: 20, season: 'winter', elevationFt: 5000, level: 3, homePrice: 0.15,
            gasCity: 28, gasHwy: 28, gasPrice: 3.5, longMi: 400,
        });
        expect(plan.assumptions).toEqual({ homePrice: 0.15 });
        expect(plan.roadTrip).toEqual({ speed: 75, totalDistance: 700, optimizerDistance: 700 });
    });

    it('says what it cannot set', () => {
        const plan = planFromAnswers({ home: 'none' }, { vehicles: fleet });
        expect(plan.costToDrive.level).toBeUndefined();
        expect(plan.unset.join(' ')).toMatch(/home/i);
    });
});

describe('planSummary', () => {
    it('names the chart, the cars and only what was answered', () => {
        const answers = { goal: 'range', speedMph: 70 };
        const plan = planFromAnswers(answers, { vehicles: [car(1)], selectedIds: [] });
        const lines = planSummary(plan, answers, { 1: 'Ioniq 5' });
        expect(lines.map(l => l.label)).toEqual(['Opens', 'Cars', 'Driving']);
        expect(lines[0].text).toBe('Charging & Range › Range & Efficiency');
        expect(lines[1].text).toMatch(/Ioniq 5/);
    });
});
