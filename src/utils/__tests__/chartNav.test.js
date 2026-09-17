import { describe, it, expect } from 'vitest';
import { CHART_CATEGORIES, categoryByKey, entryModeFor, modeNeedsSelection } from '../../constants/chartNav';

describe('chart tabs and the selection', () => {
    const specs = categoryByKey('specifications');

    it('keeps Specifications open with nothing selected, and only Specifications', () => {
        const open = CHART_CATEGORIES.filter(c => !c.modes.every(modeNeedsSelection)).map(c => c.key);
        expect(open).toEqual(['specifications']);
    });

    it('enters on the vehicle table when nothing is selected, whatever was remembered', () => {
        expect(entryModeFor(specs, 'specscatter', false)).toBe('specstable');
        expect(entryModeFor(specs, undefined, false)).toBe('specstable');
    });

    it('restores the remembered mode once there is a selection', () => {
        expect(entryModeFor(specs, 'specscatter', true)).toBe('specscatter');
        expect(entryModeFor(specs, 'nope', true)).toBe('specstable');
        expect(entryModeFor(categoryByKey('performance'), undefined, true)).toBe('perfcompare');
    });

    it('has nowhere to enter a chart-only tab with nothing selected', () => {
        expect(entryModeFor(categoryByKey('efficiency'), 'charging', false)).toBeNull();
    });
});
