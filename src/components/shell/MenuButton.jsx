import { useCallback, useState } from 'react';
import { useLightDismiss } from '../../hooks/useLightDismiss';

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
}) {
    const [open, setOpen] = useState(false);
    // How far the panel is nudged sideways to stay on screen, in px.
    const [shift, setShift] = useState(0);
    const ref = useLightDismiss(open, () => setOpen(false));
    const close = () => setOpen(false);

    /**
     * Keep the panel inside the viewport, 8px from either edge.
     *
     * It opens from its button's left edge, which on a phone runs a 320px
     * column list off the right of the screen from any button past the first
     * few — and right-aligning instead only moves the problem to the left edge
     * for a button in the middle. So it measures itself once attached and
     * slides just far enough. A callback ref rather than an effect: it runs
     * before paint, so the unshifted panel is never drawn (see
     * useAnchoredPosition for the same reasoning).
     */
    const place = useCallback((panel) => {
        if (!panel || !ref.current) return;
        const edge = 8;
        const anchorLeft = ref.current.getBoundingClientRect().left;
        const viewport = document.documentElement.clientWidth;
        const left = Math.max(edge, Math.min(anchorLeft, viewport - edge - panel.offsetWidth));
        const next = Math.round(left - anchorLeft);
        setShift(prev => (prev === next ? prev : next));
    }, [ref]);

    return (
        <div className="menu-button" ref={ref}>
            <button
                type="button"
                className={`guide-facet-btn${active ? ' active' : ''}`}
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-haspopup="menu"
                title={title}
            >
                {label}
                {value != null && value !== '' && (
                    <span className="guide-facet-btn-value">{value}</span>
                )}
                <span className="disclosure-caret guide-facet-caret" aria-hidden="true">▾</span>
            </button>

            {open && (
                <div
                    ref={place}
                    className={`popover popover--below guide-facet-panel ${panelClass}`.trim()}
                    style={shift ? { left: shift } : undefined}
                >
                    {typeof children === 'function' ? children({ close }) : children}
                </div>
            )}
        </div>
    );
}
