/**
 * A vehicle's linked EPA configurations, and which one stands for it (#322).
 *
 * A vehicle row often spans wheel and trim variants, so it can link to several
 * EPA test groups whose labels differ by a third. The primary configuration is
 * the one whose label range, EPA tested capacity and test weight are the
 * vehicle's (`epa_vehicle_mappings.is_primary`, migration 067).
 *
 * Pure module: no data access, no React.
 */

import { preferredMctTest } from './epaRecordFromGroup';

// Absent stays absent: Number(null) is 0, and a 0 kWh pack is a figure the data
// never gave.
const positive = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * One configuration reduced to the figures that are compared and chosen between.
 *
 * EPA tested comes from the same test the derivations use — the preferred
 * multi-cycle test, else the most recent — so a figure here never describes a
 * different run from the one the curator card shows. Test weight comes from the
 * primary coefficient set, as the card's does.
 */
export function epaConfigurationFigures(group) {
    const test = preferredMctTest(group.epa_tests ?? [], group.preferred_test_number);
    const sets = group.epa_coefficient_sets ?? [];
    const coeff = sets.find(c => c.is_primary) ?? sets[0] ?? null;
    return {
        id: group.test_group_id,
        name: group.display_name
            || [group.model_year, group.make, group.epa_carline_name].filter(Boolean).join(' ')
            || group.test_group_id,
        labelRangeMi:  positive(group.label_range_published),
        testedKwh:     positive(test?.total_dc_energy_kwh),
        testWeightLbs: positive(coeff?.equiv_test_weight_lbs),
    };
}

/**
 * The mapping that stands for the vehicle, and why.
 *
 *   chosen   the link a curator (or the migration) marked primary
 *   only     the vehicle's sole link, unmarked — what an un-migrated database
 *            returns; migration 067 marks every sole link, so after it this is
 *            only ever a stale read
 *
 * Null when there are several links and none is primary. Nothing is picked
 * silently: a vehicle in that state shows the span of its configurations.
 *
 * Mappings without a group are ignored, as everywhere else they are read — a
 * link to a deleted or unreadable group has nothing to stand for.
 *
 * @param {Array} mappings  vehicle.epa_mappings ({ id, isPrimary, epaGroup })
 * @returns {{ mapping, basis: 'chosen'|'only' } | null}
 */
export function primaryEpaMapping(mappings = []) {
    const usable = mappings.filter(m => m?.epaGroup);
    const chosen = usable.find(m => m.isPrimary);
    if (chosen) return { mapping: chosen, basis: 'chosen' };
    if (usable.length === 1) return { mapping: usable[0], basis: 'only' };
    return null;
}
