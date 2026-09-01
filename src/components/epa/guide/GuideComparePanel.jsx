import { Fragment } from 'react';
import { GUIDE_COLUMNS, COLUMN_GROUPS, formatCell } from '../../../utils/feGuideBrowse';

/**
 * Side-by-side comparison of the checked configurations (#235).
 *
 * This is the answer to "build virtual vehicles so the data can be compared":
 * for label figures the comparison IS a table, and no synthetic entity is needed
 * to render one. Same column vocabulary as the browser and the detail view.
 *
 * Rows where every selected configuration agrees are hidden behind a toggle. On
 * two trims of one car most of the 30 fields are identical, and a reader
 * scanning for what differs should not have to find it among two dozen rows
 * that do not.
 */
function differs(rows, col) {
    const vals = rows.map(r => r?.[col.key] ?? null);
    return vals.some(v => String(v) !== String(vals[0]));
}

export default function GuideComparePanel({ rows, showAll, onToggleShowAll, onClear, onRemove }) {
    if (rows.length === 0) return null;

    const groups = COLUMN_GROUPS.map(group => ({
        group,
        cols: GUIDE_COLUMNS
            .filter(c => c.group === group)
            .filter(c => showAll || differs(rows, c)),
    })).filter(g => g.cols.length > 0);

    const sameCount = GUIDE_COLUMNS.filter(c => !differs(rows, c)).length;

    return (
        <div className="guide-compare">
            <div className="section-header">
                <div className="section-header-title">
                    Comparing {rows.length} configuration{rows.length === 1 ? '' : 's'}
                </div>
                <div className="section-header-actions">
                    {sameCount > 0 && (
                        <button type="button" className="section-action" onClick={onToggleShowAll}>
                            {showAll ? `Hide ${sameCount} identical` : `Show ${sameCount} identical`}
                        </button>
                    )}
                    <button type="button" className="section-action" onClick={onClear}>Clear</button>
                </div>
            </div>

            <div className="guide-table-container">
                <table className="guide-table guide-compare-table">
                    <thead>
                        <tr>
                            <th className="guide-th">Field</th>
                            {rows.map(r => (
                                <th key={r.id} className="guide-th">
                                    <div className="guide-compare-head">
                                        <span>{r.carline}</span>
                                        <button
                                            type="button"
                                            className="guide-compare-remove"
                                            onClick={() => onRemove(r.id)}
                                            aria-label={`Remove ${r.carline}`}
                                        >
                                            ×
                                        </button>
                                    </div>
                                    <div className="text-note">{r.model_year} {r.division}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {groups.map(({ group, cols }) => (
                            <Fragment key={group}>
                                <tr>
                                    <td className="guide-td guide-compare-group" colSpan={rows.length + 1}>
                                        {group}
                                    </td>
                                </tr>
                                {cols.map(col => (
                                    <tr key={col.key} className="guide-compare-row">
                                        <td className="guide-td guide-compare-field" title={col.hint || ''}>
                                            {col.label}{col.unit ? ` (${col.unit})` : ''}
                                        </td>
                                        {rows.map(r => (
                                            <td key={r.id} className={`guide-td ${col.numeric ? 'numeric' : ''}`}>
                                                {formatCell(r, col)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
