/**
 * A vehicle's session base — the color you asked one car to be drawn from, for
 * now, without editing the vehicle (#317).
 *
 * `vehicles.color` is the durable base and a curator's to set. This is the same
 * thing held for the session: anyone can steer a chart with it, nothing reaches
 * the database, and it travels to the pop-out window inside `chartConfig`.
 *
 * It is applied by REPLACING the vehicle's color on the copies the charts are
 * given, and marking them `sessionBase`. That is one seam: every chart view,
 * every sidebar accent and every swatch already reads `vehicle.color`, so none
 * of them has to learn that a second layer exists. The marker is what lets
 * `resolveChartColors` honor it under a palette, where a curated color is only
 * a hint.
 *
 * Precedence, widest to narrowest: the palette → the base (curated, or this) →
 * the shades across that vehicle's tests → a test's hand-set pick on top. A base
 * does not clear a vehicle's picks; they sit above it and "Back to auto" at the
 * test scope is how you hand one back.
 */
import { isUnsetColor } from './colorUtils';

export const NO_VEHICLE_BASES = Object.freeze({});

/** The vehicles with their session bases applied. Same array when there are none. */
export function applyVehicleBases(vehicles, bases) {
    if (!vehicles || !bases) return vehicles;
    if (!Object.values(bases).some(c => !isUnsetColor(c))) return vehicles;
    return vehicles.map(v => {
        const base = bases[v.id];
        return isUnsetColor(base) ? v : { ...v, color: base, sessionBase: true };
    });
}

/** `bases` with one vehicle set (or cleared, for a null color). New object only on change. */
export function withVehicleBase(bases, vehicleId, color) {
    const current = bases ?? NO_VEHICLE_BASES;
    if (isUnsetColor(color)) {
        if (!(vehicleId in current)) return current;
        const { [vehicleId]: _dropped, ...rest } = current;
        return rest;
    }
    return current[vehicleId] === color ? current : { ...current, [vehicleId]: color };
}
