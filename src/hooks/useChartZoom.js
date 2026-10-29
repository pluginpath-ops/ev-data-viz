import { useCallback, useMemo, useState } from 'react';

/**
 * Whether a chart's box-zoom is in force, and how to undo it.
 *
 * Reset zoom used to be a button in the export strip, always there, nowhere
 * near the thing it undoes. It now lives with the Axis Scale controls and shows
 * only while the chart is zoomed, so its presence says "this is not the whole
 * plot" and its absence says it is.
 *
 * The plugin reports a finished zoom but not a reset, and the chart is rebuilt
 * (a new instance, unzoomed) whenever its data or axes change, so both ends are
 * handled here: the `zoomOptions` callback sets it, and the `plugin` clears it
 * when the instance it was set on is destroyed.
 *
 *     const { zoomed, resetZoom, zoomOptions, plugin } = useChartZoom(chartRef);
 *     … options.plugins.zoom = { zoom: { drag, mode: 'xy', ...zoomOptions } }
 *     … plugins: [plugin]
 *
 * @param {{ current: object|null }} chartRef  the ref holding the Chart.js instance
 */
export function useChartZoom(chartRef) {
    const [zoomed, setZoomed] = useState(false);

    const zoomOptions = useMemo(() => ({
        onZoomComplete: ({ chart }) => setZoomed(chart.isZoomedOrPanned()),
    }), []);
    const plugin = useMemo(() => ({
        id: 'zoomState',
        afterDestroy: () => setZoomed(false),
    }), []);

    const resetZoom = useCallback(() => {
        chartRef.current?.resetZoom();
        setZoomed(false);
    }, [chartRef]);

    return { zoomed, resetZoom, zoomOptions, plugin };
}
