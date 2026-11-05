import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { axisLimitsOf, withAxisLimit, withAxisLimits, defaultAxisLimits } from '../utils/axisLimits';

/**
 * The one door every chart's axis limits go through (#478).
 *
 * Limits live in `chartConfig.axisLimits` (utils/axisLimits.js), which is what
 * the pop-out broadcasts, a featured comparison's panel draws from and the chart
 * link writes. A chart's view asks for its own by key and gets the same three
 * things whichever chart it is, so the controls, the plot and Reset cannot
 * disagree between charts:
 *
 *     const { limits, setLimit, resetLimits } = useAxisLimits('range');
 *     …AxisScaleControls onChange={setLimit}, drawing with `limits`
 *
 * The store is whichever chartConfig is in force where the chart is drawn: the
 * site's own in the main window and the pop-out, a panel's private copy on Home
 * (PresentedChart provides it). A view never takes the config as a prop for
 * this, so a new one cannot forget to.
 */
const AxisLimitsContext = createContext(null);

/**
 * @param {object}   chartConfig      the config whose `axisLimits` is the store
 * @param {Function} setChartConfig   a React state setter for it (updater form)
 */
export function AxisLimitsProvider({ chartConfig, setChartConfig, children }) {
    const axisLimits = chartConfig?.axisLimits;
    const store = useMemo(() => ({
        axisLimits,
        update: change => setChartConfig(prev => ({ ...prev, axisLimits: change(prev.axisLimits) })),
    }), [axisLimits, setChartConfig]);
    return <AxisLimitsContext.Provider value={store}>{children}</AxisLimitsContext.Provider>;
}

/**
 * @param {string} chart  a key of AXIS_LIMIT_CHARTS
 * @returns {{ limits: object, setLimit: Function, resetLimits: Function }}
 *   `limits` is all six fields (null = Auto, except where the chart's default is
 *   not); `setLimit(field, value)` is the signature AxisScaleControls calls;
 *   `resetLimits()` puts the chart back to its defaults.
 */
export function useAxisLimits(chart) {
    const store = useContext(AxisLimitsContext);

    // Outside a provider the chart still works, on limits it keeps itself, so a
    // view rendered somewhere new is not blank. That chart's limits then reach
    // no link and no pop-out — which is why the wiring suite checks the providers
    // are where charts are drawn rather than relying on this.
    const [fallback, setFallback] = useState(null);
    const axisLimits = store ? store.axisLimits : fallback;
    const update = store ? store.update : setFallback;

    const stored = axisLimits?.[chart];
    // Same object until the limits change, so a chart that lists it in an effect's
    // dependencies redraws on a change and not on every render.
    const limits = useMemo(() => axisLimitsOf(axisLimits, chart), [stored, chart]); // eslint-disable-line react-hooks/exhaustive-deps -- `stored` is the entry the object is built from

    const setLimit = useCallback(
        (field, value) => update(prev => withAxisLimit(prev, chart, field, value)),
        [update, chart],
    );
    const resetLimits = useCallback(
        () => update(prev => withAxisLimits(prev, chart, defaultAxisLimits(chart))),
        [update, chart],
    );
    return { limits, setLimit, resetLimits };
}
