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
import { HOME_LEVELS } from '../constants/costToDrive';

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

/** The selected vehicles priced for one set of settings (see useCostToDrive). */
function priceVehicles(vehicles, selectedVehicleIds, settings, testSessions) {
    const sessionOf = (r) => sessionFor(testSessions, r);
    const selected = selectedVehicleIds
        .map(id => vehicles.find(v => v.id === id))
        .filter(Boolean);
    const colors = vehicleColors(selected);
    return selected.map(vehicle => ({
        ...priceVehicle(vehicle, vehicles, settings, sessionOf),
        color: colors[vehicle.id],
    }));
}

/**
 * One vehicle priced: its profile and its comparison with the gas car. With a
 * `trace` (utils/calcTrace.js), the same call writes down its math — "Show the
 * math" calls exactly this, so its figures are the page's.
 */
export function priceVehicle(vehicle, vehicles, settings, sessionOf, trace = null) {
    const { specs } = specProvenance(vehicle, vehicles);
    const profile = costToDriveVehicle(vehicle, settings, { specs, sessionOf, trace: trace?.group('What the week needs from the vehicle') });
    return {
        vehicle,
        profile,
        missing: profile.missing,
        comparison: profile.missing ? null : costToDriveComparison(profile, settings, { trace }),
    };
}

export function useCostToDrive(vehicles, selectedVehicleIds, settings) {
    const { testSessions } = useAppContext();
    return useMemo(
        () => priceVehicles(vehicles, selectedVehicleIds, settings, testSessions),
        [vehicles, selectedVehicleIds, settings, testSessions],
    );
}

/**
 * The same, once per home charger level (Home Charger): `[{ level, index,
 * priced }]` in HOME_LEVELS order, every other setting as the reader set it.
 */
export function useCostToDriveByLevel(vehicles, selectedVehicleIds, settings) {
    const { testSessions } = useAppContext();
    return useMemo(
        () => HOME_LEVELS.map((level, index) => ({
            level, index,
            priced: priceVehicles(vehicles, selectedVehicleIds, { ...settings, level: index }, testSessions),
        })),
        [vehicles, selectedVehicleIds, settings, testSessions],
    );
}
