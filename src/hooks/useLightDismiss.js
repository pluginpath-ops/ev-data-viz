import { useEffect, useRef } from 'react';

/**
 * Close an open overlay on a click outside it or on Escape.
 *
 * "Light dismiss" is the platform's own term for this pair — it is what the
 * HTML popover API's `auto` state does — so it is what the hook is called,
 * rather than a house name for behaviour that already has one.
 *
 * Two details it exists to stop being retyped:
 *
 * `pointerdown`, not `click`. A menu closed on click survives a drag that
 * starts inside it and ends outside — which is exactly what reordering a column
 * list does, so the menu would stay open on a gesture that plainly left it.
 *
 * Both listeners are bound only while `open`. Leaving a document-level
 * keydown attached for every closed menu on a page means Escape walking a
 * dozen handlers that all decline to act.
 *
 * `alsoInside` is for overlays whose trigger is not an ancestor of the panel —
 * a portalled popover, where the glyph and the panel are in different subtrees.
 * Without it, clicking the trigger to close reads as an outside click, the
 * overlay dismisses on pointerdown, and the click that follows re-opens it: a
 * toggle that cannot be toggled off.
 *
 * @param {boolean} open      whether the overlay is currently showing
 * @param {() => void} onDismiss  called on an outside pointerdown or Escape
 * @param {{current: HTMLElement|null}} [alsoInside]  a second element that
 *        counts as inside — typically the trigger
 * @returns {{current: HTMLElement|null}} ref for the element that is "inside"
 */
export function useLightDismiss(open, onDismiss, alsoInside = null) {
    const ref = useRef(null);
    // The callback is read through a ref so a caller passing an inline arrow —
    // which every caller does — does not re-bind both listeners on every render.
    // Written in an effect rather than during render: a ref assignment in the
    // render body is what `react-hooks/refs` exists to catch, and this pattern
    // is only safe because the listeners read it later, never sooner.
    const handler = useRef(onDismiss);
    useEffect(() => { handler.current = onDismiss; });

    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            const inside = (el) => el && el.contains(e.target);
            if (!ref.current) return;
            if (inside(ref.current) || inside(alsoInside?.current)) return;
            handler.current();
        };
        const onKey = (e) => { if (e.key === 'Escape') handler.current(); };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, alsoInside]);

    return ref;
}
