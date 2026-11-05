/**
 * The color of the car in a vehicle's photo (#311).
 *
 * A press shot is a car on a background, often a light studio sweep or sky, so
 * a plain average returns grey every time. This looks only at the middle of the
 * frame, throws away what has no hue worth borrowing (near-white, near-black,
 * low saturation: white, black and silver cars, glass, tarmac, sweeps) and
 * takes the hue family that holds the most of what is left.
 *
 * The honest answer for a white, black or silver car is NOTHING. `null` and a
 * reason come back rather than a plausible grey, because the caller writes the
 * result to the vehicle on one click and a confident wrong answer is the
 * failure to avoid. Every threshold below errs toward declining.
 *
 * The color is the car's, nudged slightly brighter and more saturated than the
 * mean of its pixels (see the boosts below). It is not lightened for the dark
 * chart ground; that was decided against on the issue.
 */

import { hslToHex } from './colorUtils';

/* The middle of the frame, as fractions. The car sits low and central; the
   corners and the top are sky, sweep and badge. */
const REGION = { x0: 0.18, x1: 0.82, y0: 0.30, y1: 0.88 };

const MIN_ALPHA = 200;
const MIN_LIGHTNESS = 0.14;      // below: black, shadow, tyre
const MAX_LIGHTNESS = 0.86;      // above: white, sweep, glare
const MIN_SATURATION = 0.28;     // below: silver, grey, glass, tarmac
const HUE_BUCKETS = 24;          // 15 degrees each

/* A mean of shaded paint, highlights and reflections is duller than the paint
   looks, so the winner is nudged back up: saturation by a fifth, lightness by
   a twelfth, neither past the limits that keep it a color. */
const SATURATION_BOOST = 1.2;
const LIGHTNESS_BOOST = 1.08;
const MAX_BOOSTED_LIGHTNESS = 0.7;

/* A winning hue must be a real part of the region, and clearly ahead of any
   other hue that is not its neighbour. Green grass behind a red car, or a blue
   sky behind a silver one, must not win by being the only thing with hue. */
const MIN_SHARE = 0.1;

/* The rim of the frame is background, whatever else it is: a hue that fills
   the top and the sides of the photo is the sky, the wall or the grass, and a
   silver car in front of it must not be called blue. */
const RIM = 0.1;
const MIN_LEAD = 1.6;

export const NO_COLOR_REASONS = {
    noPhoto: 'No photo to read a color from.',
    unreadable: 'The photo could not be read.',
    neutral: 'No color stands out in this photo (white, black or silver?). Set one by hand.',
    ambiguous: 'More than one color competes in this photo. Set one by hand.',
};

function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return { h: ((h * 60) + 360) % 360, s, l };
}

/**
 * @param {{ data: Uint8ClampedArray|number[], width: number, height: number }} image
 *        RGBA pixels, as `getImageData` returns them
 * @returns {{ color: string|null, reason: string|null }}
 */
export function dominantColor({ data, width, height }) {
    const x0 = Math.floor(width * REGION.x0), x1 = Math.ceil(width * REGION.x1);
    const y0 = Math.floor(height * REGION.y0), y1 = Math.ceil(height * REGION.y1);

    const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
    let seen = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3] < MIN_ALPHA) continue;
            seen++;
            const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            if (l < MIN_LIGHTNESS || l > MAX_LIGHTNESS || s < MIN_SATURATION) continue;
            const bucket = buckets[Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS];
            bucket.n++;
            bucket.r += data[i];
            bucket.g += data[i + 1];
            bucket.b += data[i + 2];
        }
    }
    const rim = Array.from({ length: HUE_BUCKETS }, () => 0);
    let rimSeen = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const onRim = x < width * RIM || x >= width * (1 - RIM) || y < height * RIM;
            if (!onRim) { x = Math.max(x, Math.ceil(width * (1 - RIM)) - 1); continue; }
            const i = (y * width + x) * 4;
            if (data[i + 3] < MIN_ALPHA) continue;
            rimSeen++;
            const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            if (l < MIN_LIGHTNESS || l > MAX_LIGHTNESS || s < MIN_SATURATION) continue;
            rim[Math.floor(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS]++;
        }
    }
    if (seen === 0) return { color: null, reason: NO_COLOR_REASONS.unreadable };

    // A hue family is a bucket and its two neighbours: a red car straddles the
    // 0/360 seam and an orange one straddles two buckets.
    const family = (k) => {
        const parts = [-1, 0, 1].map(d => buckets[(k + d + HUE_BUCKETS) % HUE_BUCKETS]);
        return parts.reduce((a, p) => ({ n: a.n + p.n, r: a.r + p.r, g: a.g + p.g, b: a.b + p.b }), { n: 0, r: 0, g: 0, b: 0 });
    };
    const rimFamily = (k) => [-1, 0, 1].reduce((n, d) => n + rim[(k + d + HUE_BUCKETS) % HUE_BUCKETS], 0);
    const families = buckets.map((_, k) => (
        rimSeen > 0 && rimFamily(k) / rimSeen >= MIN_SHARE ? { n: 0, r: 0, g: 0, b: 0 } : family(k)
    ));
    let best = 0;
    families.forEach((f, k) => { if (f.n > families[best].n) best = k; });

    if (families[best].n / seen < MIN_SHARE) return { color: null, reason: NO_COLOR_REASONS.neutral };

    // The strongest family that does not overlap the winner's three buckets.
    let rival = 0;
    families.forEach((f, k) => {
        const apart = Math.min((k - best + HUE_BUCKETS) % HUE_BUCKETS, (best - k + HUE_BUCKETS) % HUE_BUCKETS) > 2;
        if (apart && f.n > rival) rival = f.n;
    });
    if (families[best].n < rival * MIN_LEAD) return { color: null, reason: NO_COLOR_REASONS.ambiguous };

    // The color is the mean of the winner's own bucket plus neighbours.
    const w = families[best];
    const mean = rgbToHsl(w.r / w.n, w.g / w.n, w.b / w.n);
    return {
        color: hslToHex({
            h: mean.h,
            s: Math.min(1, mean.s * SATURATION_BOOST) * 100,
            l: Math.min(MAX_BOOSTED_LIGHTNESS, mean.l * LIGHTNESS_BOOST) * 100,
        }),
        reason: null,
    };
}

/** Pixels of an image URL, drawn small. Storage is public but the fetch is
 *  cross-origin, so this goes fetch -> blob -> bitmap, never an <img> that
 *  would taint the canvas (the same route imageRenditions takes). */
async function readPixels(url, size = { width: 96, height: 54 }) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close?.();
    return { ...ctx.getImageData(0, 0, size.width, size.height), width: size.width, height: size.height };
}

/**
 * The color of the car in the photo at `url`.
 * @returns {Promise<{ color: string|null, reason: string|null }>}
 */
export async function sampleImageColor(url) {
    if (!url) return { color: null, reason: NO_COLOR_REASONS.noPhoto };
    try {
        return dominantColor(await readPixels(url));
    } catch {
        return { color: null, reason: NO_COLOR_REASONS.unreadable };
    }
}
