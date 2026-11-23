import { describe, it, expect } from 'vitest';
import { speedAt, positionOfSpeed, roundSpeed, formatClock, formatElapsed, sliceByClock, clockExtent } from '../chartPlayback';

describe('speed slider', () => {
    it('is a log scale between its ends', () => {
        expect(speedAt(0, 10, 1000)).toBeCloseTo(10);
        expect(speedAt(0.5, 10, 1000)).toBeCloseTo(100);
        expect(speedAt(1, 10, 1000)).toBeCloseTo(1000);
        expect(positionOfSpeed(100, 10, 1000)).toBeCloseTo(0.5);
    });
    it('rounds to a readable speed', () => {
        expect(roundSpeed(47.3)).toBe(50);
        expect(roundSpeed(123)).toBe(120);
        expect(roundSpeed(4567)).toBe(4600);
    });
});

describe('formatClock', () => {
    it('reads #m ##s under an hour and #h ##m from one', () => {
        expect(formatClock(0)).toBe('0m 00s');
        expect(formatClock(12.5)).toBe('12m 30s');
        expect(formatClock(135)).toBe('2h 15m');
        expect(formatClock(37, true)).toBe('0h 37m');
        expect(formatClock(-2.5)).toBe('−2m 30s');
    });
    it('words elapsed time for the subtitle', () => {
        expect(formatElapsed(12.7)).toBe('12 min');
        expect(formatElapsed(205)).toBe('3h 25m');
    });
});

describe('sliceByClock', () => {
    const pts = [
        { x: 10, y: 100, t: 0 },
        { x: 20, y: 200, t: 2 },
        { x: 30, y: 150, t: 4 },
    ];
    it('keeps points up to the clock and interpolates the head', () => {
        const out = sliceByClock(pts, 3);
        expect(out).toHaveLength(3);
        expect(out[2]).toMatchObject({ x: 25, y: 175, t: 3 });
    });
    it('is the whole series at or past its end', () => {
        expect(sliceByClock(pts, 4)).toEqual(pts);
        expect(sliceByClock(pts, 9)).toEqual(pts);
    });
    it('keeps a point with no clock', () => {
        expect(sliceByClock([{ x: 1, y: 1 }, ...pts], 0)).toHaveLength(2);
    });
    it('carries a point’s other fields onto the head', () => {
        const out = sliceByClock([{ x: 0, y: 0, t: 0, n: 3 }, { x: 2, y: 2, t: 2, n: 3 }], 1);
        expect(out[1].n).toBe(3);
    });
});

describe('clockExtent', () => {
    it('runs from the earliest clock (never above zero) to the last', () => {
        expect(clockExtent([{ data: [{ t: 3 }] }, { data: [{ t: 7 }, { t: null }] }], false)).toEqual({ start: 0, end: 7 });
        expect(clockExtent([{ data: [{ t: -2.5 }, { t: 7 }] }], false)).toEqual({ start: -2.5, end: 7 });
        expect(clockExtent([{ data: [{ x: 90 }, { x: 240 }] }], true)).toEqual({ start: 0, end: 240 });
    });
});
