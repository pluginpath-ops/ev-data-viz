import { describe, it, expect } from 'vitest';
import { pointsKnownEmpty, withPointCount } from '../runPoints';

describe('pointsKnownEmpty', () => {
    it('skips only a run the database counted at zero', () => {
        expect(pointsKnownEmpty({ id: 1, dataPointCount: 0 })).toBe(true);
    });
    it('fetches when there are points', () => {
        expect(pointsKnownEmpty({ id: 1, dataPointCount: 3 })).toBe(false);
    });
    it('fetches when the count is unknown — never shows empty on a guess', () => {
        expect(pointsKnownEmpty({ id: 1 })).toBe(false);
        expect(pointsKnownEmpty({ id: 1, dataPointCount: null })).toBe(false);
        expect(pointsKnownEmpty({ id: 1, dataPointCount: undefined })).toBe(false);
        expect(pointsKnownEmpty(undefined)).toBe(false);
        expect(pointsKnownEmpty(null)).toBe(false);
    });
});

describe('withPointCount', () => {
    const vehicles = [
        { id: 'a', runs: [{ id: 10, dataPointCount: 0, name: 'src' }, { id: 11, dataPointCount: 5 }] },
        { id: 'b', runs: [{ id: 'inherited_1_10', _inherited: true, _realRunId: 10, dataPointCount: 0 }] },
        { id: 'c', runs: [{ id: 12, dataPointCount: 0 }] },
    ];

    it('updates the run and its inherited copies, nothing else', () => {
        const out = withPointCount(vehicles, 10, 42);
        expect(out[0].runs[0].dataPointCount).toBe(42);
        expect(out[0].runs[1].dataPointCount).toBe(5);
        expect(out[1].runs[0].dataPointCount).toBe(42);
        expect(out[2]).toBe(vehicles[2]);
    });

    it('a run that gains points stops being skipped everywhere it is read', () => {
        const out = withPointCount(vehicles, 10, 42);
        expect(out.flatMap(v => v.runs).filter(r => (r.id === 10 || r._realRunId === 10)).some(pointsKnownEmpty)).toBe(false);
    });

    it('leaves the input untouched', () => {
        withPointCount(vehicles, 10, 42);
        expect(vehicles[0].runs[0].dataPointCount).toBe(0);
    });
});
