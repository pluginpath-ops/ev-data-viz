/**
 * The selected vehicles priced for the reader's week (costToDrive.js): each
 * one's profile and its comparison with the gas car, in selection order. A
 * vehicle that cannot be priced is kept, with `missing` saying why, so the page
 * can name it rather than drop it.
 */
import { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { sessionFor } from '../utils/testSessions';
import { specProvenance } from '../utils/specHelpers';
import { costToDriveVehicle, costToDriveComparison } from '../utils/costToDrive';

export function useCostToDrive(vehicles, selectedVehicleIds, settings) {
    const { testSessions } = useAppContext();
    return useMemo(() => {
        const sessionOf = (r) => sessionFor(testSessions, r);
        return selectedVehicleIds
            .map(id => vehicles.find(v => v.id === id))
            .filter(Boolean)
            .map(vehicle => {
                const { specs } = specProvenance(vehicle, vehicles);
                const profile = costToDriveVehicle(vehicle, settings, { specs, sessionOf });
                return {
                    vehicle,
                    profile,
                    missing: profile.missing,
                    comparison: profile.missing ? null : costToDriveComparison(profile, settings),
                };
            });
    }, [vehicles, selectedVehicleIds, settings, testSessions]);
}
