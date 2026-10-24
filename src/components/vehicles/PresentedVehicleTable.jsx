import { useCallback, useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import VehicleTableGrid from './VehicleTableGrid';
import { sessionFor } from '../../utils/testSessions';
import { groupPerformanceByVehicle } from '../../utils/dataChecks';
import { vehiclesInOrder } from '../../utils/featuredComparisons';
import {
    decodeVehicleTableParams, buildVehicleRows, vehicleColumnByKey, labelledColumn,
    needsPerformance, vehicleBarMaxima,
} from '../../utils/vehicleTable';

/**
 * The vehicle table as a featured comparison shows it on Home (#448): the
 * comparison's vehicles, in the comparison's order, under the columns and
 * assumptions its curator saved. Read-only.
 *
 * It is the live table's grid (VehicleTableGrid) with none of its state. The live
 * table reads the address and the reader's remembered columns when it opens, and
 * writes both back as it changes; a table on Home must do neither, or drawing
 * one would rewrite Home's own address and overwrite whatever the reader had set
 * on the real table. So everything here comes from props: the saved settings as
 * the `vt_` parameters they were saved in, decoded with no memory to fall back
 * on, and the correction the comparison chose.
 *
 * No checkboxes, no filters, no pickers and no sorting. A click on a row calls
 * `onOpen`: the panel's whole point is to open the table, and the table scrolls
 * sideways on its own, which a transparent cover over it would prevent. A saved table's rows
 * are the comparison's vehicles in the curator's order (sorting the live table
 * already reorders the selection, so a curator who sorted before saving has that
 * order here). Opening the table opens the live one, with the same vehicles
 * selected at the top.
 */
export default function PresentedVehicleTable({ vehicleIds, search, correctionTarget, correctionMode, onOpen = null }) {
    const { vehicles, units, platformsById, testSessions, getPerformanceSummaries, getPerformanceSessions } = useAppContext();

    const { columns, assumptions } = useMemo(() => decodeVehicleTableParams(search), [search]);
    const ordered = useMemo(() => vehiclesInOrder(vehicleIds, vehicles), [vehicleIds, vehicles]);

    // Tested results only for these vehicles, and only while a tested column is shown.
    const wantsPerformance = needsPerformance(columns);
    const idsKey = ordered.map(v => v.id).join(',');
    const loadPerformance = useCallback(async () => {
        if (!wantsPerformance || !idsKey) return null;
        const ids = idsKey.split(',').map(id => (isNaN(Number(id)) ? id : Number(id)));
        const [summaries, sessions] = await Promise.all([getPerformanceSummaries(ids), getPerformanceSessions(ids)]);
        return groupPerformanceByVehicle(summaries ?? [], sessions ?? []);
        // Keyed on the ids, as the live table's is: every save hands back a new array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wantsPerformance, idsKey]);
    const { data: performance, loading } = useAsyncResource(loadPerformance, [loadPerformance]);

    const rows = useMemo(() => {
        const all = buildVehicleRows(vehicles, {
            performance, assumptions, units, platformsById, correctionTarget, correctionMode,
            sessionOf: r => sessionFor(testSessions, r),
        });
        const byId = new Map(all.map(r => [String(r.id), r]));
        return ordered.map(v => byId.get(String(v.id))).filter(Boolean);
    }, [vehicles, performance, assumptions, units, platformsById, testSessions, correctionTarget, correctionMode, ordered]);

    const cols = useMemo(
        () => columns.map(vehicleColumnByKey).filter(Boolean)
            .map(col => labelledColumn(col, assumptions, units, correctionTarget, correctionMode)),
        [columns, assumptions, units, correctionTarget, correctionMode],
    );
    const maxima = useMemo(() => vehicleBarMaxima(rows, cols), [rows, cols]);

    return (
        <div className="vehicle-table">
            {wantsPerformance && loading && <span className="text-meta">loading tested results…</span>}
            <VehicleTableGrid
                cols={cols}
                selectable={false}
                bodyRows={rows}
                rowProps={{ cols, units, maxima, onOpen }}
                emptyText="None of this comparison's vehicles are available any more."
            />
        </div>
    );
}
