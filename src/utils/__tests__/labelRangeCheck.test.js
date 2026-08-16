import { describe, it, expect } from 'vitest';
import { labelRangeCheck, labelRangeCheckNote } from '../labelRangeCheck';

describe('labelRangeCheck', () => {
    it('says nothing when either side is missing', () => {
        // Nothing to compare is not a disagreement and must not read as one —
        // most linked groups have no label at all (A1: 7 of 87).
        expect(labelRangeCheck(null, 320)).toBeNull();
        expect(labelRangeCheck(307, null)).toBeNull();
        expect(labelRangeCheck(null, null)).toBeNull();
        expect(labelRangeCheck(0, 320)).toBeNull();
        expect(labelRangeCheck('', 320)).toBeNull();
        expect(labelRangeCheck('not a number', 320)).toBeNull();
    });

    it('accepts numeric strings, which is how form values arrive', () => {
        expect(labelRangeCheck('307', '307').mismatch).toBe(false);
    });

    it('treats a few miles as agreement', () => {
        // The case the curator explicitly does not want flagged: one trim
        // mapping to several EPA configurations a few miles apart.
        const c = labelRangeCheck(307, 313);
        expect(c.mismatch).toBe(false);
        expect(c.deltaMi).toBe(-6);
        expect(Math.abs(c.deltaPct)).toBeLessThan(2);
    });

    it('flags a gap that suggests the wrong test group', () => {
        // R2: the 20" AT config is 307 mi, the 21" is 330. Linking the wrong
        // one is the mistake this exists to catch.
        const c = labelRangeCheck(330, 307);
        expect(c.mismatch).toBe(true);
        expect(c.deltaMi).toBe(23);
        expect(c.deltaPct).toBeCloseTo(7.49, 1);
    });

    it('is symmetric about direction but keeps the sign', () => {
        expect(labelRangeCheck(250, 320).mismatch).toBe(true);
        expect(labelRangeCheck(250, 320).deltaMi).toBeLessThan(0);
        expect(labelRangeCheck(320, 250).deltaMi).toBeGreaterThan(0);
    });

    it('honours an explicit tolerance', () => {
        expect(labelRangeCheck(330, 307, 10).mismatch).toBe(false);
        expect(labelRangeCheck(330, 307, 1).mismatch).toBe(true);
        // Exactly at the threshold is agreement, not a flag.
        expect(labelRangeCheck(105, 100, 5).mismatch).toBe(false);
    });
});

describe('labelRangeCheckNote', () => {
    it('stays quiet unless there is a mismatch', () => {
        expect(labelRangeCheckNote(null)).toBeNull();
        expect(labelRangeCheckNote(labelRangeCheck(307, 307))).toBeNull();
    });

    it('names the spec value, the gap and the direction', () => {
        const note = labelRangeCheckNote(labelRangeCheck(330, 307));
        expect(note).toContain('307 mi');
        expect(note).toContain('23 mi');
        expect(note).toContain('7.5%');
        expect(note).toContain('above');
    });

    it('says "below" when the label is the smaller figure', () => {
        expect(labelRangeCheckNote(labelRangeCheck(250, 320))).toContain('below');
    });
});
