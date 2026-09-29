import { useCallback } from 'react';
import { useAsyncResource } from './useAsyncResource';
import { dataService } from '../services/DataService';

/**
 * Some charging tests' SoC/kW curves, read-only (DataService.getChargingTestsPreview).
 *
 * The one data hook the explainers may import (eslint.config.js,
 * EXPLAINER_MAY_IMPORT): an explainer can show EVBench's own data beside a
 * claim without reaching into AppContext or the chart views.
 *
 * @param {Array<number|string>} runIds
 * @returns {{ data: Array|null, loading: boolean, error: any }}
 */
export function useChargingTests(runIds) {
    const key = runIds.join(',');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const loader = useCallback(() => dataService.getChargingTestsPreview(runIds), [key]);
    return useAsyncResource(loader, [key]);
}
