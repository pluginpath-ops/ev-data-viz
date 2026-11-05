/**
 * What the site events say, as counts (#477).
 *
 * Migration 090 records what readers open under an anonymous browser token; this
 * is the reading of it. The Admin view fetches a bounded window of rows through
 * the table's admin-only read policy and everything here is arithmetic over
 * those rows — PostgREST has no aggregates, and a window this small does not
 * need a function in the database.
 *
 * Counts only. A token is a browser, not a person: the same person on two
 * browsers is two, and a browser that clears its storage starts again as a new
 * one. Nothing here guesses otherwise.
 *
 * Pure module — no React, no storage. A row is
 * `{ id, created_at, event, browser_token, slug, detail }`.
 */
import { SITE_EVENTS } from './siteEvents';
import { labelForMode } from '../constants/chartNav';

/** The most rows one view reads. Past it the oldest are left out and the view says so. */
export const EVENT_ROW_CAP = 20000;

/**
 * Fewer than this many observations and a figure is shown but not ranked on.
 * Ten Home views is still a handful of browsers; two comparisons at 3 and 5
 * opens are not "first" and "second", they are noise in a different order.
 */
export const MIN_N_TO_RANK = 10;

/**
 * How far apart (seconds) a featured open and the chart view it caused may be
 * and still be taken as one click. The open is logged just before the tab
 * changes, and each is a separate request, so they arrive within a moment of
 * each other in either order.
 */
export const HOME_PAIR_SECONDS = 30;

const tOf = row => new Date(row.created_at).getTime();
const modeOf = row => row.detail?.mode ?? null;

const count = (rows, event) => rows.filter(r => r.event === event).length;
const distinctBrowsers = rows => new Set(rows.map(r => r.browser_token)).size;

/** The figures at the head of the view: how much there is to read. */
export function headline(rows) {
    return {
        events:        rows.length,
        browsers:      distinctBrowsers(rows),
        homeViews:     count(rows, SITE_EVENTS.HOME_VIEW),
        featuredOpens: count(rows, SITE_EVENTS.FEATURED_OPEN),
        resets:        count(rows, SITE_EVENTS.FEATURED_RESET),
        chartViews:    count(rows, SITE_EVENTS.CHART_VIEW),
        first:         rows.length ? new Date(Math.min(...rows.map(tOf))) : null,
        last:          rows.length ? new Date(Math.max(...rows.map(tOf))) : null,
    };
}

/**
 * The ids of the chart views that were reached from Home.
 *
 * Opening a featured chart logs a `featured_open` and then, because the tab
 * changes, an ordinary `chart_view` — so every Home open is also in the chart
 * views, and "reached from the navigation" is what is left once they are taken
 * out. Nothing on the row says which is which, so they are matched: the same
 * browser, the same chart mode, within HOME_PAIR_SECONDS, each chart view taken
 * at most once. It is a match, not a record — a flooded token whose chart view
 * was refused leaves its open unmatched, which is the right way round.
 */
export function homeChartViewIds(rows) {
    const opens = rows.filter(r => r.event === SITE_EVENTS.FEATURED_OPEN).sort((a, b) => tOf(a) - tOf(b));
    const views = rows.filter(r => r.event === SITE_EVENTS.CHART_VIEW);
    const byToken = new Map();
    for (const v of views) {
        if (!byToken.has(v.browser_token)) byToken.set(v.browser_token, []);
        byToken.get(v.browser_token).push(v);
    }
    const taken = new Set();
    for (const open of opens) {
        const candidates = (byToken.get(open.browser_token) ?? [])
            .filter(v => !taken.has(v.id)
                && modeOf(v) === modeOf(open)
                && Math.abs(tOf(v) - tOf(open)) <= HOME_PAIR_SECONDS * 1000)
            .sort((a, b) => Math.abs(tOf(a) - tOf(open)) - Math.abs(tOf(b) - tOf(open)));
        if (candidates.length) taken.add(candidates[0].id);
    }
    return taken;
}

/**
 * Per chart type (mode): how often it was opened, how many of those came from
 * Home, and how many browsers opened it. Most-opened first among the modes with
 * enough opens to rank; the rest follow, unranked, by name.
 */
export function chartTypeCounts(rows) {
    const fromHome = homeChartViewIds(rows);
    const byMode = new Map();
    for (const r of rows) {
        if (r.event !== SITE_EVENTS.CHART_VIEW || !modeOf(r)) continue;
        const m = byMode.get(modeOf(r)) ?? { mode: modeOf(r), opens: 0, fromHome: 0, tokens: new Set() };
        m.opens += 1;
        if (fromHome.has(r.id)) m.fromHome += 1;
        m.tokens.add(r.browser_token);
        byMode.set(m.mode, m);
    }
    const out = [...byMode.values()].map(m => ({
        mode:     m.mode,
        label:    labelForMode(m.mode),
        opens:    m.opens,
        fromHome: m.fromHome,
        other:    m.opens - m.fromHome,
        browsers: m.tokens.size,
        sparse:   m.opens < MIN_N_TO_RANK,
    }));
    return rankedFirst(out, r => r.opens, r => r.label);
}

/**
 * Per featured comparison: Home views (the n for everything else on its row),
 * opens of its charts, resets, and the browsers behind each. A comparison that
 * exists but has no events still gets a row — "nobody opened it" is an answer.
 * A slug with events but no comparison is a deleted one, and says so.
 *
 * `comparisons` are normalized (utils/featuredComparisons.js).
 */
export function comparisonCounts(rows, comparisons = []) {
    const bySlug = new Map();
    const entry = slug => {
        if (!bySlug.has(slug)) bySlug.set(slug, { slug, views: [], opens: [], resets: [] });
        return bySlug.get(slug);
    };
    for (const c of comparisons) entry(c.slug);
    for (const r of rows) {
        if (!r.slug) continue;
        if (r.event === SITE_EVENTS.HOME_VIEW)      entry(r.slug).views.push(r);
        if (r.event === SITE_EVENTS.FEATURED_OPEN)  entry(r.slug).opens.push(r);
        if (r.event === SITE_EVENTS.FEATURED_RESET) entry(r.slug).resets.push(r);
    }
    const known = new Map(comparisons.map(c => [c.slug, c]));

    const out = [...bySlug.values()].map(e => {
        const c = known.get(e.slug) ?? null;
        const opensByChart = new Map();
        for (const o of e.opens) {
            const n = Number(o.detail?.chart);
            if (Number.isInteger(n) && n > 0) opensByChart.set(n, (opensByChart.get(n) ?? 0) + 1);
        }
        // The comparison's own charts, in order, with the ones nobody opened.
        const chartNumbers = c ? c.charts.map((_, i) => i + 1) : [...opensByChart.keys()].sort((a, b) => a - b);
        return {
            slug:     e.slug,
            title:    c?.title || e.slug,
            known:    c !== null,
            isListed: c?.isListed ?? false,
            views:    e.views.length,
            viewers:  distinctBrowsers(e.views),
            opens:    e.opens.length,
            openers:  distinctBrowsers(e.opens),
            resets:   e.resets.length,
            charts:   chartNumbers.map(n => ({
                number: n,
                title:  c?.charts[n - 1]?.title || `Chart ${n}`,
                opens:  opensByChart.get(n) ?? 0,
            })),
            sparse:   e.views.length < MIN_N_TO_RANK,
        };
    });
    return rankedFirst(out, r => r.opens, r => r.title, r => !r.sparse);
}

/** Ranked rows by `measure` descending, then the sparse ones by name, unranked. */
function rankedFirst(rows, measure, name, isRanked = r => !r.sparse) {
    const ranked = rows.filter(isRanked).sort((a, b) => measure(b) - measure(a) || name(a).localeCompare(name(b)));
    const rest = rows.filter(r => !isRanked(r)).sort((a, b) => name(a).localeCompare(name(b)));
    return [...ranked, ...rest];
}

// ── Home over time ───────────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Monday of the week, local time. */
const startOfWeek = d => {
    const s = startOfDay(d);
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
    return s;
};
const addDays = (d, n) => { const s = new Date(d); s.setDate(s.getDate() + n); return s; };

/** How many periods the series shows at most, newest kept. */
export const MAX_PERIODS = { day: 90, week: 52 };

/**
 * Home views by day or by week, oldest first, every period from the first with
 * an event (or `from`) to the last drawn — a quiet day is a zero, not a gap. Days
 * and weeks are the viewer's own time zone; weeks start on Monday.
 *
 * @param {Array}  rows
 * @param {'day'|'week'} grain
 * @param {{ from?: Date, to?: Date }} [span]  the window; defaults to the rows' extent
 * @returns {{ periods: Array<{ key, start: Date, views: number, browsers: number }>, trimmed: boolean }}
 */
export function homeViewsOverTime(rows, grain, { from = null, to = new Date() } = {}) {
    const views = rows.filter(r => r.event === SITE_EVENTS.HOME_VIEW);
    const floor = grain === 'week' ? startOfWeek : startOfDay;
    const step = grain === 'week' ? 7 : 1;

    const first = from ?? (rows.length ? new Date(Math.min(...rows.map(tOf))) : to);
    let start = floor(first);
    const end = floor(to);

    let trimmed = false;
    const max = MAX_PERIODS[grain];
    const total = Math.round((end - start) / (step * 86400000)) + 1;
    if (total > max) {
        start = addDays(end, -step * (max - 1));
        trimmed = true;
    }

    const buckets = new Map();
    for (let d = start; d <= end; d = addDays(d, step)) {
        buckets.set(dayKey(d), { key: dayKey(d), start: d, views: 0, tokens: new Set() });
    }
    for (const r of views) {
        const b = buckets.get(dayKey(floor(new Date(r.created_at))));
        if (!b) continue;
        b.views += 1;
        b.tokens.add(r.browser_token);
    }
    return {
        periods: [...buckets.values()].map(b => ({ key: b.key, start: b.start, views: b.views, browsers: b.tokens.size })),
        trimmed,
    };
}
