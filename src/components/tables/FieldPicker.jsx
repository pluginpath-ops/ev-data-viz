import { Fragment, useState } from 'react';
import { columnMatches } from '../../utils/tableColumns';
import { groupColumns, tableScopedColumns } from '../../utils/specChart';

/**
 * Which column(s) of the vehicle table the spec chart plots (#450): the
 * ColumnPicker's list, grouped and filtered the same way, but choosing what to
 * DRAW rather than what to show. A variant, not a copy — the matching is
 * `columnMatches`, the groups are the table's, the rows use the picker's row
 * classes. What differs is the job: one answer (or two, for a scatter's axes)
 * instead of an ordered set, and no drag.
 *
 * ── Scope ───────────────────────────────────────────────────────────────────
 *
 * It opens on the columns the table is SHOWING, because those are the ones the
 * reader arranged and came here from; "All fields" lists everything the table
 * can show. Typing in the filter searches every column, so a figure not on the
 * table is one query away without switching. The column plotted now is always
 * in the list.
 *
 * @param {Array}    columns      every column the chart may offer (labelled, unit-aware)
 * @param {string[]} tableKeys    the keys the table is showing, in its order
 * @param {Function} unitOf       a column's unit as shown
 * @param {'single'|'dual'} mode  one column, or an X and a Y
 * @param {string}   [value]      single: the plotted column's key
 * @param {{x, y}}   [axes]       dual: the X and Y keys
 * @param {Function} onChange     single: (key); dual: ({ x, y })
 */
export default function FieldPicker({ columns, tableKeys, unitOf, mode = 'single', value = null, axes = null, onChange }) {
    const [query, setQuery] = useState('');
    const [scope, setScope] = useState('table');

    const plotted = mode === 'dual' ? [axes?.x, axes?.y].filter(Boolean) : [value].filter(Boolean);
    const inTable = tableScopedColumns(columns, tableKeys, plotted);

    // A filter reaches every column; the scope switch only sets the resting list.
    const needle = query.trim();
    const listed = needle || scope === 'all' ? columns : inTable;
    const shown = listed.filter(c => columnMatches(c, needle, unitOf));
    const groups = groupColumns(shown);

    const choose = (key, axis) => {
        if (mode === 'dual') onChange({ x: axes?.x ?? null, y: axes?.y ?? null, [axis]: key });
        else onChange(key);
    };

    return (
        <div className="guide-facet-panel">
            {columns.length > 8 && (
                <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Filter fields"
                    aria-label="Filter fields"
                    className="form-input guide-facet-panel-search"
                />
            )}
            <div className="stats-segmented" role="group" aria-label="Fields listed">
                {[['table', 'In the table'], ['all', 'All fields']].map(([key, label]) => (
                    <button
                        key={key}
                        type="button"
                        className={!needle && scope === key ? 'active' : ''}
                        aria-pressed={!needle && scope === key}
                        onClick={() => { setScope(key); setQuery(''); }}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {mode === 'dual' && (
                <span className="text-nano">Pick an X and a Y — numbers only</span>
            )}
            <div className="field-picker-list">
                {groups.map(({ group, columns: inGroup }) => (
                    <Fragment key={group}>
                        <div className="guide-column-group text-nano">{group}</div>
                        {inGroup.map(col => {
                            const unit = unitOf(col);
                            const on = (axis) => (mode === 'dual' ? axes?.[axis] === col.key : value === col.key);
                            const selected = mode === 'dual' ? (on('x') || on('y')) : on();
                            return (
                                <div key={col.key} className={`guide-column-row field-picker-row${selected ? ' is-selected' : ''}`}>
                                    {mode === 'single' ? (
                                        <button
                                            type="button"
                                            className="field-picker-choice"
                                            aria-pressed={selected}
                                            title={col.hint || col.fullLabel || col.label}
                                            onClick={() => choose(col.key)}
                                        >
                                            <span className="guide-column-name">{col.label}</span>
                                            {unit && <span className="guide-column-unit">{unit}</span>}
                                        </button>
                                    ) : (
                                        <>
                                            <span className="guide-column-name" title={col.hint || col.fullLabel || col.label}>{col.label}</span>
                                            {unit && <span className="guide-column-unit">{unit}</span>}
                                            {['x', 'y'].map(axis => (
                                                <button
                                                    key={axis}
                                                    type="button"
                                                    className={`field-picker-axis${on(axis) ? ' active' : ''}`}
                                                    aria-pressed={on(axis)}
                                                    aria-label={`${col.label} on the ${axis.toUpperCase()} axis`}
                                                    onClick={() => choose(col.key, axis)}
                                                >
                                                    {axis.toUpperCase()}
                                                </button>
                                            ))}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </Fragment>
                ))}
                {groups.length === 0 && (
                    <div className="guide-column-divider text-nano">
                        {needle ? `No fields match “${needle}”` : 'No fields'}
                    </div>
                )}
            </div>
            <span className="text-nano">{shown.length} of {columns.length} fields</span>
        </div>
    );
}
