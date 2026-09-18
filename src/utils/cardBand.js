/**
 * The card's media band, as numbers — and the focal point that frames a photo
 * inside it.
 *
 * ── Why the numbers are here and not in three places ────────────────────────
 *
 * The band is 140px tall and overlaps the card body by 36px. Until now the
 * height was a literal in `VehiclesView` and the overlap a literal in
 * `index.css`, which was fine while the band was the only thing that knew
 * them. It stopped being fine the moment a SECOND surface had to draw the same
 * geometry: the crop step now shows the curator what the card will keep, and a
 * preview that copies 140 and 36 is a preview that lies the first time the band
 * is tuned again. So the height comes from here and the overlap is published to
 * CSS as `--card-band-overlap` by VehicleMedia, which is the one element that
 * knows it is drawing a card band.
 *
 * ── The band shows a WINDOW of the photo, and it is not a fixed fraction ─────
 *
 * Photos are cropped to 16:9 (mostly — see PHOTO_ASPECT). The band is much
 * wider than it is tall, and fills with `background-size: cover`, so the image
 * is scaled to the band's WIDTH and the top and bottom run off the edges. How
 * much survives depends on how wide the card is — and the grid is fluid
 * (1 / 2 / 3 columns), so it genuinely varies. For a 16:9 photo:
 *
 *      viewport   columns   band width   photo shown
 *      375px         1         347            72%
 *      640px         1         588            42%
 *      768px         2         350            71%
 *      1024px        3         313            79%
 *      ≥1280px       3         399            62%
 *
 * A preview has to pick one, and the useful one to pick is the TIGHTEST of the
 * ordinary cases — frame for the narrowest window and every wider card shows
 * more, never less. That is the desktop card at the page container's full
 * width, which is also the width the band was tuned at (#339) and the one a
 * curator is looking at while curating. The 640px single-column case is
 * tighter still at 42%; it is a narrow-tablet edge and the answer to it is the
 * same as the answer to all of this, which is to crop a little wide.
 *
 * `CARD_BAND_MAX_WIDTH` is therefore derived, not measured: the page container
 * is `max-w-7xl` (1280px) with a 24px gutter each side, three columns with a
 * 12px gap, and each card spends 4px on its borders (3px accent border + 1px).
 *
 *     (1280 - 48 - 24) / 3 - 4 = 398.7
 *
 * ── The focal point ─────────────────────────────────────────────────────────
 *
 * Which part of that window the photo is aligned to. 0 is the top of the photo,
 * 100 the bottom, and null means centered — which is what every photo did
 * before this existed and what every photo nobody has repositioned still does.
 * It is stored per photo and travels with it through inheritance, so a variant
 * showing its source's photo is framed the way the source is framed.
 */

/** The band's height on a card, in CSS px. `VehiclesView` passes it to VehicleMedia. */
export const CARD_BAND_HEIGHT = 140;

/** How far the band runs under the card body. Published to CSS as `--card-band-overlap`. */
export const CARD_BAND_OVERLAP = 36;

/** The widest the band gets — see the arithmetic above. */
export const CARD_BAND_MAX_WIDTH = 399;

/**
 * How much of the band the card body covers, as a fraction of its height.
 *
 * A preview is drawn at whatever size its frame happens to be — the crop
 * rectangle is usually twice a card's width — so it places the body's edge and
 * the name proportionally rather than at 36 and 45 literal pixels.
 */
export const CARD_BAND_BODY_FRACTION = CARD_BAND_OVERLAP / CARD_BAND_HEIGHT;

/**
 * What the crop step produces. NOT a promise about every stored photo: some
 * predate the crop step or came in through import — the Gravity Grand
 * Touring's is 400×267, 3:2 — and a preview that assumed 16:9 for those drew
 * the window over the wrong part of the picture. Anything measuring a STORED
 * photo takes its real aspect; this is the default for a fresh crop.
 */
export const PHOTO_ASPECT = 16 / 9;

/** Centered: what a photo with no focal point set is drawn at. */
export const DEFAULT_FOCAL_Y = 50;

/**
 * The fraction of the photo's height the band shows, at a given band width and
 * photo aspect (width / height).
 *
 * Capped at 1: a band TALLER than the photo scaled to its width would show the
 * whole photo and letterbox it sideways instead, which no card width reaches
 * today but which a future tuning of the height could.
 */
export function bandWindowFraction(bandWidth = CARD_BAND_MAX_WIDTH, aspect = PHOTO_ASPECT) {
    return Math.min(1, CARD_BAND_HEIGHT / (bandWidth / aspect));
}

/**
 * A stored focal point as a number to draw with: null and nonsense become
 * centered, and a real number is clamped into range.
 *
 * The empty cases are tested BEFORE the conversion, not after. `Number(null)`
 * and `Number('')` are both 0, which is a perfectly finite number and also the
 * top of the photo — so a single `Number.isFinite` guard would quietly draw
 * every un-repositioned photo hard against the band's top edge, which is the
 * one thing this feature must not change.
 */
export function focalY(value) {
    if (value === null || value === undefined || value === '') return DEFAULT_FOCAL_Y;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_FOCAL_Y;
}

/**
 * A photo's `background-position`.
 *
 * `center 50%` is identical to the `center` the stylesheet has always used, so
 * a photo with no focal point is drawn at exactly the same pixels as before.
 */
export function photoPosition(value) {
    return `center ${focalY(value)}%`;
}

/**
 * Where the band's window sits inside the whole photo, as fractions of the
 * photo's height — what a preview draws to show which slice the card keeps.
 *
 * The window is `fraction` tall and slides over the `1 - fraction` that does
 * not fit, in proportion to the focal point. That IS what `background-position:
 * center Y%` does, restated so a preview can draw it: at 0 the window sits at
 * the top of the photo, at 100 at its foot, at 50 in the middle.
 */
export function bandWindow(value, bandWidth = CARD_BAND_MAX_WIDTH, aspect = PHOTO_ASPECT) {
    const height = bandWindowFraction(bandWidth, aspect);
    return { top: (1 - height) * (focalY(value) / 100), height };
}

/**
 * The focal point that puts the band's window at `top` (a fraction of the
 * photo's height). The inverse of `bandWindow`, for a drag.
 *
 * A window that fills the photo has nowhere to slide, so there is no focal
 * point that means anything — it returns centered rather than dividing by zero.
 */
export function focalYFromTop(top, bandWidth = CARD_BAND_MAX_WIDTH, aspect = PHOTO_ASPECT) {
    const slack = 1 - bandWindowFraction(bandWidth, aspect);
    if (slack <= 0) return DEFAULT_FOCAL_Y;
    return Math.round(Math.min(100, Math.max(0, (top / slack) * 100)));
}
