import { useCallback, useEffect, useState } from 'react';
import { useLightDismiss } from '../../hooks/useLightDismiss';
import { placePopover } from '../../utils/popoverPlacement';

/**
 * A button that states what it holds, and opens a panel (#236).
 *
 * `Measure  Combined MPGe ▾` — label, current value, caret. WAI-ARIA calls this
 * a *menu button*, so that is what it is called here rather than a house word.
 *
 * Four copies of it existed before this: the facet menus, the range menus and
 * the column picker on Browse, each with its own `useState(open)`, its own
 * `useLightDismiss`, and its own copy of the same three spans. They already
 * shared the CSS; sharing only the CSS is how the range menus ended up as
 * `<details>` — visually identical to their neighbours in a row of nine, and
 * the only two that did not close when you clicked away.
 *
 * The panel's CONTENT stays with the caller. A facet list, a min/max pair and a
 * drag-ordered column list have nothing in common below the button, and a prop
 * that could describe all three would be a worse API than three components.
 *
 * `children` may be a function, called with `{ close }`, for panels that
 * dismiss themselves on a choice — a single-select menu, which every menu that
 * picks exactly one thing is.
 *
 * Props:
 *   label     {node}    the control's name, always shown
 *   value     {node}    the current selection, shown when there is one
 *   active    {boolean} paint it as narrowing/changed something
 *   title     {string}  hover text for the button
 *   panelClass {string} a modifier on the panel — width, mostly
 *   children  {node | ({close}) => node}
 */
export default function MenuButton({
    label, value, active = false, title, panelClass = '', children,
    // A trigger that is not a facet button: its own class, no caret, and a
    // name for assistive tech when the label is a glyph (the list's ⋯, #338).
    buttonClass = null, ariaLabel,
}) {
    const [open, setOpen] = useState(false);
    // Where the panel sits, in viewport px; null until it has been measured.
    const [pos, setPos] = useState(null);
    const ref = useLightDismiss(open, () => setOpen(false));
    const close = () => setOpen(false);

    /**
     * Place the panel against its button, inside the viewport.
     *
     * Fixed rather than absolute under the button: an absolute panel is
     * clipped by any scrolling ancestor, and the ⋯ menu on a List row opens
     * inside the lineage popover (which scrolls), where its last items were
     * cut off at the popover's edge. A fixed box is not clipped by ancestor
     * overflow, and `placePopover` flips it above its button, or slides it up,
     * when below cannot hold it. It stays a DOM descendant of the button's
     * wrapper (no portal), so light dismiss and the owning popover's own
     * dismissal both still count a click on it as inside.
     *
     * A callback ref rather than an effect: it runs before paint, so the
     * unplaced panel is never drawn (see useAnchoredPosition for the same
     * reasoning).
     */
    const place = useCallback((panel) => {
        if (!panel || !ref.current) { setPos(null); return; }
        const next = placePopover(
            ref.current.getBoundingClientRect(),
            { width: panel.offsetWidth, height: panel.offsetHeight },
            { width: document.documentElement.clientWidth, height: window.innerHeight },
        );
        setPos(prev => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    }, [ref]);

    // A fixed panel does not follow its button, so a scroll elsewhere would
    // leave it hanging. Scrolling the panel itself (a long column list) is fine.
    useEffect(() => {
        if (!open) return;
        const onScroll = (e) => {
            if (!ref.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        return () => document.removeEventListener('scroll', onScroll, { capture: true });
    }, [open, ref]);

    return (
        <div className="menu-button" ref={ref}>
            <button
                type="button"
                className={buttonClass ?? `guide-facet-btn${active ? ' active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label={ariaLabel}
                title={title}
            >
                {label}
                {value != null && value !== '' && (
                    <span className="guide-facet-btn-value">{value}</span>
                )}
                {!buttonClass && <span className="disclosure-caret guide-facet-caret" aria-hidden="true">▾</span>}
            </button>

            {open && (
                <div
                    ref={place}
                    className={`popover popover--anchored guide-facet-panel ${panelClass}`.trim()}
                    style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
                >
                    {typeof children === 'function' ? children({ close }) : children}
                </div>
            )}
        </div>
    );
}
