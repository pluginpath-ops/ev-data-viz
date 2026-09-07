import { useCallback, useEffect, useRef, useState } from 'react';
import { placePopover } from '../utils/popoverPlacement';

/**
 * Fixed-position a floating panel against a trigger it does not live inside.
 *
 * ── Why fixed at all ────────────────────────────────────────────────────────
 *
 * The chart sidebar scrolls, which makes it a clipping context in BOTH
 * directions, so an absolutely-positioned tooltip anchored near its edge was
 * cut off. The stylesheet had grown ~90 lines working around that — the anchor
 * moved from the glyph to its row, four `position: relative/static` rules
 * fighting over which ancestor won, one width forced from the rail's padding
 * variables, a 40vh cap with `pointer-events: auto` so the capped panel could
 * still be scrolled. Every one of those exists because the panel could not
 * leave. A `position: fixed` panel is not clipped by ancestor overflow, so it
 * simply does.
 *
 * Verified before relying on it: nothing on the layout ancestors establishes a
 * containing block for fixed descendants (no `transform`, `filter`, `contain`
 * or `will-change` outside leaf elements — toggle knobs and caret rotations).
 * The panel is portalled anyway, which makes that independent of a future rule.
 *
 * ── Measured on attach, not in an effect ────────────────────────────────────
 *
 * A panel has to be in the DOM to be measured, and measured to be placed. It
 * renders once at the origin with `visibility: hidden`, and a CALLBACK REF
 * measures it the moment React attaches the node — before paint, so the
 * intermediate state is never drawn.
 *
 * A `useLayoutEffect` would do the same thing and reads more obviously, but it
 * is `setState` inside an effect, which `react-hooks/set-state-in-effect`
 * flags and CLAUDE.md singles out as the shape of a bug this project has
 * already hit. The callback ref is not a workaround for the lint: it is also
 * more correct. React re-runs it whenever its identity changes, so a peek
 * growing into a pinned panel re-measures because `openKey` changed, with no
 * dependency array to keep in step.
 *
 * ── What deliberately does NOT happen ───────────────────────────────────────
 *
 * Nothing re-positions after the first placement. No scroll tracking, no
 * resize handler, no anchor observer. A pinned panel stays where it opened
 * even when its trigger scrolls away — the panel is the thing being read, and
 * chasing an anchor that has left the screen would drag it off with it. That
 * is the decision that keeps this hook twenty lines instead of a library.
 *
 * A peek does not need any of it either, because it closes on scroll:
 * `onScrollAway` exists for one narrow reason. Scrolling the sidebar moves the
 * glyph out from under the cursor, which ends `:hover` — but browsers do not
 * reliably re-evaluate hover until the next pointer move, so the panel can
 * hang in space next to nothing. Capture-phase, because `scroll` does not
 * bubble from the element that scrolled.
 *
 * @param {string|null} openKey  falsy when closed. Any other value opens, and
 *        CHANGING it re-measures — which is how one glyph's 276px peek becomes
 *        its 520px pinned panel without a second hook.
 * @param {() => void} [onScrollAway]  called when anything scrolls while open
 */
export function useAnchoredPosition(openKey, onScrollAway) {
    const anchorRef = useRef(null);
    const [pos, setPos] = useState(null);

    // Detach clears the position rather than leaving the last one: between
    // tiers that would place a 520px panel at a 276px panel's coordinates for
    // one frame. Hidden for a frame beats wrong for a frame.
    const measureRef = useCallback((panel) => {
        const anchor = anchorRef.current;
        if (!panel || !anchor || !openKey) { setPos(null); return; }
        setPos(placePopover(
            anchor.getBoundingClientRect(),
            { width: panel.offsetWidth, height: panel.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight },
        ));
    }, [openKey]);

    // Read through a ref, so a caller passing an inline arrow — which every
    // caller does — does not re-bind the listener on every render. Same reason
    // and same shape as useLightDismiss.
    const handler = useRef(onScrollAway);
    useEffect(() => { handler.current = onScrollAway; });

    useEffect(() => {
        if (!openKey || !onScrollAway) return;
        const onScroll = () => handler.current?.();
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        return () => document.removeEventListener('scroll', onScroll, { capture: true });
        // `onScrollAway` is read through the ref; only its PRESENCE matters here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openKey, !onScrollAway]);

    // Hidden rather than absent until placed: it has to be in the DOM to be
    // measured, and the callback ref places it before anything is painted.
    const style = pos
        ? { top: pos.top, left: pos.left }
        : { top: 0, left: 0, visibility: 'hidden' };

    return {
        anchorRef,
        measureRef,
        style,
        placement: pos?.placement,
        // A caller cannot act on the panel until it has been placed: it is
        // `visibility: hidden` until then, and a hidden element cannot take
        // focus — `.focus()` on one fails silently.
        placed: pos != null,
    };
}
