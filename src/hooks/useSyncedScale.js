import { createContext, useContext, useEffect } from 'react';

/**
 * Axis limits for a chart that keeps them in its own state (#259).
 *
 * The pop-out draws a chart with no controls, so a limit set in the main tab
 * never reached it: Performance, Range & Efficiency and Road Trip each hold
 * their limits locally, and the pop-out always drew on auto scale.
 *
 * Charts that keep their limits in synced config (Charging Curves, Modeled
 * Efficiency) do not need this. The one chart on screen reports its limits up
 * through `report`; App broadcasts them on the existing channel and hands them
 * to the pop-out as `synced`. Exactly one of the two is set, depending on which
 * window this is.
 */
export const ScaleSyncContext = createContext({ synced: null, report: null });

/**
 * @param {{ xMin, xMax, yMin, yMax }} own  the limits this chart holds itself
 * @returns {{ xMin, xMax, yMin, yMax }}   the limits to DRAW with: the other
 *   window's in a pop-out that has received them, otherwise `own`
 */
export function useSyncedScale(own) {
    const { synced, report } = useContext(ScaleSyncContext);

    // Keyed on the serialised limits so a new object with the same numbers does
    // not report again.
    const key = JSON.stringify(own);
    useEffect(() => {
        if (report) report(JSON.parse(key));
    }, [key, report]);
    // Closing the chart clears it, so a pop-out does not keep drawing the
    // previous chart's limits on the next one.
    useEffect(() => () => { report?.(null); }, [report]);

    return synced ?? own;
}
