/**
 * A sortable column header, shared by the FE Guide table and the vehicle table
 * (#315 extracts the mechanisms both tables want, not one table for both).
 *
 * The name carries the weight and wraps to two lines; the unit sits under it
 * rather than competing with it on the same line. A header with no unit gives
 * that line to its name instead, so "Ultrasonic Sensors" wraps rather than
 * clipping beside an empty line. A name too long even for two lines carries a
 * shorter `label` and its `fullLabel` in the tooltip.
 *
 * `col.holds` sets the column's width by what it holds (see vehicleTable.js).
 *
 * `unit` defaults to the column's own; the vehicle table passes one converted
 * to the reader's unit system.
 *
 * `dragProps`/`dragClass` come from hooks/useColumnDrag and make the header a
 * handle on the column order — the same list the column picker drags. A drag
 * fires no click, so moving a column never re-sorts by it.
 */
export default function SortHeader({ col, sortKey, sortDir, onSort, unit = col.unit, dragProps, dragClass = '' }) {
    const active = sortKey === col.key;
    return (
        <th
            className={`guide-th ${col.numeric ? 'numeric' : ''} ${active ? 'active' : ''} ${col.sticky ? 'sticky-name' : ''} ${col.holds ?? ''} ${dragClass}`}
            {...dragProps}
            onClick={() => onSort(col.key)}
            // The drag hint goes LAST, on its own line, and only where the
            // header really drags — the fixed column would promise a move it
            // refuses.
            title={[col.hint || `Sort by ${col.fullLabel ?? col.label}`, dragProps?.draggable && 'Drag to reorder']
                .filter(Boolean).join('\n')}
            aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            <span className={`guide-th-name ${unit ? '' : 'wraps'}`}>
                {col.label}
                <span className="guide-sort-caret">{active ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
            </span>
            {unit && <span className="guide-th-unit">{unit}</span>}
        </th>
    );
}
