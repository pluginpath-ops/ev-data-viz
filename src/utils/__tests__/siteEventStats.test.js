import { describe, it, expect } from 'vitest';
import {
    headline, homeChartViewIds, chartTypeCounts, comparisonCounts, homeViewsOverTime,
    MIN_N_TO_RANK, HOME_PAIR_SECONDS, MAX_PERIODS,
} from '../siteEventStats';

let nextId = 1;
const T0 = new Date(2026, 9, 12, 12, 0, 0).getTime(); // Mon 12 Oct 2026, local noon
const ev = (event, token, { slug = null, detail = {}, at = 0 } = {}) => ({
    id: nextId++, created_at: new Date(T0 + at * 1000).toISOString(), event, browser_token: token, slug, detail,
});
const comparison = (slug, title, nCharts = 2, isListed = true) => ({
    slug, title, isListed, charts: Array.from({ length: nCharts }, (_, i) => ({ title: `${title} chart ${i + 1}` })),
});

describe('the headline', () => {
    it('counts browsers, not events, and says when the data starts and ends', () => {
        const rows = [
            ev('home_view', 'a', { slug: 's', at: 0 }),
            ev('home_view', 'a', { slug: 't', at: 60 }),
            ev('featured_open', 'b', { slug: 's', at: 120, detail: { chart: 1, mode: 'charging' } }),
        ];
        const h = headline(rows);
        expect(h).toMatchObject({ events: 3, browsers: 2, homeViews: 2, featuredOpens: 1, resets: 0, chartViews: 0 });
        expect(h.last - h.first).toBe(120000);
    });

    it('is empty rather than broken with no rows', () => {
        expect(headline([])).toMatchObject({ events: 0, browsers: 0, first: null, last: null });
    });
});

describe('Home versus the navigation', () => {
    it('matches a chart view to the Home open that caused it, in either arrival order', () => {
        const open1 = ev('featured_open', 'a', { slug: 's', at: 0, detail: { chart: 1, mode: 'charging' } });
        const view1 = ev('chart_view', 'a', { at: 1, detail: { mode: 'charging' } });
        const view2 = ev('chart_view', 'b', { at: 10, detail: { mode: 'compare' } });
        const view3 = ev('chart_view', 'c', { at: 100, detail: { mode: 'compare' } }); // arrives first
        const open3 = ev('featured_open', 'c', { slug: 's', at: 101, detail: { chart: 2, mode: 'compare' } });
        const taken = homeChartViewIds([open1, view1, view2, view3, open3]);
        expect([...taken].sort()).toEqual([view1.id, view3.id].sort());
    });

    it('does not match another browser, another mode, or a view long after the open', () => {
        const open = ev('featured_open', 'a', { slug: 's', at: 0, detail: { chart: 1, mode: 'charging' } });
        const rows = [
            open,
            ev('chart_view', 'b', { at: 1, detail: { mode: 'charging' } }),
            ev('chart_view', 'a', { at: 1, detail: { mode: 'range' } }),
            ev('chart_view', 'a', { at: HOME_PAIR_SECONDS + 5, detail: { mode: 'charging' } }),
        ];
        expect(homeChartViewIds(rows).size).toBe(0);
    });

    it('takes each chart view at most once', () => {
        const rows = [
            ev('featured_open', 'a', { slug: 's', at: 0, detail: { mode: 'charging' } }),
            ev('featured_open', 'a', { slug: 's', at: 2, detail: { mode: 'charging' } }),
            ev('chart_view', 'a', { at: 1, detail: { mode: 'charging' } }),
        ];
        expect(homeChartViewIds(rows).size).toBe(1);
    });

    it('splits each chart type into from Home and other ways, and ranks only the ones with enough opens', () => {
        const rows = [];
        for (let i = 0; i < MIN_N_TO_RANK; i++) rows.push(ev('chart_view', `t${i}`, { at: i, detail: { mode: 'charging' } }));
        rows.push(ev('featured_open', 't0', { slug: 's', at: 0, detail: { mode: 'charging' } }));
        rows.push(ev('chart_view', 'x', { at: 500, detail: { mode: 'compare' } }));
        rows.push(ev('chart_view', 'y', { at: 501, detail: { mode: 'compare' } }));
        const out = chartTypeCounts(rows);
        expect(out.map(r => r.mode)).toEqual(['charging', 'compare']);
        expect(out[0]).toMatchObject({ opens: MIN_N_TO_RANK, fromHome: 1, other: MIN_N_TO_RANK - 1, browsers: MIN_N_TO_RANK, sparse: false });
        expect(out[1]).toMatchObject({ opens: 2, sparse: true, label: 'Charge Stop' });
    });
});

describe('featured comparisons', () => {
    it('lists a comparison nobody opened, and the charts of it nobody opened', () => {
        const out = comparisonCounts([], [comparison('quiet', 'Quiet', 3)]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ slug: 'quiet', views: 0, opens: 0, known: true, sparse: true });
        expect(out[0].charts.map(c => c.opens)).toEqual([0, 0, 0]);
    });

    it('counts views, opens, resets and the browsers behind them per comparison', () => {
        const rows = [
            ev('home_view', 'a', { slug: 's' }), ev('home_view', 'b', { slug: 's' }), ev('home_view', 'a', { slug: 's' }),
            ev('featured_open', 'a', { slug: 's', detail: { chart: 2, mode: 'charging' } }),
            ev('featured_open', 'a', { slug: 's', detail: { chart: 2, mode: 'charging' } }),
            ev('featured_reset', 'b', { slug: 's' }),
            ev('home_view', 'c', { slug: 'other' }),
        ];
        const out = comparisonCounts(rows, [comparison('s', 'Sample'), comparison('other', 'Other')]);
        const s = out.find(r => r.slug === 's');
        expect(s).toMatchObject({ title: 'Sample', views: 3, viewers: 2, opens: 2, openers: 1, resets: 1 });
        expect(s.charts).toEqual([{ number: 1, title: 'Sample chart 1', opens: 0 }, { number: 2, title: 'Sample chart 2', opens: 2 }]);
    });

    it('does not rank on a tiny count: the thin rows follow the ranked ones, whatever their opens', () => {
        const rows = [];
        for (let i = 0; i < MIN_N_TO_RANK; i++) rows.push(ev('home_view', `t${i}`, { slug: 'steady' }));
        rows.push(ev('featured_open', 't0', { slug: 'steady', detail: { chart: 1 } }));
        for (let i = 0; i < 3; i++) rows.push(ev('featured_open', 'z', { slug: 'new', detail: { chart: 1 } }));
        rows.push(ev('home_view', 'z', { slug: 'new' }));
        const out = comparisonCounts(rows, [comparison('new', 'New'), comparison('steady', 'Steady')]);
        expect(out.map(r => r.slug)).toEqual(['steady', 'new']);
        expect(out.map(r => r.sparse)).toEqual([false, true]);
    });

    it('keeps a deleted comparison\'s events, named by its slug', () => {
        const out = comparisonCounts([ev('home_view', 'a', { slug: 'gone' })], []);
        expect(out[0]).toMatchObject({ slug: 'gone', title: 'gone', known: false });
    });
});

describe('Home views over time', () => {
    it('lists every day, a quiet one at zero', () => {
        const rows = [
            ev('home_view', 'a', { slug: 's', at: 0 }),
            ev('home_view', 'b', { slug: 's', at: 60 }),
            ev('home_view', 'a', { slug: 's', at: 2 * 86400 }),
        ];
        const { periods, trimmed } = homeViewsOverTime(rows, 'day', { to: new Date(T0 + 2 * 86400 * 1000) });
        expect(periods.map(p => [p.views, p.browsers])).toEqual([[2, 2], [0, 0], [1, 1]]);
        expect(trimmed).toBe(false);
    });

    it('buckets a week from Monday', () => {
        const rows = [
            ev('home_view', 'a', { at: 0 }),                    // Mon 12 Oct
            ev('home_view', 'a', { at: 6 * 86400 }),            // Sun 18 Oct, same week
            ev('home_view', 'b', { at: 7 * 86400 }),            // Mon 19 Oct
        ];
        const { periods } = homeViewsOverTime(rows, 'week', { to: new Date(T0 + 7 * 86400 * 1000) });
        expect(periods.map(p => p.views)).toEqual([2, 1]);
        expect(periods[0].start.getDay()).toBe(1);
    });

    it('keeps the newest periods and says it trimmed', () => {
        const from = new Date(T0 - 200 * 86400 * 1000);
        const { periods, trimmed } = homeViewsOverTime([], 'day', { from, to: new Date(T0) });
        expect(periods).toHaveLength(MAX_PERIODS.day);
        expect(trimmed).toBe(true);
    });
});
