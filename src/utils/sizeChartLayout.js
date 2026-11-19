/**
 * Where the Size chart puts things, in px: one scale for every vehicle, each
 * one's place along it, the ground line and the rows of dimension lines below.
 *
 * World x is inches along the chosen anchor (side view) or from the centerline
 * (front view); the canvas maps it with `originX + x * scale`, and a height y
 * with `groundY - y * scale`.
 *
 * Pure module.
 */

import { anchorX } from './vehicleProfile';

export const SIZE_MARGIN = { left: 12, right: 104, top: 18 };
/** The tallest the drawing gets, so a narrow selection doesn't fill the screen. */
export const SIZE_MAX_DRAW_PX = { side: 300, front: 320 };
export const SIZE_ROW_PX = 26;
const BARS_GAP_PX = 16;

/** How far a vehicle reaches either side of its centerline, seen from the front. */
export const frontHalfWidth = (p) => Math.max(
    (p.widthMirrors ?? p.width) / 2,
    p.trackFront ? (p.trackFront + p.tireWidth) / 2 : 0,
);

/**
 * @param {Array<{ id, profile }>} items  vehicles drawable in this view, in selection order
 * @param {object} opts
 * @param {'side'|'front'} opts.view
 * @param {string} opts.anchor      a SIZE_ANCHORS key (side view)
 * @param {number} opts.widthPx     the drawing's width
 * @param {boolean} opts.lines      draw the dimension lines below the ground
 * @returns {null | { scale, originX, groundY, heightPx, barsTop, places: Map<id, number> }}
 *          `places` is each vehicle's front bumper (side) or centerline (front), in world x
 */
export function sizeChartLayout(items, { view, anchor, widthPx, lines }) {
    if (!items.length || widthPx <= 0) return null;
    const places = new Map();
    let minX = Infinity;
    let maxX = -Infinity;
    let maxH = 0;
    for (const { id, profile: p } of items) {
        if (view === 'front') {
            const half = frontHalfWidth(p);
            places.set(id, 0);
            minX = Math.min(minX, -half);
            maxX = Math.max(maxX, half);
        } else {
            const start = -anchorX(p, anchor);
            places.set(id, start);
            minX = Math.min(minX, start);
            maxX = Math.max(maxX, start + p.length);
        }
        maxH = Math.max(maxH, p.height);
    }

    const avail = Math.max(widthPx - SIZE_MARGIN.left - SIZE_MARGIN.right, 40);
    const scale = Math.min(avail / (maxX - minX), SIZE_MAX_DRAW_PX[view] / maxH);
    const drawW = (maxX - minX) * scale;
    const originX = SIZE_MARGIN.left + (avail - drawW) / 2 - minX * scale;
    const groundY = SIZE_MARGIN.top + maxH * scale;
    const barsTop = groundY + BARS_GAP_PX;
    const heightPx = lines ? barsTop + items.length * SIZE_ROW_PX + 4 : groundY + 8;
    return { scale, originX, groundY, heightPx, barsTop, places, minX, maxX };
}

/** Inches between grid lines: a foot, or half a meter. */
export const gridStepIn = (units) => (units === 'metric' ? 500 / 25.4 : 12);
