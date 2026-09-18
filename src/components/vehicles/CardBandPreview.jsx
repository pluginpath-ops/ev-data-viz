/**
 * What the card's media band will keep of a photo — drawn over the photo
 * itself, so a curator frames for the card rather than for the file (#340).
 *
 * ── Why it is an overlay and not a second picture ────────────────────────────
 *
 * The two places this is needed already have the photo on screen: the crop step
 * has it under the cropper, and the edit form has it in the image section. A
 * preview that rendered its own copy would be a second thing to keep in step
 * with the first, and in the crop step it would also have to re-derive the crop
 * rectangle. So this draws NOTHING but the card's view: the band's window, the
 * fade, the name, and the card body's edge. Whatever is behind it shows through.
 *
 * It must therefore be placed inside a positioned box that is showing exactly
 * the WHOLE photo, at the photo's own aspect — the crop rectangle, or a frame
 * shaped like the stored image — and be told that aspect. It fills that box.
 * A 16:9 frame over a 3:2 photo was the first bug here: `cover` cut the
 * photo's top and bottom off the frame, so the window lined up with an edge
 * that was not the photo's, and showed sky where the card showed wheels.
 *
 * ── Read-only, or a handle ──────────────────────────────────────────────────
 *
 * With no `onFocalChange` it is a guide and takes no pointer events at all,
 * which is what the crop step needs: every drag there belongs to the cropper
 * underneath. With one, the window is the handle — drag it up or down over the
 * photo and the focal point follows, which is the whole of "reposition after
 * upload". Nothing is re-uploaded; the number is what gets saved.
 *
 * The geometry all comes from utils/cardBand, including the fade's stops, which
 * are one declaration shared with the real band in index.css.
 */
import { useRef } from 'react';
import {
    CARD_BAND_BODY_FRACTION,
    CARD_BAND_MAX_WIDTH,
    PHOTO_ASPECT,
    bandWindow,
    focalY,
    focalYFromTop,
} from '../../utils/cardBand';

/** One arrow key's worth of movement, in focal-point units. */
const KEY_STEP = 2;

export default function CardBandPreview({
    name,
    subtitle,
    focal = null,
    onFocalChange,
    bandWidth = CARD_BAND_MAX_WIDTH,
    // The photo's real width / height. A fresh crop is 16:9 by construction;
    // a stored photo may not be, and the window's size and travel both depend
    // on it — see usePhotoAspect.
    aspect = PHOTO_ASPECT,
    className = '',
}) {
    const frameRef = useRef(null);
    // The drag in progress, or null. A ref rather than state: it changes on
    // every pointermove and nothing renders from it — the focal point does.
    const dragRef = useRef(null);

    const interactive = typeof onFocalChange === 'function';
    const { top, height } = bandWindow(focal, bandWidth, aspect);
    const value = focalY(focal);

    const moveTo = (clientY) => {
        const drag = dragRef.current;
        if (!drag) return;
        onFocalChange(focalYFromTop(drag.top + (clientY - drag.y) / drag.height, bandWidth, aspect));
    };

    const handlePointerDown = (e) => {
        if (!interactive) return;
        const frame = frameRef.current?.getBoundingClientRect();
        if (!frame?.height) return;
        // Capture, so a drag that leaves the frame — which it will, the window
        // being most of it — keeps moving instead of stopping at the edge.
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { y: e.clientY, top, height: frame.height };
    };

    const handlePointerUp = (e) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
    };

    const handleKeyDown = (e) => {
        if (!interactive) return;
        const next = { ArrowUp: value - KEY_STEP, ArrowDown: value + KEY_STEP, Home: 0, End: 100 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        onFocalChange(Math.min(100, Math.max(0, next)));
    };

    return (
        <div ref={frameRef} className={`card-band-preview${interactive ? ' is-interactive' : ''} ${className}`}>
            {/* What the card cuts. Dimming it rather than hiding it is the
                point: the curator is choosing between the two. */}
            <div className="card-band-cut" style={{ top: 0, height: `${top * 100}%` }} />
            <div className="card-band-cut" style={{ top: `${(top + height) * 100}%`, bottom: 0 }} />

            <div
                className="card-band-window"
                style={{
                    top: `${top * 100}%`,
                    height: `${height * 100}%`,
                    // The card body's share of the band, as a percentage rather
                    // than 36px: the frame is drawn at whatever size it happens
                    // to be, and the same declarations in index.css resolve it
                    // against the window either way. It places the body's edge
                    // and, through .vehicle-media-title, the name.
                    '--card-band-overlap': `${CARD_BAND_BODY_FRACTION * 100}%`,
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={e => moveTo(e.clientY)}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onKeyDown={handleKeyDown}
                {...(interactive ? {
                    role: 'slider',
                    tabIndex: 0,
                    'aria-label': 'Vertical focal point of the photo',
                    'aria-orientation': 'vertical',
                    'aria-valuemin': 0,
                    'aria-valuemax': 100,
                    'aria-valuenow': value,
                    'aria-valuetext': value === 50 ? 'Centered' : `${value}% down the photo`,
                } : { 'aria-hidden': true })}
            >
                <div className="card-band-scrim" />
                {/* The card body's top edge. On a card the band runs under it,
                    so the photo below this line is never seen. */}
                <div className="card-band-body" />
                {/* The card's own title element, under the card's own rule —
                    the point being that the preview cannot put the name
                    anywhere the card would not. */}
                <div className="vehicle-media-title">
                    <h3>{name || 'Unnamed vehicle'}</h3>
                    {subtitle && <p>{subtitle}</p>}
                </div>
            </div>
        </div>
    );
}
