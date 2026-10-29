/**
 * Chart.js plugin that draws Trip Optimizer's map: one filled cell per plan on
 * the speed × stop-plan grid, and an outline around the plans within a few
 * minutes of the best.
 *
 * A plugin, not a matrix chart type, so the map keeps everything the other
 * charts have: linear axes, box-zoom, the readout, the PNG. Cells are drawn
 * under the datasets, which carry the lines the readout reads.
 *
 * One hue — the vehicle's own color — with opacity for the time: full at the
 * best plan, fading toward the slowest. Opacity rather than a color ramp
 * because the vehicle owns its color (#308), and because an alpha over the
 * plot's background reads the same way in both themes. The fade is squared, so
 * the eye separates the plans near the best, where the decision is, rather than
 * spending its contrast on how bad the worst ones are.
 *
 * @param {object} o
 * @param {Array<{x:number, y:number, total:number|null}>} o.cells  centres, in axis units
 * @param {number} o.halfX, o.halfY   half a cell, in axis units
 * @param {number} o.best, o.worst    the fastest and slowest totals, minutes
 * @param {boolean[][]} o.mask        within-tolerance, [speedIndex][stopIndex]
 * @param {number[]} o.xs, o.ys       cell centres by index
 * @param {string} o.color            the vehicle's color
 * @param {string} o.outline          the outline's ink, chosen against the vehicle's color
 * @param {string} o.halo             drawn under the outline, so it reads on any cell
 * @param {(si:number) => boolean} [o.allowed]  speeds the best plan may use; the
 *   rest are drawn dimmer, so the region the advice comes from is visible
 * @param {string} [o.font]           canvas font for the tags
 *
 * A dataset carrying `_tag` gets that text written beside its first point, in
 * the outline's ink: the figure the mark stands for, on the plot rather than in
 * the legend, where it was a long way from the mark it described.
 */
export function tripMapCells({ cells, halfX, halfY, best, worst, mask, xs, ys, color, outline, halo, allowed = () => true, font }) {
    const span = Math.max(1, worst - best);
    const alphaOf = total => 0.08 + 0.87 * (1 - (total - best) / span) ** 2;
    return {
        id: 'tripMapCells',
        beforeDatasetsDraw(chart) {
            const { ctx, chartArea, scales: { x, y } } = chart;
            const px = v => x.getPixelForValue(v);
            const py = v => y.getPixelForValue(v);
            ctx.save();
            ctx.beginPath();
            ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
            ctx.clip();

            ctx.fillStyle = color;
            for (const c of cells) {
                if (c.total == null) continue;
                const left = px(c.x - halfX), right = px(c.x + halfX);
                const top = py(c.y + halfY), bottom = py(c.y - halfY);
                ctx.globalAlpha = alphaOf(c.total) * (allowed(c.si) ? 1 : 0.35);
                // Half a pixel over, so neighbours meet without a hairline gap.
                ctx.fillRect(left, top, right - left + 0.5, bottom - top + 0.5);
            }

            // The within-tolerance region's edge: every side of a near cell
            // whose neighbour across it is not near.
            ctx.globalAlpha = 1;
            ctx.beginPath();
            const near = (si, ti) => mask[si]?.[ti] === true;
            mask.forEach((row, si) => row.forEach((isNear, ti) => {
                if (!isNear) return;
                const l = px(xs[si] - halfX), r = px(xs[si] + halfX);
                const t = py(ys[ti] + halfY), b = py(ys[ti] - halfY);
                if (!near(si - 1, ti)) { ctx.moveTo(l, t); ctx.lineTo(l, b); }
                if (!near(si + 1, ti)) { ctx.moveTo(r, t); ctx.lineTo(r, b); }
                if (!near(si, ti + 1)) { ctx.moveTo(l, t); ctx.lineTo(r, t); }
                if (!near(si, ti - 1)) { ctx.moveTo(l, b); ctx.lineTo(r, b); }
            }));
            // The halo a 1 px edge each side: wider, and it is what the eye reads.
            if (halo) { ctx.strokeStyle = halo; ctx.lineWidth = 4; ctx.stroke(); }
            ctx.strokeStyle = outline;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        },
        afterDatasetsDraw(chart) {
            const { ctx, chartArea: area } = chart;
            const placed = [];
            ctx.save();
            if (font) ctx.font = font;
            ctx.textBaseline = 'middle';
            ctx.lineJoin = 'round';
            chart.data.datasets.forEach((ds, i) => {
                if (!ds._tag || ds._halo) return;
                const pt = chart.getDatasetMeta(i).data[0];
                if (!pt || pt.skip) return;
                const gap = (ds.pointRadius ?? 4) + 2;
                const w = ctx.measureText(ds._tag).width;
                const h = 14;
                // North-east of the mark, clear of the lines that run through
                // it; north-west where that would leave the plot, and below
                // where above would.
                let left = pt.x + gap;
                if (left + w > area.right - 2) left = pt.x - gap - w;
                let y = pt.y - gap - h / 2;
                if (y - h / 2 < area.top) y = pt.y + gap + h / 2;
                y = Math.min(y, area.bottom - h / 2);
                // Two marks close together: step the later tag up clear of the earlier.
                for (const r of placed) {
                    if (left < r.right && left + w > r.left && Math.abs(y - r.y) < h) y = r.y - h;
                }
                placed.push({ left, right: left + w, y });
                if (halo) { ctx.strokeStyle = halo; ctx.lineWidth = 3; ctx.strokeText(ds._tag, left, y); }
                ctx.fillStyle = outline;
                ctx.fillText(ds._tag, left, y);
            });
            ctx.restore();
        },
    };
}
