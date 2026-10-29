/**
 * The line under a chart that says box-zoom exists and how to leave it. "Reset
 * zoom to restore" is the same action as the Reset zoom button beside the Axis
 * Scale controls, which only appears once the chart is zoomed; this link is
 * there from the start, so the way out is stated where the way in is.
 *
 * @param {Function} onReset  the chart's resetZoom
 */
export default function ZoomHint({ onReset }) {
    return (
        <p className="text-xs text-meta mt-1">
            Drag to box-zoom ·{' '}
            <button type="button" className="zoom-hint-link" onClick={onReset}>Reset zoom</button>
        </p>
    );
}
