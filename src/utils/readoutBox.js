/**
 * Layout for a fixed readout drawn onto the canvas (#456).
 *
 * The on-screen readout is DOM and scrolls; the one in a PNG is a picture and
 * has to fit. A box over twelve series would otherwise be a tall strip that
 * covers the chart it is reading, so this works out, in order:
 *
 *   1. SIZE — rows are one line each. If they do not fit the height cap they
 *      wrap into a second column, and past two columns the rest are counted
 *      ("+3 more") rather than listed. A box that hid the data it annotates
 *      would be worse than one that says it left some out.
 *   2. PLACE — beside the guide line, on whichever side and at whichever end
 *      of the plot covers the fewest drawn points.
 *
 * Pure and DOM-free: text is measured through a callback, so the tests supply
 * a fixed-width stand-in and the drawer supplies `ctx.measureText`.
 */

export const BOX_MAX_COLUMNS = 2;
/** Share of the plot's height the box may take before it wraps to a column. */
export const BOX_MAX_HEIGHT_FRACTION = 0.85;
/** Share of the plot's width it may take. */
export const BOX_MAX_WIDTH_FRACTION = 0.6;

/** `text` shortened with an ellipsis until it measures within `maxWidth`. */
export function fitText(text, maxWidth, measure) {
    const s = String(text ?? '');
    if (measure(s) <= maxWidth) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measure(`${s.slice(0, mid)}…`) <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return lo > 0 ? `${s.slice(0, lo).trimEnd()}…` : '…';
}

/**
 * Size the box and decide which rows go in which column.
 *
 * @param {object} p
 * @param {{name: string, value: string}[]} p.rows   one line each, already worded
 * @param {string} p.title
 * @param {string} [p.subtitle]
 * @param {(text: string, bold?: boolean) => number} p.measure  text width in px
 * @param {number} p.lineHeight
 * @param {number} p.padding
 * @param {number} p.swatch        swatch width, plus its gap to the name
 * @param {number} p.gap           gap between name and value, and between columns
 * @param {number} p.maxHeight
 * @param {number} p.maxWidth
 * @returns {{width: number, height: number, columns: {indices: number[], nameWidth: number, valueWidth: number, x: number}[],
 *            names: string[], hidden: number, headHeight: number, moreY: number|null}}
 */
export function layoutReadoutBox({ rows, title, subtitle, measure, lineHeight, padding, swatch, gap, maxHeight, maxWidth }) {
    const headHeight = padding + lineHeight + (subtitle ? lineHeight : 0) + gap / 2;
    const innerH = maxHeight - headHeight - padding;

    let perColumn = Math.max(1, Math.floor(innerH / lineHeight));
    const capacity = perColumn * BOX_MAX_COLUMNS;
    let hidden = 0;
    if (rows.length > capacity) {
        // One line of the budget goes to the "+n more" note.
        perColumn = Math.max(1, Math.floor((innerH - lineHeight) / lineHeight));
        hidden = Math.max(0, rows.length - perColumn * BOX_MAX_COLUMNS);
    }
    const shown = rows.length - hidden;
    const nColumns = Math.min(BOX_MAX_COLUMNS, Math.ceil(shown / perColumn)) || 1;
    // Balanced columns read better than a full one beside a stub.
    const rowsIn = Math.ceil(shown / nColumns);

    // Names are the only elastic part: values are short and must not clip.
    const valueW = rows.map(r => measure(r.value));
    const maxValueW = Math.max(0, ...valueW);
    const roomPerColumn = (maxWidth - padding * 2 - gap * (nColumns - 1)) / nColumns;
    const nameCap = Math.max(40, roomPerColumn - swatch - gap - maxValueW);

    const names = rows.map(r => fitText(r.name, nameCap, measure));
    const columns = [];
    let x = padding;
    for (let c = 0; c < nColumns; c++) {
        const indices = [];
        for (let i = c * rowsIn; i < Math.min(shown, (c + 1) * rowsIn); i++) indices.push(i);
        const nameWidth = Math.max(0, ...indices.map(i => measure(names[i])));
        const valueWidth = Math.max(0, ...indices.map(i => valueW[i]));
        columns.push({ indices, nameWidth, valueWidth, x });
        x += swatch + nameWidth + gap + valueWidth + gap;
    }
    const listWidth = x - gap - padding;
    const headWidth = Math.max(measure(title, true), subtitle ? measure(subtitle) : 0);
    const width = Math.min(maxWidth, Math.max(listWidth, headWidth) + padding * 2);

    const bodyRows = Math.min(rowsIn, shown);
    const moreY = hidden > 0 ? headHeight + bodyRows * lineHeight : null;
    const height = headHeight + bodyRows * lineHeight + (hidden > 0 ? lineHeight : 0) + padding;
    return { width, height, columns, names, hidden, headHeight, moreY };
}

/**
 * Points along the drawn lines, for `placeReadoutBox` to avoid. Segments are
 * subdivided so a long straight stretch between two samples counts as the line
 * it is, not as the two points it ends in.
 *
 * @param {{x: number, y: number}[][]} polylines  in pixels
 * @param {number} [step]  spacing, px
 */
export function sampleObstacles(polylines, step = 6) {
    const out = [];
    for (const line of polylines) {
        let prev = null;
        for (const p of line) {
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { prev = null; continue; }
            if (prev) {
                const n = Math.min(400, Math.floor(Math.hypot(p.x - prev.x, p.y - prev.y) / step));
                for (let k = 1; k < n; k++) {
                    const t = k / n;
                    out.push({ x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t });
                }
            }
            out.push({ x: p.x, y: p.y });
            prev = p;
        }
    }
    return out;
}

/**
 * Where to put a box of `size` beside the guide line at `xPx`, inside `area`.
 * Tries right/left of the line at the top and the bottom of the plot and takes
 * the one covering the fewest `obstacles`; the order breaks ties, so an empty
 * plot gets the reading-order default (right, top).
 *
 * @returns {{left: number, top: number, covered: number}}
 */
export function placeReadoutBox({ size, area, xPx, obstacles, gap = 10, margin = 6 }) {
    const clampX = (l) => Math.max(area.left + margin, Math.min(l, area.right - margin - size.width));
    const clampY = (t) => Math.max(area.top + margin, Math.min(t, area.bottom - margin - size.height));
    const candidates = [
        { left: xPx + gap, top: area.top + margin },
        { left: xPx + gap, top: area.bottom - margin - size.height },
        { left: xPx - gap - size.width, top: area.top + margin },
        { left: xPx - gap - size.width, top: area.bottom - margin - size.height },
    ];
    let best = null;
    for (const c of candidates) {
        const left = clampX(c.left), top = clampY(c.top);
        // A side the box does not fit on gets clamped onto the guide line;
        // charge for that so the other side wins when it can.
        const onLine = xPx > left - 2 && xPx < left + size.width + 2;
        let covered = onLine ? 1e6 : 0;
        for (const o of obstacles) {
            if (o.x >= left && o.x <= left + size.width && o.y >= top && o.y <= top + size.height) covered++;
        }
        if (!best || covered < best.covered) best = { left, top, covered };
    }
    return best;
}
