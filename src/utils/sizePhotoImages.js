/**
 * The canvas work behind the size photo editor: load a picture, cut it out,
 * trim, flip and size it, and encode it. The pixel decisions are cutout.js's;
 * this only moves pixels between canvases.
 *
 * Browser-only (canvas, Image).
 */

import { hasTransparency, removePlainBackground, visibleBounds, trimBox } from './cutout';

/** The original is kept at most this long a side; the cutout, at most this. */
export const ORIGINAL_MAX_SIDE = 2400;
export const CUTOUT_MAX_SIDE = 1600;

/**
 * A picture as a canvas, scaled down to `maxSide`. A stored image is fetched
 * with CORS so its pixels can be read (the bucket is public).
 *
 * @param {Blob|string} source  a chosen file, or a URL
 */
export async function loadCanvas(source, maxSide = ORIGINAL_MAX_SIDE) {
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('The image could not be read.'));
            img.src = url;
        });
        const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * k);
        canvas.height = Math.round(img.naturalHeight * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas;
    } finally {
        if (typeof source !== 'string') URL.revokeObjectURL(url);
    }
}

const pixels = (canvas) => canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height);

/** True when the picture is already a cutout. */
export const isCutout = (canvas) => hasTransparency(pixels(canvas));

/**
 * The original with its background removed (or as it is, when it is already
 * a cutout), and where the car's visible pixels sit in it.
 *
 * @returns {{ ok: true, canvas, trim } | { ok: false, reason: 'busy' | 'empty' }}
 *          `trim` as fractions of the original
 */
export function cutOut(original, tolerance = null) {
    let image = pixels(original);
    if (tolerance != null) {
        const res = removePlainBackground(image, tolerance);
        if (!res.ok) return res;
        image = res.image;
    }
    const bounds = visibleBounds(image);
    if (!bounds) return { ok: false, reason: 'empty' };
    const canvas = document.createElement('canvas');
    canvas.width = original.width;
    canvas.height = original.height;
    canvas.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    return { ok: true, canvas, trim: trimBox(bounds, original.width, original.height) };
}

/**
 * The cutout as stored: the trim box of `cut`, flipped when mirrored, no
 * longer than CUTOUT_MAX_SIDE.
 */
export function finishCutout(cut, trim, mirrored) {
    const sx = trim.x * cut.width;
    const sy = trim.y * cut.height;
    const sw = trim.w * cut.width;
    const sh = trim.h * cut.height;
    const k = Math.min(1, CUTOUT_MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * k));
    canvas.height = Math.max(1, Math.round(sh * k));
    const ctx = canvas.getContext('2d');
    if (mirrored) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(cut, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
}

/** A canvas flipped left to right. */
export function flipCanvas(source) {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, 0, 0);
    return canvas;
}

/** The visible pixels of a canvas, as fractions of it. */
export function visibleFractions(canvas) {
    const b = visibleBounds(pixels(canvas));
    return b
        ? { x: b.x / canvas.width, y: b.y / canvas.height, w: b.w / canvas.width, h: b.h / canvas.height }
        : { x: 0, y: 0, w: 1, h: 1 };
}

export const toBlob = (canvas, type = 'image/png', quality) => new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The image could not be encoded.'))), type, quality);
});
