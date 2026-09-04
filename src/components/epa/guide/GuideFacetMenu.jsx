import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * One facet, as a button that opens a menu (#235, re-skin phase 5a).
 *
 * It was a chip wall: every value of every facet rendered at once, so 38 makes
 * and 6 model years and 9 classes filled most of a screen before a single row
 * of data. The set you are choosing FROM is not the thing you came to read, and
 * it should cost a button until you want it.
 *
 * ── Ordered by count, not alphabetically ────────────────────────────────────
 *
 * The question a facet answers is "what is actually in here", and alphabetical
 * order buries that: Tesla's 40 configurations sort below Aston Martin's one.
 * By count, the first three rows of the menu are the three makes that matter,
 * and the long tail sorts itself out at the bottom where it belongs.
 *
 * ── Two behaviours carried over deliberately ────────────────────────────────
 *
 * The counts are computed with this facet's OWN selection removed — see
 * GuideFilterBar — so a value's number says what clicking it would leave, not
 * what the unfiltered corpus holds. And a value that would leave nothing is
 * DISABLED rather than hidden: a make vanishing from the list reads as a bug,
 * where a greyed one reads as an answer.
 */
export default function GuideFacetMenu({
    label, values, selected, countFor, onToggle, onClear, format = String, hint,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const ref = useRef(null);

    // Pointerdown rather than click, so the menu does not survive a drag that
    // starts inside it and ends outside. Same as GuideColumnPicker.
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const ordered = useMemo(() => {
        const withCounts = values.map(v => ({ v, n: countFor(v), text: String(format(v)) }));
        // Count descending, then by label so equal counts do not shuffle
        // between renders.
        withCounts.sort((a, b) => b.n - a.n || a.text.localeCompare(b.text, undefined, { numeric: true }));
        return withCounts;
    }, [values, countFor, format]);

    const needle = query.trim().toLowerCase();
    const shown = needle ? ordered.filter(o => o.text.toLowerCase().includes(needle)) : ordered;

    if (!values.length) return null;

    // One selection shows its value, several show how many — "Year 2026" says
    // more than "Year 1", and "Make 3" says more than three truncated names.
    const summary = selected.length === 0 ? null
        : selected.length === 1 ? String(format(selected[0]))
            : String(selected.length);

    return (
        <div className="guide-facet-menu" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`guide-facet-btn${selected.length ? ' active' : ''}`}
                title={hint ? `${label} — ${hint}` : label}
                aria-expanded={open}
            >
                {label}
                {summary && <span className="guide-facet-btn-value">{summary}</span>}
                <span className="guide-facet-caret" aria-hidden="true">▾</span>
            </button>

            {open && (
                <div className="guide-facet-panel">
                    {/* Only where the list is long enough to need it. A filter
                        box above eight options is furniture. */}
                    {values.length > 8 && (
                        <input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={`Filter ${label.toLowerCase()}`}
                            aria-label={`Filter ${label} options`}
                            className="form-input guide-facet-panel-search"
                        />
                    )}

                    <div className="guide-facet-panel-head">
                        <span className="text-nano">
                            {selected.length} of {values.length} · by count
                        </span>
                        {selected.length > 0 && (
                            <button type="button" className="section-action" onClick={onClear}>
                                clear
                            </button>
                        )}
                    </div>

                    <div className="guide-facet-panel-list">
                        {shown.map(({ v, n, text }) => {
                            const on = selected.includes(v);
                            return (
                                <label
                                    key={String(v)}
                                    className={`guide-facet-option${on ? ' selected' : ''}`}
                                    title={`${n} configuration${n === 1 ? '' : 's'}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={!on && n === 0}
                                        onChange={() => onToggle(v)}
                                    />
                                    <span className="guide-facet-option-name">{text}</span>
                                    <span className="guide-facet-option-count">{n}</span>
                                </label>
                            );
                        })}
                        {shown.length === 0 && (
                            <div className="text-note p-2">Nothing matches.</div>
                        )}
                    </div>

                    <div className="guide-facet-panel-foot">
                        <span className="text-nano">{shown.length} shown</span>
                        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
