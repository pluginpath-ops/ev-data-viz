/**
 * What a Fuel Economy Guide row says about an EPA test vehicle, laid over its
 * stored values at read time (#206, reworked for #374).
 *
 * Until #374 a link COPIED the Guide's figures onto the test vehicle row
 * ("promotion") and unlinking copied them back. That cannot survive a test
 * vehicle certified in several years: the Guide is published by year, each
 * certification links its own row, and one row of columns cannot hold three
 * years' figures. So the Guide row is now read alongside the record and laid
 * over it — `guideOverlay` — and nothing is copied. Migration 083 restored the
 * values promotion had displaced.
 *
 * Readers did not have to learn a new source: `epaDerivations`, the
 * methodology diagram, the curator form and the vehicle figures all keep
 * reading the same fields, from a view of the test vehicle that already
 * carries its Guide figures (epaCertifications.testVehicleView).
 *
 * ── The two rules, unchanged ─────────────────────────────────────────────────
 *
 * THE GUIDE BEATS THE CERT RECORD. It is the published figure by definition;
 * a CSI value is manufacturer-delivered and not necessarily what reached the
 * window sticker.
 *
 * THE CURATOR BEATS THE GUIDE. A field a human has deliberately set (source
 * 'manual') is left alone, and its disagreement with the Guide is reported
 * (`guideConflicts`) rather than silently resolved either way.
 *
 * Pure module: takes rows, returns values. No data access.
 */

/**
 * Guide column → test vehicle column.
 *
 * Deliberately explicit rather than derived from a naming convention: five of
 * these differ on both sides, and a convention that silently skips a mismatched
 * pair is how a field stops being read without anyone noticing.
 */
export const GUIDE_FIELD_MAP = {
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

/** The source tag a Guide value carries in a view's `overrides`. */
export const GUIDE_SOURCE = 'fe_guide';

/**
 * A field a human set by hand is not the Guide's to replace.
 *
 * Exported because the same question is asked outside the overlay: unlinking
 * clears the guide-derived test selection, and must leave a hand-set one alone.
 * A second spelling of this rule is how one of them ends up wrong — the first
 * version of that guard checked for source 'curator', which nothing writes, so
 * it never fired.
 */
export const isCuratorOwned = (overrides, column) => overrides?.[column]?.source === 'manual';

/**
 * The test vehicle's fields as the Guide row fills them.
 *
 * `values` holds every mapped field the Guide states and the curator has not
 * set by hand. `overrides` is the test vehicle's own, with those fields tagged
 * 'fe_guide' so the curator form and the audit can say where a figure came
 * from — as promotion's tags did.
 *
 * @param {Object} testVehicle  stored epa_test_vehicles row (values + overrides)
 * @param {Object} guideRow     epa_fe_guide row, or null
 * @returns {{ values: Object, overrides: Object, applied: string[], held: string[] }}
 */
export function guideOverlay(testVehicle, guideRow) {
    const overrides = { ...(testVehicle?.overrides ?? {}) };
    const values = {};
    const applied = [];
    const held = [];
    if (!testVehicle || !guideRow) return { values, overrides, applied, held };

    for (const [from, to] of Object.entries(GUIDE_FIELD_MAP)) {
        const value = guideRow[from];
        if (value == null) continue;
        if (isCuratorOwned(testVehicle.overrides, to)) { held.push(to); continue; }
        values[to] = value;
        overrides[to] = { source: GUIDE_SOURCE };
        applied.push(to);
    }
    return { values, overrides, applied, held };
}

/**
 * What a stored record should write to forget an old promotion: every field
 * still tagged as copied from the Guide, restored to the value it displaced.
 *
 * Kept for the records promoted before #374. Migration 083 restores them all
 * at once; this does the same for one record when its last Guide link is
 * removed, so the result is right whether or not 083 has been applied yet.
 * After 083 no stored record carries the tag and this writes nothing new.
 *
 * Only fields still tagged are touched. One the curator has since edited by
 * hand carries 'manual' and is left exactly as it is.
 */
export function demotionUpdates(testVehicle) {
    if (!testVehicle) return { updates: {}, restored: [] };

    const overrides = { ...(testVehicle.overrides ?? {}) };
    const updates = {};
    const restored = [];

    for (const column of Object.values(GUIDE_FIELD_MAP)) {
        const entry = overrides[column];
        if (entry?.source !== GUIDE_SOURCE) continue;
        // `previous` is null for a field that was empty before promotion, which
        // restores correctly — the entry's existence is what marks it promoted.
        updates[column] = entry.previous ?? null;
        delete overrides[column];
        restored.push(column);
    }

    updates.overrides = overrides;
    return { updates, restored };
}

/**
 * Fields the guide would fill differently from what is stored, and was not
 * allowed to.
 *
 * The overlay holds a curator's value over the Guide's without a word — but
 * the disagreement persists, and the curator may well want the published
 * figure after all. A value protected from the Guide is not the same as a
 * value the curator has re-examined since.
 *
 * Only curator-owned fields appear: anything else already reads the Guide.
 *
 * @returns {Array<{ column, guideColumn, ours, theirs }>}
 */
export function guideConflicts(testVehicle, feRow) {
    if (!testVehicle || !feRow) return [];
    const out = [];

    for (const [from, to] of Object.entries(GUIDE_FIELD_MAP)) {
        const theirs = feRow[from];
        if (theirs == null) continue;
        if (!isCuratorOwned(testVehicle.overrides, to)) continue;

        const ours = testVehicle[to] ?? null;
        // Numbers compared loosely: 307 and "307.00" out of a numeric column
        // are the same figure, and flagging that as a disagreement would train
        // the curator to ignore the flag.
        const same = ours != null && Number.isFinite(Number(ours)) && Number.isFinite(Number(theirs))
            ? Math.abs(Number(ours) - Number(theirs)) < 1e-6
            : String(ours ?? '') === String(theirs ?? '');
        if (same) continue;

        out.push({ column: to, guideColumn: from, ours, theirs });
    }
    return out;
}

/**
 * Take the guide's value for fields the curator had been holding: drop the
 * 'manual' tag, so the overlay reads the Guide for them again. The stored
 * value stays where it is (and in the audit trail) — it is simply no longer
 * held over the Guide.
 *
 * @returns {{ overrides: Object, accepted: string[] }}
 */
export function acceptGuideTags(testVehicle, columns = []) {
    const overrides = { ...(testVehicle?.overrides ?? {}) };
    const accepted = [];
    const mapped = new Set(Object.values(GUIDE_FIELD_MAP));
    for (const to of new Set(columns)) {
        if (!mapped.has(to) || !isCuratorOwned(overrides, to)) continue;
        delete overrides[to];
        accepted.push(to);
    }
    return { overrides, accepted };
}
