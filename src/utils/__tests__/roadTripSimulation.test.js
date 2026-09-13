import { describe, it, expect } from 'vitest';
import { simulateRoadTrip } from '../roadTripSimulation';

// A flat, easy-to-reason-about charging curve: 1 minute per % SoC, 0→100.
const LINEAR_CURVE = [{ soc: 0, time: 0 }, { soc: 100, time: 100 }];

const baseParams = {
    batteryKwh: 100,
    miPerKwh: 1,
    testSpeedMph: 65,
    chargingData: LINEAR_CURVE,
    speedMph: 65,       // == testSpeedMph, so the speed-correction factor is 1
    overheadMinutes: 0,
};

// A stop's own leg (distance mode) or duration (time mode) budget: the most
// SoC one en-route charge is ever allowed to add.
const legCapSoc = (params) => params.mode === 'time'
    ? params.chargeTimeMinutes // LINEAR_CURVE is 1 min per %, so minutes == points
    : (params.legDistanceMi / (params.batteryKwh * params.miPerKwh)) * 100;

describe('destination SoC requirement (road trip)', () => {
    // The en-route loop (drive-to-minSoc, charge-one-leg) never reasons about
    // destFloor at all. Only a dedicated stop AT the destination — after the
    // loop, not bound by the leg/duration cap since no more driving follows
    // it — closes a shortfall. This is the bug as originally reported: the
    // trip used to "complete" the moment it could reach the destination
    // without dropping below minSoc, even when that left it below destFloor,
    // because nothing ever checked destFloor during the drive itself.
    it('adds a destination top-up when arrival would otherwise fall short of destFloor', () => {
        const params = {
            ...baseParams,
            startSoc: 100,
            minSoc: 10,
            destinationMinSoc: 20,
            legDistanceMi: 50,
            totalDistanceMi: 135,
            mode: 'distance',
        };
        const result = simulateRoadTrip(params);

        expect(result.completed).toBe(true);
        expect(result.warnings.some(w => w.includes('below the'))).toBe(false);
        const last = result.segments[result.segments.length - 1];
        expect(last.type).toBe('charge');
        expect(last.endDist).toBe(params.totalDistanceMi);
        expect(last.endSoc).toBeGreaterThanOrEqual(19.5);
    });

    it('same shortfall in fixed-time mode also gets a destination top-up', () => {
        const result = simulateRoadTrip({
            ...baseParams,
            startSoc: 100,
            minSoc: 10,
            destinationMinSoc: 20,
            totalDistanceMi: 135,
            mode: 'time',
            chargeTimeMinutes: 20,
        });

        expect(result.completed).toBe(true);
        expect(result.warnings.some(w => w.includes('below the'))).toBe(false);
        const last = result.segments[result.segments.length - 1];
        expect(last.endSoc).toBeGreaterThanOrEqual(19.5);
    });

    it('without a destination floor, behaviour is unchanged: the trip ends near minSoc', () => {
        const result = simulateRoadTrip({
            ...baseParams,
            startSoc: 100,
            minSoc: 10,
            legDistanceMi: 50,
            totalDistanceMi: 135,
            mode: 'distance',
        });

        expect(result.completed).toBe(true);
        const last = result.segments[result.segments.length - 1];
        expect(last.endSoc).toBeGreaterThanOrEqual(9.5);
        expect(last.endSoc).toBeLessThan(15);
    });

    it('a high destination floor still converges via a single top-up at the end', () => {
        const result = simulateRoadTrip({
            ...baseParams,
            startSoc: 100,
            minSoc: 10,
            destinationMinSoc: 90,
            legDistanceMi: 50,
            totalDistanceMi: 300,
            mode: 'distance',
        });

        expect(result.completed).toBe(true);
        expect(result.warnings.some(w => w.includes('below the'))).toBe(false);
        const last = result.segments[result.segments.length - 1];
        expect(last.endSoc).toBeGreaterThanOrEqual(89.5);
    });

    it('a destination top-up is uncapped by the leg budget, so even a steep floor is always reachable', () => {
        // legDistanceMi (50) is far smaller than the destFloor-minSoc gap
        // (95-10), so no en-route stop alone could ever bridge it — but the
        // top-up isn't leg-capped, so the trip still lands exactly on
        // destFloor rather than warning about a shortfall.
        const result = simulateRoadTrip({
            ...baseParams,
            startSoc: 100,
            minSoc: 10,
            destinationMinSoc: 95,
            legDistanceMi: 50,
            totalDistanceMi: 300,
            mode: 'distance',
        });

        expect(result.completed).toBe(true);
        expect(result.warnings.some(w => w.includes('below the'))).toBe(false);
        const last = result.segments[result.segments.length - 1];
        expect(last.endSoc).toBeGreaterThanOrEqual(94.5);
        expect(last.endSoc).toBeLessThanOrEqual(100);
    });

    // The property this whole feature exists to guarantee: no EN-ROUTE stop
    // — including the last one before arrival — ever adds more than its own
    // leg (or, in time mode, duration) budget. The destination top-up is the
    // one deliberate exception (checked separately below), because nothing
    // drives after it.
    describe('en-route stops never exceed their own leg/duration cap', () => {
        it('distance mode: a stop close to the end still stops EARLY when destFloor needs less than a full leg', () => {
            // Battery/efficiency scaled so a "leg" is a moderate fraction of
            // the pack (not a rounding-error's difference from 100%) —
            // mirrors reaching a charger with plenty of trip left, wanting
            // only a partial top-up to clear destFloor at the finish.
            const params = {
                ...baseParams,
                batteryKwh: 300,
                startSoc: 100,
                minSoc: 10,
                destinationMinSoc: 15,
                legDistanceMi: 150, // 50% of the pack
                totalDistanceMi: 490,
                mode: 'distance',
            };
            const result = simulateRoadTrip(params);
            const cap = legCapSoc(params);

            expect(result.completed).toBe(true);
            expect(result.warnings).toEqual([]);
            const enRouteCharges = result.segments
                .filter(s => s.type === 'charge')
                .filter(s => s.endDist < params.totalDistanceMi); // exclude any destination top-up
            expect(enRouteCharges.length).toBeGreaterThan(0);
            for (const seg of enRouteCharges) {
                expect(seg.endSoc - seg.startSoc).toBeLessThanOrEqual(cap + 0.1);
            }
            // The last en-route stop had room to spare — it should have
            // stopped short of a full leg, not maxed it out or hit 100%.
            const lastEnRoute = enRouteCharges[enRouteCharges.length - 1];
            expect(lastEnRoute.endSoc - lastEnRoute.startSoc).toBeLessThan(cap - 0.1);
            expect(lastEnRoute.endSoc).toBeLessThan(99.9);
        });

        it('distance mode: a stop that CANNOT clear destFloor within one leg still takes only one leg', () => {
            // destFloor (80) is far above minSoc (10) relative to one leg —
            // this is the exact scenario that used to jump an en-route stop
            // straight to 100%.
            const params = {
                ...baseParams,
                batteryKwh: 82,
                miPerKwh: 3.8,
                testSpeedMph: 70,
                speedMph: 70,
                overheadMinutes: 5,
                startSoc: 90,
                minSoc: 10,
                destinationMinSoc: 80,
                legDistanceMi: 150,
                totalDistanceMi: 500,
                mode: 'distance',
            };
            const result = simulateRoadTrip(params);
            const cap = legCapSoc(params);

            expect(result.completed).toBe(true);
            expect(result.warnings.some(w => w.includes('below the'))).toBe(false);
            const enRouteCharges = result.segments
                .filter(s => s.type === 'charge')
                .filter(s => s.endDist < params.totalDistanceMi);
            expect(enRouteCharges.length).toBeGreaterThan(0);
            for (const seg of enRouteCharges) {
                expect(seg.endSoc - seg.startSoc).toBeLessThanOrEqual(cap + 0.1);
            }
        });

        it('time mode: an en-route stop never exceeds chargeTimeMinutes, even close to the end', () => {
            const params = {
                ...baseParams,
                batteryKwh: 82,
                miPerKwh: 3.8,
                testSpeedMph: 70,
                speedMph: 70,
                overheadMinutes: 5,
                startSoc: 90,
                minSoc: 10,
                destinationMinSoc: 80,
                chargeTimeMinutes: 30,
                totalDistanceMi: 500,
                mode: 'time',
            };
            const result = simulateRoadTrip(params);
            const cap = legCapSoc(params);

            expect(result.completed).toBe(true);
            const enRouteCharges = result.segments
                .filter(s => s.type === 'charge')
                .filter(s => s.endDist < params.totalDistanceMi);
            expect(enRouteCharges.length).toBeGreaterThan(0);
            for (const seg of enRouteCharges) {
                // chargeTime includes overhead; the curve here is 1 min/%,
                // so the SoC delta alone (excluding overhead) is the bound.
                expect(seg.endSoc - seg.startSoc).toBeLessThanOrEqual(cap + 0.1);
            }
        });
    });

    it('the destination top-up is the one stop allowed to exceed a leg — capped only at 100%', () => {
        const params = {
            ...baseParams,
            batteryKwh: 82,
            miPerKwh: 3.8,
            testSpeedMph: 70,
            speedMph: 70,
            overheadMinutes: 5,
            startSoc: 90,
            minSoc: 10,
            destinationMinSoc: 80,
            legDistanceMi: 150,
            totalDistanceMi: 500,
            mode: 'distance',
        };
        const result = simulateRoadTrip(params);
        const cap = legCapSoc(params);

        const topUp = result.segments[result.segments.length - 1];
        expect(topUp.type).toBe('charge');
        expect(topUp.endDist).toBe(params.totalDistanceMi);
        expect(topUp.endSoc).toBeLessThanOrEqual(100);
        // This is the one stop expected to add more than a leg's worth.
        expect(topUp.endSoc - topUp.startSoc).toBeGreaterThan(cap);
    });
});
