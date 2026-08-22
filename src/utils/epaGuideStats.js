/**
 * Statistics over the Fuel Economy Guide corpus (#236, phase 2 of #234).
 *
 * Pure module, computed from the same rows `EpaGuideView` already loads.
 *
 * ── Why this is not a set of Postgres RPCs ──────────────────────────────────
 *
 * The plan for #236 called for server-side aggregates, on the strength of
 * migration 054. That migration is about SILENT TRUNCATION: PostgREST caps a
 * response at 1000 rows without a word, so a median computed over a truncated
 * set is confidently wrong.
 *
 * `getFeGuideRows` pages until the source is exhausted and is therefore
 * complete, not truncated — the same argument that put the browser's filtering
 * in the client. Given a complete array, the reason to aggregate in SQL is gone,
 * and one reason not to remains: `body_class` is derived by `splitCarlineClass`,
 * so grouping by it in SQL would mean a second implementation of the class
 * rollup in a second language, free to drift from the one the browser shows.
 * The catalogue's own rule 3 says derivations get exactly one implementation.
 *
 * `ROW_BUDGET` in `feGuideBrowse` marks where loading the whole corpus stops
 * being reasonable. Past it, the browser and these statistics move server-side
 * together — and at that point the class rollup becomes a stored column rather
 * than a duplicated expression.
 */
import { GUIDE_COLUMNS } from './feGuideBrowse';

// ── Units of analysis ────────────────────────────────────────────────────────

/**
 * What one observation IS, which is the first thing any of these numbers
 * depends on and the last thing anyone thinks to ask.
 *
 * The corpus is one row per configuration, and configurations are not evenly
 * distributed: Rivian files 171 against Mazda's 1, mostly wheel and trim
 * variants of the same certified vehicle. Counting configurations therefore
 * measures how many variants a manufacturer chose to list, and calls it a fact
 * about the fleet.
 *
 * The test group is EPA's own grouping — the configurations certified together
 * — and collapsing onto it takes 1,175 rows to 462 while moving Rivian from
 * rank 1 to rank 10. That is why it is the default.
 *
 * None of the three is wrong. They answer different questions, and the UI says
 * which, because the same query gives materially different answers: MY2026
 * combined MPGe reads 91.0 per configuration, 95.2 per test group, 91.8 per
 * make.
 */
export const UNITS = [
    { key: 'config',     label: 'Per configuration', answers: 'What can I actually buy?' },
    { key: 'test_group', label: 'Per test group',    answers: 'What did EPA measure?' },
    { key: 'make',       label: 'Per make',          answers: 'Who builds efficient cars?' },
];
export const DEFAULT_UNIT = 'test_group';

/**
 * The guide's natural key, from migration 053's UNIQUE constraint.
 *
 * Used wherever `id` might be absent — a projection that did not select it, a
 * fixture, a row assembled in a test. Falling back to `id` alone was a quiet
 * hazard: an undefined id makes every row share one bucket, so the whole corpus
 * collapses to a single observation and the view reports a median of one number
 * with no sign anything went wrong.
 *
 * `model_type_index` is not optional here. 053 explains why: carline alone is
 * not unique, and Audi lists "Q6 e-tron quattro" three times in MY27 at 325,
 * 301 and 301 miles.
 */
const naturalKey = (r) =>
    `${r.model_year}|${r.division}|${r.carline}|${r.model_type_index}`;

/** How rows are bucketed into one observation, per unit. */
const UNIT_KEYS = {
    config:     (r) => r.id ?? naturalKey(r),
    // A row with no test group is its own group rather than joining a shared
    // null bucket, which would merge unrelated vehicles into one observation.
    test_group: (r) => `${r.model_year}|${r.smog_test_group ?? naturalKey(r)}`,
    make:       (r) => r.brand ?? r.division ?? '(unknown)',
};

// ── Dimensions and measures ──────────────────────────────────────────────────

export const DIMENSIONS = [
    { key: 'body_class',  label: 'Class' },
    { key: 'brand',       label: 'Make' },
    { key: 'parent_name', label: 'Corporate parent' },
    { key: 'drive_desc',  label: 'Drive' },
    { key: 'model_year',  label: 'Model year', numeric: true },
    { key: 'motor_count', label: 'Motors',     numeric: true },
];

export const MEASURES = [
    { key: 'label_comb_mpge',     label: 'Combined',  unit: 'MPGe', digits: 1 },
    { key: 'label_city_mpge',     label: 'City',      unit: 'MPGe', digits: 1 },
    { key: 'label_hwy_mpge',      label: 'Highway',   unit: 'MPGe', digits: 1 },
    // `axisLabel` is what an axis calls the quantity when there is no unit to
    // print. Without it the axis falls back to the measure's own name, which is
    // already the column heading directly above it.
    { key: 'city_hwy_ratio',      label: 'City:Hwy',  unit: '', axisLabel: 'ratio', digits: 3 },
    { key: 'label_comb_range_mi', label: 'Range',     unit: 'mi',   digits: 0 },
    { key: 'nominal_pack_kwh',    label: 'Pack',      unit: 'kWh',  digits: 1 },
];
export const measureByKey = (key) => MEASURES.find(m => m.key === key) ?? null;

// ── Descriptive statistics ───────────────────────────────────────────────────

const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * Linear-interpolated quantile over a sorted array.
 *
 * Interpolated rather than nearest-rank so the median of an even-sized set is
 * the midpoint of the two central values, which is what a reader expects and
 * what makes the quartiles comparable between buckets of different sizes.
 */
export function quantile(sorted, q) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * min / q1 / median / q3 / max / n over a set of values.
 *
 * Median and IQR rather than mean and standard deviation, throughout. These
 * distributions are skewed and small, and a single Lucid Air at 520 miles moves
 * a mean in a way it does not move a median. `n` is returned with every figure
 * because a median without one is not reportable.
 */
export function describe(values) {
    const clean = values.map(num).filter(v => v != null).sort((a, b) => a - b);
    if (!clean.length) return { n: 0, min: null, q1: null, median: null, q3: null, max: null };
    return {
        n:      clean.length,
        min:    clean[0],
        q1:     quantile(clean, 0.25),
        median: quantile(clean, 0.5),
        q3:     quantile(clean, 0.75),
        max:    clean[clean.length - 1],
    };
}

// ── Cluster, then summarise ──────────────────────────────────────────────────

/**
 * Collapse rows to one observation per unit.
 *
 * Cluster-then-summarise: summarise within the cluster first, then across
 * clusters. Standard for clustered data, needs no inputs we do not have, and
 * does not pretend to a sales weighting nobody has.
 *
 * The within-cluster summary is a median too, not a mean — a test group holding
 * a 20-inch and a 22-inch variant should report the middle of them, and one
 * outlying wheel option should not drag the group.
 */
export function toObservations(rows, unit = DEFAULT_UNIT) {
    const keyOf = UNIT_KEYS[unit] ?? UNIT_KEYS[DEFAULT_UNIT];
    const clusters = new Map();
    for (const r of rows) {
        const k = String(keyOf(r));
        if (!clusters.has(k)) clusters.set(k, []);
        clusters.get(k).push(r);
    }

    const out = [];
    for (const [, members] of clusters) {
        // One row in the cluster is the common case and needs no arithmetic;
        // returning the row itself keeps its labels for the outlier lists.
        if (members.length === 1) { out.push({ ...members[0], _n: 1, _members: members }); continue; }
        const summary = { ...members[0], _n: members.length, _members: members };
        for (const m of MEASURES) {
            summary[m.key] = describe(members.map(r => r[m.key])).median;
        }
        out.push(summary);
    }
    return out;
}

/**
 * One row per bucket of `dimension`, describing `measure`.
 *
 * Buckets below `minN` are returned with `suppressed: true` rather than
 * dropped. A make vanishing from a ranking reads as an error; a make shown as
 * "n too small" is an answer.
 */
export function summarise(rows, { unit = DEFAULT_UNIT, dimension, measure, minN = 3 } = {}) {
    const observations = toObservations(rows, unit);
    const buckets = new Map();
    for (const o of observations) {
        const v = o[dimension];
        if (v == null || v === '') continue;
        const k = String(v);
        if (!buckets.has(k)) buckets.set(k, { bucket: v, values: [] });
        buckets.get(k).values.push(o[measure]);
    }

    const rowsOut = [];
    for (const { bucket, values } of buckets.values()) {
        const stats = describe(values);
        if (stats.n === 0) continue;
        rowsOut.push({ bucket, ...stats, suppressed: stats.n < minN });
    }
    // Largest first among the reportable ones; suppressed buckets sink to the
    // bottom so they read as a footnote rather than as part of the ranking.
    rowsOut.sort((a, b) => {
        if (a.suppressed !== b.suppressed) return a.suppressed ? 1 : -1;
        return (b.median ?? -Infinity) - (a.median ?? -Infinity);
    });
    return rowsOut;
}

/** The corpus-wide figure for one measure, to sit beside the per-bucket ones. */
export function overall(rows, { unit = DEFAULT_UNIT, measure } = {}) {
    return describe(toObservations(rows, unit).map(o => o[measure]));
}

/**
 * Equal-width histogram of one measure.
 *
 * Equal-width rather than equal-count, because the shape is the point — the
 * adjustment factor's pile at exactly 0.700 is the finding, and quantile bins
 * would spread it across several buckets and hide it.
 */
export function histogram(rows, { unit = DEFAULT_UNIT, measure, bins = 20 } = {}) {
    const values = toObservations(rows, unit).map(o => num(o[measure])).filter(v => v != null);
    if (!values.length) return { bins: [], n: 0 };
    const min = Math.min(...values), max = Math.max(...values);
    if (min === max) return { bins: [{ from: min, to: max, count: values.length }], n: values.length };
    const width = (max - min) / bins;
    const counts = new Array(bins).fill(0);
    for (const v of values) {
        // The maximum belongs in the last bin, not in a bin past the end.
        const i = Math.min(bins - 1, Math.floor((v - min) / width));
        counts[i] += 1;
    }
    return {
        n: values.length,
        bins: counts.map((count, i) => ({ from: min + i * width, to: min + (i + 1) * width, count })),
    };
}

/**
 * The extremes of one measure, named.
 *
 * The shareable artefact: "most efficient highway car of its class" is a fact
 * about a specific vehicle, and a distribution alone never names one.
 */
export function extremes(rows, { unit = DEFAULT_UNIT, measure, count = 5 } = {}) {
    const observations = toObservations(rows, unit)
        .filter(o => num(o[measure]) != null)
        .sort((a, b) => num(b[measure]) - num(a[measure]));
    return {
        highest: observations.slice(0, count),
        lowest:  observations.slice(-count).reverse(),
    };
}

/** Label for one observation in an extremes list. */
export function observationLabel(o) {
    const bits = [o.model_year, o.brand ?? o.division, o.carline].filter(Boolean);
    return bits.join(' ');
}

/** Column metadata reused so a statistic's units match the browser's. */
export const unitLabelFor = (measureKey) =>
    measureByKey(measureKey)?.unit ?? GUIDE_COLUMNS.find(c => c.key === measureKey)?.unit ?? '';
