import { useEffect, useState } from 'react';
import { LOADING_INDICATOR_DELAY_MS, isLoadingIndicatorVisible } from '../utils/loadingIndicator';

/**
 * `loading`, held back until it has lasted `delayMs` (#453).
 *
 * Turns off the instant the real state does; only the turning ON waits. The
 * timer is keyed on `loading`, so a load that ends first clears it and the
 * indicator never mounts — no flash on a cached chart.
 *
 * @param {boolean} loading  Real loading state from the view.
 * @returns {boolean} whether the indicator should be showing.
 */
export function useDelayedLoading(loading, delayMs = LOADING_INDICATOR_DELAY_MS) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!loading) return undefined;
        const timer = setTimeout(() => setElapsed(delayMs), delayMs);
        // Reset in the cleanup, not the effect body: the next load starts its
        // own clock from zero, and the state is never written synchronously
        // while rendering.
        return () => { clearTimeout(timer); setElapsed(0); };
    }, [loading, delayMs]);

    return isLoadingIndicatorVisible(loading, elapsed, delayMs);
}
