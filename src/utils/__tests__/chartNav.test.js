import { describe, it, expect } from 'vitest';
import {
    CHART_CATEGORIES, TOP_CHART_CATEGORIES, categoryByKey, categoryForMode, entryModeFor, modeNeedsSelection,
    navTabFor, chartModesUnder, navItemForMode,
} from '../../constants/chartNav';

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

describe('a chart category drawn under another tab (#338)', () => {
    it('puts Modeled vs Tested under EPA, not in the header', () => {
        expect(TOP_CHART_CATEGORIES.map(c => c.key)).not.toContain('epatested');
        expect(chartModesUnder('epa').map(m => [m.key, m.label, m.group])).toEqual([['epacurves', 'Modeled Efficiency', 'Selected vehicles']]);
        expect(navTabFor('epatested')).toBe('epa');
        expect(navTabFor('efficiency')).toBe('efficiency');   // a top tab is its own
        expect(navTabFor('vehicles')).toBe('vehicles');       // so is a non-chart view
    });

    it('lands an old Charging & Efficiency link to EPA Curves on its new home', () => {
        // The URL restore lands on whichever category owns the linked mode.
        expect(categoryForMode('epacurves').key).toBe('epatested');
        expect(categoryByKey('efficiency').modes.map(m => m.key)).not.toContain('epacurves');
    });

    it('keeps every mode key, which pop-outs, help bubbles and links depend on', () => {
        const keys = CHART_CATEGORIES.flatMap(c => c.modes.map(m => m.key));
        for (const k of ['charging', 'range', 'compare', 'roadtrip', 'epacurves', 'perfcompare', 'perfcurve', 'specs', 'specscatter', 'specstable']) {
            expect(keys).toContain(k);
        }
    });
});

describe('Vehicles & Specs (#338)', () => {
    it('draws the Specifications section under Vehicles & Specs, not as a tab', () => {
        expect(TOP_CHART_CATEGORIES.map(c => c.key)).not.toContain('specifications');
        expect(navTabFor('specifications')).toBe('vehicles');
        expect(categoryForMode('specstable').key).toBe('specifications');   // old links land under Vehicles & Specs
    });

    it('shows Table and one Chart item for the two spec charts, in a named section', () => {
        const items = chartModesUnder('vehicles');
        expect(items.map(m => [m.key, m.label, m.group])).toEqual([
            ['specstable', 'Table', 'Specifications & Data'],
            ['specs', 'Chart', 'Specifications & Data'],
        ]);
        expect(navItemForMode('specscatter')).toBe('specs');
        expect(navItemForMode('specs')).toBe('specs');
        expect(navItemForMode('charging')).toBe('charging');
    });
});
