import LoadingSpinner from '../LoadingSpinner';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';

/**
 * The chart views' loading indicator: the existing `.chart-loading` badge and
 * LoadingSpinner, once, behind a short delay (#453).
 *
 * Out of flow — `.chart-loading` is absolutely positioned over the nearest
 * positioned ancestor (a plot frame, or `.chart-main`), so appearing and
 * disappearing moves nothing.
 *
 * The status region is always mounted and only its text changes. A live region
 * inserted already containing its message is announced unreliably; one that
 * exists first and is then filled is the pattern screen readers handle. The
 * visible badge is hidden from them so the message is not read twice.
 *
 * It is DOM, so a PNG export (which draws the chart canvas) never contains it.
 */
export default function ChartLoading({ loading, message = 'Loading…' }) {
    const visible = useDelayedLoading(loading);
    return (
        <>
            <span role="status" aria-live="polite" className="sr-only">
                {visible ? message : ''}
            </span>
            {visible && (
                <span className="chart-loading" aria-hidden="true">
                    <LoadingSpinner message={message} />
                </span>
            )}
        </>
    );
}
