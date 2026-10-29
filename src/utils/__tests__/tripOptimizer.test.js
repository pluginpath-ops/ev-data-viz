import { describe, it, expect } from 'vitest';
import {
    bestOf, envelopeBySpeed, envelopeByStop, nearBest, chargeWindow, nearestIndex, stopAxisFor,
    speedIndexRange, withinSpeeds, usefulStopCount,
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
        // 672 × 1% = 6.72 minutes: 672, 676 and 674, not 680.
        const near = nearBest(GRID, 1);
        expect(near.tolMin).toBeCloseTo(6.72);
        expect(near.count).toBe(3);   // 672, 676, 674
        expect(near.speeds).toEqual([1, 2]);
        expect(near.stops).toEqual([1, 2]);
        expect(near.mask[0]).toEqual([false, false, false]);
        expect(nearBest([[null]])).toBeNull();
        // Against a slower reference, every faster cell is in too: no upper bound.
        const open = nearBest(GRID, 1, { si: 2, ti: 1, total: 690 });
        expect(open.mask[0]).toEqual([false, true, false]);  // 700 > 696.9
        expect(open.count).toBe(6);                          // all but 700 and 701
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

    it('holds the best plan to a speed range, in either order', () => {
        const [lo, hi] = speedIndexRange(55, 80);
        expect([OPT_SPEED_MPH[lo], OPT_SPEED_MPH[hi]]).toEqual([55, 80]);
        expect(speedIndexRange(80, 55)).toEqual([lo, hi]);
        expect(speedIndexRange(55.5, 79.5).map(i => OPT_SPEED_MPH[i])).toEqual([56, 79]);
        // The fastest cell (row 1) is outside; the best within row 2 is 674.
        expect(bestOf(withinSpeeds(GRID, [2, 2]))).toEqual({ si: 2, ti: 1, total: 674 });
        expect(withinSpeeds(GRID, [2, 2])[1]).toEqual([null, null, null]);
    });

    it('searches the setting the sim holds fixed', () => {
        expect(stopAxisFor('time')).toEqual({ values: OPT_CHARGE_MIN, param: 'chargeTimeMinutes' });
        expect(stopAxisFor('distance').param).toBe('legDistanceMi');
    });

    it('cuts top stop plans that are blank or repeat the row below', () => {
        // The fixed-time L: a one-stop speed repeats up the column, the rest go blank.
        expect(usefulStopCount([
            [600, 590, 590, 590],
            [550, 540, null, null],
        ])).toBe(2);
        // A row that changes anything, anywhere, is kept — and so is all below it.
        expect(usefulStopCount([
            [600, 590, 590, 580],
            [550, 540, null, null],
        ])).toBe(4);
        expect(usefulStopCount([[null, null]])).toBe(1);
        expect(usefulStopCount(GRID)).toBe(3);
    });
});
