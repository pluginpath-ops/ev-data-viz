/**
 * The settings key (`sk=1.…`): a chart link's less common settings, packed
 * into one parameter so the address stays short and readable where it counts.
 *
 * A chart link names what is plotted in plain parameters (`m`, `v`, `r`,
 * `rt_sp` …). Everything else that changes how a chart draws — the palette and
 * hand-set colors, labels, routing overrides, the Performance and Weekly Plan
 * views' controls — goes in here, so a link, the pop-out and a featured
 * comparison draw what the sender saw.
 *
 * It is a packing of ordinary parameters, not a second record: the same
 * parameters can stand in the query unpacked, and are read the same either way.
 * A short link packs them flat beside the rest, and a featured comparison
 * stores them flat so a curator can read the row (`openSettingsKey`).
 *
 * ── The key ──────────────────────────────────────────────────────────────────
 *   <version>.<body> — the body is the short link's version-1 packing
 *   (shortLink.js `packParams`), nothing implied.
 *
 * ── Adding a setting ─────────────────────────────────────────────────────────
 * One row in SETTINGS: its parameter, the charts it belongs to, where it lives
 * and its default. The row is the read and the write, so they cannot disagree.
 * Append its parameter to shortLink.js NAMES_V1 so it packs small. The wiring
 * suite fails on a chart setting no row names.
 *
 * A parameter may be renamed if it must: links are meant to last weeks, and
 * one with an old name opens drawn the default way. Featured comparisons hold
 * the names longer, so a rename resets those settings until re-featured.
 *
 * Pure module — no React, no `window`.
 */
import { packParams, unpackParams } from './shortLink';
import { encodeColorMap, decodeColorMap } from './colorPicks';
import { SERIES_PALETTES, VEHICLE_PALETTE, DEFAULT_SERIES_PALETTE } from './colorUtils';
import { DEFAULT_SIZE_PHOTO_OPACITY } from '../constants/sizeChart';
import { defaultRoadTripConfig } from './chartDefaults';

export const SETTINGS_KEY_PARAM = 'sk';
const SETTINGS_KEY_VERSION = '1';

const idOf = id => (isNaN(Number(id)) ? id : Number(id));

// ── Codecs: a value as a parameter's text, and back ─────────────────────────
// `dec` returns undefined for text it cannot read, which is then ignored.

const bool = { enc: v => (v ? '1' : '0'), dec: s => (s === '1' ? true : s === '0' ? false : undefined) };
const num  = { enc: v => String(v), dec: s => (s !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined) };
const oneOf = values => ({ enc: String, dec: s => (values.includes(s) ? s : undefined) });
const text = { enc: String, dec: s => s || undefined };
const id   = { enc: String, dec: s => (s ? idOf(s) : undefined) };
/** A list of ids. Empty is a value ("none"), unlike a map's. */
const ids  = { enc: v => v.join(','), dec: s => s.split(',').filter(Boolean).map(idOf) };
const colors = { enc: v => encodeColorMap(v), dec: decodeColorMap, empty: true };
/** `{ name: 'word' }` as `name:word,…`; a name holds no colon. */
const words = {
    enc: obj => Object.entries(obj ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}:${v}`).join(','),
    dec: s => {
        const out = {};
        for (const part of s.split(',')) {
            const at = part.indexOf(':');
            if (at > 0 && at < part.length - 1) out[part.slice(0, at)] = part.slice(at + 1);
        }
        return out;
    },
    empty: true,
};
/**
 * Named numbers as `<code><number>` parts, e.g. `ms5`, `ld120`: `fields` is
 * [[code, name], …]. A blank, missing or non-numeric value is not written.
 */
const numberParts = fields => ({
    enc: obj => fields
        .filter(([, f]) => obj?.[f] !== '' && obj?.[f] != null && Number.isFinite(Number(obj[f])))
        .map(([c, f]) => `${c}${Number(obj[f])}`),
    dec: parts => {
        const out = {};
        for (const part of parts) {
            const field = fields.find(([c]) => part.startsWith(c));
            const n = field ? Number(part.slice(field[0].length)) : NaN;
            if (field && part.length > field[0].length && Number.isFinite(n)) out[field[1]] = n;
        }
        return out;
    },
});

/**
 * Customize routing's overrides, `{ [pairKey]: { minSoc, legDistance, chargeTime } }`,
 * as `<pairKey>/ms5/ld120/ct25,…`. A pair key holds no `/`.
 */
const ROUTING_PARTS = numberParts([['ms', 'minSoc'], ['ld', 'legDistance'], ['ct', 'chargeTime']]);
const routing = {
    enc: perRun => Object.entries(perRun ?? {})
        .map(([key, ov]) => [key, ...ROUTING_PARTS.enc(ov)])
        .filter(parts => parts.length > 1)
        .map(parts => parts.join('/'))
        .join(','),
    dec: s => {
        const out = {};
        for (const entry of s.split(',')) {
            const [key, ...parts] = entry.split('/');
            const ov = ROUTING_PARTS.dec(parts);
            if (key && Object.keys(ov).length) out[key] = ov;
        }
        return out;
    },
    empty: true,
};

/**
 * Modeled Efficiency's wind and elevation change (hooks/useViewingConditions.js),
 * as `ws20/wd180/gg500/gd10`. The inputs hold text, '' for "not set"; the
 * elevation disclosure is open when a route is set.
 */
const EXTRAS_PARTS = numberParts([
    ['ws', 'windSpeedMph'], ['wd', 'windDirectionDeg'], ['gg', 'gradeGainFt'], ['gd', 'gradeDistanceMiles'],
]);
const extras = {
    enc: x => EXTRAS_PARTS.enc(x).join('/'),
    dec: s => {
        const set = Object.fromEntries(Object.entries(EXTRAS_PARTS.dec(s.split('/'))).map(([f, n]) => [f, String(n)]));
        if (!Object.keys(set).length) return undefined;
        return {
            windSpeedMph: '', windDirectionDeg: '', gradeGainFt: '', gradeDistanceMiles: '', ...set,
            gradeExpanded: 'gradeGainFt' in set || 'gradeDistanceMiles' in set,
        };
    },
    empty: true,
};

// ── The settings ────────────────────────────────────────────────────────────

const TRIP = ['roadtrip', 'optimizer'];
/** The palettes a link may name: a series palette, or each vehicle's own color. */
const PALETTE_IDS = [...SERIES_PALETTES.map(p => p.id), VEHICLE_PALETTE];
/** Every chart that draws series, so has colors and labels: all but the vehicle table. */
const SERIES = null;

/** Marks a setting whose ids (a map's keys, a list's items, or one id) name
 *  what is plotted: only those still plotted are written. */
const PLOTTED = 'plotted';

/**
 * [parameter, charts it is written for (null: every series chart), config, path, codec, default, PLOTTED?]
 *   config  'chart' (chartConfig), 'roadTrip' or 'epa'
 *   path    the field, or [group, field] for a view's group in chartConfig
 * A value equal to its default is not written; with a null default, any value
 * set is.
 *
 * A PLOTTED setting is kept in the session for rows you may tick again, but a
 * link carries only the part for what is on the chart. The Performance
 * Curves runs are not marked: the link cannot see which runs are plotted, so
 * that view drops its own stale ones (PerformanceCurveView).
 */
const SETTINGS = [
    // Colors and labels, every series chart. (The session bases `vb` and the
    // hand-set picks `col` are written by chartUrlState.js: they depend on
    // the selected vehicles.)
    ['pal',     SERIES,          'chart',    'seriesPalette',              oneOf(PALETTE_IDS), DEFAULT_SERIES_PALETTE],
    ['vl',      SERIES,          'chart',    'verboseLabels',              bool,  false],
    // The test spread on Range & Efficiency and Charge Stop.
    ['tsp',     ['range', 'compare'], 'chart', 'testSpread',              bool,  true],
    ['rpts',    ['range'],       'chart',    'rangePoints',                bool,  true],
    // The Size chart's drawing.
    ['sz_l',    ['specsize'],    'chart',    'sizeLines',                  bool,  true],
    ['sz_g',    ['specsize'],    'chart',    'sizeGrid',                   bool,  true],
    ['sz_o',    ['specsize'],    'chart',    'sizeOpacity',                num,   DEFAULT_SIZE_PHOTO_OPACITY],
    ['sz_p',    ['specsize'],    'chart',    'sizePicked',                 id,    null, PLOTTED],
    // Road Trip and Trip Optimizer. The destination SoC sits beside rt_ss and
    // rt_ms but is behind an ⓘ, and a readable rt_ds would lengthen every
    // short link (its frozen defaults predate it).
    ['rt_ds',   TRIP,            'roadTrip', 'destinationMinSoc',          num,   defaultRoadTripConfig().destinationMinSoc],
    ['rt_pr',   TRIP,            'roadTrip', 'perRun',                     routing, {}, PLOTTED],
    ['rt_mk',   ['optimizer'],   'roadTrip', 'mapKey',                     text,  null, PLOTTED],
    ['rt_tsp',  TRIP,            'roadTrip', 'testSpread',                 bool,  false],
    // Modeled Efficiency: hand-set curve colors, and the wind and elevation change.
    ['epa_mc',  ['epacurves'],   'epa',      'mappingColors',              colors, {}, PLOTTED],
    ['epa_x',   ['epacurves'],   'epa',      'extras',                     extras, null],
    // Performance · Compare.
    ['pc_sd',   ['perfcompare'], 'chart',    ['perfCompare', 'sortDir'],   oneOf(['best', 'worst']),  'best'],
    ['pc_bm',   ['perfcompare'], 'chart',    ['perfCompare', 'barMode'],   oneOf(['best', 'source']),  'best'],
    ['pc_or',   ['perfcompare'], 'chart',    ['perfCompare', 'origin'],    oneOf(['all', 'session', 'published']),  'all'],
    ['pc_mt',   ['perfcompare'], 'chart',    ['perfCompare', 'metrics'],   words, {}],
    ['pc_bk',   ['perfcompare'], 'chart',    ['perfCompare', 'brakingMode'], oneOf(['distance', 'g']), 'distance'],
    // Performance · Curves.
    ['pv_pub',  ['perfcurve'],   'chart',    ['perfCurve', 'showPublished'], bool, true],
    ['pv_grp',  ['perfcurve'],   'chart',    ['perfCurve', 'grouping'],    oneOf(['mode', 'vehicle', 'all']),  'mode'],
    ['pv_runs', ['perfcurve'],   'chart',    ['perfCurve', 'pickedRunIds'], ids,  null],
    ['pv_col',  ['perfcurve'],   'chart',    ['perfCurve', 'colorEdits'],  colors, {}],
    ['pv_g',    ['perfcurve'],   'chart',    ['perfCurve', 'showG'],       bool,  false],
    // Cost & Time · Weekly Charging Plan.
    ['wp_ch',   ['driveplan'],   'chart',    ['weeklyPlan', 'chartKind'],  oneOf(['balance', 'day', 'line']),  'balance'],
    ['wp_pick', ['driveplan'],   'chart',    ['weeklyPlan', 'pickedId'],   id,    null, PLOTTED],
    ['wp_cmp',  ['driveplan'],   'chart',    ['weeklyPlan', 'compare'],    oneOf(['none', 'season', 'level']),  'none'],
    ['wp_lvl',  ['driveplan'],   'chart',    ['weeklyPlan', 'compareLevel'], num, null],
];

/** Every parameter the settings key may hold, for shortLink's names and the tests. */
export const SETTINGS_PARAMS = [...SETTINGS.map(([param]) => param), 'vb', 'col'];

const getAt = (obj, path) => (Array.isArray(path) ? obj?.[path[0]]?.[path[1]] : obj?.[path]);
const setAt = (obj, path, value) => {
    if (!Array.isArray(path)) { obj[path] = value; return; }
    obj[path[0]] = { ...(obj[path[0]] ?? {}), [path[1]]: value };
};

/**
 * `value` cut to what `plotted` holds: a map's keys, a list's items, or one
 * id (null when it is not plotted).
 *
 * @param {Set<string>} plotted  ids as strings
 */
export function keepPlotted(value, plotted) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.filter(v => plotted.has(String(v)));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => plotted.has(k)));
    return plotted.has(String(value)) ? value : null;
}

/**
 * Writes the settings of `chartMode` that differ from their defaults into `p`.
 *
 * @param {URLSearchParams} p
 * @param {object} configs  { chart, roadTrip, epa }
 * @param {Set<string>} [plotted]  the ids on the chart (chartUrlState.js
 *                      `plottedIdsOf`); a PLOTTED setting keeps only those
 */
export function writeSettings(p, chartMode, configs, plotted) {
    for (const [param, modes, config, path, codec, def, scope] of SETTINGS) {
        if (modes && !modes.includes(chartMode)) continue;
        const raw = getAt(configs[config], path);
        const value = scope === PLOTTED && plotted ? keepPlotted(raw, plotted) : raw;
        if (value == null) continue;
        const enc = codec.enc(value);
        if (codec.empty && enc === '') continue;
        if (def != null && enc === codec.enc(def)) continue;
        p.set(param, enc);
    }
}

/**
 * The settings `p` names, as fragments of each config: { chart, roadTrip, epa },
 * each holding only what the link says. A group (perfCompare …) holds only its
 * named fields; `mergeSettings` lays it over the config's own.
 */
export function readSettings(p) {
    const out = { chart: {}, roadTrip: {}, epa: {} };
    for (const [param, , config, path, codec] of SETTINGS) {
        if (!p.has(param)) continue;
        const value = codec.dec(p.get(param));
        if (value !== undefined) setAt(out[config], path, value);
    }
    return out;
}

/** `config` with a `readSettings` fragment laid over it, groups merged field by field. */
export function mergeSettings(config, fragment) {
    const out = { ...config };
    for (const [key, value] of Object.entries(fragment ?? {})) {
        const group = value && typeof value === 'object' && !Array.isArray(value) && GROUPS.has(key);
        out[key] = group ? { ...(config?.[key] ?? {}), ...value } : value;
    }
    return out;
}
const GROUPS = new Set(SETTINGS.filter(r => Array.isArray(r[3])).map(r => r[3][0]));

/** Parameters as a settings key, '' when there are none. */
export function encodeSettingsKey(p) {
    return [...p.keys()].length ? `${SETTINGS_KEY_VERSION}.${packParams(p)}` : '';
}

/**
 * A query with its settings key opened out into plain parameters. A key that
 * cannot be read is dropped: it only ever holds how a chart draws, so the chart
 * still opens, drawn the default way. A plain parameter beside the key wins.
 *
 * @param {string|URLSearchParams} search
 * @returns {URLSearchParams}
 */
export function openSettingsKey(search) {
    const p = new URLSearchParams(search ?? '');
    const key = p.get(SETTINGS_KEY_PARAM);
    if (key == null) return p;
    p.delete(SETTINGS_KEY_PARAM);
    const dot = key.indexOf('.');
    if (key.slice(0, dot) !== SETTINGS_KEY_VERSION) return p;
    try {
        for (const [name, value] of unpackParams(key.slice(dot + 1))) if (!p.has(name)) p.set(name, value);
    } catch {
        // Unreadable: the chart opens drawn the default way.
    }
    return p;
}
