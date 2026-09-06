import { useState } from 'react';
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
    const ref = useLightDismiss(open, () => setOpen(false));
    const close = () => setOpen(false);

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
                <div className={`guide-facet-panel ${panelClass}`.trim()}>
                    {typeof children === 'function' ? children({ close }) : children}
                </div>
            )}
        </div>
    );
}
