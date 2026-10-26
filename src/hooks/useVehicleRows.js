import { useCallback, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { useAsyncResource } from './useAsyncResource';
import { sessionFor } from '../utils/testSessions';
import { groupPerformanceByVehicle } from '../utils/dataChecks';
import { DEFAULT_CORRECTION_TARGET, DEFAULT_READER_MODE } from '../utils/correctionSettings';
import { buildVehicleRows, needsPerformance, DEFAULT_ASSUMPTIONS } from '../utils/vehicleTable';

/**
 * The vehicle table's rows over the whole fleet — the figures a cell shows —
 * for whichever view needs them: the table itself, and the spec chart that
 * plots a column of it (#450).
 *
 * One builder is the point: a chart that worked a figure out its own way would
 * disagree with the cell the reader came from.
 *
 * Tested results are fetched only while one of `keys` is a tested column:
 * sessions carry every run and split, which is the heaviest read here. Pass
 * every column key the view reads (shown, sorted by, plotted).
 */
export function useVehicleRows({
    keys = [], assumptions = DEFAULT_ASSUMPTIONS,
    correctionTarget = DEFAULT_CORRECTION_TARGET, correctionMode = DEFAULT_READER_MODE,
}) {
    const {
        vehicles, units, platformsById, testSessions, getPerformanceSummaries, getPerformanceSessions,
    } = useAppContext();

    const wantsPerformance = needsPerformance(keys);
    const idsKey = vehicles.map(v => v.id).join(',');
    const loadPerformance = useCallback(async () => {
        if (!wantsPerformance || !idsKey) return null;
        const ids = vehicles.map(v => v.id);
        const [summaries, sessions] = await Promise.all([getPerformanceSummaries(ids), getPerformanceSessions(ids)]);
        return groupPerformanceByVehicle(summaries ?? [], sessions ?? []);
        // Keyed on the ids, not the fleet array: every save hands back a new
        // array, and refetching every run after each edit elsewhere is waste.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wantsPerformance, idsKey]);
    const { data: performance, loading: performanceLoading } = useAsyncResource(loadPerformance, [loadPerformance]);

    // A range test's session supplies the conditions it omits, which the
    // composite range corrects for.
    const rows = useMemo(
        () => buildVehicleRows(vehicles, {
            performance, assumptions, units, platformsById, correctionTarget, correctionMode,
            sessionOf: r => sessionFor(testSessions, r),
        }),
        [vehicles, performance, assumptions, units, platformsById, testSessions, correctionTarget, correctionMode],
    );

    return { rows, performance, wantsPerformance, performanceLoading };
}
