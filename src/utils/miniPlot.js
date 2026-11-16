/**
 * One small plot's points and extents, from a test's data points.
 *
 * Keeps the points' own order (the order they were entered or imported), so a
 * point out of sequence draws as a visible kink in the line rather than being
 * sorted out of sight. Extents are rounded outward to whole numbers for the
 * tick labels. Null when fewer than two points carry both fields.
 *
 * @param {Array<Object>} points  shaped data points (soc, chargeRate, time, …)
 * @param {string} xKey
 * @param {string} yKey
 * @returns {{pts: {x:number,y:number}[], x0:number, x1:number, y0:number, y1:number} | null}
 */
export function miniPlotSeries(points, xKey, yKey) {
    const pts = (points || [])
        .filter(p => Number.isFinite(p?.[xKey]) && Number.isFinite(p?.[yKey]))
        .map(p => ({ x: p[xKey], y: p[yKey] }));
    if (pts.length < 2) return null;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return {
        pts,
        x0: Math.floor(Math.min(...xs)), x1: Math.ceil(Math.max(...xs)),
        y0: Math.floor(Math.min(...ys)), y1: Math.ceil(Math.max(...ys)),
    };
}
