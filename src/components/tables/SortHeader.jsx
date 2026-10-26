import { nameLines } from '../../utils/tableColumns';

/** What a disabled chart icon says, and the hint beside the table when nothing is selected. */
export const PLOT_NEEDS_SELECTION = 'Select vehicles to plot';

/**
 * A sortable column header, shared by the FE Guide table and the vehicle table
 * (#315 extracts the mechanisms both tables want, not one table for both).
 *
 * The header is the NAME and nothing else, wrapping to two lines. The unit is
 * not here: every cell states its own beside the figure (TableCell), so a
 * screenshot with the header cropped away still reads, and a header that said
 * it too would say it twice. A name too long even for two lines carries a
 * shorter `label` (a spec's `tableLabel`) and its `fullLabel` in the tooltip.
 *
 * A `qualified` column's name ("Composite range, 70 mph") breaks after its comma
 * and sets the qualifier whole on its own line (tableColumns.js nameLines), so a
 * short tail never orphans as "70 / mph".
 *
 * `col.holds` sets the column's width by what it holds (see vehicleTable.js).
 *
 * With no `onSort` the header is a plain label: no click, no sort caret, no
 * "sort by" promise. The read-only table on Home draws headers this way (#448).
 *
 * `plot` ({ enabled, onPlot }) puts a small chart icon beside the name: the click
 * target that opens THIS column plotted in the spec chart (#450). It is its own
 * button, so the header's click still sorts and its drag still reorders; with
 * no vehicle selected it is disabled and says why, since the chart plots only
 * the selected vehicles.
 *
 * `dragProps`/`dragClass` come from hooks/useColumnDrag and make the header a
 * handle on the column order — the same list the column picker drags. A drag
 * fires no click, so moving a column never re-sorts by it.
 *
 * `reorderHint` (the pinned name header, in both tables) says "drag to reorder
 * columns" at the cell's right edge, in the same `.text-nano` role as the column
 * picker's "Shown · drag to reorder". It floats (`.guide-th-reorder`), so it adds
 * no height and cannot wrap or push the name; a phone has no drag, and hides it.
 */
export default function SortHeader({ col, sortKey, sortDir, onSort, dragProps, dragClass = '', reorderHint = false, plot = null }) {
    const active = sortKey === col.key;
    // "Composite range, 70 mph" breaks after the comma, the qualifier whole beneath.
    const [head, qualifier] = col.qualified ? nameLines(col.label) : [col.label, null];
    return (
        <th
            className={`guide-th column-header ${col.numeric ? 'numeric' : ''} ${active ? 'active' : ''} ${col.sticky ? 'sticky-name' : ''} ${col.holds ?? ''} ${dragClass}`}
            {...dragProps}
            onClick={onSort ? () => onSort(col.key) : undefined}
            // The drag hint goes LAST, on its own line, and only where the
            // header really drags — the fixed column would promise a move it
            // refuses.
            title={[col.hint || (onSort ? `Sort by ${col.fullLabel ?? col.label}` : (col.fullLabel ?? col.label)), dragProps?.draggable && 'Drag to reorder']
                .filter(Boolean).join('\n')}
            aria-sort={onSort ? (active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
        >
            <span className="guide-th-name">
                {head}{qualifier && <><br />{qualifier}</>}
                <span className="guide-sort-caret">{active ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                {plot && (
                    <button
                        type="button"
                        className="column-plot-button"
                        disabled={!plot.enabled}
                        aria-label={`Plot ${col.fullLabel ?? col.label}`}
                        title={plot.enabled ? `Plot ${col.fullLabel ?? col.label} for the selected vehicles` : PLOT_NEEDS_SELECTION}
                        // Not the header's click: that sorts.
                        onClick={e => { e.stopPropagation(); plot.onPlot(col.key); }}
                    >
                        <svg viewBox="0 0 12 12" width="1em" height="1em" aria-hidden="true" focusable="false">
                            <rect x="1" y="6" width="2.4" height="5" rx="0.6" fill="currentColor" />
                            <rect x="4.8" y="2" width="2.4" height="9" rx="0.6" fill="currentColor" />
                            <rect x="8.6" y="4.5" width="2.4" height="6.5" rx="0.6" fill="currentColor" />
                        </svg>
                    </button>
                )}
            </span>
            {reorderHint && <span className="text-nano guide-th-reorder">drag to reorder columns</span>}
        </th>
    );
}
