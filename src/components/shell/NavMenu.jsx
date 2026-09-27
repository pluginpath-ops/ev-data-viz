import { Fragment, useState } from 'react';
import { useLightDismiss } from '../../hooks/useLightDismiss';

/**
 * A row of navigation, collapsed to the one item you are standing on (#281).
 *
 * The narrow-screen form of both nav levels. At 375px the six top-level tabs
 * need ~630px of label against the 125px left over once the wordmark and the
 * account control have taken their share, so the row does not fit and never
 * did — it scrolled, inside a box with no scrollbar, and the five tabs past
 * `Vehicles` were unreachable rather than merely awkward.
 *
 * Shared by the main nav and the sub-nav because they are the same problem at
 * two scales, and the design handoff prescribes the same answer for both: the
 * current section's name as the button, the rest behind it.
 *
 * The button shows where you ARE, not what the menu is. "EPA ▾" answers "which
 * section is this" from the bar itself, which a label reading "Menu" or "Tabs"
 * does not — and that answer is the whole job of a nav bar that has given up
 * showing its own items.
 *
 * Props:
 *   items     [{ key, label, disabled, hint }]
 *   activeKey  which item is current
 *   onSelect   (key) => void; the menu closes itself
 *   level     'main' | 'sub' — which of the two bars this is painted on
 */
export default function NavMenu({ items, activeKey, onSelect, level = 'main' }) {
    const [open, setOpen] = useState(false);
    const ref = useLightDismiss(open, () => setOpen(false));

    if (!items?.length) return null;

    // Falling back to the first item matters on the sub-nav, where the active
    // key can briefly be one section's while the items are already the next's.
    const active = items.find(i => i.key === activeKey) ?? items[0];

    return (
        <div className={`nav-menu nav-menu-${level}`} ref={ref}>
            <button
                type="button"
                className="nav-menu-btn"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-haspopup="menu"
            >
                {/* Each collapsed bar says so (#338), with a different mark so
                    the two never read as the same menu: three bars for the
                    site's navigation, the mark every phone reader knows; a
                    bulleted list for the choices within this section. */}
                {level === 'main' ? (
                    <svg className="nav-menu-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <path d="M2 4h12M2 8h12M2 12h12" />
                    </svg>
                ) : (
                    <svg className="nav-menu-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                        <path d="M6 4h8M6 8h8M6 12h8" />
                        <path className="nav-menu-icon-dot" d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
                    </svg>
                )}
                <span className="nav-menu-current">{active.label}</span>
                <span className="disclosure-caret nav-menu-caret" aria-hidden="true">▾</span>
            </button>

            {open && (
                <div className="popover popover--stretch nav-menu-panel" role="menu">
                    {items.map(({ key, label, disabled, hint, group }, i) => (
                        <Fragment key={key}>
                        {/* The sub-nav's sections survive the collapse (#338). */}
                        {group && group !== items[i - 1]?.group && (
                            <span className="nav-menu-section text-nano" role="presentation">{group}</span>
                        )}
                        <button
                            type="button"
                            role="menuitem"
                            disabled={disabled}
                            aria-current={key === activeKey ? 'page' : undefined}
                            className={`nav-menu-item${key === activeKey ? ' active' : ''}`}
                            onClick={() => { onSelect(key); setOpen(false); }}
                        >
                            <span className="nav-menu-item-label">{label}</span>
                            {/* A tab you cannot reach yet says WHY here. In the
                                wide bar that reason is a title attribute, which
                                a touch device has no way to show. */}
                            {disabled && hint && <span className="nav-menu-item-hint">{hint}</span>}
                        </button>
                        </Fragment>
                    ))}
                </div>
            )}
        </div>
    );
}
