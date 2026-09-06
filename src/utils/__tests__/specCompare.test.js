import { describe, it, expect } from 'vitest';
import { bestIndices, rowDiffers, rowIsEmpty } from '../specCompare';

const idx = (values, better) => [...bestIndices(values, better)].sort((a, b) => a - b);

describe('bestIndices', () => {
    it('marks the single winner in each direction', () => {
        expect(idx([250, 400, 200], 'higher')).toEqual([1]);
        expect(idx([25, 21, 35], 'lower')).toEqual([1]);
    });

    it('marks EVERY cell that ties for best', () => {
        // The report that prompted this: two cars at 400 kW, and neither was
        // marked. They are joint best; saying nothing is not an answer.
        expect(idx([400, 250, 400], 'higher')).toEqual([0, 2]);
        expect(idx([11.5, 11.5, 11, 11.5], 'higher')).toEqual([0, 1, 3]);
        expect(idx([21, 21, 35], 'lower')).toEqual([0, 1]);
    });

    it('marks nothing when every vehicle records the same value', () => {
        // No winner to point at, and washing the whole row says nothing.
        expect(idx([1, 1, 1], 'higher')).toEqual([]);
        expect(idx([11.5, 11.5], 'lower')).toEqual([]);
        // Blanks alongside a single repeated value are the same case.
        expect(idx([null, 250, 250, null], 'higher')).toEqual([]);
    });

    it('never lets an unrecorded cell win', () => {
        // `Number(null)` is 0, which is the minimum of every `lower` row.
        expect(idx([null, 4.6, 4.7], 'lower')).toEqual([1]);
        expect(idx([null, null, 25, 21], 'lower')).toEqual([3]);
        expect(idx(['', 5, 9], 'lower')).toEqual([1]);
    });

    it('needs two comparable figures', () => {
        expect(idx([null, 400, null], 'higher')).toEqual([]);
        expect(idx([400], 'higher')).toEqual([]);
        expect(idx([], 'higher')).toEqual([]);
    });

    it('marks nothing without a declared direction', () => {
        // Most rows have none, and that is the point: more motors and more
        // speakers are not better without a use case.
        expect(idx([2, 1, 3], undefined)).toEqual([]);
        expect(idx([2, 1, 3], 'sideways')).toEqual([]);
    });

    it('reads numeric strings, and refuses formatted ones', () => {
        expect(idx(['250', '400'], 'higher')).toEqual([1]);
        // "405 mi" is what the EPA Range row used to hold. It is not a number,
        // and a row model has to carry what was recorded rather than how it
        // was printed.
        expect(idx(['327 mi', '405 mi'], 'higher')).toEqual([]);
    });
});

describe('rowDiffers / rowIsEmpty', () => {
    it('compares raw values, including the blanks', () => {
        expect(rowDiffers([5, 5, 5])).toBe(false);
        expect(rowDiffers([5, 5, 6])).toBe(true);
        expect(rowDiffers([null, null])).toBe(false);
        expect(rowDiffers([null, 5])).toBe(true);
    });

    it('is empty only when nothing at all was recorded', () => {
        expect(rowIsEmpty([null, undefined])).toBe(true);
        expect(rowIsEmpty([null, 0])).toBe(false);
    });
});
