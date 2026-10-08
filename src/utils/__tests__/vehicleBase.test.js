import { describe, it, expect } from 'vitest';
import { applyVehicleBases, withVehicleBase, NO_VEHICLE_BASES } from '../vehicleBase';
import { resolveChartColors, SERIES_PALETTES, VEHICLE_PALETTE } from '../colorUtils';

const runs = [
    { id: 'a1', created_at: '2026-01-01' },
    { id: 'b1', created_at: '2026-01-02' },
];
const vehicles = [
    { id: 'a', color: '#aa0000', runs: [runs[0]] },
    { id: 'b', color: null, runs: [runs[1]] },
];
const SET = SERIES_PALETTES[0].id;

describe('withVehicleBase', () => {
    it('sets a base and returns a new object only on change', () => {
        const one = withVehicleBase(NO_VEHICLE_BASES, 'a', '#112233');
        expect(one).toEqual({ a: '#112233' });
        expect(withVehicleBase(one, 'a', '#112233')).toBe(one);
    });

    it('hands a base back with a null color, and clearing nothing is a no-op', () => {
        const one = withVehicleBase(NO_VEHICLE_BASES, 'a', '#112233');
        expect(withVehicleBase(one, 'a', null)).toEqual({});
        expect(withVehicleBase(NO_VEHICLE_BASES, 'a', null)).toBe(NO_VEHICLE_BASES);
    });
});

describe('applyVehicleBases', () => {
    it('returns the same array when nothing is based', () => {
        expect(applyVehicleBases(vehicles, NO_VEHICLE_BASES)).toBe(vehicles);
    });

    it('replaces the color on a copy and marks it, leaving the original alone', () => {
        const [a, b] = applyVehicleBases(vehicles, { a: '#00aa00' });
        expect(a).toMatchObject({ id: 'a', color: '#00aa00', sessionBase: true });
        expect(b).toBe(vehicles[1]);
        expect(vehicles[0].color).toBe('#aa0000');
    });
});

describe('a session base in resolveChartColors', () => {
    it('is drawn exactly under Vehicle color, over the curated color', () => {
        const based = applyVehicleBases(vehicles, { a: '#00aa00' });
        expect(resolveChartColors(runs, {}, VEHICLE_PALETTE, based).a1).toBe('#00aa00');
    });

    it('reaches the chart under a palette, where a curated color does not', () => {
        const based = applyVehicleBases(vehicles, { a: '#00aa00' });
        expect(resolveChartColors(runs, {}, SET, based).a1).toBe('#00aa00');
        expect(resolveChartColors(runs, {}, SET, vehicles).a1).not.toBe('#aa0000');
    });

    it('leaves every other vehicle to the palette', () => {
        const based = applyVehicleBases(vehicles, { a: '#00aa00' });
        const drawn = resolveChartColors(runs, {}, SET, based);
        expect(drawn.b1).toBeTruthy();
        expect(drawn.b1).not.toBe(drawn.a1);
    });

    it('is still beaten by a hand-set pick on the test', () => {
        const based = applyVehicleBases(vehicles, { a: '#00aa00' });
        expect(resolveChartColors(runs, { a1: '#0000ff' }, SET, based).a1).toBe('#0000ff');
    });
});
