import { useState, useMemo } from 'react';
import MenuButton from '../../shell/MenuButton';

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
 *
 * ── Exclude, and any / all (#338) ───────────────────────────────────────────
 *
 * With `onExclude`, each value can also be excluded: its "not" button drops
 * every row that has it, and an excluded value reads struck through. Including
 * a value clears its exclusion and the other way round. With `onAllChange`,
 * a facet whose rows carry several values (tags, test data) gets an any / all
 * switch: match rows with any of the chosen values, or every one of them.
 * Both are opt-in, so a caller that passes neither sees the menu it had.
 */
export default function GuideFacetMenu({
    label, values, selected, countFor, onToggle, onClear, format = String, hint,
    excluded = [], onExclude = null, all = false, onAllChange = null,
    // What one count counts, for the option's tooltip.
    unit = 'configuration',
}) {
    const [query, setQuery] = useState('');


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
    // An exclusion alone reads as one: "not Truck".
    const chosen = selected.length + excluded.length;
    const summary = chosen === 0 ? null
        : chosen > 1 ? String(chosen)
            : selected.length ? String(format(selected[0]))
                : `not ${format(excluded[0])}`;

    return (
        <MenuButton
            label={label}
            value={summary}
            active={chosen > 0}
            title={hint ? `${label} — ${hint}` : label}
        >
            {({ close }) => (
                <>
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
                        {chosen > 0 && (
                            <button type="button" className="section-action" onClick={onClear}>
                                clear
                            </button>
                        )}
                    </div>

                    {/* Its own line: beside the count and "clear" in a menu this
                        narrow, the switch was pushed off the panel's edge. */}
                    {onAllChange && (
                        <div className="guide-facet-panel-head">
                            <span className="text-nano">Match</span>
                            <span className="stats-segmented guide-facet-match" role="group" aria-label={`${label}: match`}>
                                {[['any', false], ['all', true]].map(([word, v]) => (
                                    <button
                                        key={word}
                                        type="button"
                                        className={all === v ? 'active' : ''}
                                        aria-pressed={all === v}
                                        title={v ? `Rows with every chosen ${label.toLowerCase()}` : `Rows with any chosen ${label.toLowerCase()}`}
                                        onClick={() => onAllChange(v)}
                                    >
                                        {word}
                                    </button>
                                ))}
                            </span>
                        </div>
                    )}
                    <div className="guide-facet-panel-list">
                        {shown.map(({ v, n, text }) => {
                            const on = selected.includes(v);
                            const off = excluded.includes(v);
                            return (
                                <div key={String(v)} className={`flex items-center gap-1 guide-facet-option-row${off ? ' is-excluded' : ''}`}>
                                    <label
                                        className={`guide-facet-option${on ? ' selected' : ''}`}
                                        title={`${n} ${unit}${n === 1 ? '' : 's'}`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            disabled={!on && !off && n === 0}
                                            onChange={() => onToggle(v)}
                                        />
                                        <span className="guide-facet-option-name">{text}</span>
                                        <span className="guide-facet-option-count">{n}</span>
                                    </label>
                                    {onExclude && (
                                        <button
                                            type="button"
                                            className={`guide-facet-exclude${off ? ' active' : ''}`}
                                            aria-pressed={off}
                                            aria-label={`${off ? 'Stop excluding' : 'Exclude'} ${text}`}
                                            title={off ? `Stop excluding ${text}` : `Leave out everything with ${text}`}
                                            onClick={() => onExclude(v)}
                                        >
                                            not
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                        {shown.length === 0 && (
                            <div className="text-note p-2">Nothing matches.</div>
                        )}
                    </div>

                    <div className="guide-facet-panel-foot">
                        <span className="text-nano">{shown.length} shown</span>
                        <button type="button" className="btn btn-secondary" onClick={close}>
                            Done
                        </button>
                    </div>
                </>
            )}
        </MenuButton>
    );
}
