import SortHeader from '../tables/SortHeader';
import TableCell from '../tables/TableCell';
import VehicleCardPopover from './VehicleCardPopover';
import { useNavigation } from '../../context/NavigationContext';
import { cellUnit } from '../../utils/tableColumns';
import { testHref } from '../../utils/testDetails';
import { platformHref } from '../../utils/platforms';
import { vehicleColor } from '../../utils/specHelpers';
import { unitFor, formatVehicleCell, vehicleBarPercent } from '../../utils/vehicleTable';

/*
 * The vehicle table's grid: its header row and its rows, drawn from rows that
 * are already built. Two tables draw it — the live one on Vehicles & Specs
 * (VehicleTable), which owns the state, the selection and the URL, and the
 * read-only one on Home (PresentedVehicleTable, #448), which owns none of them.
 * One grid keeps them the same table: a column, a unit or a note changed here
 * changes in both.
 */

/** One vehicle. Rendered by the selected band and the body from the same component. */
function VehicleTableRow({ row, cols, units, maxima, selected, selectable = true, onToggle, onOpen, onOpenTest, onViewRuns, performanceCounts }) {
    const { openPlatform } = useNavigation();
    return (
        <tr className={`guide-row${selected ? ' selected' : ''}`} data-row-id={row.id} onClick={() => onOpen?.(row.vehicle)}>
            {selectable && (
                <td className="guide-td guide-td-select sticky-select" onClick={e => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggle(row.id)}
                        aria-label={selected ? `Remove ${row.values.name} from the selection` : `Add ${row.values.name} to the selection`}
                    />
                </td>
            )}
            {cols.map(col => {
                // An asterisk on the tested range where its peek has a when-new
                // range to justify it (whenNewRange: only a pack well down).
                const text = formatVehicleCell(row, col, units);
                // The asterisk closes the figure, unit included: "512 mi*".
                const mark = col.key === 'tested.range_mi' && row.whenNew ? '*' : '';
                if (col.key === 'name') {
                    return (
                        // The name TEXT opens the vehicle's card in a popover; the
                        // rest of the cell — the margin around it and the swatch —
                        // selects, like the checkbox beside it, so the row's
                        // biggest target still does what it always did. Every other
                        // cell opens View Specs.
                        <TableCell
                            key={col.key}
                            className="sticky-name"
                            restate={text + mark}
                            onClick={selectable ? (e) => { e.stopPropagation(); onToggle(row.id); } : undefined}
                        >
                            <span className="vehicle-table-name">
                                {/* The vehicle's series color, so a row ties to the
                                    same vehicle on every chart. */}
                                <span className="series-swatch" style={{ backgroundColor: vehicleColor(row.vehicle, row.index) }} aria-hidden="true" />
                                {selectable ? (
                                    <VehicleCardPopover
                                        vehicle={row.vehicle}
                                        units={units}
                                        performanceCounts={performanceCounts}
                                        selected={selected}
                                        onViewRuns={onViewRuns}
                                        onViewSpecs={onOpen}
                                        onOpenTest={onOpenTest}
                                    >
                                        <span className="guide-cell-name">{text}</span>
                                    </VehicleCardPopover>
                                ) : (
                                    // A read-only table has no card to open, and a click on the
                                    // name does what a click on the row does.
                                    <span className="guide-cell-name">{text}</span>
                                )}
                            </span>
                        </TableCell>
                    );
                }
                return (
                    <TableCell
                        key={col.key}
                        numeric={col.numeric}
                        text={text}
                        unit={col.numeric ? cellUnit(unitFor(col, units), row.values[col.key]) : null}
                        mark={mark}
                        pct={vehicleBarPercent(row, col, maxima)}
                        note={row.notes[col.key]}
                        flagged={row.flagged.has(col.key)}
                        test={testLink(row.tests[col.key], onOpenTest)}
                        testKey={col.key}
                        link={platformNoteLink(row.links?.[col.key], openPlatform)}
                    />
                );
            })}
        </tr>
    );
}

/**
 * A cell's test as TableCell links it: the href always, and an in-app open
 * where the table has one. The pop-out window has none — it holds only the
 * table — so there a click opens the test in a new tab instead.
 */
/** A "from <platform>" note as TableCell links it (#354). */
function platformNoteLink(link, openPlatform) {
    if (link?.platformId == null) return null;
    return { href: platformHref(link.platformId), onOpen: openPlatform ? () => openPlatform(link.platformId) : null };
}

function testLink(ref, onOpenTest) {
    if (!ref) return null;
    return { href: testHref(ref), onOpen: onOpenTest ? () => onOpenTest(ref) : null };
}


/**
 * @param {Array}  cols        the columns, labelled (labelledColumn)
 * @param {{ key, dir, onSort }|null} sort   null: headers do not sort and show no caret
 * @param {{ dragProps, dragClass }|null} drag   null: headers do not drag
 * @param {{ enabled, onPlot }|null} plot   null: headers carry no chart icon (#450)
 * @param {boolean} selectable  a checkbox column and a selected band; false for a read-only table
 * @param {Array}  selectedRows  the selected band, above the body
 * @param {Array}  bodyRows
 * @param {object} rowProps     handed to every row (cols, units, maxima, handlers)
 * @param {object} [peekProps]  the cell peek's table props (useCellPeek)
 * @param {*}      [peek]       the cell peek's panel, drawn after the table
 */
export default function VehicleTableGrid({
    cols, sort = null, drag = null, plot = null, selectable = true,
    selectedRows = [], bodyRows, rowProps, peekProps = {}, peek = null, emptyText = '',
}) {
    const span = cols.length + (selectable ? 1 : 0);
    return (
        <div className="guide-table-container">
            <table className={`guide-table${selectable ? '' : ' is-read-only'}`} {...peekProps}>
                <thead>
                    <tr>
                        {selectable && <th className="guide-th guide-th-select sticky-select" />}
                        {cols.map(col => (
                            <SortHeader key={col.key} col={col} sortKey={sort?.key ?? null} sortDir={sort?.dir} onSort={sort?.onSort ?? null}
                                dragProps={drag?.dragProps(col.key)} dragClass={drag?.dragClass(col.key)} reorderHint={!!drag && col.sticky}
                                plot={plot && col.key !== 'name' ? plot : null} />
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {selectable && selectedRows.length > 0 && (
                        <>
                            <tr className="vehicle-table-band">
                                <td colSpan={span}>
                                    <div className="guide-band-content">
                                        <span className="text-nano">Selected · {selectedRows.length}</span>
                                        <span className="text-note">maintained site-wide, at the top</span>
                                    </div>
                                </td>
                            </tr>
                            {selectedRows.map(row => (
                                <VehicleTableRow key={`selected-${row.id}`} row={row} selected {...rowProps} />
                            ))}
                            <tr className="vehicle-table-band-spacer"><td colSpan={span} /></tr>
                        </>
                    )}
                    {bodyRows.map(row => (
                        <VehicleTableRow key={row.id} row={row} selected={false} selectable={selectable} {...rowProps} />
                    ))}
                </tbody>
            </table>
            {peek}
            {bodyRows.length === 0 && selectedRows.length === 0 && (
                <div className="empty-state">{emptyText}</div>
            )}
        </div>
    );
}
