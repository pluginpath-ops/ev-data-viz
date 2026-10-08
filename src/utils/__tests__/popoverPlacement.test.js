import { describe, it, expect } from 'vitest';
import { placePopover, GAP, MARGIN } from '../popoverPlacement';

/** A 1000×800 viewport with a 16×16 glyph wherever you put it. */
const view = { width: 1000, height: 800 };
const glyph = (left, top) => ({ left, top, bottom: top + 16 });

describe('placePopover', () => {
    it('opens below and left-aligned when there is room', () => {
        const { top, left, placement } = placePopover(glyph(200, 100), { width: 276, height: 120 }, view);
        expect(placement).toBe('below');
        expect(top).toBe(116 + GAP);
        expect(left).toBe(200);
    });

    it('flips above when below cannot hold it and above can', () => {
        // Glyph near the floor: 800 - 716 - 6 - 8 = 70px below, 700px above.
        const { top, placement } = placePopover(glyph(200, 700), { width: 276, height: 300 }, view);
        expect(placement).toBe('above');
        expect(top).toBe(700 - GAP - 300);
    });

    it('stays below when neither side fits but below has more room', () => {
        // A panel taller than the viewport: flipping would trade one clipped
        // panel for another, and below at least opens the way you are reading.
        const { placement } = placePopover(glyph(200, 300), { width: 276, height: 900 }, view);
        expect(placement).toBe('below');
    });

    it('slides up until its bottom is on screen when neither side fits (#382)', () => {
        // Measured live: a 517px color picker under a swatch at y≈333 of a
        // 748px window ended at 856, with Apply 100px below the edge.
        const short = { width: 1000, height: 748 };
        const { top, placement } = placePopover(glyph(160, 317), { width: 300, height: 517 }, short);
        expect(placement).toBe('below');
        expect(top + 517).toBe(748 - MARGIN);
    });

    it('keeps the header on screen when the panel is taller than the viewport', () => {
        const { top } = placePopover(glyph(200, 300), { width: 276, height: 900 }, view);
        expect(top).toBe(MARGIN);
    });

    it('slides back from the right edge rather than flipping', () => {
        const { left } = placePopover(glyph(900, 100), { width: 276, height: 120 }, view);
        expect(left).toBe(1000 - 276 - MARGIN);
    });

    it('never opens past the left margin', () => {
        // Wider than the viewport allows. `.popover`'s max-width is what
        // actually prevents this; the clamp keeps the arithmetic honest.
        const { left } = placePopover(glyph(4, 100), { width: 1200, height: 120 }, view);
        expect(left).toBe(MARGIN);
    });

    it('clamps the top when flipping above into too little space', () => {
        const { top } = placePopover(glyph(200, 40), { width: 276, height: 400 }, view);
        expect(top).toBeGreaterThanOrEqual(MARGIN);
    });
});
