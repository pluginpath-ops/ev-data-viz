import { describe, it, expect } from 'vitest';
import {
    isUnlisted, isListed, isExcluded, poolGateMissing, countsInStatistics, poolOf, statisticalRuns, unlistedCount,
} from '../runListing';

const r = (id, over = {}) => ({ id, kind: 'range', speed_mph: 70, temperature_f: 70, ...over });

describe('runListing — two questions per test (#394)', () => {
    it('reads the camel key first, so a local edit wins over the loaded value', () => {
        expect(isUnlisted({ is_hidden: true })).toBe(true);
        expect(isUnlisted({ is_hidden: true, isHidden: false })).toBe(false);
        expect(isExcluded({ is_excluded: true, isExcluded: false })).toBe(false);
        expect(isListed(r(1))).toBe(true);
    });

    it('holds only an unlisted range test to the pool rule', () => {
        expect(poolGateMissing(r(1, { speed_mph: null, temperature_f: null }))).toEqual([]);            // listed
        expect(poolGateMissing(r(1, { isHidden: true, speed_mph: null }))).toEqual(['speed']);
        expect(poolGateMissing(r(1, { isHidden: true, temperature_f: null }))).toEqual(['temperature']);
        // A temperature the session supplies is a temperature recorded.
        expect(poolGateMissing(r(1, { isHidden: true, temperature_f: null }), { temperature_f: 60 })).toEqual([]);
        expect(poolGateMissing({ id: 1, kind: 'charging', isHidden: true })).toEqual([]);
    });

    it('counts all four combinations correctly', () => {
        expect(countsInStatistics(r(1))).toBe(true);                                         // listed, counted
        expect(countsInStatistics(r(2, { isHidden: true }))).toBe(true);                     // the pool
        expect(countsInStatistics(r(3, { isHidden: true, isExcluded: true }))).toBe(false);  // what "hidden" was
        expect(countsInStatistics(r(4, { isExcluded: true }))).toBe(false);                  // shown, not counted
        expect(countsInStatistics(r(5, { isHidden: true, speed_mph: null }))).toBe(false);   // fails the pool rule
    });

    it('builds the pool and the statistical set once each', () => {
        const runs = [r(1), r(2, { isHidden: true }), r(3, { isHidden: true, isExcluded: true }), r(4, { isExcluded: true })];
        const pooledRuns = poolOf(runs);
        expect(pooledRuns.map(x => x.id)).toEqual([2]);
        expect(statisticalRuns({ runs, pooledRuns }).map(x => x.id)).toEqual([1, 2]);
        // A viewer: listed runs only, with the pool beside them.
        expect(statisticalRuns({ runs: [r(1), r(4, { isExcluded: true })], pooledRuns }).map(x => x.id)).toEqual([1, 2]);
        expect(unlistedCount(runs)).toBe(2);
    });
});

describe('a curator overriding the quality checks (migration 080)', () => {
    it('lets an unlisted range test into the pool without speed or temperature', async () => {
        const { hasQualityOverride } = await import('../runListing');
        const bare = r(1, { isHidden: true, speed_mph: null, temperature_f: null });
        expect(countsInStatistics(bare)).toBe(false);
        const forced = { ...bare, qualityOverride: true };
        expect(hasQualityOverride(forced)).toBe(true);
        expect(poolGateMissing(forced)).toEqual([]);
        expect(countsInStatistics(forced)).toBe(true);
        // ...but never past an exclusion: that is the curator's own call.
        expect(countsInStatistics({ ...forced, isExcluded: true })).toBe(false);
    });
});
