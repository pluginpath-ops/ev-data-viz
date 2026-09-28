import { useMemo } from 'react';
import { vehicleFilterContext, filterVehicles } from '../utils/vehicleFilters';

/**
 * The vehicles Vehicles & Specs' filters leave (#338), and the context the
 * filter bar needs for its counts. Cards, List and Table all call this with
 * the same filters, so the three views always show the same vehicles.
 */
export function useFilteredVehicles(vehicles, filters, performanceCounts) {
    const ctx = useMemo(() => vehicleFilterContext(vehicles, performanceCounts), [vehicles, performanceCounts]);
    const filtered = useMemo(() => filterVehicles(vehicles, filters, ctx), [vehicles, filters, ctx]);
    return { ctx, filtered };
}
