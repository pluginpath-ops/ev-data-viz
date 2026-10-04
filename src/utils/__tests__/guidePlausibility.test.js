import { describe, it, expect } from 'vitest';
import { guidePlausibilityFlags } from '../guidePlausibility';

describe('guidePlausibilityFlags', () => {
    it('flags the staged LYRIQ row: highway 26 against city 530', () => {
        const flags = guidePlausibilityFlags({
            label_city_range_mi: 530, label_hwy_range_mi: 26, label_comb_range_mi: 314,
        });
        expect(flags.map(f => f.kind)).toContain('range-ratio');
        expect(flags[0].text).toContain('530');
    });

    it('passes an ordinary row, and rounding in the combined figure', () => {
        expect(guidePlausibilityFlags({
            label_city_range_mi: 338, label_hwy_range_mi: 276, label_comb_range_mi: 307,
            label_city_mpge: 130, label_hwy_mpge: 105, label_comb_mpge: 117,
        })).toEqual([]);
    });

    it('flags a combined figure outside the two it blends', () => {
        const flags = guidePlausibilityFlags({
            label_city_range_mi: 300, label_hwy_range_mi: 280, label_comb_range_mi: 400,
        });
        expect(flags.map(f => f.kind)).toEqual(['range-combined']);
    });

    it('says nothing when the figures are missing, rather than guessing', () => {
        expect(guidePlausibilityFlags({ label_city_range_mi: 300 })).toEqual([]);
        expect(guidePlausibilityFlags(null)).toEqual([]);
    });
});
