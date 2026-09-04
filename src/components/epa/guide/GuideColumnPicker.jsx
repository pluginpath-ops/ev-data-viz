import { useState, useRef } from 'react';
import { useLightDismiss } from '../../../hooks/useLightDismiss';
import { GUIDE_COLUMNS, DEFAULT_COLUMNS, columnByKey } from '../../../utils/feGuideBrowse';

/**
 * Which columns the guide table shows, and in what ORDER (#235, phase 5b).
 *
 * The guide holds 30-odd fields per configuration and a table showing all of
 * them is unreadable, but which ten matter depends entirely on the question —
 * someone comparing label methods wants the adjustment factor and signature,
 * someone shopping wants range and MPGe.
 *
 * ── Order is now part of the answer ─────────────────────────────────────────
 *
 * It used to be a set of checkboxes grouped by topic, and the table rendered
 * whatever was ticked in `GUIDE_COLUMNS` order — so two people could tick the
 * same ten columns and neither could put the one they cared about next to the
 * one they were comparing it against. The list is the order now, and it drags.
 *
 * Configuration is fixed. It is the sticky column the horizontal scroll pins,
 * and a table whose row labels can be hidden or moved to the middle is a table
 * of numbers belonging to nothing.
 */
const FIXED_KEY = 'carline';

export default function GuideColumnPicker({ visible, onChange }) {
    const [open, setOpen] = useState(false);
    const ref = useLightDismiss(open, () => setOpen(false));
    // A REF for what is being dragged, and state only for the styling.
    // Reading it from state in the drop handler meant reading the closure the
    // row was last rendered with — which, between a dragstart and a drop that
    // React has not re-rendered between, is still null and the drop does
    // nothing. A ref is current the moment it is written.
    const dragKeyRef = useRef(null);
    const [dragKey, setDragKey] = useState(null);


    const shown = visible.map(columnByKey).filter(Boolean);
    const hidden = GUIDE_COLUMNS.filter(c => !visible.includes(c.key));

    const toggle = (key) => {
        if (key === FIXED_KEY) return;
        onChange(visible.includes(key)
            ? visible.filter(k => k !== key)
            // Added at the end, where it can then be dragged. Inserting it at
            // its GUIDE_COLUMNS position would silently reorder a list the
            // reader had arranged.
            : [...visible, key]);
    };

    /** Move `from` to sit where `to` currently is, keeping everything else in order. */
    const reorder = (from, to) => {
        if (from === to || from === FIXED_KEY || to === FIXED_KEY) return;
        const next = visible.filter(k => k !== from);
        const at = next.indexOf(to);
        if (at < 0) return;
        next.splice(at, 0, from);
        onChange(next);
    };

    return (
        <div className="guide-column-picker" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`guide-facet-btn${visible.length !== DEFAULT_COLUMNS.length ? ' active' : ''}`}
                aria-expanded={open}
            >
                Columns
                <span className="guide-facet-btn-value">{visible.length}</span>
                <span className="disclosure-caret guide-facet-caret" aria-hidden="true">▾</span>
            </button>

            {open && (
                <div className="guide-facet-panel guide-column-panel">
                    <div className="guide-facet-panel-head">
                        <span className="text-nano">Shown · drag to reorder</span>
                        <button type="button" className="section-action" onClick={() => onChange(DEFAULT_COLUMNS)}>
                            reset
                        </button>
                    </div>

                    <div className="guide-facet-panel-list">
                        {shown.map(col => {
                            const fixed = col.key === FIXED_KEY;
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
                                    {col.unit && <span className="guide-column-unit">{col.unit}</span>}
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
                                {hidden.map(col => (
                                    <button
                                        key={col.key}
                                        type="button"
                                        className="guide-column-row is-hidden"
                                        onClick={() => toggle(col.key)}
                                        title={col.hint || `Show ${col.label}`}
                                    >
                                        <span className="guide-column-grip" aria-hidden="true">+</span>
                                        <span className="guide-column-name">{col.label}</span>
                                        {col.unit && <span className="guide-column-unit">{col.unit}</span>}
                                    </button>
                                ))}
                            </>
                        )}
                    </div>

                    <div className="guide-facet-panel-foot">
                        <span className="text-nano">{shown.length} of {GUIDE_COLUMNS.length}</span>
                        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
