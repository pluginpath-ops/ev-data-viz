import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useAsyncResource } from './useAsyncResource';

/**
 * The one list of sources for performance results (#327), loaded once per mount.
 *
 * `available` is false until migration 068 is applied; callers then fall back
 * to what they did before rather than offering a list that cannot be written.
 */
export function useSources() {
    const { getSources } = useAppContext();
    // The context's functions are recreated every render; the list only needs
    // loading once, and `reload` is there for a caller that changed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const load = useCallback(() => getSources(), []);
    const { data, loading, error, reload } = useAsyncResource(load, [load]);
    return {
        sources: data?.sources ?? [],
        available: data?.available === true,
        loading,
        error,
        reload,
    };
}
