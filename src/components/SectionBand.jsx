import { useRef } from 'react';

/**
 * A section band: the full-width labelled divider that opens and closes a
 * section of a chart's sidebar (docs/vocabulary.md).
 *
 * The run selector, Road Trip's routing overrides, the performance run picker
 * and every Display section each drew their own — two caret conventions, three
 * label styles. This is the one: the sunken band, the micro all-caps label,
 * the disclosure caret (▶ closed, ▼ open), and the same nudge into view on
 * opening, because a section that opens below the fold reads as a control
 * that did nothing.
 *
 * Props:
 *   open, onToggle(next)  the caller holds the state
 *   label        {node}     the section's name
 *   count        {node}     a "3 / 12" beside the name, where the section picks from a list
 *   active       {boolean}  something inside is APPLIED — a correction moving the
 *                           figures — drawn as the applied dot in accent orange,
 *                           the design system's "active / now" signal
 *   activeLabel  {string}   what the dot means, for its tooltip and screen readers
 *   note         {node}     a muted line after the name: a summary while closed,
 *                           a hint while open — the caller decides which
 */
export default function SectionBand({ open, onToggle, label, count = null, active = false, activeLabel = null, note = null }) {
    const ref = useRef(null);
    return (
        <button
            ref={ref}
            type="button"
            aria-expanded={open}
            className="section-band"
            onClick={() => {
                const next = !open;
                onToggle(next);
                if (next) {
                    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
                }
            }}
        >
            <span aria-hidden="true" className="collapsible-caret" style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
            {/* The note sits under the label, not under the caret, so it reads
                as part of the section it summarises. */}
            <span className="flex flex-col gap-0.5 min-w-0">
                <span className="flex items-center gap-2">
                    <span className="text-micro">{label}</span>
                    {active && <span className="section-band-dot" role="img" aria-label={activeLabel ?? 'Applied'} title={activeLabel ?? undefined} />}
                    {count != null && <span className="section-band-count">{count}</span>}
                </span>
                {note && <span className="section-band-note">{note}</span>}
            </span>
        </button>
    );
}
