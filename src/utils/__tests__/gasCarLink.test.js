import { describe, it, expect } from 'vitest';
import { buildChartParams, parseChartUrl, chartShortLink } from '../chartUrlState';
import { expandShortLink } from '../shortLink';
import { DEFAULT_COST_TO_DRIVE, GAS_CAR_PRESETS } from '../../constants/costToDrive';
import { decodeCostToDriveKey, encodeGasCarKey, GAS_CAR_KEY_FIELDS } from '../costToDriveKey';
import { defaultChartConfig, defaultCompareConfig, defaultRoadTripConfig, defaultEpaConfig } from '../chartDefaults';

/**
 * The gas car in Road Trip's chart link (#555). Cost & Time's link carries its
 * whole `cd` key; Road Trip and Trip Optimizer carry the car's part of the same
 * key, only when the car is not the default. No new short-link name: `cd` is
 * already one (shortLink.js NAMES_V1).
 */
const link = (mode, costToDrive) => buildChartParams({
    view: 'efficiency', chartMode: mode,
    chartConfig: defaultChartConfig(), selectedVehicles: [73, 24], vehicles: [],
    compareConfig: defaultCompareConfig(), roadTripConfig: defaultRoadTripConfig(), epaConfig: defaultEpaConfig(),
    pairings: {}, vehicleFilters: {}, costToDrive,
});
const f150 = { ...DEFAULT_COST_TO_DRIVE, ...GAS_CAR_PRESETS.find(p => p.key === 'f150').settings, gasCar: 'f150' };

describe('the gas car in a Road Trip link', () => {
    it('writes nothing for the default car, so an untouched chart keeps its short link', () => {
        expect(encodeGasCarKey(DEFAULT_COST_TO_DRIVE)).toBeNull();
        expect(link('roadtrip', DEFAULT_COST_TO_DRIVE).has('cd')).toBe(false);
        expect(link('optimizer', DEFAULT_COST_TO_DRIVE).has('cd')).toBe(false);
        // Settings only Cost & Time reads are not the car: a different week, price or season adds nothing.
        const week = { ...DEFAULT_COST_TO_DRIVE, level: 0, longMi: 250, gasPrice: 5.5, season: 'summer' };
        expect(link('roadtrip', week).has('cd')).toBe(false);
    });

    it('carries the picked car on Road Trip and Trip Optimizer, and on no other chart', () => {
        for (const mode of ['roadtrip', 'optimizer']) {
            const cd = link(mode, f150).get('cd');
            expect(cd).toBeTruthy();
            expect(cd).toBe(encodeGasCarKey(f150));
        }
        expect(link('charging', f150).has('cd')).toBe(false);
        expect(link('compare', f150).has('cd')).toBe(false);
    });

    it('is light: a picked car is a handful of characters', () => {
        expect(link('roadtrip', f150).get('cd').length).toBeLessThan(16);
    });

    it('reads back as the car and nothing else of the week, its price at the default', () => {
        const busy = { ...f150, level: 0, longMi: 250, season: 'summer', gasPrice: 6.25, gasFillAt: 20, gasFillMin: 9 };
        const { settings, error } = decodeCostToDriveKey(link('roadtrip', busy).get('cd'));
        expect(error).toBeNull();
        expect(settings).toMatchObject({ gasCar: 'f150', gasHwy: 23, gasTank: 23, gasFillAt: 20, gasFillMin: 9 });
        expect(settings.gasPrice).toBe(DEFAULT_COST_TO_DRIVE.gasPrice);
        // Everything outside the car's fields is the default.
        const rest = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !GAS_CAR_KEY_FIELDS.includes(k)));
        expect(rest(settings)).toEqual(rest(DEFAULT_COST_TO_DRIVE));
    });

    it('carries the reader\'s own named car, and survives the short link without a new name', () => {
        const own = { ...DEFAULT_COST_TO_DRIVE, gasName: 'My Accord', gasHwy: 38, gasTank: 14 };
        const search = link('roadtrip', own).toString();
        const { settings } = decodeCostToDriveKey(parseChartUrl(search).costToDrive);
        expect(settings).toMatchObject({ gasName: 'My Accord', gasHwy: 38, gasTank: 14, gasCar: 'custom' });
        const opened = new URLSearchParams(expandShortLink(`?k=${chartShortLink(search)}`).search);
        expect(opened.get('cd')).toBe(new URLSearchParams(search).get('cd'));
        expect(opened.get('m')).toBe('roadtrip');
    });
});
