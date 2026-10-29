import { describe, it, expect } from 'vitest';
import {
    bestOf, envelopeBySpeed, envelopeByStop, nearBest, chargeWindow, nearestIndex, stopAxisFor,
    OPT_LEG_MI, OPT_CHARGE_MIN, OPT_SPEED_MPH,
} from '../tripOptimizer';

// speed rows × stop columns, minutes; null = did not finish
const GRID = [
    [700, 690, null],
    [680, 672, 676],
    [690, 674, 701],
];

describe('tripOptimizer', () => {
    it('finds the fastest cell and skips cells that did not finish', () => {
        expect(bestOf(GRID)).toEqual({ si: 1, ti: 1, total: 672 });
        expect(bestOf([[null, null]])).toBeNull();
    });

    it('takes the best of the other setting at each value of one', () => {
        expect(envelopeBySpeed(GRID)).toEqual([
            { total: 690, ti: 1 }, { total: 672, ti: 1 }, { total: 674, ti: 1 },
        ]);
        expect(envelopeByStop(GRID)).toEqual([
            { total: 680, si: 1 }, { total: 672, si: 1 }, { total: 676, si: 1 },
        ]);
        expect(envelopeBySpeed([[null], [5]])).toEqual([null, { total: 5, ti: 0 }]);
    });

    it('marks every cell within the tolerance and spans them', () => {
        const near = nearBest(GRID, 5);
        expect(near.count).toBe(3);   // 672, 676, 674
        expect(near.speeds).toEqual([1, 2]);
        expect(near.stops).toEqual([1, 2]);
        expect(near.mask[0]).toEqual([false, false, false]);
        expect(nearBest([[null]])).toBeNull();
    });

    it('describes the en-route stops, not the destination top-up', () => {
        const sim = {
            totalDistMi: 500,
            segments: [
                { type: 'drive' },
                { type: 'charge', startDist: 200, startSoc: 10, endSoc: 60 },
                { type: 'charge', startDist: 400, startSoc: 14, endSoc: 70 },
                { type: 'charge', startDist: 500, startSoc: 5, endSoc: 20 },
            ],
        };
        expect(chargeWindow(sim)).toEqual({ stops: 2, arriveSoc: 12, leaveSoc: 65 });
        expect(chargeWindow({ segments: [] }).stops).toBe(0);
    });

    it('places a hand-typed setting on the grid', () => {
        expect(OPT_LEG_MI[nearestIndex(OPT_LEG_MI, 147)]).toBe(150);
        expect(OPT_SPEED_MPH[nearestIndex(OPT_SPEED_MPH, 200)]).toBe(100);
    });

    it('searches the setting the sim holds fixed', () => {
        expect(stopAxisFor('time')).toEqual({ values: OPT_CHARGE_MIN, param: 'chargeTimeMinutes' });
        expect(stopAxisFor('distance').param).toBe('legDistanceMi');
    });
});
