import { describe, it, expect } from 'vitest';
import { buildChartParams, parseChartUrl, chartShortLink } from '../chartUrlState';
import { expandShortLink } from '../shortLink';
import { DEFAULT_COST_TO_DRIVE } from '../../constants/costToDrive';
import { decodeCostToDriveKey } from '../costToDriveKey';
import { defaultChartConfig, defaultCompareConfig, defaultRoadTripConfig, defaultEpaConfig } from '../chartDefaults';

const build = (chartMode, costToDrive) => buildChartParams({
    view: chartMode === 'charging' ? 'efficiency' : 'cost', chartMode,
    chartConfig: defaultChartConfig(), selectedVehicles: [73, 24], vehicles: [],
    compareConfig: defaultCompareConfig(), roadTripConfig: defaultRoadTripConfig(), epaConfig: defaultEpaConfig(),
    pairings: {}, vehicleFilters: {}, costToDrive,
});

describe('the Cost to Drive key in a link', () => {
    const week = { ...DEFAULT_COST_TO_DRIVE, level: 0, longMi: 250 };

    it('is written on Cost to Drive, with the vehicles readable beside it', () => {
        const p = build('drivesetup', week);
        expect(p.get('v')).toBe('73,24');
        expect(decodeCostToDriveKey(p.get('cd')).settings).toEqual(week);
    });

    it('is left out for an untouched week, and on every other chart', () => {
        expect(build('drivesetup', DEFAULT_COST_TO_DRIVE).has('cd')).toBe(false);
        expect(build('charging', week).has('cd')).toBe(false);
    });

    it('is read back from the address, still packed, and survives the short link', () => {
        const search = build('drivesetup', week).toString();
        expect(parseChartUrl(search).costToDrive).toBe(new URLSearchParams(search).get('cd'));
        const key = chartShortLink(search);
        const opened = new URLSearchParams(expandShortLink(`?k=${key}`).search);
        expect(opened.get('cd')).toBe(new URLSearchParams(search).get('cd'));
        expect(opened.get('m')).toBe('drivesetup');
    });
});
