import { useCallback } from 'react';
import { dataService } from '../services/DataService';
import { useAsyncResource } from './useAsyncResource';
import { normalizeComparison, comparisonToRow } from '../utils/featuredComparisons';

/**
 * The featured comparisons the reader may see (#448), loaded once per mount,
 * with the three writes a curator makes.
 *
 * Each write reloads the list rather than patching it: the database stamps
 * `listed_at` and decides the slug is free, and the list Home shows is ordered
 * by what it stamped.
 *
 * @returns {{ comparisons: Array, loading: boolean, error: *, reload: Function,
 *             create: Function, save: Function, remove: Function }}
 */
export function useFeaturedComparisons() {
    const load = useCallback(async () => (await dataService.getFeaturedComparisons()).map(normalizeComparison), []);
    const { data, loading, error, reload } = useAsyncResource(load, [load]);

    const create = useCallback(async (comparison) => {
        const row = await dataService.addFeaturedComparison(comparisonToRow(comparison));
        reload();
        return normalizeComparison(row);
    }, [reload]);

    const save = useCallback(async (comparison) => {
        const row = await dataService.updateFeaturedComparison(comparison.id, comparisonToRow(comparison));
        reload();
        return normalizeComparison(row);
    }, [reload]);

    const remove = useCallback(async (comparison) => {
        await dataService.deleteFeaturedComparison(comparison.id);
        reload();
    }, [reload]);

    return { comparisons: data ?? [], loading, error, reload, create, save, remove };
}
