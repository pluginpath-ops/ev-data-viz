/**
 * Where a floating panel goes, as arithmetic.
 *
 * Placement used to be declarative — `.popover--above`, `--below`, `--right`,
 * `--end` — and that worked only while a panel stayed inside its anchor's
 * containing block. The moment a panel has to LEAVE one (the chart sidebar
 * clips on both axes, so a tooltip anchored near its edge was simply cut off)
 * it becomes `position: fixed`, and a fixed box is positioned against the
 * viewport. CSS cannot express "6px below that glyph" for one, so the offsets
 * have to be computed.
 *
 * Kept pure and DOM-free so the decisions are testable without a browser: it
 * takes three rectangles and returns two numbers. `useAnchoredPosition` does
 * the measuring.
 *
 * The declarative classes are NOT gone — a menu that opens inside its own
 * anchor still uses them, and should. This is for panels that escape.
 */

/** Clearance between the anchor and the panel. Matches `.popover--*`'s 6px. */
export const GAP = 6;

/** How close a panel may come to the viewport edge. */
export const MARGIN = 8;

/**
 * Place a panel against its anchor.
 *
 * Below-start is the preferred placement: reading order runs down and left, so
 * a panel that opens down and aligns left is where the eye already is. It flips
 * above only when below genuinely cannot hold it AND above can hold more —
 * `belowRoom >= aboveRoom` rather than a bare fit test, because flipping into a
 * space that is also too small trades one clipped panel for another, and the
 * one below at least opens in the direction the reader is travelling.
 *
 * Horizontal is a clamp, not a flip. A panel that jumped to right-aligned near
 * the edge would move by its own width — a big, surprising displacement to fix
 * an overhang that is usually a few pixels. Sliding it back in place keeps the
 * left edge as close to the anchor as the viewport allows.
 *
 * @param {{top:number, bottom:number, left:number}} anchor    viewport rect of the trigger
 * @param {{width:number, height:number}}            panel     measured size of the panel
 * @param {{width:number, height:number}}            viewport
 * @param {{gap?:number, margin?:number}}            [opts]
 * @returns {{top:number, left:number, placement:'above'|'below'}}
 */
export function placePopover(anchor, panel, viewport, { gap = GAP, margin = MARGIN } = {}) {
    const belowRoom = viewport.height - anchor.bottom - gap - margin;
    const aboveRoom = anchor.top - gap - margin;

    const below = panel.height <= belowRoom || belowRoom >= aboveRoom;
    const rawTop = below ? anchor.bottom + gap : anchor.top - gap - panel.height;

    // The right edge a panel may start at and still fit. Can go below `margin`
    // when the panel is wider than the viewport allows — `.popover`'s own
    // `max-width: calc(100vw - 2rem)` is what stops that, and since we measure
    // the RENDERED panel, the width arriving here is already clamped.
    const rightmost = viewport.width - panel.width - margin;

    return {
        top: Math.max(margin, rawTop),
        left: Math.max(margin, Math.min(anchor.left, rightmost)),
        placement: below ? 'below' : 'above',
    };
}
