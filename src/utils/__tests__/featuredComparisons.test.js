import { describe, it, expect } from 'vitest';
import {
    slugify, uniqueSlug, chartParamsFromSearch, chartModeOf, defaultChartTitle,
    normalizeComparison, comparisonToRow, comparisonProblems, comparisonToShow,
    addChart, removeChart, moveChart, renameChart,
    liveVehicleIds, chartStateOf, resetStateOf, replacesSelection,
} from '../featuredComparisons';
import { buildChartParams } from '../chartUrlState';
import { defaultChartConfig, defaultCompareConfig, defaultRoadTripConfig, defaultEpaConfig } from '../chartDefaults';

const vehicles = [
    { id: 1, runs: [{ id: 11 }, { id: 12 }] },
    { id: 2, runs: [{ id: 21 }] },
    { id: 3, runs: [] },
];

const row = (over = {}) => ({
    id: 5, slug: 'ski-trip', title: 'Cheap cars on a ski trip', blurb: null,
    vehicle_ids: [1, 2, 99],
    charts: [
        { title: 'Range', params: 'tab=efficiency&m=range&r=11,21&rc=eff-vehicle-bar&corr=none' },
        { title: '', params: 'tab=efficiency&m=compare&cmp_soc=20&cmp_o=vertical' },
    ],
    is_listed: true, listed_at: '2026-10-23T10:00:00Z',
    ...over,
});

describe('slugs', () => {
    it('makes a readable link name', () => {
        expect(slugify('Cheap cars on a ski trip!')).toBe('cheap-cars-on-a-ski-trip');
        expect(slugify('  Café  —  Crème ')).toBe('cafe-creme');
        expect(slugify('')).toBe('');
    });

    it('never ends on a hyphen, even when it cuts mid-word', () => {
        expect(slugify('a'.repeat(59) + ' bcd')).not.toMatch(/-$/);
    });

    it('numbers a repeat rather than reusing a slug', () => {
        expect(uniqueSlug('Ski trip', ['ski-trip'])).toBe('ski-trip-2');
        expect(uniqueSlug('Ski trip', ['ski-trip', 'ski-trip-2'])).toBe('ski-trip-3');
        expect(uniqueSlug('???', [])).toBe('comparison');
    });
});

describe('a chart saved from the address', () => {
    it('keeps the chart\'s own parameters and drops the vehicles, window and comparison', () => {
        expect(chartParamsFromSearch('?tab=efficiency&m=range&v=1,2&r=11&popout=1&fc=ski-trip&corr=none'))
            .toBe('tab=efficiency&m=range&r=11&corr=none');
    });

    it('refuses an address that is not a chart', () => {
        expect(chartParamsFromSearch('?tab=reference&sub=platforms')).toBe('');
        expect(chartParamsFromSearch('?tab=runs&vid=3')).toBe('');
        expect(chartParamsFromSearch('')).toBe('');
    });

    it('survives being built by the real writer', () => {
        const p = buildChartParams({
            view: 'efficiency', chartMode: 'range', chartConfig: { ...defaultChartConfig(), selectedRuns: [11] },
            selectedVehicles: [1, 3], vehicles, compareConfig: defaultCompareConfig(),
            roadTripConfig: defaultRoadTripConfig(), epaConfig: defaultEpaConfig(), pairings: {},
        });
        const params = chartParamsFromSearch(p.toString());
        expect(params).not.toContain('v=');
        expect(chartModeOf(params)).toBe('range');
    });

    it('names a chart by its sub-nav label', () => {
        expect(defaultChartTitle('range')).toBe('Range & Efficiency');
        expect(defaultChartTitle('compare')).toBe('Charge Stop');
    });
});

describe('a stored row', () => {
    it('becomes a comparison, titling an untitled chart by its mode', () => {
        const c = normalizeComparison(row());
        expect(c).toMatchObject({ slug: 'ski-trip', vehicleIds: [1, 2, 99], isListed: true });
        expect(c.charts.map(x => x.title)).toEqual(['Range', 'Charge Stop']);
    });

    it('drops a chart that is not one rather than breaking Home', () => {
        const c = normalizeComparison(row({ charts: [null, { title: 'x' }, { title: 'y', params: 'tab=reference' }, { title: 'ok', params: 'tab=efficiency&m=range' }] }));
        expect(c.charts).toEqual([{ title: 'ok', params: 'tab=efficiency&m=range' }]);
        expect(normalizeComparison(row({ charts: 'oops', vehicle_ids: null })).charts).toEqual([]);
    });

    it('round-trips to the columns written', () => {
        const c = normalizeComparison(row({ blurb: '  Cold and high.  ' }));
        const out = comparisonToRow({ ...c, blurb: '  Cold and high.  ' });
        expect(out).toMatchObject({ slug: 'ski-trip', blurb: 'Cold and high.', vehicle_ids: [1, 2, 99], is_listed: true });
        expect(out.charts).toHaveLength(2);
        expect(comparisonToRow({ ...c, blurb: '   ' }).blurb).toBeNull();
    });

    it('says what stops a save', () => {
        expect(comparisonProblems(normalizeComparison(row()))).toEqual([]);
        const bad = comparisonProblems({ title: ' ', slug: 'Bad Slug', vehicleIds: [], charts: [] });
        expect(bad).toHaveLength(4);
    });
});

describe('which comparison Home shows', () => {
    const a = normalizeComparison(row({ id: 1, slug: 'a', listed_at: '2026-10-01T00:00:00Z' }));
    const b = normalizeComparison(row({ id: 2, slug: 'b', listed_at: '2026-10-20T00:00:00Z' }));
    const draft = normalizeComparison(row({ id: 3, slug: 'draft', is_listed: false, listed_at: null }));

    it('is the newest listed, never a draft', () => {
        expect(comparisonToShow([a, draft, b]).slug).toBe('b');
    });

    it('is the one named, when it exists', () => {
        expect(comparisonToShow([a, b], 'a').slug).toBe('a');
        expect(comparisonToShow([a, b], 'missing').slug).toBe('b');
    });

    it('is nothing when nothing is listed', () => {
        expect(comparisonToShow([draft])).toBeNull();
        expect(comparisonToShow([])).toBeNull();
    });
});

describe('editing the chart list', () => {
    const c = normalizeComparison(row());

    it('adds a chart and the vehicles it brings, once', () => {
        const next = addChart(c, { title: 'T', params: 'tab=efficiency&m=compare' }, [2, 3]);
        expect(next.vehicleIds).toEqual([1, 2, 99, 3]);
        expect(next.charts).toHaveLength(3);
        expect(c.charts).toHaveLength(2);   // not mutated
    });

    it('removes, moves and renames', () => {
        expect(removeChart(c, 0).charts.map(x => x.title)).toEqual(['Charge Stop']);
        expect(moveChart(c, 0, 1).charts.map(x => x.title)).toEqual(['Charge Stop', 'Range']);
        expect(moveChart(c, 0, 5)).toBe(c);
        expect(renameChart(c, 1, 'Summer').charts[1].title).toBe('Summer');
    });
});

describe('putting a saved chart on screen', () => {
    const c = normalizeComparison(row());

    it('skips a vehicle that has since been deleted', () => {
        expect(liveVehicleIds(c, vehicles)).toEqual([1, 2]);
    });

    it('lays the chart\'s link over the defaults', () => {
        const s = chartStateOf(c, 0, vehicles);
        expect(s.chartMode).toBe('range');
        expect(s.view).toBe('efficiency');
        expect(s.chartConfig).toMatchObject({ selectedRuns: [11, 21], rangeChartType: 'eff-vehicle-bar', correctionMode: 'none' });
        expect(s.vehicleIds).toEqual([1, 2]);
    });

    it('does not carry one chart\'s settings into the next', () => {
        const range = chartStateOf(c, 0, vehicles);
        const compare = chartStateOf(c, 1, vehicles);
        expect(compare.chartConfig.rangeChartType).toBe(defaultChartConfig().rangeChartType);
        expect(compare.chartConfig.correctionMode).toBe(defaultChartConfig().correctionMode);
        expect(compare.chartConfig.selectedRuns).toEqual([]);
        expect(compare.compareConfig).toMatchObject({ startSoc: 20, orientation: 'vertical', selected: [] });
        expect(range.compareConfig).toEqual(defaultCompareConfig());
    });

    it('returns fresh objects, so replacing one cannot touch the defaults', () => {
        const a = chartStateOf(c, 0, vehicles);
        a.chartConfig.selectedRuns.push(999);
        expect(defaultChartConfig().selectedRuns).toEqual([]);
        expect(chartStateOf(c, 0, vehicles).chartConfig.selectedRuns).toEqual([11, 21]);
    });

    it('is null for a chart that is not there', () => {
        expect(chartStateOf(c, 7, vehicles)).toBeNull();
    });

    it('resets to the comparison\'s vehicles and the correction its first chart used', () => {
        const r = resetStateOf(c, vehicles);
        expect(r.vehicleIds).toEqual([1, 2]);
        expect(r.chartConfig.correctionMode).toBe('none');
        expect(r.chartConfig.rangeChartType).toBe(defaultChartConfig().rangeChartType);
        expect(r.chartConfig.selectedRuns).toEqual([]);
        expect(r.pairings).toEqual({});
    });

    it('resets a comparison with no charts to the defaults', () => {
        const r = resetStateOf({ ...c, charts: [] }, vehicles);
        expect(r.chartConfig.correctionMode).toBe(defaultChartConfig().correctionMode);
    });
});

describe('when opening would replace a selection worth keeping', () => {
    const c = normalizeComparison(row());

    it('is free with none or one vehicle selected', () => {
        expect(replacesSelection([], c, vehicles)).toBe(false);
        expect(replacesSelection([3], c, vehicles)).toBe(false);
    });

    it('warns with two or more that differ', () => {
        expect(replacesSelection([1, 3], c, vehicles)).toBe(true);
        expect(replacesSelection([1, 2, 3], c, vehicles)).toBe(true);
    });

    it('does not warn when the comparison would select the same vehicles', () => {
        expect(replacesSelection([2, 1], c, vehicles)).toBe(false);
        expect(replacesSelection(['1', '2'], c, vehicles)).toBe(false);
    });
});
