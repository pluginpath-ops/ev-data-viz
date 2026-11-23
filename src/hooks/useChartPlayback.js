import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { playbackPlugins } from '../utils/chartPlayback';

/**
 * Playback state shared by a chart view and its PlaybackControl.
 *
 * The clock lives in a ref, not in the view's state: it moves every frame,
 * and re-rendering a whole chart view 60 times a second would be the cost.
 * The control re-renders itself and asks the chart to redraw; the view hears
 * only `engaged` — on from the first Play until Reset — for anything playback
 * changes about how its data is built.
 *
 * Put `plugins.open` first in the chart's plugin list and `plugins.close`
 * last (see utils/chartPlayback) — or before a plugin whose drawing must not be
 * clipped, which then hides what the clock has not reached itself (Road
 * Trip's finish labels).
 *
 * @param {{ clockFromX?: boolean }} opts  clockFromX: the X axis is the clock.
 */
export function useChartPlayback({ clockFromX = false } = {}) {
    const stateRef = useRef({ active: false, now: 0, clockFromX, onExtent: null, listeners: new Set() });
    // Before the view's own effects build the chart.
    useLayoutEffect(() => { stateRef.current.clockFromX = clockFromX; }, [clockFromX]);
    const [engaged, setEngaged] = useState(false);
    const plugins = useMemo(() => playbackPlugins(stateRef), []);
    return useMemo(() => ({ stateRef, plugins, engaged, setEngaged }), [plugins, engaged]);
}
