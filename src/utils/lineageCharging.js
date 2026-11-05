/**
 * Charging tests that come down a lineage (migration 086).
 *
 * A variant inherits its source's charging tests the way it inherits specs: at
 * read time, through `spec_source_vehicle_id`, up the whole chain. A test added
 * to an origin reaches every variant below it on the next read, and re-pointing
 * a variant moves its tests with it. Nothing is written to the variant.
 *
 * Two fields on each vehicle say where that stops and how it scales:
 *
 *   battery_revision  the pack differs from the source's in chemistry or
 *                     construction. The walk stops at the vehicle itself: it
 *                     takes nothing from its source or above. Its own variants
 *                     still inherit from it, so a revision is a cut on one edge.
 *   capacity_factor   the pack against its source's, for one effectively the
 *                     same but a different size. 1 unless a curator sets it.
 *                     Multiplies down the chain: a variant of a ×1.1 variant
 *                     reads the origin's tests at ×1.1.
 *
 * Range tests are not inherited this way — range turns on wheels, trim and
 * weight — and keep the spec-link model. A spec link naming a test the lineage
 * already provides overrides that one test (DataService.buildInheritedRuns).
 *
 * Pure module: no data access, no React.
 */
import { isCompositeRun, runKindFrom } from './runUtils';

const factorOf = (v) => {
    const f = Number(v?.capacity_factor);
    return Number.isFinite(f) && f > 0 ? f : 1;
};

/**
 * The sources a vehicle takes charging tests from, nearest first, each with the
 * capacity factor its tests are read at: the product of the factors on every
 * edge between them and the vehicle.
 *
 * Empty for a battery revision. Stops after a source that is a revision (its
 * tests come down, its source's do not), at a missing source, and at a cycle.
 */
export function chargingLineage(vehicle, byId) {
    const lineage = [];
    if (!vehicle || vehicle.battery_revision) return lineage;
    const seen = new Set([vehicle.id]);
    let factor = factorOf(vehicle);
    let next = vehicle.spec_source_vehicle_id != null ? byId.get(vehicle.spec_source_vehicle_id) : null;
    while (next && !seen.has(next.id)) {
        lineage.push({ source: next, capacityFactor: factor });
        if (next.battery_revision) break;
        seen.add(next.id);
        factor *= factorOf(next);
        next = next.spec_source_vehicle_id != null ? byId.get(next.spec_source_vehicle_id) : null;
    }
    return lineage;
}

/** Whether a run is one a lineage passes down: a real charging test, not a composite. */
export const passesDownLineage = (run) =>
    !run._inherited && !isCompositeRun(run) && runKindFrom(run) === 'charging';

/**
 * The tests a vehicle's lineage provides: each source's own charging tests,
 * with the factor they are read at and the vehicle that owns them.
 *
 * `runsOf(source)` gives a source's runs; by default its `runs`, which must be
 * its OWN runs (getVehicles pass 1), not runs it inherits — those are reached
 * through the walk, at the right factor.
 */
export function lineageChargingTests(vehicle, byId, runsOf) {
    return testsFromLineage(chargingLineage(vehicle, byId), runsOf);
}

/** The same, from a lineage already worked out (DataService.getVehicleRuns). */
export function testsFromLineage(lineage, runsOf = (v) => v.runs ?? []) {
    const tests = [];
    for (const { source, capacityFactor } of lineage) {
        for (const run of runsOf(source)) {
            if (passesDownLineage(run)) tests.push({ run, capacityFactor, source });
        }
    }
    return tests;
}

/**
 * The vehicles whose charging tests come from `vehicleId`'s, directly or down
 * the chain: every variant below it that is not cut off by a battery revision
 * on the way. A write to one of its charging tests changes their composites.
 */
export function lineageInheritors(vehicleId, vehicles) {
    const byId = new Map(vehicles.map(v => [v.id, v]));
    return vehicles
        .filter(v => v.id !== vehicleId && chargingLineage(v, byId).some(e => e.source.id === vehicleId))
        .map(v => v.id);
}
