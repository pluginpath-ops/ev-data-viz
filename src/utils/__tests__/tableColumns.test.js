import { describe, it, expect } from 'vitest';
import { isBlank, sortByColumn, barMaximaOf, barPercentOf, BAR_MIN_PCT, moveColumn } from '../tableColumns';

const valueOf = (row, col) => row[col.key];
const scaleOf = (col) => col.scale ?? col.key;

describe('sortByColumn', () => {
    const rows = [{ v: 2 }, { v: null }, { v: 10 }, { v: '' }, { v: 0 }];
    const col = { key: 'v', numeric: true };

    it('puts blanks last in both directions, and keeps zero as a value', () => {
        expect(sortByColumn(rows, col, 'asc', valueOf).map(r => r.v)).toEqual([0, 2, 10, null, '']);
        expect(sortByColumn(rows, col, 'desc', valueOf).map(r => r.v)).toEqual([10, 2, 0, null, '']);
    });

    it('compares text with numbers in it numerically', () => {
        const text = [{ n: 'R10' }, { n: 'R2' }];
        expect(sortByColumn(text, { key: 'n' }, 'asc', valueOf).map(r => r.n)).toEqual(['R2', 'R10']);
    });

    it('does not reorder its input', () => {
        const input = [{ v: 2 }, { v: 1 }];
        sortByColumn(input, col, 'asc', valueOf);
        expect(input.map(r => r.v)).toEqual([2, 1]);
    });
});

describe('bars', () => {
    it('shares a maximum between columns on one scale, and skips columns with no bar', () => {
        const cols = [{ key: 'city', bar: true, scale: 'mi' }, { key: 'hwy', bar: true, scale: 'mi' }, { key: 'hp' }];
        const rows = [{ city: 300, hwy: 250, hp: 900 }, { city: '', hwy: 320, hp: 1 }];
        expect(barMaximaOf(rows, cols, valueOf, scaleOf)).toEqual({ mi: 320 });
    });

    it('draws no bar for a blank, and never less than the minimum for a real value', () => {
        expect(isBlank(0)).toBe(false);
        expect(barPercentOf(null, 100)).toBeNull();
        expect(barPercentOf('', 100)).toBeNull();
        expect(barPercentOf(50, 0)).toBeNull();
        expect(barPercentOf(0, 100)).toBe(BAR_MIN_PCT);
        expect(barPercentOf(50, 100)).toBe(50);
        expect(barPercentOf(150, 100)).toBe(100);
    });
});

describe('moveColumn', () => {
    const cols = ['name', 'a', 'b', 'c'];

    it('moves a column one place right — the move "splice at the target" could not make', () => {
        expect(moveColumn(cols, 'a', 'b', 'after', 'name')).toEqual(['name', 'b', 'a', 'c']);
    });

    it('moves left and right across several columns', () => {
        expect(moveColumn(cols, 'c', 'a', 'before', 'name')).toEqual(['name', 'c', 'a', 'b']);
        expect(moveColumn(cols, 'a', 'c', 'after', 'name')).toEqual(['name', 'b', 'c', 'a']);
    });

    it('never moves the fixed column, nor puts anything in front of it', () => {
        expect(moveColumn(cols, 'name', 'b', 'after', 'name')).toBe(cols);
        expect(moveColumn(cols, 'b', 'name', 'before', 'name')).toBe(cols);
        expect(moveColumn(cols, 'b', 'name', 'after', 'name')).toEqual(['name', 'b', 'a', 'c']);
    });

    it('returns the same array for a drop that changes nothing', () => {
        expect(moveColumn(cols, 'a', 'b', 'before', 'name')).toBe(cols);
        expect(moveColumn(cols, 'a', 'a', 'after', 'name')).toBe(cols);
        expect(moveColumn(cols, 'zz', 'a', 'after', 'name')).toBe(cols);
    });
});
