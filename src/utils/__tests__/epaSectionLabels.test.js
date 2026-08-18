/**
 * Naming the methodology sections.
 *
 * Every case here is taken from real data — the awkward output that prompted
 * the rule, and the good output the rule must not break.
 */
import { describe, it, expect } from 'vitest';
import { methodologyTitle, methodologySubtitle } from '../epaSectionLabels';

describe('methodologyTitle', () => {
    it('drops a config name that only repeats the vehicle', () => {
        // The case that prompted this: two adjacent sections reading
        // "2026 Model Y Performance · Performance EPA Range Assessment".
        expect(methodologyTitle({
            vehicleName: '2026 Model Y Performance · Performance',
            epaLabel: 'Model Y Performance',
            configCount: 2,
        })).toBe('2026 Model Y Performance · Performance');
    });

    it('keeps a config name that says something the vehicle does not', () => {
        // The R2's names are the good case and must survive.
        expect(methodologyTitle({
            vehicleName: '2027 R2 Performance · Performance',
            epaLabel: '20" AT',
            configCount: 2,
        })).toBe('2027 R2 Performance · Performance — 20" AT');
    });

    it('omits the config name when there is only one to distinguish', () => {
        // With a single configuration there is nothing to tell apart, so even a
        // useful name is noise in the heading.
        expect(methodologyTitle({
            vehicleName: '2025-2026 Model Y Premium · Premium AWD',
            epaLabel: '2026 (Update)',
            configCount: 1,
        })).toBe('2025-2026 Model Y Premium · Premium AWD');
    });

    it('matches redundancy case-insensitively', () => {
        expect(methodologyTitle({
            vehicleName: '2026 Model Y PERFORMANCE',
            epaLabel: 'model y performance',
            configCount: 2,
        })).toBe('2026 Model Y PERFORMANCE');
    });

    it('survives a missing config name', () => {
        expect(methodologyTitle({ vehicleName: 'A car', epaLabel: null, configCount: 3 })).toBe('A car');
    });

    it('never carries the redundant suffix', () => {
        // "EPA Range Assessment" appeared on every section inside a card already
        // headed "EPA range methodology".
        const title = methodologyTitle({ vehicleName: 'A car', epaLabel: '20" AT', configCount: 2 });
        expect(title).not.toMatch(/EPA Range Assessment/);
    });
});

describe('methodologySubtitle', () => {
    it('pairs the year with the test group, as the run selector does', () => {
        expect(methodologySubtitle({ modelYear: 2026, testGroupId: 'YD226-00180' }))
            .toBe('2026 · YD226-00180');
    });

    it('is what actually separates two same-named configurations', () => {
        const a = methodologySubtitle({ modelYear: 2026, testGroupId: 'YD226-00180' });
        const b = methodologySubtitle({ modelYear: 2026, testGroupId: 'YD226-765263' });
        expect(a).not.toBe(b);
    });

    it('degrades rather than printing a stray separator', () => {
        expect(methodologySubtitle({ modelYear: 2026, testGroupId: null })).toBe('2026');
        expect(methodologySubtitle({ modelYear: null, testGroupId: 'X1' })).toBe('X1');
        expect(methodologySubtitle({})).toBeNull();
    });
});
