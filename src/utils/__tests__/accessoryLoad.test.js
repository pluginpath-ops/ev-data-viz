import { describe, it, expect } from 'vitest';
import {
    assumedAccessoryW, effectiveAccessoryW, accessoryWhPerMile, accessoryFactor,
} from '../accessoryLoad';

describe('assumedAccessoryW', () => {
    it('is the base load everywhere in the comfort band', () => {
        for (const T of [60, 62, 65, 70]) expect(assumedAccessoryW(T)).toBe(300);
    });

    it('adds 50 W for each °F below 60', () => {
        expect(assumedAccessoryW(50)).toBe(800);
        expect(assumedAccessoryW(32)).toBe(1700);
        expect(assumedAccessoryW(20)).toBe(2300);
        expect(assumedAccessoryW(0)).toBe(3300);
    });

    it('adds A/C above 70 that rises with the square of the degrees, 1,000 W at 95°F', () => {
        expect(assumedAccessoryW(75)).toBeCloseTo(340, 6);
        expect(assumedAccessoryW(80)).toBeCloseTo(460, 6);
        expect(assumedAccessoryW(95)).toBeCloseTo(1300, 6);
        expect(assumedAccessoryW(98)).toBeCloseTo(1554.4, 6);
        expect(assumedAccessoryW(100)).toBeCloseTo(1740, 6);
    });

    it('keeps the 95°F anchor when the band moves', () => {
        expect(assumedAccessoryW(95, { comfortBand: [60, 75] })).toBeCloseTo(1300, 6);
        expect(assumedAccessoryW(85, { comfortBand: [60, 75] })).toBeCloseTo(300 + 1000 * (10 / 20) ** 2, 6);
        // A band reaching 95°F or above leaves no span to scale over: no A/C.
        expect(assumedAccessoryW(100, { comfortBand: [60, 95] })).toBe(300);
    });

    it('is the base load for a blank or unreadable temperature', () => {
        for (const blank of [null, undefined, '', 'abc']) expect(assumedAccessoryW(blank)).toBe(300);
    });

    it('takes its constants as options, so a comparison can try others', () => {
        expect(assumedAccessoryW(20, { heatWPerF: 25 })).toBe(300 + 25 * 40);
        expect(assumedAccessoryW(80, { coolWAt95F: 0 })).toBe(300);
        expect(assumedAccessoryW(72, { comfortBand: [55, 75], baseW: 200 })).toBe(200);
    });
});

describe('effectiveAccessoryW', () => {
    it('follows the temperature while the reader has not set it', () => {
        expect(effectiveAccessoryW({ temperatureF: 20, accessoryW: null })).toBe(2300);
        expect(effectiveAccessoryW({ temperatureF: 20 })).toBe(2300);
        expect(effectiveAccessoryW({ temperatureF: 90 })).toBeCloseTo(940, 6);
    });

    it('stops following it once set — even to a figure that happens to be the base', () => {
        expect(effectiveAccessoryW({ temperatureF: 20, accessoryW: 4000 })).toBe(4000);
        expect(effectiveAccessoryW({ temperatureF: 20, accessoryW: 300 })).toBe(300);
    });
});

describe('accessoryWhPerMile', () => {
    it('costs more per mile the slower it is driven', () => {
        expect(accessoryWhPerMile(2000, 70)).toBeCloseTo(28.57, 2);
        expect(accessoryWhPerMile(2000, 50)).toBe(40);
    });
});

describe('accessoryFactor', () => {
    const base = { runW: 300, runSpeedMph: 70, targetW: 300, targetSpeedMph: 70, tractionScale: 1 };

    it('is exactly 1 when nothing differs', () => {
        expect(accessoryFactor({ ...base, consumptionWhMi: 320 }).factor).toBeCloseTo(1, 12);
    });

    it('gives back the aero ratio when the loads match and the speeds match', () => {
        // Traction 20% cheaper at the target, accessory unchanged: less than 20% of the whole.
        const { factor } = accessoryFactor({ ...base, consumptionWhMi: 300, tractionScale: 0.8 });
        expect(factor).toBeGreaterThan(1);
        expect(factor).toBeLessThan(1 / 0.8);
    });

    it('takes a blank consumption as the assumption and reports it', () => {
        const r = accessoryFactor({ ...base, consumptionWhMi: null });
        expect(r.assumedConsumptionWhMi).toBe(300);
        for (const blank of ['', 0, -5, 'abc']) {
            expect(accessoryFactor({ ...base, consumptionWhMi: blank }).assumedConsumptionWhMi).toBe(300);
        }
        expect(accessoryFactor({ ...base, consumptionWhMi: 250 }).assumedConsumptionWhMi).toBeNull();
    });

    it('declines when the accessory share is the whole of the test', () => {
        const r = accessoryFactor({ ...base, consumptionWhMi: 4, runW: 1000 });
        expect(r.factor).toBeNull();
        expect(r.skipped).toBe('more than the test used');
    });
});
