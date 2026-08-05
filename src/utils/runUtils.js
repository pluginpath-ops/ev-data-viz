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
