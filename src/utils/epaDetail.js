/**
 * The startup vehicle read carries a test vehicle without its coefficient sets
 * and without each test's phases and comments (#501). Views that need them ask
 * for them (hooks/useEpaDetail) and this puts them back, so what they read is
 * the whole record the startup read used to bring.
 *
 * A slim test vehicle is one with no `epa_coefficient_sets` key at all; a
 * record with no sets has an empty array, never an absent key.
 *
 * Pure module: no data access, no React.
 */

export const isSlimTestVehicle = (testVehicle) =>
    testVehicle != null && !('epa_coefficient_sets' in testVehicle);

/** The slim test vehicles linked from these vehicles. */
export function slimTestVehicles(vehicles = []) {
    return vehicles.flatMap(v => (v?.epa_mappings ?? [])
        .map(m => m.epaTestVehicle)
        .filter(isSlimTestVehicle));
}

/**
 * The vehicles with each slim test vehicle replaced by its detailed one, where
 * `detailOf(slim)` has it. Vehicles with nothing to add come back as they were,
 * so a memo on the result stays quiet.
 */
export function withEpaDetail(vehicles = [], detailOf) {
    return vehicles.map(v => {
        let changed = false;
        const mappings = (v?.epa_mappings ?? []).map(m => {
            const detail = isSlimTestVehicle(m.epaTestVehicle) ? detailOf(m.epaTestVehicle) : null;
            if (!detail) return m;
            changed = true;
            return {
                ...m,
                epaTestVehicle: {
                    ...m.epaTestVehicle,
                    epa_coefficient_sets: detail.epa_coefficient_sets ?? [],
                    epa_tests: detail.epa_tests ?? m.epaTestVehicle.epa_tests,
                },
            };
        });
        return changed ? { ...v, epa_mappings: mappings } : v;
    });
}
