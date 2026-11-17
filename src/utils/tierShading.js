/**
 * On a time-of-use plan, the stretches a week's charger ran, tinted by tier
 * behind a battery line: green the base (the cheapest the plan uses), gray
 * the middle, red the dearest — the dearer two the stripes the day bars give
 * those parts (owner, 2026-11-17).
 * Drawn by the Weekly Charging Plan's line and the battery's level under its
 * bars.
 */
const WEEK_HOURS = 7 * 24;
const TINT_ALPHA = 0.22;

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} xScale             a Chart.js scale in hours of the week
 * @param {number} top, bottom        the band's pixel rows
 * @param {{spans, base}|null} tiers  chargingTiers(week)
 * @param {{danger, tick, success}} theme  chartTheme()
 */
export function drawTierShading(ctx, xScale, top, bottom, tiers, theme) {
    if (!tiers) return;
    const ink = [theme.danger, theme.tick, theme.success];
    ctx.save();
    ctx.globalAlpha = TINT_ALPHA;
    for (const { from, to, tier } of tiers.spans) {
        ctx.fillStyle = tier === tiers.base ? theme.success : ink[tier];
        // A Sunday night runs past the week's end: it wraps to Monday.
        for (const off of [0, -WEEK_HOURS]) {
            const a0 = Math.max(0, from + off), a1 = Math.min(WEEK_HOURS, to + off);
            if (a1 <= a0) continue;
            const x0 = xScale.getPixelForValue(a0);
            ctx.fillRect(x0, top, xScale.getPixelForValue(a1) - x0, bottom - top);
        }
    }
    ctx.restore();
}
