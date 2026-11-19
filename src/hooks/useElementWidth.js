import { useCallback, useRef, useState } from 'react';

/**
 * An element's content width in px, kept current as it resizes. For a drawing
 * laid out in px (the Size chart's SVG), so its text stays one size at any width
 * instead of shrinking with a scaled viewBox.
 *
 * Measured once on attach as well as observed: a ResizeObserver reports only
 * when the page renders a frame, which a window opened behind another may not
 * do for a while.
 *
 * @returns {[(el: Element|null) => void, number]} a callback ref to attach, and the width (0 before layout)
 */
export function useElementWidth() {
    const [width, setWidth] = useState(0);
    const observer = useRef(null);
    const ref = useCallback((el) => {
        observer.current?.disconnect();
        observer.current = null;
        if (!el) return;
        setWidth(Math.round(el.clientWidth));
        if (typeof ResizeObserver === 'undefined') return;
        observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
        observer.current.observe(el);
    }, []);
    return [ref, width];
}
