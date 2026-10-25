import { describe, it, expect } from 'vitest';
import {
    assumedAccessoryW, effectiveAccessoryW, accessoryWhPerMile, accessoryFactor,
} from '../accessoryLoad';

describe('assumedAccessoryW', () => {
    it('is the base load everywhere in the comfort band', () => {
        for (const T of [60, 62, 65, 70]) expect(assumedAccessoryW(T)).toBe(300);
    });

    it('adds 50 W for each °F below 60 and 70 W for each above 70', () => {
        expect(assumedAccessoryW(50)).toBe(800);
        expect(assumedAccessoryW(32)).toBe(1700);
        expect(assumedAccessoryW(20)).toBe(2300);
        expect(assumedAccessoryW(0)).toBe(3300);
        expect(assumedAccessoryW(80)).toBe(1000);
        expect(assumedAccessoryW(100)).toBe(2400);
    });

    it('is the base load for a blank or unreadable temperature', () => {
        for (const blank of [null, undefined, '', 'abc']) expect(assumedAccessoryW(blank)).toBe(300);
    });

    it('takes its constants as options, so a comparison can try others', () => {
        expect(assumedAccessoryW(20, { heatWPerF: 25 })).toBe(300 + 25 * 40);
        expect(assumedAccessoryW(80, { coolWPerF: 0 })).toBe(300);
        expect(assumedAccessoryW(72, { comfortBand: [55, 75], baseW: 200 })).toBe(200);
    });
});

describe('effectiveAccessoryW', () => {
    it('follows the temperature while the reader has not set it', () => {
        expect(effectiveAccessoryW({ temperatureF: 20, accessoryW: null })).toBe(2300);
        expect(effectiveAccessoryW({ temperatureF: 20 })).toBe(2300);
        expect(effectiveAccessoryW({ temperatureF: 90 })).toBe(1700);
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
