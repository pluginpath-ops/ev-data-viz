import { describe, it, expect } from 'vitest';
import { clockToSeconds, timestampToMs, isTimestampValue, wallClockTimestamp } from '../parseElapsedTime';

describe('clockToSeconds', () => {
    it('reads HH:MM:SS:FF timecode as a duration', () => {
        expect(clockToSeconds('00:00:00:00')).toBe(0);
        expect(clockToSeconds('00:01:09:15')).toBeCloseTo(69.5);
        expect(clockToSeconds('01:08:27:16')).toBeCloseTo(4107 + 16 / 30);
    });

    it('rejects blanks and non-clock strings', () => {
        expect(clockToSeconds('')).toBeNull();
        expect(clockToSeconds('2024-01-01 10:00:00')).toBeNull();
        expect(clockToSeconds('1:2:3:4:5')).toBeNull();
    });
});

describe('timestampToMs', () => {
    it('gives timecodes elapsed milliseconds', () => {
        expect(timestampToMs('00:00:32:15')).toBeCloseTo(32500);
        expect(isTimestampValue('00:00:00:00')).toBe(true);
    });
});

describe('wallClockTimestamp', () => {
    it('keeps a real datetime as written', () => {
        expect(wallClockTimestamp('2024-01-01 10:00:00')).toBe('2024-01-01 10:00:00');
        expect(wallClockTimestamp('2024-01-01T10:00:00Z')).toBe('2024-01-01T10:00:00Z');
    });

    // The save that failed: "00:00:00:00" reached the timestamptz column.
    it('drops elapsed clocks and timecodes, which are durations', () => {
        expect(wallClockTimestamp('00:00:00:00')).toBeNull();
        expect(wallClockTimestamp('00:03:35:61')).toBeNull();
        expect(wallClockTimestamp('05:30')).toBeNull();
        expect(wallClockTimestamp('00:01:04')).toBeNull();
    });

    it('drops blanks, junk and non-strings', () => {
        expect(wallClockTimestamp('')).toBeNull();
        expect(wallClockTimestamp('not a date')).toBeNull();
        expect(wallClockTimestamp(null)).toBeNull();
        expect(wallClockTimestamp(undefined)).toBeNull();
        expect(wallClockTimestamp(51)).toBeNull();
    });
});
