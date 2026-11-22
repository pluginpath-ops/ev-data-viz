import { useCallback } from 'react';

/**
 * One of a view's settings, held in chartConfig rather than in the view, as
 * `[value, setValue]` like useState.
 *
 * Held in the view, a setting died with it: a sub-tab switch reset it, and the
 * chart link, the pop-out and a featured comparison could not carry it. In
 * chartConfig it is part of the chart's state, and the settings key
 * (utils/settingsKey.js) writes it into the link.
 *
 * @param {object}   chartConfig
 * @param {Function} [setChartConfig]  absent where the chart only draws (a Home
 *                                     panel): the setter then does nothing
 * @param {string}   group     the view's group in chartConfig ('perfCompare' …)
 * @param {string}   field
 * @param {*}        fallback  the default; an object or array must be a stable
 *                             module-level value, or every render sees a new one
 */
export function useChartSetting(chartConfig, setChartConfig, group, field, fallback) {
    const value = chartConfig?.[group]?.[field] ?? fallback;
    const setValue = useCallback(next => setChartConfig?.(prev => {
        const current = prev[group]?.[field] ?? fallback;
        const resolved = typeof next === 'function' ? next(current) : next;
        if (Object.is(resolved, current)) return prev;
        return { ...prev, [group]: { ...(prev[group] ?? {}), [field]: resolved } };
    }), [setChartConfig, group, field, fallback]);
    return [value, setValue];
}
