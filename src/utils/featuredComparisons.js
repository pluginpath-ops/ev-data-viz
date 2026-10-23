/**
 * Featured comparisons (#448): what a curator saves and Home draws.
 *
 * A featured comparison is one question told in several charts. It holds the
 * vehicles it is about (one shared, ordered set) and, per chart, a chart link
 * (utils/chartUrlState.js): the tab, mode, plotted tests, settings and
 * correction of that chart. Home draws every chart at once; clicking one makes
 * the live site look like it, and from there the reader's changes are theirs.
 *
 * This module is the rules around that record, none of it React:
 *   - the row <-> comparison mapping, tolerant of a hand-edited row
 *   - slugs, the newest-listed rule, building and editing the chart list
 *   - turning one saved chart into the full state that draws it
 *   - when opening one would replace a selection worth keeping
 *
 * Pure module — no React, no `window`.
 */
import { parseChartUrl, chartConfigFromParsed, vehicleIdsOfLink } from './chartUrlState';
import { defaultChartConfig, defaultCompareConfig, defaultRoadTripConfig, defaultEpaConfig } from './chartDefaults';
import { DEFAULT_READER_MODE, DEFAULT_CORRECTION_TARGET } from './correctionSettings';
import { categoryForMode, isChartCategory } from '../constants/chartNav';

/**
 * Parameters of a chart link that belong to the comparison or the window, not
 * to a chart: the vehicles are the comparison's, popout is a window, fc names
 * the comparison itself.
 */
const NOT_A_CHARTS_OWN = ['v', 'popout', 'fc'];

/** "Cheap cars on a ski trip" → "cheap-cars-on-a-ski-trip". */
export function slugify(text) {
    return String(text ?? '')
        .toLowerCase()
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/, '');
}

/** A slug for `title` that no comparison in `taken` already has. */
export function uniqueSlug(title, taken = []) {
    const base = slugify(title) || 'comparison';
    const used = new Set(taken);
    if (!used.has(base)) return base;
    for (let n = 2; ; n++) {
        const candidate = `${base}-${n}`;
        if (!used.has(candidate)) return candidate;
    }
}

/**
 * The part of a chart link a comparison keeps: no vehicles, window or
 * comparison parameters. Returns '' for an address that is not a chart's
 * (Home, Reference, a vehicle's page), which cannot be saved as a chart.
 *
 * @param {string} search  a query string, with or without the leading `?`
 */
export function chartParamsFromSearch(search) {
    const p = new URLSearchParams(search ?? '');
    if (!isChartCategory(p.get('tab'))) return '';
    for (const key of NOT_A_CHARTS_OWN) p.delete(key);
    return p.toString();
}

/** A chart's mode, read from its link — what Home draws and what the card names. */
export function chartModeOf(params) {
    return parseChartUrl(params).chart.chartMode;
}

/** The sub-nav label of a mode ("Range & Efficiency"), the default name of a saved chart. */
export function defaultChartTitle(mode) {
    const category = categoryForMode(mode);
    return category?.modes.find(m => m.key === mode)?.label ?? category?.label ?? 'Chart';
}

const idOf = id => (isNaN(Number(id)) ? id : Number(id));

/**
 * A stored row as the app holds it. Tolerant on purpose: a curator can edit the
 * jsonb by hand, and Home is the landing page, so a malformed chart is dropped
 * rather than breaking the first screen.
 */
export function normalizeComparison(row) {
    const charts = (Array.isArray(row?.charts) ? row.charts : [])
        .filter(c => c && typeof c.params === 'string' && isChartCategory(new URLSearchParams(c.params).get('tab')))
        .map(c => ({
            title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : defaultChartTitle(chartModeOf(c.params)),
            params: c.params,
        }));
    return {
        id:         row.id ?? null,
        slug:       row.slug,
        title:      row.title ?? '',
        blurb:      row.blurb ?? '',
        vehicleIds: (Array.isArray(row.vehicle_ids) ? row.vehicle_ids : []).map(idOf),
        charts,
        isListed:   row.is_listed === true,
        listedAt:   row.listed_at ?? null,
        createdAt:  row.created_at ?? null,
        updatedAt:  row.updated_at ?? null,
    };
}

/** A comparison as the columns DataService writes. */
export function comparisonToRow(c) {
    return {
        slug:        c.slug,
        title:       c.title.trim(),
        blurb:       c.blurb?.trim() ? c.blurb.trim() : null,
        vehicle_ids: c.vehicleIds,
        charts:      c.charts.map(({ title, params }) => ({ title: title.trim(), params })),
        is_listed:   !!c.isListed,
    };
}

/** What stops a comparison being saved, in words; an empty list means it can be. */
export function comparisonProblems(c) {
    const problems = [];
    if (!c.title?.trim()) problems.push('A featured comparison needs a title.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug ?? '')) problems.push('The link name may use only lowercase letters, numbers and single hyphens.');
    if (!c.vehicleIds?.length) problems.push('Select at least one vehicle.');
    if (!c.charts?.length) problems.push('Add at least one chart.');
    return problems;
}

/**
 * The comparison Home shows: the one named by `slug` if it can be had, else the
 * newest listed (listing an older one features it again). null if none is listed.
 */
export function comparisonToShow(comparisons, slug = null) {
    if (slug) {
        const named = comparisons.find(c => c.slug === slug);
        if (named) return named;
    }
    return comparisons
        .filter(c => c.isListed)
        .sort((a, b) => String(b.listedAt ?? '').localeCompare(String(a.listedAt ?? '')))[0] ?? null;
}

// ── Editing the chart list ───────────────────────────────────────────────────

/**
 * Add a chart. Its vehicles join the shared set at the end, so every chart of
 * the comparison keeps being drawn for one set.
 */
export function addChart(comparison, chart, vehicleIds = []) {
    return {
        ...comparison,
        vehicleIds: [...new Set([...comparison.vehicleIds, ...vehicleIds])],
        charts: [...comparison.charts, chart],
    };
}

export function removeChart(comparison, index) {
    return { ...comparison, charts: comparison.charts.filter((_, i) => i !== index) };
}

export function moveChart(comparison, from, to) {
    if (from === to || from < 0 || to < 0 || from >= comparison.charts.length || to >= comparison.charts.length) return comparison;
    const charts = [...comparison.charts];
    const [moved] = charts.splice(from, 1);
    charts.splice(to, 0, moved);
    return { ...comparison, charts };
}

export function renameChart(comparison, index, title) {
    return { ...comparison, charts: comparison.charts.map((c, i) => (i === index ? { ...c, title } : c)) };
}

// ── Putting a saved chart on screen ──────────────────────────────────────────

/**
 * The vehicles of a comparison that still exist, in its order. A vehicle deleted
 * after the comparison was saved leaves its id behind (the array has no foreign
 * key), and is skipped rather than selected.
 */
export function liveVehicleIds(comparison, vehicles) {
    const have = new Set(vehicles.map(v => String(v.id)));
    return comparison.vehicleIds.filter(id => have.has(String(id)));
}

/**
 * Every setting that draws one saved chart: its link laid over the defaults, so
 * nothing a previous chart was tweaked to leaks in. The same bundle Home hands
 * to a chart to draw it, and App applies when the chart is opened.
 *
 * @param {object} comparison
 * @param {number} index        which of its charts
 * @param {Array}  vehicles     the vehicles that exist
 * @returns {null | { view, chartMode, chartConfig, compareConfig, roadTripConfig,
 *                    epaConfig, pairings, vehicleIds }}
 */
export function chartStateOf(comparison, index, vehicles) {
    const chart = comparison.charts[index];
    if (!chart) return null;
    const parsed = parseChartUrl(chart.params);
    const mode = parsed.chart.chartMode;
    // The comparison's vehicles first, then any a plotted test of this chart
    // belongs to that the set somehow lacks.
    const fromTests = vehicleIdsOfLink(parsed.chart, vehicles);
    const vehicleIds = [...new Set([...liveVehicleIds(comparison, vehicles), ...fromTests])];
    return {
        view:           categoryForMode(mode).key,
        chartMode:      mode,
        chartConfig:    chartConfigFromParsed(parsed.chart, defaultChartConfig()),
        compareConfig:  { ...defaultCompareConfig(), ...(parsed.compare ?? {}) },
        roadTripConfig: { ...defaultRoadTripConfig(), ...(parsed.roadTrip ?? {}) },
        epaConfig:      { ...defaultEpaConfig(), ...(parsed.epa ?? {}) },
        pairings:       parsed.pairings ?? {},
        vehicleIds,
    };
}

/**
 * What "reset to this comparison" puts back: its vehicles and the correction
 * its first chart used, with every other setting back to a fresh visitor's. The
 * site has one live chart state shared by all its tabs, so it cannot hold every
 * chart of a comparison at once; each chart's own settings arrive when that
 * chart is opened.
 */
export function resetStateOf(comparison, vehicles) {
    const first = comparison.charts[0];
    const correction = first
        ? parseChartUrl(first.params).chart.correction
        : { mode: DEFAULT_READER_MODE, target: DEFAULT_CORRECTION_TARGET };
    return {
        vehicleIds:     liveVehicleIds(comparison, vehicles),
        chartConfig:    { ...defaultChartConfig(), correctionMode: correction.mode, correctionTarget: correction.target },
        compareConfig:  defaultCompareConfig(),
        roadTripConfig: defaultRoadTripConfig(),
        epaConfig:      defaultEpaConfig(),
        pairings:       {},
    };
}

/**
 * Whether opening a comparison would throw away a selection worth keeping.
 * With 0 or 1 vehicles selected the reader is not yet comparing anything, so
 * replacing it is free; with 2 or more it is a choice they made, and is warned
 * about — unless the comparison would select exactly the same vehicles.
 */
export function replacesSelection(selectedIds, comparison, vehicles) {
    if (selectedIds.length < 2) return false;
    const incoming = new Set(liveVehicleIds(comparison, vehicles).map(String));
    const current = new Set(selectedIds.map(String));
    return incoming.size !== current.size || [...current].some(id => !incoming.has(id));
}
