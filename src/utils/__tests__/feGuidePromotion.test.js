import { describe, it, expect } from 'vitest';
import {
    promotionUpdates, demotionUpdates, guideConflicts, acceptGuideUpdates,
    PROMOTION_MAP, PROMOTION_SOURCE,
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

describe('promotionUpdates', () => {
    it('fills an empty group and records the link', () => {
        const { updates, promoted } = promotionUpdates({ overrides: {} }, feRow);
        expect(updates.label_range_published).toBe(307);
        expect(updates.label_combined_mpge).toBe(99);
        expect(updates.label_calc_approach).toBe('Electric Vehicle 5-cycle label');
        expect(updates.fe_guide_row_id).toBe(42);
        expect(promoted).toContain('label_range_published');
    });

    it('overwrites a cert-derived value, because the guide is the published one', () => {
        // A CSI figure is manufacturer-delivered and not necessarily what
        // reached the window sticker.
        const group = {
            label_range_published: 306,
            overrides: { label_range_published: { source: 'pdf' } },
        };
        const { updates, promoted, skipped } = promotionUpdates(group, feRow);
        expect(updates.label_range_published).toBe(307);
        expect(promoted).toContain('label_range_published');
        expect(skipped).toEqual([]);
    });

    it('leaves a curator-set value alone', () => {
        // An import silently undoing a deliberate override would make the
        // override worthless.
        const group = {
            label_range_published: 300,
            overrides: { label_range_published: { source: 'manual' } },
        };
        const { updates, promoted, skipped } = promotionUpdates(group, feRow);
        expect(updates.label_range_published).toBeUndefined();
        expect(skipped).toContain('label_range_published');
        expect(promoted).not.toContain('label_range_published');
        // and the rest still promote
        expect(updates.label_city_range_mi).toBe(338);
    });

    it('remembers what it displaced, so unlink can undo it', () => {
        const group = { label_range_published: 306, overrides: {} };
        const { updates } = promotionUpdates(group, feRow);
        expect(updates.overrides.label_range_published)
            .toEqual({ source: PROMOTION_SOURCE, previous: 306 });
    });

    it('records a null previous when the field was empty', () => {
        // Distinguishable from "never promoted" because the entry exists at all,
        // which is what lets unlink restore it to empty rather than leave 307.
        const { updates } = promotionUpdates({ overrides: {} }, feRow);
        expect(updates.overrides.label_range_published)
            .toEqual({ source: PROMOTION_SOURCE, previous: null });
    });

    it('says nothing about fields the guide row does not carry', () => {
        const sparse = { id: 7, label_comb_range_mi: 250 };
        const { updates, promoted } = promotionUpdates({ overrides: {} }, sparse);
        expect(promoted).toEqual(['label_range_published']);
        expect(updates.label_city_range_mi).toBeUndefined();
        expect('unadj_city_mpge' in updates).toBe(false);
    });

    it('writes nothing at all when there is nothing to promote', () => {
        const { updates, promoted } = promotionUpdates({ overrides: {} }, { id: 9 });
        expect(promoted).toEqual([]);
        expect(updates).toEqual({});
        // No link recorded either — an empty promotion is not a link.
        expect(updates.fe_guide_row_id).toBeUndefined();
    });

    it('never targets useable_kwh', () => {
        // Gross pack energy from the guide is a different quantity from what the
        // pack delivers after its buffer, which stays with the curator.
        expect(Object.values(PROMOTION_MAP)).not.toContain('useable_kwh');
        expect(Object.values(PROMOTION_MAP)).toContain('nominal_pack_kwh');
    });
});

describe('demotionUpdates', () => {
    it('restores what promotion displaced', () => {
        const group = { label_range_published: 306, overrides: {} };
        const promoted = promotionUpdates(group, feRow).updates;
        const after = { ...group, ...promoted };

        const { updates, restored } = demotionUpdates(after);
        expect(updates.label_range_published).toBe(306);
        expect(restored).toContain('label_range_published');
        expect(updates.fe_guide_row_id).toBeNull();
        expect(updates.overrides.label_range_published).toBeUndefined();
    });

    it('restores an empty field to empty, not to the promoted value', () => {
        const after = { ...promotionUpdates({ overrides: {} }, feRow).updates };
        const { updates } = demotionUpdates(after);
        expect(updates.label_range_published).toBeNull();
        expect(updates.label_city_range_mi).toBeNull();
    });

    it('leaves alone a field the curator edited after promotion', () => {
        // Unlinking a source should not discard work done after it.
        const after = {
            label_range_published: 311,
            overrides: {
                label_range_published: { source: 'manual' },
                label_city_range_mi:   { source: PROMOTION_SOURCE, previous: null },
            },
        };
        const { updates, restored } = demotionUpdates(after);
        expect('label_range_published' in updates).toBe(false);
        expect(restored).toEqual(['label_city_range_mi']);
        expect(updates.overrides.label_range_published).toEqual({ source: 'manual' });
    });

    it('is a no-op on a group that was never linked', () => {
        const { updates, restored } = demotionUpdates({ overrides: { total_voltage: { source: 'pdf' } } });
        expect(restored).toEqual([]);
        expect(updates.fe_guide_row_id).toBeNull();
        // The pdf entry survives untouched.
        expect(updates.overrides.total_voltage).toEqual({ source: 'pdf' });
    });

    it('round-trips: promote then demote returns the original values', () => {
        const original = {
            label_range_published: 306,
            label_combined_mpge: 97,
            total_voltage: 350,
            overrides: { label_range_published: { source: 'pdf' } },
        };
        const linked = { ...original, ...promotionUpdates(original, feRow).updates };
        const back   = { ...linked,   ...demotionUpdates(linked).updates };

        expect(back.label_range_published).toBe(306);
        expect(back.label_combined_mpge).toBe(97);
        expect(back.total_voltage).toBe(350);
        expect(back.fe_guide_row_id).toBeNull();
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
        // Promotion reports these once and then forgets; the disagreement does
        // not go away, and the curator may want the published figure after all.
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
        const promoted = {
            label_range_published: 999,
            overrides: { label_range_published: { source: 'fe_guide', previous: null } },
        };
        expect(guideConflicts(promoted, feRow)).toEqual([]);
    });
});

describe('acceptGuideUpdates', () => {
    const held = {
        label_range_published: 306,
        overrides: { label_range_published: { source: 'manual' } },
    };

    it('takes the guide value for the named field only', () => {
        const { updates, accepted } = acceptGuideUpdates(held, feRow, ['label_range_published']);
        expect(updates.label_range_published).toBe(307);
        expect(accepted).toEqual(['label_range_published']);
        expect(updates.label_city_range_mi).toBeUndefined();
    });

    it('records the displaced value, so unlink still restores it', () => {
        const { updates } = acceptGuideUpdates(held, feRow, ['label_range_published']);
        expect(updates.overrides.label_range_published)
            .toEqual({ source: PROMOTION_SOURCE, previous: 306 });

        const back = demotionUpdates({ ...held, ...updates });
        expect(back.updates.label_range_published).toBe(306);
    });

    it('does nothing when asked for nothing', () => {
        expect(acceptGuideUpdates(held, feRow, []).accepted).toEqual([]);
        expect(acceptGuideUpdates(held, feRow, ['not_a_column']).accepted).toEqual([]);
    });
});
