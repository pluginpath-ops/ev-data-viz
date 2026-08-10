import { describe, it, expect } from 'vitest';
import { linkableRuns, linkableCounts } from '../runUtils';

const run = (id, kind, extra = {}) => ({ id, kind, name: `${kind}-${id}`, ...extra });
const source = () => ({
    id: 1,
    runs: [
        run(10, 'charging'), run(11, 'charging'),
        run(12, 'range'), run(13, 'range'),
        run(14, 'charging', { _inherited: true }),
    ],
});

describe('which runs can be inherited', () => {
    it('offers every own run by default', () => {
        expect(linkableRuns(source()).map(r => r.id)).toEqual([10, 11, 12, 13]);
    });

    it('filters to charging only — a trim sharing the battery', () => {
        expect(linkableRuns(source(), new Set(), 'charging').map(r => r.id)).toEqual([10, 11]);
    });

    it('filters to range only — a battery variant of the same car', () => {
        expect(linkableRuns(source(), new Set(), 'range').map(r => r.id)).toEqual([12, 13]);
    });

    it('never offers an inherited run — a link to a link', () => {
        expect(linkableRuns(source()).some(r => r._inherited)).toBe(false);
    });

    it('excludes runs already linked to the target', () => {
        expect(linkableRuns(source(), new Set([10, 12])).map(r => r.id)).toEqual([11, 13]);
    });

    it('respects both the filter and the already-linked set together', () => {
        expect(linkableRuns(source(), new Set([10]), 'charging').map(r => r.id)).toEqual([11]);
    });

    it('classifies pre-046 rows by their legacy flags', () => {
        const legacy = { id: 2, runs: [
            { id: 20, has_charging: true, has_range: false },
            { id: 21, has_charging: false, has_range: true },
        ] };
        expect(linkableRuns(legacy, new Set(), 'range').map(r => r.id)).toEqual([21]);
    });

    it('tolerates a missing vehicle', () => {
        expect(linkableRuns(null)).toEqual([]);
        expect(linkableRuns({})).toEqual([]);
    });
});

describe('counts for the filter', () => {
    it('counts each kind, excluding inherited and already-linked runs', () => {
        expect(linkableCounts(source())).toEqual({ all: 4, charging: 2, range: 2 });
        expect(linkableCounts(source(), new Set([10, 11]))).toEqual({ all: 2, charging: 0, range: 2 });
    });
});
