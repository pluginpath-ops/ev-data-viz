/**
 * The selected vehicles priced for the reader's week (costToDrive.js): each
 * one's profile and its comparison with the gas car, in selection order. A
 * vehicle that cannot be priced is kept, with `missing` saying why, so the page
 * can name it rather than drop it. Each carries its series color.
 */
import { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { sessionFor } from '../utils/testSessions';
import { specProvenance } from '../utils/specHelpers';
import { costToDriveVehicle, costToDriveComparison } from '../utils/costToDrive';
import { resolveChartColors, VEHICLE_PALETTE } from '../utils/colorUtils';

/**
 * Color per vehicle, as Performance resolves it: the vehicle's own color, the
 * palette only for a car that has none. Each vehicle stands in as its own
 * single "run", which is what makes the resolver treat it as a car.
 */
function vehicleColors(selected) {
    return resolveChartColors(
        selected.map(v => ({ id: v.id, created_at: v.created_at })),
        {},
        VEHICLE_PALETTE,
        selected.map(v => ({ ...v, runs: [{ id: v.id }] })),
    );
}

export function useCostToDrive(vehicles, selectedVehicleIds, settings) {
    const { testSessions } = useAppContext();
    return useMemo(() => {
        const sessionOf = (r) => sessionFor(testSessions, r);
        const selected = selectedVehicleIds
            .map(id => vehicles.find(v => v.id === id))
            .filter(Boolean);
        const colors = vehicleColors(selected);
        return selected
            .map(vehicle => {
                const { specs } = specProvenance(vehicle, vehicles);
                const profile = costToDriveVehicle(vehicle, settings, { specs, sessionOf });
                return {
                    vehicle,
                    color: colors[vehicle.id],
                    profile,
                    missing: profile.missing,
                    comparison: profile.missing ? null : costToDriveComparison(profile, settings),
                };
            });
    }, [vehicles, selectedVehicleIds, settings, testSessions]);
}
