/**
 * A sortable column header, shared by the FE Guide table and the vehicle table
 * (#315 extracts the mechanisms both tables want, not one table for both).
 *
 * Two lines: the name carries the weight, the unit sits under it rather than
 * competing with it on the same line. The unit line is always rendered so every
 * header is the same height — a ragged header row is harder to scan than a
 * slightly taller one.
 *
 * `unit` defaults to the column's own; the vehicle table passes one converted
 * to the reader's unit system.
 */
export default function SortHeader({ col, sortKey, sortDir, onSort, unit = col.unit }) {
    const active = sortKey === col.key;
    return (
        <th
            className={`guide-th ${col.numeric ? 'numeric' : ''} ${active ? 'active' : ''} ${col.sticky ? 'sticky-name' : ''}`}
            onClick={() => onSort(col.key)}
            title={col.hint || `Sort by ${col.label}`}
            aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            <span className="guide-th-name">
                {col.label}
                <span className="guide-sort-caret">{active ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
            </span>
            <span className="guide-th-unit">{unit ?? '\u00A0'}</span>
        </th>
    );
}
