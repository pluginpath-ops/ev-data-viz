import { describe, it, expect } from 'vitest';
import { countNoun, countParts, legendWorthShowing } from '../plotCaption';

describe('countNoun', () => {
    it('pluralizes except at exactly one', () => {
        expect(countNoun(1, 'run')).toBe('1 run');
        expect(countNoun(0, 'run')).toBe('0 runs');
        expect(countNoun(3, 'composite curve')).toBe('3 composite curves');
    });
});

describe('countParts', () => {
    const counts = [[4, 'run'], [1, 'vehicle']];
    it('is empty unless Full Labels is on', () => {
        expect(countParts(false, counts)).toEqual([]);
        expect(countParts(undefined, counts)).toEqual([]);
    });
    it('leads with the counts under Full Labels', () => {
        expect(countParts(true, counts)).toEqual(['4 runs', '1 vehicle']);
    });
});

describe('legendWorthShowing', () => {
    it('hides a single dataset', () => {
        expect(legendWorthShowing([{ label: 'Range (mi)' }])).toBe(false);
    });
    it('hides datasets that all share a label', () => {
        expect(legendWorthShowing([{ label: 'A' }, { label: 'A' }])).toBe(false);
    });
    it('keeps two or more distinct labels', () => {
        expect(legendWorthShowing([{ label: 'A' }, { label: 'B' }])).toBe(true);
    });
    it('copes with nothing', () => {
        expect(legendWorthShowing(undefined)).toBe(false);
        expect(legendWorthShowing([])).toBe(false);
    });
});
