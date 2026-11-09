import { useCallback } from 'react';
import { createTrace } from '../../utils/calcTrace';
import { metricEntries, brakingGEntries } from '../../utils/performanceCompare';
import { vehicleLabel } from '../../utils/specHelpers';
import ShowTheMath from './ShowTheMath';
import MathPass from './MathPass';

const EMPTY_BUCKET = { sessions: [], summaries: [] };

/**
 * "Show the math" for Performance › Compare: one vehicle's bars in one chart,
 * by the same call the chart makes (performanceCompare.js), with the reader's
 * metric, source type and braking mode.
 *
 * Props:
 *   data       the page's loaded sessions and summaries, by vehicle id
 *   selected   the selected vehicles
 *   categories the page's charts (accel, drag, passing, braking)
 *   metricFor  (category, default) => the metric key the chart shows
 *   origin, brakingMode  as the page has them
 */
function PerformanceMathBody({ data, selected, categories, metricFor, origin, brakingMode }) {
    // One pass per chart and vehicle with something to show, run the page's way.
    const passes = [];
    for (const cat of categories) {
        const isBrakingG = cat.key === 'braking' && brakingMode === 'g';
        const metricKey = isBrakingG ? null : metricFor(cat.key, cat.defaultMetric);
        if (!isBrakingG && !metricKey) continue;
        for (const v of selected) {
            const bucket = data[v.id] || EMPTY_BUCKET;
            const run = (trace = null) => (isBrakingG
                ? brakingGEntries(bucket, origin, trace)
                : metricEntries(bucket, metricKey, cat.key, origin, trace));
            const entries = run();
            if (!entries.length) continue;
            passes.push({ id: `${cat.key}:${v.id}`, label: `${cat.title} · ${vehicleLabel(v)}`, run, entries, metricKey, isBrakingG });
        }
    }
    // metricFor is a fresh function each render; the passes are keyed by what they show.
    const key = passes.map(p => `${p.id}=${p.metricKey}`).join(',');
    const buildTrace = useCallback((id) => {
        const p = passes.find(x => x.id === id);
        const trace = createTrace();
        trace.note(p.isBrakingG ? 'Braking in g: every braking window, ranked together' : `Metric: ${p.metricKey}`);
        p.run(trace);
        return {
            trace,
            summary: `Chart: ${p.entries.map(e => `${e.display}${e.badge ? ` (${e.badge})` : ''} · ${e.sourceName}`).join('; ')}`,
        };
    }, [key, origin, data]); // eslint-disable-line react-hooks/exhaustive-deps -- `passes` is keyed by `key`
    return (
        <MathPass
            intro="One vehicle's bars in one chart, worked out by the chart's own code: the best run per source, and the badge beside it."
            options={passes.map(p => ({ id: p.id, label: p.label }))}
            buildTrace={buildTrace}
        />
    );
}

export default function PerformanceMath(props) {
    return <ShowTheMath Body={PerformanceMathBody} {...props} />;
}
