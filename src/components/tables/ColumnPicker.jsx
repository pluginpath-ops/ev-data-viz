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
 */
export default function ColumnPicker({ columns, visible, defaults, fixedKey, onChange, unitOf = (col) => col.unit }) {
    // The same drag the table's column headers use (hooks/useColumnDrag).
    const { dragProps, dragClass } = useColumnDrag({ visible, fixedKey, onChange, axis: 'y' });

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
