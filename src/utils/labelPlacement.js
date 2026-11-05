/**
 * Where to put a label beside each point of a scatter so they do not sit on one
 * another (#450).
 *
 * A greedy pass, not an optimiser: points are taken left to right, each tries a
 * fixed list of positions around its dot (right first, the usual reading
 * place), and takes the first that costs nothing — no overlap with a label
 * already placed, with any dot, or with the plot's edge. If every position
 * costs something it takes the cheapest, and if even that mostly sits on other
 * ink it is left unlabeled: the tooltip still names the point, and a cloud of
 * overlapping text names nothing.
 *
 * Pure geometry, in pixels, so it is tested without a canvas.
 *
 * @param {Array<{x, y, w, h}>} items   a dot's center and its label's size
 * @param {{left, right, top, bottom}} area   the plot area labels must stay inside
 * @param {{radius?: number, gap?: number, maxCovered?: number}} [opts]
 * @returns {Array<{x, y}|null>}  per item, the label's top-left corner, or null for none
 */
export function placeLabels(items, area, { radius = 8, gap = 3, maxCovered = 0.35 } = {}) {
    const placed = [];
    const out = new Array(items.length).fill(null);
    const dots = items.map(p => ({ x: p.x - radius, y: p.y - radius, w: radius * 2, h: radius * 2 }));
    const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x || items[a].y - items[b].y);

    for (const i of order) {
        const { x, y, w, h } = items[i];
        const d = radius + gap;
        const candidates = [
            { x: x + d,         y: y - h / 2 },      // right
            { x: x - d - w,     y: y - h / 2 },      // left
            { x: x - w / 2,     y: y - d - h },      // above
            { x: x - w / 2,     y: y + d },          // below
            { x: x + d * 0.6,   y: y - d * 0.6 - h },  // above right
            { x: x + d * 0.6,   y: y + d * 0.6 },      // below right
            { x: x - d * 0.6 - w, y: y - d * 0.6 - h }, // above left
            { x: x - d * 0.6 - w, y: y + d * 0.6 },     // below left
        ];
        let best = null;
        for (const c of candidates) {
            const box = { ...c, w, h };
            const cost = coverage(box, placed, dots.filter((_, j) => j !== i), area);
            if (cost === 0) { best = { c, cost }; break; }
            if (!best || cost < best.cost) best = { c, cost };
        }
        if (best.cost <= maxCovered * w * h) {
            out[i] = best.c;
            placed.push({ ...best.c, w, h });
        }
    }
    return out;
}

/** Area of `box` lying on a placed label, a dot, or outside the plot area. */
function coverage(box, labels, dots, area) {
    let covered = 0;
    for (const other of labels) covered += overlap(box, other);
    for (const other of dots) covered += overlap(box, other);
    const inside = overlap(box, { x: area.left, y: area.top, w: area.right - area.left, h: area.bottom - area.top });
    covered += box.w * box.h - inside;
    return covered;
}

function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}
