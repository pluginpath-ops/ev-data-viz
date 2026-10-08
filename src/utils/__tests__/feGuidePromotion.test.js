import { describe, it, expect } from 'vitest';
import {
    guideOverlay, demotionUpdates, guideConflicts, acceptGuideTags,
    GUIDE_FIELD_MAP, GUIDE_SOURCE, isCuratorOwned,
} from '../feGuidePromotion';

const feRow = {
    id: 42,
    label_comb_range_mi: 307,
    label_city_range_mi: 338,
    label_hwy_range_mi: 276,
    label_comb_mpge: 99,
    label_city_mpge: 109,
    label_hwy_mpge: 89,
    unadj_city_mpge: 154.2,
    unadj_hwy_mpge: 126.2,
    label_adjustment_factor: 0.7051,
    calc_approach: 'Electric Vehicle 5-cycle label',
    total_voltage_v: 353,
    nominal_pack_kwh: 92.062,
    batt_specific_energy_wh_kg: 173,
};

describe('guideOverlay — the Guide read over the record, not copied onto it (#374)', () => {
    it('fills a field the record leaves empty', () => {
        const { values, applied } = guideOverlay({ overrides: {} }, feRow);
        expect(values.label_range_published).toBe(307);
        expect(applied).toContain('label_range_published');
    });

    it('reads the Guide over a certificate value, because the Guide is the published one', () => {
        // Found comparing every vehicle before and after: a CSI re-import had
        // overwritten copied Guide values with the PDF's own pack voltage on
        // records still linked to the Guide row. The rule is the Guide.
        const record = { total_voltage: 349, overrides: { total_voltage: { source: 'pdf' } } };
        expect(guideOverlay(record, { ...feRow, total_voltage_v: 378 }).values.total_voltage).toBe(378);
    });

    it('leaves a curator-set value alone, and says so', () => {
        const record = { label_range_published: 306, overrides: { label_range_published: { source: 'manual' } } };
        const { values, held, overrides } = guideOverlay(record, feRow);
        expect(values).not.toHaveProperty('label_range_published');
        expect(held).toEqual(['label_range_published']);
        expect(overrides.label_range_published).toEqual({ source: 'manual' });
    });

    it('tags what it filled, so the curator form can say where a figure came from', () => {
        const { overrides } = guideOverlay({ overrides: {} }, feRow);
        expect(overrides.label_hwy_mpge).toEqual({ source: GUIDE_SOURCE });
    });

    it('says nothing about fields the guide row does not carry', () => {
        const { values } = guideOverlay({ overrides: {} }, { id: 1, label_comb_range_mi: 300 });
        expect(Object.keys(values)).toEqual(['label_range_published']);
    });

    it('is empty without a Guide row', () => {
        expect(guideOverlay({ overrides: {} }, null)).toMatchObject({ values: {}, applied: [] });
    });

    it('never targets useable_kwh', () => {
        // Gross pack energy is not what the pack delivers after its buffer.
        expect(Object.values(GUIDE_FIELD_MAP)).not.toContain('useable_kwh');
        expect(guideOverlay({ overrides: {} }, feRow).values).not.toHaveProperty('useable_kwh');
    });
});

describe('demotionUpdates — forgetting a pre-#374 promotion', () => {
    const promoted = {
        label_range_published: 307,
        label_hwy_mpge: 89,
        overrides: {
            label_range_published: { source: 'fe_guide', previous: 306 },
            label_hwy_mpge:        { source: 'fe_guide', previous: null },
            useable_kwh:           { source: 'manual' },
        },
    };

    it('restores what promotion displaced, and drops the tag', () => {
        const { updates, restored } = demotionUpdates(promoted);
        expect(updates.label_range_published).toBe(306);
        expect(updates.overrides).not.toHaveProperty('label_range_published');
        expect(restored).toEqual(expect.arrayContaining(['label_range_published', 'label_hwy_mpge']));
    });

    it('restores an empty field to empty, not to the promoted value', () => {
        expect(demotionUpdates(promoted).updates.label_hwy_mpge).toBeNull();
    });

    it('leaves alone a field the curator owns', () => {
        expect(demotionUpdates(promoted).updates.overrides.useable_kwh).toEqual({ source: 'manual' });
    });

    it('writes no Guide link any more — that lives on the certification', () => {
        expect(demotionUpdates(promoted).updates).not.toHaveProperty('fe_guide_row_id');
    });

    it('is a no-op on a record that was never promoted', () => {
        const { updates, restored } = demotionUpdates({ overrides: { useable_kwh: { source: 'manual' } } });
        expect(restored).toEqual([]);
        expect(Object.keys(updates)).toEqual(['overrides']);
    });
});

describe('guideConflicts', () => {
    const held = {
        label_range_published: 306,
        label_combined_mpge: 99,
        overrides: {
            label_range_published: { source: 'manual' },
            label_combined_mpge:   { source: 'manual' },
        },
    };

    it('names the fields the guide was not allowed to fill', () => {
        // The overlay holds these without a word; the disagreement does not go
        // away, and the curator may want the published figure after all.
        const conflicts = guideConflicts(held, feRow);
        expect(conflicts.map(c => c.column)).toEqual(['label_range_published']);
        expect(conflicts[0]).toMatchObject({ ours: 306, theirs: 307 });
    });

    it('stays quiet when the held value already agrees', () => {
        // label_combined_mpge is 99 on both sides — flagging that would train
        // the curator to ignore the flag.
        expect(guideConflicts(held, feRow).some(c => c.column === 'label_combined_mpge')).toBe(false);
    });

    it('compares numbers as numbers', () => {
        const stringy = {
            label_range_published: '307.00',
            overrides: { label_range_published: { source: 'manual' } },
        };
        expect(guideConflicts(stringy, feRow)).toEqual([]);
    });

    it('ignores fields that were not curator-held', () => {
        const fromGuide = {
            label_range_published: 999,
            overrides: { label_range_published: { source: 'fe_guide' } },
        };
        expect(guideConflicts(fromGuide, feRow)).toEqual([]);
    });
});

describe('acceptGuideTags — letting go of a held value', () => {
    const held = {
        label_range_published: 306,
        useable_kwh: 80,
        overrides: {
            label_range_published: { source: 'manual' },
            useable_kwh:           { source: 'manual' },
        },
    };

    it('drops the hand-set tag, so the Guide is read for that field again', () => {
        const { overrides, accepted } = acceptGuideTags(held, ['label_range_published']);
        expect(accepted).toEqual(['label_range_published']);
        expect(overrides).not.toHaveProperty('label_range_published');
        expect(guideOverlay({ ...held, overrides }, feRow).values.label_range_published).toBe(307);
    });

    it('touches only fields the Guide fills', () => {
        expect(acceptGuideTags(held, ['useable_kwh']).accepted).toEqual([]);
    });

    it('does nothing when asked for nothing', () => {
        expect(acceptGuideTags(held, []).accepted).toEqual([]);
    });
});

describe('isCuratorOwned — one spelling of "a human set this"', () => {
    it('recognises the source the curator editor actually writes', () => {
        // EpaCuratorEditor tags hand edits `manual`. An unlink guard written
        // against 'curator' never fired, and would have wiped the very choice
        // it was meant to protect.
        expect(isCuratorOwned({ preferred_test_number: { source: 'manual' } }, 'preferred_test_number'))
            .toBe(true);
        expect(isCuratorOwned({ preferred_test_number: { source: 'curator' } }, 'preferred_test_number'))
            .toBe(false);
    });

    it('says no for a field nothing has touched', () => {
        expect(isCuratorOwned({}, 'preferred_test_number')).toBe(false);
        expect(isCuratorOwned(null, 'preferred_test_number')).toBe(false);
    });

    it('says no for a value the Guide fills', () => {
        expect(isCuratorOwned({ label_hwy_mpge: { source: GUIDE_SOURCE } }, 'label_hwy_mpge'))
            .toBe(false);
    });
});
