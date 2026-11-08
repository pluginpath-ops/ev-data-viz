import { useCallback } from 'react';
import { createTrace } from '../../utils/calcTrace';
import { correctRunDistance, correctionNote } from '../../utils/conditionCorrection';
import { fullPackRange } from '../../utils/fullPackRange';
import { correctionCaption } from '../../utils/correctionSettings';
import { sessionFor } from '../../utils/testSessions';
import ShowTheMath from './ShowTheMath';

/**
 * "Show the math" for the Range chart: one plotted test, corrected and turned
 * into its bar, by the same two calls the chart makes (correctRunDistance,
 * then fullPackRange on the corrected test), with the reader's correction.
 *
 * PROTOTYPE (2026-11-08).
 *
 * Props:
 *   plotted   the chart's plotted runs (each carries `vehicle` and `vehicleName`)
 *   mode, target  the reader's correction
 *   testSessions  for the conditions a run leaves to its session
 */
export default function RangeMath({ plotted, mode, target, testSessions }) {
    const options = plotted.map(p => ({
        id: p.id,
        label: `${p.vehicleName} · ${p.name ?? `test ${p.id}`}${p.speed_mph != null ? ` · ${p.speed_mph} mph` : ''}${p.temperature_f != null ? ` · ${p.temperature_f}°F` : ''}`,
    }));
    const buildTrace = useCallback((id) => {
        const entry = plotted.find(p => p.id === id);
        // The test as stored, not the chart's corrected copy.
        const run = entry.vehicle.runs.find(r => r.id === id) ?? entry;
        const trace = createTrace();
        trace.note(`Correction: ${correctionCaption(mode, target)}`);
        const { result, distanceMiles } = correctRunDistance(run, sessionFor(testSessions, run), { mode, target }, trace);
        const range = fullPackRange({ ...run, distance_miles: distanceMiles }, entry.vehicle, trace.group('The bar: range on a full pack'));
        const note = correctionNote(result);
        return {
            trace,
            summary: `Range bar: ${range ? Math.round(range.mi) : '—'} mi${note ? ` · tooltip: ${note}` : ' · not corrected'}`,
        };
    }, [plotted, mode, target, testSessions]);
    return (
        <ShowTheMath
            intro="Range and efficiency both scale with the corrected distance, so one factor moves every chart type. Figures in miles; the chart converts to your units after."
            options={options}
            buildTrace={buildTrace}
        />
    );
}
