// ── Run filtering helpers ─────────────────────────────────────────────────────
//
// Two forms are provided for each data type:
//   filterXxxRuns(runs)  — takes a run array, returns a filtered array.
//                          Use when building derived arrays: filterChargingRuns(v.runs).map(...)
//   isXxxRun(run)        — predicate, takes a single run, returns boolean.
//                          Use as a runFilter prop: <RunSelector runFilter={isChargingRun} />

// `kind` is the discriminator, NOT NULL since migration 044 and authoritative
// since 046 split the last dual-role rows and dropped the has_charging /
// has_range pair it replaced.
//
// Both predicates used to carry transitional clauses — a boolean fallback here,
// and `|| !!r.has_range` there, because a dual-role row was genuinely both roles
// and one column could not say so. Those are gone with the columns they read.
export const isChargingRun = (r) => r.kind === 'charging';
export const isRangeRun    = (r) => r.kind === 'range';

/**
 * The `kind` to persist for a run being created or edited.
 *
 * Accepts `kind` directly, or the legacy hasCharging/hasRange pair that callers
 * used before migration 046 dropped those columns. A caller that still asks for
 * BOTH gets 'charging': a row has one role now, and the range half of a combined
 * upload has to be created separately — see the importer note on #155.
 */
export function runKindFrom(run) {
    if (run?.kind === 'charging' || run?.kind === 'range') return run.kind;
    const wantsRange    = run?.hasRange    ?? run?.has_range    ?? false;
    const wantsCharging = run?.hasCharging ?? run?.has_charging ?? true;
    return (wantsRange && !wantsCharging) ? 'range' : 'charging';
}

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

// ── Default runs ─────────────────────────────────────────────────────────────

/**
 * Mark `runId` as its vehicle's default, leaving the OTHER kind alone.
 *
 * A vehicle has two independent defaults since migration 046: a default charging
 * run (the fallback curve) and a default range test (rank 2 of the range-source
 * order). Marking one used to clear both, so setting a default range test
 * silently dropped the default charging run.
 *
 * Pure, and shared by the optimistic update and the offline store so the two
 * cannot drift — they already had, which is how this survived: the service
 * scoped it per kind while the copy on screen did not, and they disagreed until
 * a reload.
 */
export function applyDefaultRun(runs, runId) {
    const target = (runs || []).find(r => r.id === runId);
    if (!target) return runs || [];
    const kind = runKindFrom(target);
    return runs.map(r =>
        runKindFrom(r) !== kind ? r : { ...r, isDefault: r.id === runId });
}

/**
 * Clear the default flag on one run, or — with no runId — on every run of the
 * vehicle, which is what discarding a vehicle's data wants.
 */
export function clearDefaultRuns(runs, runId = null) {
    return (runs || []).map(r =>
        (runId == null || r.id === runId) ? { ...r, isDefault: false } : r);
}
