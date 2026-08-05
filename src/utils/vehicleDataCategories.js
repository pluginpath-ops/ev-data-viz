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
 */

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
        count: (v) => v.runs?.filter(r => r.has_charging).length ?? 0,
    },
    {
        key: 'range',
        label: 'Range',
        colorClass: 'text-amber-600 dark:text-amber-400',
        count: (v) => v.runs?.filter(r => r.has_range).length ?? 0,
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

/**
 * Apply the data filter — AND / NOT only, unlike the tag filter's OR/AND/NOT.
 *
 * OR is dropped deliberately: the questions worth asking of data coverage are
 * conjunctive ("has both charging and range", which is what the pairing work
 * needs) or exclusionary ("has no EPA data" — what still needs looking up).
 * "Has charging or braking" isn't a question anyone asks, and offering it makes
 * the first click on a chip mean something nobody wants.
 *
 * @param {Array}  vehicles
 * @param {Object} states  { [categoryKey]: 'and'|'not' }
 * @param {Object} performanceCounts
 */
export function filterByDataCategories(vehicles, states, performanceCounts = {}) {
    const pick = (s) => Object.entries(states).filter(([, v]) => v === s).map(([k]) => k);
    const and = pick('and'), not = pick('not');
    if (!and.length && !not.length) return vehicles;

    return vehicles.filter(v => {
        const has = (k) => hasDataCategory(v, k, performanceCounts);
        if (not.some(has)) return false;
        if (and.length && !and.every(has)) return false;
        return true;
    });
}
