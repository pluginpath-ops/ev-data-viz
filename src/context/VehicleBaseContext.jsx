import { createContext, useContext } from 'react';

/**
 * What a vehicle swatch needs from the app, held in one place so the chip strip
 * and the run selector — two components with nothing between them — can both
 * open the same color panel without five chart views threading props for it.
 *
 *   bases      { [vehicleId]: hex } — the session bases (utils/vehicleBase.js)
 *   setBase    (vehicleId, hex | null) — set one, or hand it back
 *   canSave    (vehicle) → can this person write vehicles.color for it
 *   save       (vehicle, hex) → write it, then drop the session base it made redundant
 *
 * `null` when no provider is above: the swatch then renders nothing, which is
 * right for the pop-out window and for the playground.
 */
export const VehicleBaseContext = createContext(null);

export function useVehicleBase() {
    return useContext(VehicleBaseContext);
}
