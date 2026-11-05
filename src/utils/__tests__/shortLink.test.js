import { describe, it, expect } from 'vitest';
import {
    encodeShortLink, decodeShortLink, expandShortLink, SHORT_LINK_ERRORS, SHORT_LINK_PARAM,
} from '../shortLink';
import {
    parseChartUrl, buildChartParams, chartConfigFromParsed, chartQueryString, chartShortLink,
    withDefaultsWrittenOut,
} from '../chartUrlState';
import {
    defaultChartConfig, defaultCompareConfig, defaultRoadTripConfig, defaultEpaConfig,
} from '../chartDefaults';
import { explicitChartParams } from '../featuredComparisons';

/**
 * Everything a link makes the page show, as App applies it on arrival: each
 * parsed part laid over a fresh page's settings. Two links that agree here
 * draw the same chart.
 */
function applied(search) {
    const { chart, compare, pairings, roadTrip, epa } = parseChartUrl(search);
    return {
        tab: new URLSearchParams(search).get('tab'),
        mode: chart.chartMode,
        vehicles: chart.vehicleIds,
        runs: chart.runIds,
        chart: chartConfigFromParsed(chart, defaultChartConfig()),
        compare: { ...defaultCompareConfig(), ...compare },
        roadTrip: { ...defaultRoadTripConfig(), ...roadTrip },
        epa: { ...defaultEpaConfig(), ...epa },
        pairings: pairings ?? {},
    };
}

/** What a reader gets from the URL button, opened as main.jsx opens it. */
const throughShortLink = (search) => {
    const opened = expandShortLink(`?${SHORT_LINK_PARAM}=${chartShortLink(search)}`);
    expect(opened.error).toBeUndefined();
    return opened.search;
};

// Links as they exist in the wild. The three featured comparisons are the rows
// in production on 2026-10-26; the rest are each chart as the address bar wrote
// it BEFORE #476 (every Charge Stop and Road Trip setting, x and y always,
// commas escaped), plus the forms that predate #478's `ax`.
const FEATURED = [
    'tab=efficiency&r=347%2C348%2C346%2C137%2C307&m=range',
    'tab=efficiency&m=compare&cmp_soc=10&cmp_mins=15&cmp_mi=150&cmp_sel=347%3A%3A%2C348%3A%3A%2C346%3A%3A%2C137%3A%3A%2C307%3A%3A',
    'tab=efficiency&m=roadtrip&rt_m=time&rt_ss=90&rt_ms=10&rt_ld=150&rt_ct=15&rt_td=500&rt_sp=70&rt_oh=5&rt_ya=byTest&rt_xa=totalTime',
    'tab=efficiency&r=265%2Cinherited_v96_304%2Cinherited_12_115&x=time&y=chargeRate&rt=10&ax=xx30',
    'tab=efficiency&r=265%2Cinherited_v96_304%2Cinherited_12_115&x=time&y=soc&rt=10&ax=xx30_yx80',
    'tab=specifications&m=specstable&vt_cols=name%2Cfigures.epaEfficiency%2Ccalc.efficiency%2Ccalc.costPer100Home%2Ccalc.costPer100Fast%2Cfigures.epaRangeMi&vt_preset=efficiency&vt_sort=calc.costPer100Home&vt_win=10-70&vt_home=0.18&vt_fast=0.46',
];
const OLD_ADDRESSES = [
    'tab=efficiency&v=3&x=soc&y=chargeRate',
    'tab=efficiency&r=480%2C1070%2C660&x=time&y=chargeRate&y2=soc&rt=10&xx=30&yn=0&yx=250&c_spd=75&c_tmp=40',
    'tab=efficiency&r=480%2C1070&m=range&corr=none&rc=eff-speed-line&eff=wh_mi&ax=yn50',
    'tab=efficiency&v=48%2C107&m=compare&cmp_soc=10&cmp_mins=15&cmp_mi=150&cmp_o=vertical&cmp_sel=480%3A%3A900%2Cinherited_v96_304%3A%3A',
    'tab=efficiency&v=48%2C107&m=roadtrip&rt_m=distance&rt_ss=90&rt_ms=10&rt_ld=150&rt_ct=30&rt_td=500&rt_sp=70&rt_oh=5&rt_ya=chargeTime&rt_xa=totalTime',
    'tab=efficiency&v=48%2C107%2C66&m=roadtrip&pairs=480%3A481%3B1070%3A1071&rt_m=time&rt_ss=90&rt_ms=10&rt_ld=150&rt_ct=15&rt_td=500&rt_sp=70&rt_oh=5&rt_ya=chargeTime&rt_xa=speed&rt_sya=driveTime&rt_tw=1&rt_te=1.5&rt_tr=70',
    'tab=efficiency&v=48%2C107&m=epacurves&epa_m=1201%2C1202&epa_ov=corrected&epa_ya=mpge&c_alt=5000&c_acc=1500',
    'tab=specifications&v=4%2C9&m=specs&sf=calc.efficiency&vt_win=10-70&ss=all&q=Model+3',
    'tab=specifications&v=4%2C9&m=specscatter&scx=figures.epaRangeMi&scy=pricing.base_price_usd',
    'tab=performance&v=4&m=perfcurve&line=0&pts=1&cspread=0&aspread=1&raw=1',
];
const CORPUS = [...FEATURED, ...OLD_ADDRESSES];

describe('old links open as they always did (#476)', () => {
    it.each(OLD_ADDRESSES)('%s', (old) => {
        // The address bar rewrites an arriving link in the slim form; the page
        // it then shows, and a refresh of it, must be the old link's.
        const parsed = parseChartUrl(old);
        const state = {
            view: applied(old).tab, chartMode: parsed.chart.chartMode,
            chartConfig: { ...applied(old).chart, selectedRuns: parsed.chart.runIds },
            selectedVehicles: parsed.chart.vehicleIds, vehicles: [],
            compareConfig: applied(old).compare, roadTripConfig: applied(old).roadTrip,
            epaConfig: applied(old).epa, pairings: applied(old).pairings,
        };
        const slim = chartQueryString(buildChartParams(state));
        expect(applied(slim).chart).toEqual(applied(old).chart);
        expect(applied(slim).compare).toEqual(applied(old).compare);
        expect(applied(slim).roadTrip).toEqual(applied(old).roadTrip);
        expect(applied(slim).epa).toEqual(applied(old).epa);
        expect(applied(slim).pairings).toEqual(applied(old).pairings);
        expect(slim.length).toBeLessThanOrEqual(old.length);
    });

    it('reads every Road Trip and Charge Stop setting an old link wrote', () => {
        expect(parseChartUrl(OLD_ADDRESSES[5]).roadTrip).toEqual({
            mode: 'time', startSoc: 90, minSoc: 10, legDistance: 150, chargeTime: 15, totalDistance: 500,
            speed: 70, overhead: 5, yAxis: 'chargeTime', xAxis: 'speed', sweepYAxis: 'driveTime',
            towingMode: true, towingEfficiency: 1.5, towingRefSpeedMph: 70,
        });
        expect(parseChartUrl(OLD_ADDRESSES[3]).compare).toEqual({
            startSoc: 10, xMinutes: 15, mMiles: 150, orientation: 'vertical',
            selected: ['480::900', 'inherited_v96_304::'],
        });
    });

    it('a pop-out of an old link is the same chart', () => {
        for (const old of OLD_ADDRESSES) expect(applied(`${old}&popout=1`)).toEqual(applied(old));
    });
});

describe('the short link opens the chart it was copied from', () => {
    it.each(CORPUS)('%s', (search) => {
        expect(applied(throughShortLink(search))).toEqual(applied(search));
    });

    it('keeps a pop-out a pop-out', () => {
        const opened = expandShortLink(`?k=${chartShortLink(OLD_ADDRESSES[4])}&popout=1`);
        expect(new URLSearchParams(opened.search).get('popout')).toBe('1');
        expect(applied(opened.search)).toEqual(applied(OLD_ADDRESSES[4]));
    });

    it('opens a featured comparison\'s saved chart the same through its key', () => {
        for (const saved of FEATURED.map(explicitChartParams)) {
            expect(applied(throughShortLink(saved))).toEqual(applied(saved));
        }
    });

    it('carries a parameter version 1 has no name for, spelled out', () => {
        const q = 'tab=efficiency&m=range&r=5&brand_new=hello%2Cworld&mk=Tesla';
        const back = new URLSearchParams(throughShortLink(q));
        expect(back.get('brand_new')).toBe('hello,world');
        expect(back.get('mk')).toBe('Tesla');
    });

    it('is shorter than the address it replaces', () => {
        for (const search of CORPUS) {
            expect(chartShortLink(search).length, search).toBeLessThan(chartQueryString(new URLSearchParams(search)).length);
        }
        // The two the issue was about: an untouched Road Trip, and its towing case.
        expect(chartShortLink(OLD_ADDRESSES[4]).length).toBeLessThan(25);
        expect(chartShortLink(OLD_ADDRESSES[5]).length).toBeLessThan(65);
    });
});

describe('a key means the same after a default moves', () => {
    it('keeps a setting that differs from version 1\'s frozen default', () => {
        // Road Trip's Y axis default was once 'distance' (#78). A link on it is
        // kept in the key, whatever chartDefaults says by then.
        const key = encodeShortLink('tab=efficiency&m=roadtrip&rt_ya=distance');
        expect(new URLSearchParams(decodeShortLink(key).search).get('rt_ya')).toBe('distance');
    });

    it('puts version 1\'s defaults back, written out', () => {
        const back = new URLSearchParams(decodeShortLink(encodeShortLink('tab=efficiency&m=roadtrip')).search);
        expect(back.get('rt_ya')).toBe('chargeTime');
        expect(back.get('rt_ss')).toBe('90');
        expect(back.has('rt_te')).toBe(false);   // only on a towing link
    });

    it('writes the live defaults out before packing', () => {
        expect(new URLSearchParams(withDefaultsWrittenOut('tab=efficiency&m=compare')).get('cmp_mins'))
            .toBe(String(defaultCompareConfig().xMinutes));
    });
});

describe('version 1 keys do not change meaning', () => {
    // Golden keys. A failure here means NAMES_V1 or WORDS_V1 had an entry moved
    // or removed — which changes every key already shared. Append instead.
    it.each([
        ['1.BQAJBQ', 'tab=efficiency&m=range'],
        ['1.BQASA6QIA2CwAgcMcxURGQ4jCiQJeHgzMF95eDgw', 'tab=efficiency&r=265%2Cinherited_v96_304%2Cinherited_12_115&x=time&y=soc&rt=10&ax=xx30_yx80'],
    ])('%s', (key, search) => {
        expect(encodeShortLink(search)).toBe(key);
        expect(applied(decodeShortLink(key).search)).toEqual(applied(search));
    });
});

describe('a key that cannot be read says so', () => {
    it.each([
        ['', 'unreadable'], ['abc', 'unreadable'], ['1.', null], ['1.%%%', 'unreadable'],
        ['1.////', 'unreadable'], ['x.BQAJBQ', 'unreadable'], ['0.BQAJBQ', 'unreadable'],
        ['2.BQAJBQ', 'newer'], ['99.whatever', 'newer'],
    ])('%j', (key, kind) => {
        const out = decodeShortLink(key);
        if (kind) expect(out.error).toBe(SHORT_LINK_ERRORS[kind]);
        else expect(out.error).toBeUndefined();
    });

    it('a key cut short mid-value is an error, not a wrong chart', () => {
        const key = chartShortLink(OLD_ADDRESSES[1]);
        expect(decodeShortLink(key.slice(0, 6)).error).toBe(SHORT_LINK_ERRORS.unreadable);
    });

    it('never throws on what someone might paste', () => {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.%';
        let seed = 7;
        const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 2000; i++) {
            const body = Array.from({ length: Math.floor(rand() * 40) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
            expect(() => decodeShortLink(`1.${body}`)).not.toThrow();
        }
    });

    it('opens on Home, with the reason, and keeps what sat beside the key', () => {
        const out = expandShortLink('?k=1.%25%25&popout=1');
        expect(out.error).toBe(SHORT_LINK_ERRORS.unreadable);
        expect(new URLSearchParams(out.search).get('tab')).toBeNull();
        expect(new URLSearchParams(out.search).get('popout')).toBe('1');
    });

    it('leaves an address with no key alone', () => {
        expect(expandShortLink('?tab=efficiency&m=range')).toBeNull();
    });
});
