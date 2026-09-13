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

    // A charge stop close enough to the end to be sized for arrival at
    // destFloor used to target `destFloor + socForMiles(remaining)` with no
    // cap — jumping straight to 100% (or as close as the curve allows)
    // whenever the destination buffer implied more than one leg's worth,
    // even on a stop that had plenty of room to just take a normal,
    // leg-sized charge and keep driving. Every stop's own budget (one leg's
    // worth of range) is now the hard cap; only a stop that CAN'T clear
    // destFloor without also exceeding the cap gets a second, merged helping
    // (covered by the next test) — this one has room to spare and shouldn't
    // need it.
    it('a stop near the end still respects the leg cap when that leaves room above destFloor', () => {
        const result = simulateRoadTrip({
            ...baseParams,
            startSoc: 100,
            minSoc: 10,
            destinationMinSoc: 50,
            legDistanceMi: 60,
            totalDistanceMi: 245, // arranged so a 55 mi remainder lands on a stop at minSoc
            mode: 'distance',
        });

        expect(result.completed).toBe(true);
        expect(result.warnings.some(w => w.includes('below the'))).toBe(false);
        for (const seg of result.segments.filter(s => s.type === 'charge')) {
            expect(seg.endSoc - seg.startSoc).toBeLessThanOrEqual(60 + 0.1);
        }
        // None of that charging needed to reach all the way to 100%: the
        // destination buffer was well inside one leg's reach the whole trip.
        expect(result.segments.some(s => s.type === 'charge' && s.endSoc >= 99.9)).toBe(false);
    });

    // The flip side: when even a full leg's worth of charge from minSoc
    // can't clear destFloor, a second stop at the same spot is genuinely
    // required (the car can't drive at all below the buffer) — the two
    // leg-capped helpings are merged into one reported stop rather than
    // shown (and charged an extra overhead) as two.
    it('merges a forced back-to-back top-up into one stop instead of double-counting it', () => {
        const result = simulateRoadTrip({
            ...baseParams,
            overheadMinutes: 5,
            startSoc: 90,
            minSoc: 10,
            destinationMinSoc: 80,
            legDistanceMi: 48,
            totalDistanceMi: 500,
            mode: 'distance',
        });

        expect(result.completed).toBe(true);
        expect(result.warnings.some(w => w.includes('below the'))).toBe(false);
        // No two charge segments sit at the exact same distance — a forced
        // continuation extends the prior segment instead of logging a
        // separate (and separately-overheaded) one right behind it.
        const chargeDists = result.segments.filter(s => s.type === 'charge').map(s => s.startDist);
        expect(new Set(chargeDists).size).toBe(chargeDists.length);
    });
});
