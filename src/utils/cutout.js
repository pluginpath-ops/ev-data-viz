/**
 * Cutting a vehicle out of its photo, for the Size chart's size photos
 * (docs/size-photos-plan.md). Works on pixels — `{ data, width, height }`, the
 * shape of a canvas ImageData — so it is pure and testable; the editor does
 * the canvas work around it.
 *
 * Only plain backgrounds are removed: a studio shot on white or gray. The
 * border is sampled, and if it is one color (within the tolerance) the
 * background is flood-filled away from every edge. A busy border is refused
 * rather than guessed at — a cutout made elsewhere is the answer there.
 */

/** Alpha below this counts as see-through. */
const CLEAR_ALPHA = 16;

/** Share of the border that must match its typical color to call it plain. */
const PLAIN_BORDER_SHARE = 0.85;

const dist = (d, i, [r, g, b]) => Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b));

/** True when enough of the image is already see-through to be a cutout. */
export function hasTransparency({ data, width, height }) {
    const total = width * height;
    let clear = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < CLEAR_ALPHA) clear++;
    return clear > total * 0.02;
}

/** Every border pixel's offset into `data`, once each. */
function borderOffsets(width, height) {
    const out = [];
    for (let x = 0; x < width; x++) out.push(x, (height - 1) * width + x);
    for (let y = 1; y < height - 1; y++) out.push(y * width, y * width + width - 1);
    return out.map(p => p * 4);
}

/** The border's typical color: the per-channel median. */
function borderColor(data, offsets) {
    const median = (ch) => {
        const v = offsets.map(i => data[i + ch]).sort((a, b) => a - b);
        return v[v.length >> 1];
    };
    return [median(0), median(1), median(2)];
}

/**
 * The image with its plain background made transparent.
 *
 * @param {{ data: Uint8ClampedArray, width: number, height: number }} img
 * @param {number} tolerance  0–255: how far a pixel may stray from the background color and still be background
 * @returns {{ ok: true, image: { data, width, height }, removed: number } | { ok: false, reason: 'busy' }}
 *          `removed` is the share of pixels cleared
 */
export function removePlainBackground({ data, width, height }, tolerance = 24) {
    const border = borderOffsets(width, height);
    const bg = borderColor(data, border);
    const matching = border.filter(i => dist(data, i, bg) <= tolerance).length;
    if (matching < border.length * PLAIN_BORDER_SHARE) return { ok: false, reason: 'busy' };

    const out = new Uint8ClampedArray(data);
    const seen = new Uint8Array(width * height);
    const queue = [];
    for (const i of border) {
        const p = i >> 2;
        if (!seen[p] && dist(data, i, bg) <= tolerance) { seen[p] = 1; queue.push(p); }
    }
    let removed = 0;
    while (queue.length) {
        const p = queue.pop();
        out[p * 4 + 3] = 0;
        removed++;
        const x = p % width;
        const y = (p / width) | 0;
        const next = [x > 0 && p - 1, x < width - 1 && p + 1, y > 0 && p - width, y < height - 1 && p + width];
        for (const q of next) {
            if (q === false || seen[q]) continue;
            if (dist(data, q * 4, bg) <= tolerance) { seen[q] = 1; queue.push(q); }
        }
    }

    // Soften the edge: a kept pixel beside a cleared one, close to the
    // background color, goes partly see-through, so the cutout has no halo.
    for (let p = 0; p < width * height; p++) {
        if (seen[p]) continue;
        const x = p % width;
        const y = (p / width) | 0;
        const besideCleared = (x > 0 && seen[p - 1]) || (x < width - 1 && seen[p + 1])
            || (y > 0 && seen[p - width]) || (y < height - 1 && seen[p + width]);
        if (!besideCleared) continue;
        const d = dist(data, p * 4, bg);
        if (d < tolerance * 2) out[p * 4 + 3] = Math.round(out[p * 4 + 3] * ((d - tolerance) / tolerance));
    }
    return { ok: true, image: { data: out, width, height }, removed: removed / (width * height) };
}

/**
 * The box around the visible pixels, in px, or null for an empty image.
 *
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
export function visibleBounds({ data, width, height }) {
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] < CLEAR_ALPHA) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The trim box: the visible pixels plus a margin, kept inside the image, as
 * fractions of it (what `vehicle_size_photos.trim` stores).
 */
export function trimBox(bounds, width, height, margin = 0.02) {
    const pad = Math.round(Math.max(bounds.w, bounds.h) * margin);
    const x = Math.max(0, bounds.x - pad);
    const y = Math.max(0, bounds.y - pad);
    const x1 = Math.min(width, bounds.x + bounds.w + pad);
    const y1 = Math.min(height, bounds.y + bounds.h + pad);
    return { x: x / width, y: y / height, w: (x1 - x) / width, h: (y1 - y) / height };
}
