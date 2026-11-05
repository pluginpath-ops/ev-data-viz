/**
 * Axis limits: the Min/Max a reader types under a chart to pin an axis (#478).
 *
 * Every chart with Axis Scale controls keeps its limits in ONE place —
 * `chartConfig.axisLimits`, keyed by chart — and reads and writes them through
 * `useAxisLimits` (hooks/useAxisLimits.jsx). Because that is inside chartConfig,
 * the things that carry a chart's state carry the limits with no further work:
 * the pop-out (chartConfig is broadcast), a featured comparison's panel on Home
 * (it draws from its own chartConfig), and the chart link, which writes them as
 * the one packed parameter below. A chart that kept its limits in component
 * state, as Range & Efficiency, Road Trip and the Acceleration Curve did, lost
 * them on every one of those routes.
 *
 * Pure module — no React, no `window`.
 *
 * ── Units ────────────────────────────────────────────────────────────────────
 * A limit is stored as the number typed into the control, in the unit that
 * control's label names ("X-Axis Scale (hrs)", "Y-Axis Scale (mph)"), and no
 * chart converts it on the way in. Where the plot wants a different unit the
 * conversion is at the plot, through one helper here (`hoursToMinutes`), so a
 * stored number never has two meanings depending on who reads it.
 *
 * ── The link ─────────────────────────────────────────────────────────────────
 * One parameter, `ax`, for the chart the link opens: the limits that differ from
 * that chart's defaults, as `_`-joined tokens of a field and its value —
 *     ax=xn10_xx80_yx120          X from 10 to 80, Y topped at 120
 *     ax=yna                      Y minimum put back to Auto on a chart whose
 *                                 default is zero
 * `_` because it is one of the few characters a query string does not escape;
 * `,` and `:` would each cost three bytes a token. Nothing is written when no
 * limit is set, so an untouched chart keeps a short link.
 *
 * Links written before this carried `xn xx yn yx y2n y2x`, one parameter per
 * limit, from Charging Curves alone (the only chart that kept its limits in
 * chartConfig). `decodeLegacyAxisLimits` still reads them, so a saved link or a
 * featured comparison made before #478 opens as it did.
 */
export const AXIS_LIMIT_FIELDS = ['xMin', 'xMax', 'yMin', 'yMax', 'y2Min', 'y2Max'];

/** The chart-link parameter that carries the limits. */
export const AXIS_LIMITS_PARAM = 'ax';

// The token each field wears in `ax`, and the parameter it wore on its own
// before #478. The same short names, so an old link reads like a new one.
const TOKEN = { xMin: 'xn', xMax: 'xx', yMin: 'yn', yMax: 'yx', y2Min: 'y2n', y2Max: 'y2x' };
const FIELD_OF_TOKEN = Object.fromEntries(Object.entries(TOKEN).map(([field, token]) => [token, field]));
// Longest first so `y2n` is never read as `y` + `2n`.
const TOKEN_PATTERN = /^(y2n|y2x|xn|xx|yn|yx)(a|-?\d[\d.]*(?:e[-+]?\d+)?)$/;
const AUTO = 'a';

/**
 * The charts that have axis limits, keyed by what keeps them apart, with each
 * one's own defaults. A key is a chart mode where the chart is one; the Modeled
 * Efficiency "All EVs" explorer is a sub-tab, not a mode, so it has a key of its
 * own.
 *
 * A default is only listed where it is not Auto: Charging Curves and Range &
 * Efficiency start their Y axis at zero, and "a missing yn" has always meant
 * that, not "whatever the page had".
 *
 * Adding a chart with Axis Scale controls starts here; the wiring suite fails
 * until the chart's view calls `useAxisLimits` with the key it adds.
 */
export const AXIS_LIMIT_CHARTS = {
    charging:    { yMin: 0 },
    range:       { yMin: 0 },
    roadtrip:    {},
    optimizer:   {},
    perfcurve:   {},
    epacurves:   {},
    epaexplorer: {},
};

/**
 * The chart modes WITHOUT axis limits, each with why. The unit test checks that
 * every mode in chartNav is either in AXIS_LIMIT_CHARTS or here, so a new chart
 * cannot ship without someone deciding which.
 */
export const NO_AXIS_LIMITS = {
    compare:      'Charge Stop draws bars whose axis is the value itself; it has no Axis Scale controls',
    perfcompare:  'Performance Compare draws bars; it has no Axis Scale controls',
    specs:        'The Spec chart is a bar chart of one table column; it has no Axis Scale controls',
    specscatter:  'The Spec scatter fits its axes to the two columns chosen; it has no Axis Scale controls',
    specstable:   'The vehicle table is not a plot',
};

export const hasAxisLimits = chart => Object.prototype.hasOwnProperty.call(AXIS_LIMIT_CHARTS, chart);

/** A chart's limits with nothing set: Auto, bar the defaults listed above. */
export function defaultAxisLimits(chart) {
    const own = AXIS_LIMIT_CHARTS[chart] ?? {};
    return Object.fromEntries(AXIS_LIMIT_FIELDS.map(field => [field, own[field] ?? null]));
}

const isDefault = (chart, limits) => {
    const base = defaultAxisLimits(chart);
    return AXIS_LIMIT_FIELDS.every(field => (limits[field] ?? null) === base[field]);
};

/**
 * One chart's limits, all six fields, from the stored `chartConfig.axisLimits`
 * (which holds only the charts someone has set).
 */
export function axisLimitsOf(axisLimits, chart) {
    return { ...defaultAxisLimits(chart), ...(axisLimits?.[chart] ?? {}) };
}

/**
 * `axisLimits` with one chart's limits replaced. A chart set back to its
 * defaults is dropped rather than stored, so equal states compare equal and the
 * pop-out message carries nothing for a chart nobody touched.
 */
export function withAxisLimits(axisLimits, chart, limits) {
    const { [chart]: _dropped, ...rest } = axisLimits ?? {};
    if (isDefault(chart, limits)) return rest;
    return { ...rest, [chart]: { ...defaultAxisLimits(chart), ...limits } };
}

/** `axisLimits` with one limit changed. The write every chart's controls make. */
export function withAxisLimit(axisLimits, chart, field, value) {
    return withAxisLimits(axisLimits, chart, { ...axisLimitsOf(axisLimits, chart), [field]: value });
}

/**
 * The `ax` value for a chart: its limits that differ from its defaults, or '' if
 * none do.
 */
export function encodeAxisLimits(limits, chart) {
    const base = defaultAxisLimits(chart);
    return AXIS_LIMIT_FIELDS
        .filter(field => (limits[field] ?? null) !== base[field])
        .map(field => TOKEN[field] + (limits[field] == null ? AUTO : String(limits[field])))
        .join('_');
}

/**
 * A chart's limits from an `ax` value. Tolerant: a token it cannot read is
 * skipped, since a hand-edited link should lose that one limit, not the chart.
 */
export function decodeAxisLimits(raw, chart) {
    const limits = defaultAxisLimits(chart);
    for (const token of (raw ?? '').split('_')) {
        const m = TOKEN_PATTERN.exec(token);
        if (!m) continue;
        const value = m[2] === AUTO ? null : Number(m[2]);
        if (value !== null && !Number.isFinite(value)) continue;
        limits[FIELD_OF_TOKEN[m[1]]] = value;
    }
    return limits;
}

/**
 * The limits an old link carried: `xn xx yn yx y2n y2x`, written for every chart
 * but read by Charging Curves alone. Read for that chart only — on any other
 * mode they are whatever Charging Curves held when the link was copied, which
 * the chart in the link never showed and must not start to.
 *
 * @param {URLSearchParams} p
 */
export function decodeLegacyAxisLimits(p, chart) {
    const limits = defaultAxisLimits(chart);
    if (chart !== 'charging') return limits;
    for (const [token, field] of Object.entries(FIELD_OF_TOKEN)) {
        const raw = p.get(token);
        if (raw === null || raw === '') continue;
        const value = Number(raw);
        if (Number.isFinite(value)) limits[field] = value;
    }
    return limits;
}

/**
 * The limits a chart link names for the chart it opens: `ax` if it has one, else
 * the pre-#478 parameters. null for a mode with no axis limits.
 *
 * @param {URLSearchParams} p
 */
export function axisLimitsOfLink(p, chart) {
    if (!hasAxisLimits(chart)) return null;
    const packed = p.get(AXIS_LIMITS_PARAM);
    return packed !== null ? decodeAxisLimits(packed, chart) : decodeLegacyAxisLimits(p, chart);
}

/**
 * Hours as the minutes a time axis is plotted in. Road Trip's time limits are
 * typed in hours (the control says so) and its plot is in minutes; this is the
 * only place that happens.
 */
export const hoursToMinutes = hours => (hours == null ? null : hours * 60);
