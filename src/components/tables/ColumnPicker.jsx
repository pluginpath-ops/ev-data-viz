import { useState, useRef } from 'react';
import MenuButton from '../shell/MenuButton';

/**
 * Which columns a table shows, and in what ORDER — shared by the FE Guide table
 * and the vehicle table (#235 phase 5b, extracted for #315).
 *
 * ── Order is part of the answer ─────────────────────────────────────────────
 *
 * It used to be a set of checkboxes grouped by topic, and the table rendered
 * whatever was ticked in declaration order — so two people could tick the same
 * ten columns and neither could put the one they cared about next to the one
 * they were comparing it against. The list is the order now, and it drags.
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
 */
export default function ColumnPicker({ columns, visible, defaults, fixedKey, onChange, unitOf = (col) => col.unit }) {
    // A REF for what is being dragged, and state only for the styling.
    // Reading it from state in the drop handler meant reading the closure the
    // row was last rendered with — which, between a dragstart and a drop that
    // React has not re-rendered between, is still null and the drop does
    // nothing. A ref is current the moment it is written.
    const dragKeyRef = useRef(null);
    const [dragKey, setDragKey] = useState(null);

    const byKey = new Map(columns.map(c => [c.key, c]));
    const shown = visible.map(k => byKey.get(k)).filter(Boolean);
    const hidden = columns.filter(c => !visible.includes(c.key));

    const toggle = (key) => {
        if (key === fixedKey) return;
        onChange(visible.includes(key)
            ? visible.filter(k => k !== key)
            // Added at the end, where it can then be dragged. Inserting it at
            // its declared position would silently reorder a list the reader
            // had arranged.
            : [...visible, key]);
    };

    /** Move `from` to sit where `to` currently is, keeping everything else in order. */
    const reorder = (from, to) => {
        if (from === to || from === fixedKey || to === fixedKey) return;
        const next = visible.filter(k => k !== from);
        const at = next.indexOf(to);
        if (at < 0) return;
        next.splice(at, 0, from);
        onChange(next);
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
                    <div className="guide-facet-panel-head">
                        <span className="text-nano">Shown · drag to reorder</span>
                        <button type="button" className="section-action" onClick={() => onChange(defaults)}>
                            reset
                        </button>
                    </div>

                    <div className="guide-facet-panel-list">
                        {shown.map(col => {
                            const fixed = col.key === fixedKey;
                            const unit = unitOf(col);
                            return (
                                <div
                                    key={col.key}
                                    className={`guide-column-row${dragKey === col.key ? ' dragging' : ''}`}
                                    draggable={!fixed}
                                    onDragStart={e => {
                                        dragKeyRef.current = col.key;
                                        setDragKey(col.key);
                                        // Firefox starts no drag without payload.
                                        e.dataTransfer?.setData('text/plain', col.key);
                                    }}
                                    onDragEnd={() => { dragKeyRef.current = null; setDragKey(null); }}
                                    onDragOver={e => e.preventDefault()}
                                    onDrop={e => {
                                        e.preventDefault();
                                        const from = dragKeyRef.current
                                            ?? e.dataTransfer?.getData('text/plain');
                                        if (from) reorder(from, col.key);
                                        dragKeyRef.current = null;
                                        setDragKey(null);
                                    }}
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

                        {hidden.length > 0 && (
                            <>
                                {/* Below the shown ones, not interleaved: the top
                                    of this list is the table you are looking at,
                                    and the bottom is what you could add to it. */}
                                <div className="guide-column-divider text-nano">Not shown</div>
                                {hidden.map(col => {
                                    const unit = unitOf(col);
                                    return (
                                        <button
                                            key={col.key}
                                            type="button"
                                            className="guide-column-row is-hidden"
                                            onClick={() => toggle(col.key)}
                                            title={col.hint || `Show ${col.label}`}
                                        >
                                            <span className="guide-column-grip" aria-hidden="true">+</span>
                                            <span className="guide-column-name">
                                                {col.group ? <span className="text-meta">{col.group} · </span> : null}
                                                {col.label}
                                            </span>
                                            {unit && <span className="guide-column-unit">{unit}</span>}
                                        </button>
                                    );
                                })}
                            </>
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
