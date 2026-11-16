import { useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { createTrace } from '../../utils/calcTrace';
import { sessionFor } from '../../utils/testSessions';
import { traceVehicleRow, isTracedColumn, vehicleColumnByKey, formatVehicleCell } from '../../utils/vehicleTable';
import ShowTheMath from './ShowTheMath';
import MathPass from './MathPass';

/**
 * "Show the math" for the vehicle table: one row, rebuilt by the table's own
 * row builder (traceVehicleRow) with the reader's assumptions and correction,
 * tracing the worked-out columns the reader shows.
 *
 * Under the table, not in a cell: a column has no help bubble, and a control
 * in every row would cost every row. One closed section, a picker for the row.
 *
 * Props:
 *   selectedRows, bodyRows  the table's rows, in its order (the picker's list)
 *   columns    the shown column keys
 *   selectedIds  the selected vehicles, the first of which is picked first
 *   performance, assumptions, correctionTarget, correctionMode  as the table builds with
 */
function TableMathBody({ selectedRows, bodyRows, columns, selectedIds, performance, assumptions, correctionTarget, correctionMode }) {
    const { vehicles, units, platformsById, testSessions } = useAppContext();
    const rows = [...selectedRows, ...bodyRows];
    const traced = columns.filter(isTracedColumn);
    const tracedKey = traced.join(',');
    const options = rows.map(r => ({ id: r.id, label: r.values.name }));
    const buildTrace = useCallback((id) => {
        const vehicle = vehicles.find(v => v.id === id);
        const trace = createTrace();
        traceVehicleRow(vehicle, vehicles, {
            performance, assumptions, units, platformsById, correctionTarget, correctionMode,
            sessionOf: r => sessionFor(testSessions, r),
        }, { trace, columns: traced });
        // The table's own cells for this row, to check the trace against.
        const row = rows.find(r => r.id === id);
        const cells = traced.map(k => {
            const col = vehicleColumnByKey(k);
            return `${col.label} ${formatVehicleCell(row, col, units)}`;
        });
        return { trace, summary: `Table: ${cells.join(' · ')}` };
    }, [vehicles, rows, tracedKey, performance, assumptions, units, platformsById, correctionTarget, correctionMode, testSessions]); // eslint-disable-line react-hooks/exhaustive-deps -- `traced` is keyed by its contents
    if (!traced.length) {
        return <p className="text-note">None of the shown columns is worked out here. Add a tested range column or a calculated one (Efficiency, % of EPA hwy, Cost/100 mi…) to see its math.</p>;
    }
    return (
        <MathPass
            intro="One row, rebuilt by the table's own code with your assumptions and correction, for the worked-out columns you show. Figures in miles; the table converts to your units after."
            options={options}
            buildTrace={buildTrace}
            initialId={selectedIds.find(id => rows.some(r => r.id === id)) ?? null}
        />
    );
}

export default function TableMath(props) {
    return <ShowTheMath Body={TableMathBody} {...props} />;
}
