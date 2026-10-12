import { Fragment, useState } from 'react';
import MenuButton from '../shell/MenuButton';
import useColumnDrag from '../../hooks/useColumnDrag';

/**
 * Which columns a table shows, and in what ORDER — shared by the FE Guide table
 * and the vehicle table (#235 phase 5b, extracted for #315).
 *
 * ── Order is part of the answer ─────────────────────────────────────────────
 *
 * It used to be a set of checkboxes grouped by topic, and the table rendered
 * whatever was ticked in declaration order — so two people could tick the same
 * ten columns and neither could put the one they cared about next to the one
 * they were comparing it against. The list is the order now, and it drags —
 * as do the table's own column headers, through the same hook (useColumnDrag).
 *
 * The fixed column is the row label the horizontal scroll pins, and a table
 * whose row labels can be hidden or moved to the middle is a table of numbers
 * belonging to nothing.
 *
 * @param {Array}    columns   every column the table can show: { key, label, unit?, hint? }
 * @param {string[]} visible   the keys shown, in order
 * @param {string[]} defaults  the keys "reset" restores
 * @param {string}   fixedKey  the row-label column, which cannot be hidden or moved
 * @param {Function} [unitOf]  a column's unit as shown — defaults to `col.unit`
 *
 * ── Filtering ───────────────────────────────────────────────────────────────
 *
 * The vehicle table offers well over a hundred columns, so the menu carries a
 * filter box (same threshold as the facet menus: not above eight or fewer).
 * It narrows both halves — shown and not shown — by name, unit or group, so
 * "cargo" finds every cargo column whether it is on the table or not. The
 * fixed column stays put regardless: it is the anchor the list reads from.
 */
export default function ColumnPicker({ columns, visible, defaults, fixedKey, onChange, unitOf = (col) => col.unit }) {
    // The same drag the table's column headers use (hooks/useColumnDrag).
    const { dragProps, dragClass } = useColumnDrag({ visible, fixedKey, onChange, axis: 'y' });

    const [query, setQuery] = useState('');

    const byKey = new Map(columns.map(c => [c.key, c]));
    const shown = visible.map(k => byKey.get(k)).filter(Boolean);
    const hidden = columns.filter(c => !visible.includes(c.key));

    const needle = query.trim().toLowerCase();
    const matches = (col) => !needle
        || [col.label, col.fullLabel, unitOf(col), col.group].some(t => t && String(t).toLowerCase().includes(needle));
    const shownMatching = shown.filter(col => col.key === fixedKey || matches(col));
    const hiddenMatching = hidden.filter(matches);

    const toggle = (key) => {
        if (key === fixedKey) return;
        onChange(visible.includes(key)
            ? visible.filter(k => k !== key)
            // Added at the end, where it can then be dragged. Inserting it at
            // its declared position would silently reorder a list the reader
            // had arranged.
            : [...visible, key]);
    };

    const isDefault = visible.length === defaults.length && visible.every((k, i) => k === defaults[i]);

    return (
        <MenuButton
            label="Columns"
            value={visible.length}
            active={!isDefault}
            panelClass="guide-column-panel"
        >
            {({ close }) => (
                <>
                    {columns.length > 8 && (
                        <input
                            type="search"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Filter columns"
                            aria-label="Filter columns"
                            className="form-input guide-facet-panel-search"
                            autoFocus
                        />
                    )}

                    <div className="guide-facet-panel-head">
                        <span className="text-nano">Shown · drag to reorder</span>
                        <button type="button" className="section-action" onClick={() => onChange(defaults)}>
                            reset
                        </button>
                    </div>

                    <div className="guide-facet-panel-list">
                        {shownMatching.map(col => {
                            const fixed = col.key === fixedKey;
                            const unit = unitOf(col);
                            return (
                                <div
                                    key={col.key}
                                    className={`guide-column-row ${dragClass(col.key)}`}
                                    {...dragProps(col.key)}
                                >
                                    <span className="guide-column-grip" aria-hidden="true">
                                        {fixed ? '' : '⠿'}
                                    </span>
                                    <span className="guide-column-name" title={col.hint || ''}>{col.label}</span>
                                    {unit && <span className="guide-column-unit">{unit}</span>}
                                    {fixed
                                        ? <span className="text-nano">fixed</span>
                                        : (
                                            <button
                                                type="button"
                                                className="guide-column-drop"
                                                onClick={() => toggle(col.key)}
                                                title={`Hide ${col.label}`}
                                            >
                                                ✕
                                            </button>
                                        )}
                                </div>
                            );
                        })}

                        {hiddenMatching.length > 0 && (
                            <>
                                {/* Below the shown ones, not interleaved: the top
                                    of this list is the table you are looking at,
                                    and the bottom is what you could add to it. */}
                                <div className="guide-column-divider text-nano">Not shown</div>
                                {hiddenMatching.map((col, i) => {
                                    const unit = unitOf(col);
                                    // The group once, as a heading, rather than
                                    // "Tested performance · " on every row — at
                                    // menu width the prefix left the name "0–60 …".
                                    const heading = col.group && col.group !== hiddenMatching[i - 1]?.group;
                                    return (
                                        <Fragment key={col.key}>
                                            {heading && <div className="guide-column-group text-nano">{col.group}</div>}
                                            <button
                                                type="button"
                                                className="guide-column-row is-hidden"
                                                onClick={() => toggle(col.key)}
                                                title={col.hint || `Show ${col.label}`}
                                            >
                                                <span className="guide-column-grip" aria-hidden="true">+</span>
                                                <span className="guide-column-name">{col.label}</span>
                                                {unit && <span className="guide-column-unit">{unit}</span>}
                                            </button>
                                        </Fragment>
                                    );
                                })}
                            </>
                        )}
                        {needle && hiddenMatching.length === 0 && shownMatching.every(c => c.key === fixedKey) && (
                            <div className="guide-column-divider text-nano">No columns match “{query.trim()}”</div>
                        )}
                    </div>

                    <div className="guide-facet-panel-foot">
                        <span className="text-nano">{shown.length} of {columns.length}</span>
                        <button type="button" className="btn btn-secondary" onClick={close}>
                            Done
                        </button>
                    </div>
                </>
            )}
        </MenuButton>
    );
}
