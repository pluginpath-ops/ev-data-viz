import { describe, it, expect } from 'vitest';
import { importProgressLabel } from '../importProgress';

describe('importProgressLabel', () => {
    it('shows no estimate before anything has finished', () => {
        expect(importProgressLabel({ done: 0, total: 168, name: 'G1', startedAt: 0 }, 4000))
            .toBe('0 of 168 written · now G1 · 4s elapsed');
    });

    it('estimates the time left from the running average', () => {
        // 42 done in 210 s → 5 s each → 126 left → 630 s
        expect(importProgressLabel({ done: 42, total: 168, name: 'G2', startedAt: 0 }, 210_000))
            .toBe('42 of 168 written · now G2 · 3m 30s elapsed · ~10 min left');
    });

    it('drops the estimate and the name when finished', () => {
        expect(importProgressLabel({ done: 168, total: 168, name: null, startedAt: 0 }, 60_000))
            .toBe('168 of 168 written · 1m 00s elapsed');
    });
});
