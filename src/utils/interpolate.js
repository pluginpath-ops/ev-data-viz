// ── Interpolation helper ──────────────────────────────────────────────────────
// Returns the interpolated yField value at targetX, given points sorted by xField.
// allowExtrapolateBefore — extends linearly backward past the first point (slope of first two).
// allowExtrapolateAfter  — extends linearly forward past the last point (slope of last two).
export function interpolate(points, xField, yField, targetX, allowExtrapolateBefore = false, allowExtrapolateAfter = false) {
    const valid = points.filter(p => p[xField] != null && p[yField] != null);
    if (valid.length === 0) return null;
    const before = [...valid].filter(p => p[xField] <= targetX).at(-1);
    const after  = valid.find(p => p[xField] > targetX);
    if (before && after) {
        if (before[xField] === targetX) return before[yField];
        const t = (targetX - before[xField]) / (after[xField] - before[xField]);
        return before[yField] + t * (after[yField] - before[yField]);
    }
    if (!before && allowExtrapolateBefore && valid.length >= 2) {
        const [p0, p1] = valid;
        const slope = (p1[yField] - p0[yField]) / (p1[xField] - p0[xField]);
        return p0[yField] + slope * (targetX - p0[xField]);
    }
    if (!after && before && allowExtrapolateAfter && valid.length >= 2) {
        const last = valid[valid.length - 1];
        const prev = valid[valid.length - 2];
        const slope = (last[yField] - prev[yField]) / (last[xField] - prev[xField]);
        return last[yField] + slope * (targetX - last[xField]);
    }
    return null;
}
