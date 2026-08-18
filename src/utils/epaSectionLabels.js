/**
 * Naming the per-configuration sections of the EPA methodology card (#222).
 *
 * Pure string composition, kept out of the view so the rules can be stated and
 * tested rather than read out of JSX.
 */

/**
 * What to call one methodology section.
 *
 * The obvious answer — vehicle name plus the group's display_name — produced
 * "2026 Model Y Performance · Performance EPA Range Assessment" twice in a row,
 * separated only by a subtitle reading "Model Y Performance" against "Model Y
 * Performance-B". Three problems at once, and they need different fixes.
 *
 * "EPA Range Assessment" is gone: the card is headed "EPA range methodology", so
 * it was repeated on every section and carried no information.
 *
 * `display_name` LEADS when it earns it and is dropped when it does not. It is
 * curator free text and its quality is all over the real data — `20" AT` and
 * `21" AS` describe the configuration exactly, `Model Y Performance` merely
 * repeats the vehicle, and `2026 (Update)` is not a configuration descriptor at
 * all. So it is appended only when the vehicle has more than one configuration
 * AND the name is not already contained in the vehicle's.
 *
 * `test_group_id` is the identifier that cannot degrade — unique, present on
 * every group, occasionally self-describing (`R2-159XR20AT`). It goes in the
 * subtitle unconditionally, which is what actually lets two Model Y Performance
 * sections be told apart. The run selector above already pairs the year and the
 * test group this way; this matches it rather than inventing a second scheme.
 */
export function methodologyTitle({ vehicleName, epaLabel, configCount }) {
    if (!epaLabel || configCount <= 1) return vehicleName;

    const redundant = vehicleName
        && vehicleName.toLowerCase().includes(epaLabel.toLowerCase());
    return redundant ? vehicleName : `${vehicleName} — ${epaLabel}`;
}

/** The line beneath it: year and the one identifier guaranteed to be unique. */
export function methodologySubtitle({ modelYear, testGroupId }) {
    return [modelYear, testGroupId].filter(Boolean).join(' · ') || null;
}

