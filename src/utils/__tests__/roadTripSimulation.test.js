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

describe('destination SoC requirement (road trip)', () => {
    // Reproduces the reported bug: with a 10% en-route floor and a 20%
    // destination floor, a remaining stretch that fits within range-to-10%
    // but not range-to-20% used to let the trip "complete" below the
    // destination buffer instead of taking one more stop to close the gap.
    it('inserts an extra stop to arrive at the destination floor, not just the en-route floor', () => {
        const result = simulateRoadTrip({
            ...baseParams,
            startSoc: 100,
            minSoc: 10,
            destinationMinSoc: 20,
            legDistanceMi: 50,
            totalDistanceMi: 135,
            mode: 'distance',
        });

        expect(result.completed).toBe(true);
        expect(result.warnings.some(w => w.includes('below the'))).toBe(false);
        const last = result.segments[result.segments.length - 1];
        expect(last.endSoc).toBeGreaterThanOrEqual(19.5);
    });

    it('same shortfall in fixed-time mode also gets a top-up stop', () => {
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

    it('a high destination floor still converges, even needing its own late top-up', () => {
        // destFloor (90) sits close to 100, so nearly every en-route stop
        // charges well past what the destination alone would need — the
        // buffer only starts to matter, and force a dedicated stop, on the
        // final stretch.
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
});
