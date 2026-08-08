import { useMemo, useRef } from 'react';
import { resolveChartColors } from '../utils/colorUtils';

/**
 * Auto-assigned chart colours that stay put.
 *
 * resolveChartColors assigns Okabe-Ito slots across the whole set at once, so
 * adding or removing one run re-solved every other run and the chart's colours
 * shuffled underneath you. Reading a chart you had already made sense of meant
 * re-reading the legend.
 *
 * This remembers what each run was given and feeds those back in as session
 * overrides, which resolveChartColors treats as highest priority AND adds to its
 * collision list — so a newly added run picks a slot that avoids the colours
 * already on screen, and everything already plotted keeps what it had.
 *
 * Colours are ADDED, never reshuffled. They reset only when:
 *   • the vehicle set changes  — a different comparison, so a fresh palette
 *   • Auto Color is switched off and back on — the explicit "redo this" gesture
 *
 * A removed run keeps its remembered colour, so toggling one off and on again
 * returns it to the same colour rather than moving it to the end of the queue.
 *
 * @param {Array}   runs      the runs to colour
 * @param {Object}  opts
 * @param {boolean} opts.autoColor  auto mode on/off
 * @param {string}  opts.resetKey   changes when the vehicle set changes
 */
export function useStickyChartColors(runs, { autoColor, resetKey }) {
    const assigned = useRef({});          // runId → colour, sticky for the session
    const prevResetKey = useRef(resetKey);
    const prevAutoColor = useRef(autoColor);

    return useMemo(() => {
        const cycledBackOn = autoColor && !prevAutoColor.current;
        if (resetKey !== prevResetKey.current || cycledBackOn) {
            assigned.current = {};
        }
        prevResetKey.current = resetKey;
        prevAutoColor.current = autoColor;

        // Only auto mode is sticky. Manual mode already honours each run's own
        // stored colour, so there is nothing to hold still.
        if (!autoColor) {
            assigned.current = {};
            return resolveChartColors(runs, {}, 'manual');
        }

        const resolved = resolveChartColors(runs, assigned.current, 'auto');
        // Remember, so the next call holds these in place. Idempotent: React may
        // run a memo more than once, and re-merging the same answer changes
        // nothing — unlike a mutation whose result depends on not having run yet.
        assigned.current = { ...assigned.current, ...resolved };
        return resolved;
    }, [runs, autoColor, resetKey]);
}
