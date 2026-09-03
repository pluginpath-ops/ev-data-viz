import { GUIDE_COLUMNS, formatCell, barPercent } from '../../../utils/feGuideBrowse';

/**
 * The browse table (#235).
 *
 * Presentation only — every row it receives has already been filtered, sorted
 * and paged by the view. Keeping it dumb is what lets the compare panel and the
 * detail modal read from the same decorated rows without a second source of
 * truth about what a column means.
 *
 * ── Two sticky columns ──────────────────────────────────────────────────────
 *
 * Thirty columns do not fit, so the table scrolls sideways — and a sideways
 * scroll that takes the configuration name with it leaves rows of numbers
 * belonging to nothing. The checkbox and the name are therefore pinned, which
 * also means the compare checkbox stays reachable at any scroll position
 * instead of only at the far left.
 *
 * Pinning needs `border-collapse: separate` (collapsed borders do not render on
 * sticky cells) and opaque backgrounds on the pinned cells, so the row's own
 * hover and selected colours are re-applied to them in CSS rather than
 * inherited.
 */
function SortHeader({ col, sortKey, sortDir, onSort }) {
    const active = sortKey === col.key;
    return (
        <th
            className={`guide-th ${col.numeric ? 'numeric' : ''} ${active ? 'active' : ''} ${col.sticky ? 'sticky-name' : ''}`}
            onClick={() => onSort(col.key)}
            title={col.hint || `Sort by ${col.label}`}
            aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            {/* Two lines: the name carries the weight, the unit sits under it
                rather than competing with it on the same line. The unit line is
                always rendered so every header is the same height — a ragged
                header row is harder to scan than a slightly taller one. */}
            <span className="guide-th-name">
                {col.label}
                <span className="guide-sort-caret">{active ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
            </span>
            <span className="guide-th-unit">{col.unit ?? ' '}</span>
        </th>
    );
}

export default function GuideTable({
    rows, visibleColumns, sortKey, sortDir, onSort,
    selectedIds, onToggleSelect, onOpenRow, vehicleLinks, barMaxima,
}) {
    const cols = GUIDE_COLUMNS.filter(c => visibleColumns.includes(c.key));

    return (
        <div className="guide-table-container">
            <table className="guide-table">
                <thead>
                    <tr>
                        <th className="guide-th guide-th-select sticky-select" />
                        {cols.map(col => (
                            <SortHeader key={col.key} col={col} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const vehicles = vehicleLinks[row.id]?.vehicles ?? [];
                        return (
                            <tr
                                key={row.id}
                                className={`guide-row ${selectedIds.includes(row.id) ? 'selected' : ''}`}
                                onClick={() => onOpenRow(row)}
                            >
                                <td className="guide-td guide-td-select sticky-select" onClick={e => e.stopPropagation()}>
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.includes(row.id)}
                                        onChange={() => onToggleSelect(row.id)}
                                        aria-label={`Compare ${row.carline}`}
                                    />
                                </td>
                                {cols.map((col) => {
                                    const pct = barPercent(row, col, barMaxima);
                                    return (
                                        <td
                                            key={col.key}
                                            className={`guide-td ${col.numeric ? 'numeric' : ''} ${col.sticky ? 'sticky-name' : ''} ${pct != null ? 'has-bar' : ''}`}
                                            style={pct != null ? { '--bar-fill': `${pct}%` } : undefined}
                                        >
                                            {col.key === 'carline' ? (
                                                <span className="guide-carline">
                                                    <span className="guide-carline-name">{row.carline}</span>
                                                    {/* Badges ride on the name rather than holding columns of
                                                        their own — at 30 columns the horizontal budget is the
                                                        scarce one. */}
                                                    {vehicles.length > 0 && (
                                                        <span
                                                            className="guide-badge guide-badge-tested"
                                                            title={`We hold test data for ${vehicles.map(v => `${v.year} ${v.name}`).join(', ')}`}
                                                        >
                                                            tested
                                                        </span>
                                                    )}
                                                    {row.is_collapsed && (
                                                        <span
                                                            className="guide-badge guide-badge-multi"
                                                            title="EPA collapsed several configurations into this row — its motor count and power are a union, not one vehicle"
                                                        >
                                                            multi
                                                        </span>
                                                    )}
                                                </span>
                                            ) : pct != null ? (
                                                /* The value, then its bar beneath
                                                   it. It used to be painted as a
                                                   cell BACKGROUND — cheaper in
                                                   DOM, but a wash behind a number
                                                   reads as a highlight rather than
                                                   as a measurement, and it could
                                                   not be given a track. */
                                                <span className="guide-cell-stack">
                                                    <span>{formatCell(row, col)}</span>
                                                    <span
                                                        className="guide-spark"
                                                        style={{ '--bar-fill': `${pct}%` }}
                                                        aria-hidden="true"
                                                    />
                                                </span>
                                            ) : formatCell(row, col)}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {rows.length === 0 && (
                <div className="empty-state">No configurations match these filters.</div>
            )}
        </div>
    );
}
