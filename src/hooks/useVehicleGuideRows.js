import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useAsyncResource } from './useAsyncResource';

/**
 * A vehicle's EPA Label: its Guide rows, each with its Tested via and pool
 * (DataService.getVehicleGuideRows). Reloads when the vehicle's configurations
 * change, since linking a row adds them. `data` is null while loading and when
 * migration 095 is not applied.
 */
export function useVehicleGuideRows(vehicle) {
    const { getVehicleGuideRows } = useAppContext();
    const vehicleId = vehicle?.id ?? null;
    const configurations = (vehicle?.epa_mappings ?? []).map(m => m.id).join(',');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const load = useCallback(() => (vehicleId == null ? [] : getVehicleGuideRows(vehicleId)), [vehicleId]);
    return useAsyncResource(load, [vehicleId, configurations]);
}
