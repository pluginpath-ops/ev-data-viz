// Vehicle images are stored in two renditions: the full-resolution original and
// a card-sized thumbnail. This module owns both the dimensions and the canvas
// resize step, so the upload path and the one-time backfill cannot drift apart.
//
// Why two: the grid renders images into a ~394 CSS px box, so a 1600×900 JPEG
// ships roughly 4× the pixels any screen will use (2× the pixels on a HiDPI
// display). The full copy is still kept — see migration 051 for why.

/** Full rendition. Matches what the crop step has always produced. */
export const FULL_MAX = { width: 1600, height: 900 };

/**
 * Thumbnail rendition. 800×450 is 2× the widest box the card uses (~394 CSS px),
 * so it stays sharp on HiDPI screens and is the smallest size that does.
 */
export const THUMB_MAX = { width: 800, height: 450 };

/** JPEG quality per rendition. The thumbnail is displayed small, so it tolerates
 *  more compression than the original we are keeping for later features. */
export const FULL_QUALITY = 0.92;
export const THUMB_QUALITY = 0.82;

/** Storage prefix for thumbnails, relative to the vehicle-images bucket root. */
export const THUMB_PREFIX = 'thumbs';

/** `24.jpg` → `thumbs/24.jpg`. Kept here so the path shape has one definition. */
export function thumbPathFor(fullPath) {
    return `${THUMB_PREFIX}/${fullPath}`;
}

/**
 * Draw a source image into a canvas that fits within `max`, preserving aspect
 * ratio, and return it as a JPEG blob.
 *
 * Never upscales: an image already smaller than `max` is re-encoded at its own
 * size rather than stretched.
 *
 * @param {CanvasImageSource & {width:number,height:number}} source
 *        Anything drawImage accepts that also reports intrinsic dimensions —
 *        an HTMLImageElement, an ImageBitmap, or another canvas.
 * @param {{width:number,height:number}} max
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
export function renderToJpegBlob(source, max, quality) {
    const sourceW = source.naturalWidth ?? source.width;
    const sourceH = source.naturalHeight ?? source.height;
    if (!sourceW || !sourceH) {
        return Promise.reject(new Error('Source image has no intrinsic size'));
    }

    const scale = Math.min(1, max.width / sourceW, max.height / sourceH);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceW * scale));
    canvas.height = Math.max(1, Math.round(sourceH * scale));

    const ctx = canvas.getContext('2d');
    // Downscaling by more than 2× with the default filter aliases badly on the
    // fine detail in a car photo (grille slats, wheel spokes).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
            'image/jpeg',
            quality,
        );
    });
}

/**
 * Produce both renditions from one source.
 *
 * Both come from the same source rather than the thumbnail being re-derived
 * from the encoded full JPEG: the source is the cropped canvas, so the two
 * renditions frame an identical region and the thumbnail is not compressed
 * twice.
 *
 * @returns {Promise<{ full: Blob, thumb: Blob }>}
 */
export async function buildRenditions(source) {
    const [full, thumb] = await Promise.all([
        renderToJpegBlob(source, FULL_MAX, FULL_QUALITY),
        renderToJpegBlob(source, THUMB_MAX, THUMB_QUALITY),
    ]);
    return { full, thumb };
}

/**
 * The URL every UI surface should render. Nothing on screen is wider than the
 * thumbnail, so the full-resolution original is only for features that
 * explicitly want it.
 *
 * Falls back to image_url so rows are correct before the backfill has run and
 * for anything uploaded by a client older than migration 051.
 */
export function displayImageUrl(vehicle) {
    return vehicle?.image_thumb_url || vehicle?.image_url || '';
}

/** Load a URL into an ImageBitmap for the backfill path. Storage is public, but
 *  the fetch is still cross-origin, so this goes through fetch → blob → bitmap
 *  rather than an <img> that would taint a canvas. */
export async function loadBitmapFromUrl(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    return createImageBitmap(await res.blob());
}
