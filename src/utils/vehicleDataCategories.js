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

/**
 * Category definitions, in display order.
 *
 * `count` reads a vehicle's total for that category. `colorClass` is the pill
 * styling; keeping it here means the filter chip and the card pill can share it.
 */
export const DATA_CATEGORIES = [
    {
        key: 'charging',
        label: 'Charging',
        colorClass: 'text-green-600 dark:text-green-400',
        // Tests only: a stored composite curve (#313) is a charging run but
        // not a test anyone ran.
        count: (v) => filterTests(v.runs).filter(isChargingRun).length,
    },
    {
        key: 'range',
        label: 'Range',
        colorClass: 'text-amber-600 dark:text-amber-400',
        count: (v) => (v.runs || []).filter(isRangeRun).length,
    },
    {
        key: 'epa',
        label: 'EPA',
        colorClass: 'text-blue-600 dark:text-blue-400',
        count: (v) => v.epa_mappings?.length ?? 0,
    },
    {
        key: 'accel',
        label: 'Acceleration',
        // Where a line has no room for the word (the list's Tests column).
        short: 'Accel',
        colorClass: 'text-purple-600 dark:text-purple-400',
        count: (v, perf) => perf?.[v.id]?.accel ?? 0,
    },
    {
        key: 'braking',
        label: 'Braking',
        colorClass: 'text-rose-600 dark:text-rose-400',
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

/** True when the vehicle has any data of that category. */
export const hasDataCategory = (vehicle, key, performanceCounts = {}) => {
    const cat = DATA_CATEGORIES.find(c => c.key === key);
    return cat ? cat.count(vehicle, performanceCounts) > 0 : false;
};

