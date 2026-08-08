// ── Run filtering helpers ─────────────────────────────────────────────────────
//
// Two forms are provided for each data type:
//   filterXxxRuns(runs)  — takes a run array, returns a filtered array.
//                          Use when building derived arrays: filterChargingRuns(v.runs).map(...)
//   isXxxRun(run)        — predicate, takes a single run, returns boolean.
//                          Use as a runFilter prop: <RunSelector runFilter={isChargingRun} />

// `kind` (migration 044) is the discriminator; the has_charging / has_range
// booleans it replaced are still written by the app and kept in sync by a DB
// trigger until #155 drops them. Reading kind-first with a boolean fallback
// means this works whether or not migration 044 has been applied yet, so code
// and migration can be deployed in either order.
//
// Note the fallback keeps the old asymmetry deliberately: a run with neither
// flag set counts as charging (has_charging !== false), matching how these
// predicates have always behaved. Migration 044 backfills those rows the same
// way, so the two paths agree.
export const isChargingRun = (r) => r.kind ? r.kind === 'charging' : r.has_charging !== false;

// `kind` alone CANNOT decide this one until #155 runs.
//
// A dual-role row — one drive recorded as a single run, with both flags set —
// is genuinely both a charging test and a range test, and a single discriminator
// cannot say so. The backfill assigns it kind='charging' (it is split into two
// rows in #155), so testing kind alone would drop every such row out of the
// range views. On the current database that is 35 of 76 runs.
//
// So has_range stays part of this predicate through the transition. After #155
// the column is gone, `r.has_range` is undefined, and this collapses to the
// kind check on its own with no further edit.
export const isRangeRun = (r) => r.kind === 'range' || !!r.has_range;

export const filterChargingRuns = (runs) => (runs || []).filter(isChargingRun);
export const filterRangeRuns    = (runs) => (runs || []).filter(isRangeRun);

/**
 * The charging test to use for a vehicle when the user hasn't picked one:
 * the explicitly-defaulted run, else the most recent.
 *
 * The mirror of defaultRangeRun() in utils/rangeSource.js. Charging curves vary
 * far less than range tests — they're a property of the car, where a range test
 * is a property of the day — so this default is usually the right answer and
 * rarely worth overriding.
 */
export function defaultChargingRun(vehicle) {
    const charging = filterChargingRuns(vehicle?.runs);
    if (!charging.length) return null;
    return charging.find(r => r.isDefault || r.is_default)
        ?? [...charging].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        ?? null;
}

/**
 * The charging test for a given range test, absent an explicit chart-session
 * pairing. Two ranks:
 *
 *   1. the curator's stored pairing (runs.paired_charging_run_id, migration 045)
 *   2. the vehicle's default charging run
 *
 * The chart session's own pairing outranks both, but it lives only in the URL —
 * this is what a visitor arriving without one sees, and the reason a non-default
 * pairing can be published at all.
 *
 * Falls through to the default when the stored id points at a run that is gone
 * or no longer charging, rather than silently rendering nothing.
 */
export function pairedChargingRun(rangeRun, vehicle) {
    const storedId = rangeRun?.paired_charging_run_id;
    if (storedId != null) {
        const stored = filterChargingRuns(vehicle?.runs)
            .find(r => String(r.id) === String(storedId));
        if (stored) return stored;
    }
    return defaultChargingRun(vehicle);
}

// ── Populated-field detection ─────────────────────────────────────────────────

/**
 * Return the list of field keys that have at least one non-null value across
 * the given array of (camelCase) data-point objects.
 */
export function detectPopulatedFields(points) {
    const fields = [];
    if (points.some(p => p.soc         != null)) fields.push('soc');
    if (points.some(p => p.chargeRate  != null)) fields.push('chargeRate');
    if (points.some(p => p.time        != null)) fields.push('time');
    if (points.some(p => p.range       != null)) fields.push('range');
    if (points.some(p => p.temperature != null)) fields.push('temperature');
    return fields;
}

// ── Inherited run ID helpers ──────────────────────────────────────────────────
// Inherited run IDs follow the pattern: inherited_<linkId>_<realRunId>
// Centralising the format here means a single change propagates everywhere.

const INHERITED_PREFIX = 'inherited_';

export const isInheritedRunId    = (id) => typeof id === 'string' && id.startsWith(INHERITED_PREFIX);
export const buildInheritedRunId = (linkId, realRunId) => `${INHERITED_PREFIX}${linkId}_${realRunId}`;
export const parseInheritedRunId = (id) => {
    const [, linkId, realRunId] = id.split('_');
    return { linkId: parseInt(linkId, 10), realRunId: parseInt(realRunId, 10) };
};
