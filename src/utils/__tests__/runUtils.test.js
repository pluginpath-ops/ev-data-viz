import { describe, it, expect } from 'vitest';
import { applyDefaultRun, clearDefaultRuns, runKindFrom } from '../runUtils';

// A vehicle after the 046 split: charging halves and range halves side by side.
const fleet = () => ([
    { id: 1, kind: 'charging', isDefault: true },
    { id: 2, kind: 'charging', isDefault: false },
    { id: 3, kind: 'range',    isDefault: true },
    { id: 4, kind: 'range',    isDefault: false },
]);
const flags = rs => rs.map(r => `${r.id}${r.isDefault ? '*' : ''}`);

describe('a vehicle holds one default per KIND', () => {
    it('leaves the charging default standing when a range default is set', () => {
        expect(flags(applyDefaultRun(fleet(), 4))).toEqual(['1*', '2', '3', '4*']);
    });

    it('leaves the range default standing when a charging default is set', () => {
        expect(flags(applyDefaultRun(fleet(), 2))).toEqual(['1', '2*', '3*', '4']);
    });

    it('displaces the previous default of the SAME kind', () => {
        expect(flags(applyDefaultRun(fleet(), 2))).not.toContain('1*');
    });
});

describe('clearing', () => {
    it('clears one run without disturbing the other kind', () => {
        expect(flags(clearDefaultRuns(fleet(), 3))).toEqual(['1*', '2', '3', '4']);
    });

    it('clears everything with no id, for discarding a vehicle', () => {
        expect(flags(clearDefaultRuns(fleet()))).toEqual(['1', '2', '3', '4']);
    });

    it('changes nothing for an id that is not there', () => {
        expect(flags(clearDefaultRuns(fleet(), 99))).toEqual(['1*', '2', '3*', '4']);
    });
});

describe('edges', () => {
    it('scopes pre-046 rows by their has_charging/has_range flags', () => {
        const legacy = [
            { id: 1, has_charging: true,  has_range: false, isDefault: true },
            { id: 2, has_charging: false, has_range: true,  isDefault: true },
            { id: 3, has_charging: false, has_range: true,  isDefault: false },
        ];
        expect(flags(applyDefaultRun(legacy, 3))).toEqual(['1*', '2', '3*']);
    });

    it('treats an unknown runId as a no-op rather than clearing every default', () => {
        expect(flags(applyDefaultRun(fleet(), 99))).toEqual(['1*', '2', '3*', '4']);
    });

    it('does not mutate its input', () => {
        const rs = fleet();
        applyDefaultRun(rs, 4);
        expect(flags(rs)).toEqual(['1*', '2', '3*', '4']);
    });

    it('tolerates empty and null', () => {
        expect(applyDefaultRun([], 1)).toEqual([]);
        expect(applyDefaultRun(null, 1)).toEqual([]);
        expect(clearDefaultRuns(null)).toEqual([]);
    });
});

describe('runKindFrom', () => {
    it('prefers an explicit kind, falling back to the legacy flag pair', () => {
        expect(runKindFrom({ kind: 'range' })).toBe('range');
        expect(runKindFrom({ has_range: true, has_charging: false })).toBe('range');
        expect(runKindFrom({})).toBe('charging');
    });
});
