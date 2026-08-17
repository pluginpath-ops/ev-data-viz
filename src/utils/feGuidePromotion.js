/**
 * Copying a staged Fuel Economy Guide row onto an EPA test group, and undoing it
 * (#206, phase 3).
 *
 * Promotion is what makes the guide useful without teaching anything a new
 * source: `epaDerivations`, the methodology diagram, the curator form and the
 * mismatch badge all keep reading `epa_test_groups`, and the guide fills it.
 *
 * ── The two rules that govern it ─────────────────────────────────────────────
 *
 * THE GUIDE BEATS THE CERT RECORD. It is the published figure by definition;
 * a CSI value is manufacturer-delivered and not necessarily what reached the
 * window sticker. So a value sourced 'csv' or 'pdf' is overwritten.
 *
 * THE CURATOR BEATS THE GUIDE. A field a human has deliberately set is left
 * alone — that is the whole point of an override, and an import silently
 * undoing one would make the override worthless.
 *
 * ── Why the previous value is carried in `overrides` ─────────────────────────
 *
 * Unlinking has to restore what promotion displaced, and the only place that
 * knows is the promotion itself. Rather than a second table or a snapshot
 * column, each promoted field records its own previous value beside its source
 * marker — the shape the overrides column already has:
 *
 *     label_range_published: { source: 'fe_guide', previous: 306 }
 *
 * Unlink reads that back. A field promoted onto nothing restores to null, which
 * is correct and distinguishable from "never promoted" because the entry exists.
 *
 * Pure module: takes rows, returns the writes to make. No data access.
 */

/**
 * Guide column → test-group column.
 *
 * Deliberately explicit rather than derived from a naming convention: five of
 * these differ on both sides, and a convention that silently skips a mismatched
 * pair is how a field stops being promoted without anyone noticing.
 */
export const PROMOTION_MAP = {
    label_comb_range_mi:        'label_range_published',
    label_city_range_mi:        'label_city_range_mi',
    label_hwy_range_mi:         'label_hwy_range_mi',
    label_comb_mpge:            'label_combined_mpge',
    label_city_mpge:            'label_city_mpge',
    label_hwy_mpge:             'label_hwy_mpge',
    unadj_city_mpge:            'unadj_city_mpge',
    unadj_hwy_mpge:             'unadj_hwy_mpge',
    adj_city_mpge:              'adj_city_mpge',
    adj_hwy_mpge:               'adj_hwy_mpge',
    label_adjustment_factor:    'label_adjustment_factor',
    calc_approach:              'label_calc_approach',
    total_voltage_v:            'total_voltage',
    batt_specific_energy_wh_kg: 'battery_specific_energy',
    // GROSS pack energy. Never useable_kwh — that is what the pack delivers
    // after its buffer, a curator judgement, and a different quantity.
    nominal_pack_kwh:           'nominal_pack_kwh',
};

export const PROMOTION_SOURCE = 'fe_guide';

/** A field a human set by hand is not the import's to overwrite. */
const isCuratorOwned = (overrides, column) => overrides?.[column]?.source === 'manual';

/**
 * What linking this guide row to this group should write.
 *
 * @param {Object} group   current epa_test_groups row (values + overrides)
 * @param {Object} feRow   staged epa_fe_guide row
 * @returns {{ updates: Object, promoted: string[], skipped: string[] }}
 *          `updates` is ready to send; `promoted` and `skipped` are for telling
 *          the curator what happened, since a silent skip looks like a bug.
 */
export function promotionUpdates(group, feRow) {
    if (!group || !feRow) return { updates: {}, promoted: [], skipped: [] };

    const overrides = { ...(group.overrides ?? {}) };
    const updates = {};
    const promoted = [];
    const skipped = [];

    for (const [from, to] of Object.entries(PROMOTION_MAP)) {
        const value = feRow[from];
        if (value == null) continue;              // nothing to say about this field

        if (isCuratorOwned(group.overrides, to)) {
            skipped.push(to);
            continue;
        }

        updates[to] = value;
        // The displaced value, so unlink can put it back. Captured from the
        // group as it is NOW, before this write lands.
        overrides[to] = { source: PROMOTION_SOURCE, previous: group[to] ?? null };
        promoted.push(to);
    }

    if (promoted.length) {
        updates.overrides = overrides;
        updates.fe_guide_row_id = feRow.id;
    }
    return { updates, promoted, skipped };
}

/**
 * What unlinking should write: every field this guide row displaced, restored.
 *
 * Only fields still marked as guide-sourced are touched. One the curator has
 * since edited by hand carries source 'manual' and is left exactly as it is —
 * unlinking a source should not discard work done after it.
 */
export function demotionUpdates(group) {
    if (!group) return { updates: {}, restored: [] };

    const overrides = { ...(group.overrides ?? {}) };
    const updates = {};
    const restored = [];

    for (const column of Object.values(PROMOTION_MAP)) {
        const entry = overrides[column];
        if (entry?.source !== PROMOTION_SOURCE) continue;
        // `previous` is null for a field that was empty before promotion, which
        // restores correctly — the entry's existence is what marks it promoted.
        updates[column] = entry.previous ?? null;
        delete overrides[column];
        restored.push(column);
    }

    updates.overrides = overrides;
    updates.fe_guide_row_id = null;
    return { updates, restored };
}
