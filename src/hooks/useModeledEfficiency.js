import { useCallback } from 'react';
import { useAsyncResource } from './useAsyncResource';
import { dataService } from '../services/DataService';
import { modeledEfficiencyPreview } from '../utils/modeledEfficiencyPreview';

/**
 * Some vehicles' modeled efficiency curves with their range tests, read-only,
 * by EPA link (mapping) id: the id the Modeled Efficiency chart's epa_m= carries.
 *
 * The explainers' second data hook, beside useChargingTests (eslint.config.js,
 * EXPLAINER_MAY_IMPORT). The model runs here, on EVBench's side, so an
 * explainer gets finished points and never imports the EPA derivations.
 *
 * @param {Array<number|string>} mappingIds
 * @returns {{ data: Array|null, loading: boolean, error: any }}
 */
export function useModeledEfficiency(mappingIds) {
    const key = mappingIds.join(',');
    const loader = useCallback(
        async () => (await dataService.getModeledEfficiencyPreview(mappingIds)).map(modeledEfficiencyPreview).filter(Boolean),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [key]);
    return useAsyncResource(loader, [key]);
}
