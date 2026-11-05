/**
 * Which kinds of data a vehicle has, and how much of each.
 *
 * Single source of truth for the Vehicles page: the "Tests:" pills on each card
 * and the data-type filter both read from here, so adding a category later is
 * one edit rather than three that can drift apart.
 *
 * Performance counts are passed in rather than read off the vehicle, because
 * they aren't on the vehicle record — getVehicles deliberately doesn't embed the
 * performance tables (a nested select against a table that doesn't exist yet
 * fails the whole query and blanks the app), so AppContext loads them separately.
 *
 * Charging and range counts go through the shared runUtils predicates rather
 * than reading the role flags directly, so the card pills, the data filter and
 * the chart run selectors can never disagree about what counts as a charging
 * run — and all of them pick up `kind` (migration 044) together.
 */
import { isChargingRun, isRangeRun, filterTests } from './runUtils';
import { isListed } from './runListing';

/**
 * Category definitions, in display order.
 *
 * `count` reads a vehicle's total for that category. `glyph` leads the card's
 * count badge where a flat symbol exists; the others use `short` or `label`.
 * `subtab` is the Tests & Data sub-tab the tests live on (RunsView SUBTABS), so a
 * count can link straight to them — charging and range share one.
 */
export const DATA_CATEGORIES = [
    {
        key: 'charging',
        subtab: 'tests',
        label: 'Charging',
        glyph: '↯',   // the same mark as the run-kind badge
        // Tests only: a stored composite curve (#313) is a charging run but
        // not a test anyone ran. Listed tests only (#394) — a contributor's
        // runs include the unlisted ones, a viewer's do not, and the count
        // must read the same for both. The pool is counted apart.
        count: (v) => filterTests(v.runs).filter(r => isChargingRun(r) && isListed(r)).length,
        pooled: (v) => filterTests(v.pooledRuns).filter(isChargingRun).length,
    },
    {
        key: 'range',
        subtab: 'tests',
        label: 'Range',
        glyph: '↔',
        count: (v) => (v.runs || []).filter(r => isRangeRun(r) && isListed(r)).length,
        pooled: (v) => (v.pooledRuns || []).filter(isRangeRun).length,
    },
    {
        key: 'epa',
        subtab: 'epa',
        label: 'EPA',
        count: (v) => v.epa_mappings?.length ?? 0,
    },
    {
        key: 'accel',
        subtab: 'performance',
        label: 'Acceleration',
        // Where a line has no room for the word (the list's Tests column).
        short: 'Accel',
        count: (v, perf) => perf?.[v.id]?.accel ?? 0,
    },
    {
        key: 'braking',
        subtab: 'performance',
        label: 'Braking',
        count: (v, perf) => perf?.[v.id]?.braking ?? 0,
    },
];

/**
 * Counts per category for one vehicle.
 * @returns {Record<string, number>} e.g. { charging: 3, range: 8, epa: 2, accel: 6, braking: 0 }
 */
export function vehicleDataCategories(vehicle, performanceCounts = {}) {
    const out = {};
    for (const c of DATA_CATEGORIES) out[c.key] = c.count(vehicle, performanceCounts);
    return out;
}

/**
 * Unlisted tests per category that still count in the statistics (#394, the
 * pool) — the grey half of "Charging (4/2)". Categories with no pool are absent.
 * @returns {Record<string, number>}
 */
export function vehiclePooledCounts(vehicle) {
    const out = {};
    for (const c of DATA_CATEGORIES) if (c.pooled) out[c.key] = c.pooled(vehicle);
    return out;
}

/** True when the vehicle has any data of that category. */
export const hasDataCategory = (vehicle, key, performanceCounts = {}) => {
    const cat = DATA_CATEGORIES.find(c => c.key === key);
    return cat ? cat.count(vehicle, performanceCounts) > 0 : false;
};

