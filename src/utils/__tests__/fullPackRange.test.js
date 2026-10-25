import { describe, it, expect } from 'vitest';
import { fullPackRange } from '../fullPackRange';

const r2 = { socWindowKwh: 89, socWindowBasis: 'usable' };

describe('fullPackRange', () => {
    it('scales a test with a SoC window by the pack it used', () => {
        // The 80 mph test: 30.3 mi over 60 → 46 %.
        const range = fullPackRange({ distance_miles: 30.3, energy_kwh: 12.4, start_soc: 60, end_soc: 46 }, r2);
        expect(range.basis).toBe('soc-window');
        expect(range.mi).toBeCloseTo(30.3 * 100 / 14, 9);
    });

    it('scales a test with energy but no SoC window by its own efficiency and the vehicle’s capacity', () => {
        // The 50 mph test: 23.3 mi on 5.8 kWh is 4.02 mi/kWh; × 89 kWh is 358 mi.
        const range = fullPackRange({ distance_miles: 23.3, energy_kwh: 5.8 }, r2);
        expect(range.basis).toBe('efficiency');
        expect(Math.round(range.mi)).toBe(358);
        expect(range.miPerKwh).toBeCloseTo(4.0172, 4);
        expect(range).toMatchObject({ capacityKwh: 89, capacityLabel: 'Usable' });
    });

    it('prefers the SoC window to the efficiency when a test has both', () => {
        expect(fullPackRange({ distance_miles: 23.3, energy_kwh: 4.9, start_soc: 60, end_soc: 54 }, r2).basis).toBe('soc-window');
    });

    it('is corrected exactly as the distance is, because both figures are linear in it', () => {
        const run = { distance_miles: 23.3, energy_kwh: 5.8 };
        const k = 0.6678;
        expect(fullPackRange({ ...run, distance_miles: run.distance_miles * k }, r2).mi)
            .toBeCloseTo(fullPackRange(run, r2).mi * k, 9);
    });

    it('falls back to the distance driven, and says it is only that', () => {
        // No energy, or no capacity to scale it to: the miles the test covered.
        expect(fullPackRange({ distance_miles: 23.3 }, r2)).toEqual({ mi: 23.3, basis: 'distance' });
        expect(fullPackRange({ distance_miles: 23.3, energy_kwh: 5.8 }, {})).toEqual({ mi: 23.3, basis: 'distance' });
        expect(fullPackRange({ distance_miles: 23.3, energy_kwh: 5.8 })).toEqual({ mi: 23.3, basis: 'distance' });
    });

    it('is null for a test with no distance', () => {
        expect(fullPackRange({ energy_kwh: 5.8 }, r2)).toBeNull();
        expect(fullPackRange({ distance_miles: 0 }, r2)).toBeNull();
        expect(fullPackRange(null, r2)).toBeNull();
    });
});
