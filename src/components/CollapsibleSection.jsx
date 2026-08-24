import { useState } from 'react';

/**
 * A titled section that starts collapsed.
 *
 * Extracted rather than written inline because three places now needed the same
 * disclosure and each had rolled its own caret-and-useState (ChartInfoBubble,
 * AuditHistory, the methodology phase table). This is the shared one.
 *
 * Props:
 *   title       {node}    — the always-visible heading
 *   subtitle    {node}    — optional detail beside the title, muted
 *   defaultOpen {boolean} — starts open when true (default: closed)
 *   className   {string}  — extra classes on the section, for a caller that
 *                           needs to drop the divider (see --flush)
 *   children    {node}    — revealed when open
 */
export default function CollapsibleSection({ title, subtitle, defaultOpen = false, className = '', children }) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <section className={`collapsible-section ${className}`.trim()}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                className="collapsible-header"
            >
                <span
                    aria-hidden="true"
                    className="collapsible-caret"
                    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                >
                    ▼
                </span>
                <span className="collapsible-title">{title}</span>
                {subtitle && <span className="collapsible-subtitle">{subtitle}</span>}
            </button>

            {/* Unmounted rather than hidden: these sections carry charts, and a
                collapsed one should cost nothing to have on the page. */}
            {open && <div className="collapsible-body">{children}</div>}
        </section>
    );
}
