/**
 * What every plotted series reads at one X, for the chart readout (#455).
 *
 * Chart.js's own `index` and `x` interaction modes assume the datasets share x
 * values. Here they do not: each test has its own samples, a composite curve
 * has its own grid, and a modeled curve has another. So the lookup is done per
 * series, against that series' own x, and the answers are put side by side.
 *
 * Pure and DOM-free. The hook (useChartReadout) supplies the cursor's x and the
 * pixel conversion; this decides what each series would say.
 *
 * ── Interpolated or sampled ─────────────────────────────────────────────────
 *
 * A series drawn as a line is read OFF THE LINE: between its two samples that
 * bracket x, linearly — unless a sample is within `fuzz` of x, when that sample
 * is the reading. That puts every row at exactly the same x, which is the
 * point of reading them together — a row at SoC 54 beside a row at SoC 51
 * cannot be compared. Each such reading says `interpolated`, and the readout
 * marks it, because it is a reading of the drawn line, not a measurement.
 *
 * A series that is only points, or whose neighbours are different tests, is
 * SAMPLED: the nearest real sample within `tolerance` x-units, else nothing.
 * Interpolating between two different tests would invent a value neither test
 * produced. A series set to interpolate still snaps to its end sample just past
 * its extent, within the same tolerance, so the ends of a curve are reachable.
 *
 * Linear between the samples even where the line is drawn smoothed (`tension`):
 * the difference is smaller than the reading is worth.
 */

/** Rows the hover readout shows before it windows around the nearest. */
export const READOUT_CAP = 12;

/**
 * How far from a sample, in x-units, a point-only series still reads.
 *
 * One x-unit — a minute, a mile, a percent of SoC — is the natural size of
 * "this X" on the axes people compare on. On an axis whose whole span is small
 * (C-rate, 0–3) one unit would be the whole chart, so it is capped at 2% of
 * the visible span, and never less than three pixels so a very wide axis does
 * not demand pixel-exact aim.
 *
 * @param {{span: number, pxPerUnit: number}} axis  visible x span and its scale
 */
export function autoTolerance({ span, pxPerUnit }) {
    const wanted = Math.min(1, span * 0.02);
    const floor = pxPerUnit > 0 ? 3 / pxPerUnit : 0;
    return Math.max(wanted, floor);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// The datasets are rebuilt with the chart, so a cache keyed on the dataset
// object cannot outlive what it describes. Validated by the data array's
// identity and length as well, in case a caller mutates in place.
const sortedCache = new WeakMap();

/** A dataset's usable samples as parallel arrays, sorted by x, built once. */
function sortedOf(dataset) {
    const data = dataset.data ?? [];
    const hit = sortedCache.get(dataset);
    if (hit && hit.data === data && hit.n === data.length) return hit;

    const pts = [];
    for (let i = 0; i < data.length; i++) {
        const p = data[i];
        if (p && isNum(p.x) && isNum(p.y)) pts.push({ x: p.x, y: p.y, i });
    }
    pts.sort((a, b) => a.x - b.x || a.i - b.i);
    const entry = {
        data,
        n: data.length,
        xs: Float64Array.from(pts, p => p.x),
        ys: Float64Array.from(pts, p => p.y),
        idx: Int32Array.from(pts, p => p.i),
    };
    sortedCache.set(dataset, entry);
    return entry;
}

/** The last position whose x is <= `x`, or -1. Binary search. */
function lowerIndex(xs, x) {
    let lo = 0, hi = xs.length - 1, found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
}

/** A dataset the readout lists: not a spread band, a trend line, or opted out. */
export function isReadable(dataset) {
    return dataset.readout !== false && !dataset.spreadOf && !dataset._spread;
}

function readSeries(entry, x, mode, tolerance, fuzz) {
    const { xs, ys, idx } = entry;
    const n = xs.length;
    if (!n) return null;

    const lo = lowerIndex(xs, x);
    const sample = (k) => ({ x: xs[k], y: ys[k], index: idx[k], interpolated: false });

    if (mode === 'interpolate' && lo >= 0 && lo < n - 1) {
        const x0 = xs[lo], x1 = xs[lo + 1];
        // Close enough to a real sample to BE that sample: it is the measured
        // number, and calling a reading "read off the line" when the line's own
        // point is a hair away would flag nearly every row.
        const toLow = x - x0, toHigh = x1 - x;
        if (Math.min(toLow, toHigh) <= fuzz) return sample(toLow <= toHigh ? lo : lo + 1);
        const t = (x - x0) / (x1 - x0);
        return {
            x,
            y: ys[lo] + (ys[lo + 1] - ys[lo]) * t,
            index: t < 0.5 ? idx[lo] : idx[lo + 1],
            interpolated: true,
        };
    }

    // A sampled series, or the ends of an interpolated one: the nearest real
    // sample, if it is close enough to count as "this X".
    let best = -1, bestDist = Infinity;
    for (const k of [lo, lo + 1]) {
        if (k < 0 || k >= n) continue;
        const d = Math.abs(xs[k] - x);
        if (d < bestDist) { bestDist = d; best = k; }
    }
    return best >= 0 && bestDist <= tolerance ? sample(best) : null;
}

/**
 * Every listed series' reading at `x`, top of the plot first.
 *
 * A dataset sets how it is read with these fields, all optional:
 *   readout          false to leave it out (spread bands are left out anyway)
 *   readoutMode      'interpolate' | 'sample' — default: interpolate when it is
 *                    drawn as a line (`showLine !== false`), else sample
 *   readoutLabel     the name to list it under — default `label`
 *   readoutGroup     datasets sharing a group are ONE row: the first is the
 *                    row, the rest are its `companions` (a run's right-axis
 *                    twin, a session's acceleration trace)
 *
 * @param {Array} datasets  Chart.js datasets, `data` as `{x, y}`
 * @param {number} x        the cursor's x, in data units
 * @param {object} opts
 * @param {number} [opts.tolerance=0]  x-units a sampled series may be off by
 * @param {number} [opts.fuzz=0]  x-units within which an interpolating series
 *        snaps to its own sample and is NOT marked interpolated (the hook
 *        passes 1% of the visible span)
 * @param {(axisId: string, y: number) => number} [opts.toPixelY]  sorts the rows
 *        the way the lines stack on screen, which is not by value on a reversed
 *        axis; without it, higher values come first
 * @param {(datasetIndex: number) => boolean} [opts.isVisible]  legend toggles
 * @returns {{ rows: Array, missing: number }}  `missing` counts the listed
 *          series with nothing at this x
 */
export function readingsAtX(datasets, x, { tolerance = 0, fuzz = 0, toPixelY, isVisible = () => true } = {}) {
    const groups = new Map();

    datasets.forEach((dataset, datasetIndex) => {
        if (!dataset || !isReadable(dataset) || !isVisible(datasetIndex)) return;
        const mode = dataset.readoutMode ?? (dataset.showLine === false ? 'sample' : 'interpolate');
        const reading = readSeries(sortedOf(dataset), x, mode, tolerance, fuzz);
        const member = { dataset, datasetIndex, reading };
        const key = dataset.readoutGroup ?? `#${datasetIndex}`;
        const group = groups.get(key);
        if (group) group.companions.push(member);
        else groups.set(key, { key, primary: member, companions: [] });
    });

    const rows = [];
    let missing = 0;
    for (const { key, primary, companions } of groups.values()) {
        if (!primary.reading) { missing += 1; continue; }
        const { dataset, datasetIndex, reading } = primary;
        const yAxisID = dataset.yAxisID ?? 'y';
        rows.push({
            key,
            datasetIndex,
            dataIndex: reading.index,
            label: dataset.readoutLabel ?? dataset.label ?? '',
            color: typeof dataset.borderColor === 'string' ? dataset.borderColor
                : typeof dataset.backgroundColor === 'string' ? dataset.backgroundColor : null,
            yAxisID,
            x: reading.x,
            y: reading.y,
            interpolated: reading.interpolated,
            pixelY: toPixelY ? toPixelY(yAxisID, reading.y) : -reading.y,
            companions: companions.filter(c => c.reading).map(c => ({
                datasetIndex: c.datasetIndex,
                dataIndex: c.reading.index,
                yAxisID: c.dataset.yAxisID ?? 'y',
                x: c.reading.x,
                y: c.reading.y,
                interpolated: c.reading.interpolated,
            })),
        });
    }

    rows.sort((a, b) => a.pixelY - b.pixelY || a.datasetIndex - b.datasetIndex);
    return { rows, missing };
}

/**
 * The row whose line is closest to the cursor vertically. Every row is at the
 * same x, so "nearest" is only ever a question of y — which is also what makes
 * it independent of how densely a series is sampled. -1 with no rows; the top
 * row when there is no cursor y (a keyboard reading).
 */
export function nearestRow(rows, cursorPixelY, reach = Infinity) {
    if (!rows.length) return -1;
    if (cursorPixelY == null) return 0;
    let best = 0, bestDist = Infinity;
    rows.forEach((r, i) => {
        const d = Math.abs(r.pixelY - cursorPixelY);
        if (d < bestDist) { bestDist = d; best = i; }
    });
    return bestDist <= reach ? best : -1;
}

/**
 * How far from a line, in pixels, the cursor still counts as "on" it. Past this
 * no row is active: the cursor is in open plot, not pointing at a run, and
 * spelling out the detail of whichever happened to be least far would be
 * answering a question nobody asked.
 */
export const ACTIVE_REACH_PX = 40;

/**
 * The rows to show when there are more than `cap`: a window centred on the
 * nearest row, so the one the cursor is on never scrolls out of view. The rest
 * are counted, above and below, not dropped silently.
 */
export function windowRows(rows, nearest, cap = READOUT_CAP) {
    if (rows.length <= cap) return { shown: rows, offset: 0, above: 0, below: 0 };
    const start = Math.max(0, Math.min(nearest - Math.floor(cap / 2), rows.length - cap));
    return {
        shown: rows.slice(start, start + cap),
        offset: start,
        above: start,
        below: rows.length - start - cap,
    };
}

/**
 * A reading as the readout prints it: whole numbers from 10 up, which is all
 * these charts can tell apart. Below 10 a decimal is kept (3.1 mi/kWh, 0.45 g),
 * because rounding a ratio to its integer would collapse every row to the same
 * figure.
 */
export function readoutNumber(v) {
    if (!isNum(v)) return '—';
    const a = Math.abs(v);
    if (a >= 10) return String(Math.round(v));
    return String(Number(v.toFixed(a >= 1 ? 1 : 2)));
}

/**
 * The unit an axis title ends in — "Charge Rate (kW)" -> "kW". Only a short,
 * unspaced one: "C-Rate (~kW ÷ battery)" is a definition, not a unit, and
 * printing it after every number would be noise.
 */
export function unitOf(label) {
    const m = /\(([^()\s]{1,10})\)\s*$/.exec(String(label ?? ''));
    return m ? m[1] : '';
}

/** The axis title without its trailing unit — "Charge Rate (kW)" -> "Charge Rate". */
export function nameOf(label) {
    return String(label ?? '').replace(/\s*\([^()\s]{1,10}\)\s*$/, '');
}

/** A number with its unit after it: "54%", "36°F", "212 kW". */
export function withUnit(text, unit) {
    if (!unit) return text;
    return /^[%°]/.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
}
