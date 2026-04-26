// ── Run filtering helpers ─────────────────────────────────────────────────────

export const filterChargingRuns = (runs) => (runs || []).filter(r => r.has_charging !== false);
export const filterRangeRuns    = (runs) => (runs || []).filter(r => r.has_range);

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
