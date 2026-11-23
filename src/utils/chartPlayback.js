/**
 * Playback: a chart drawn over time, every series on one clock, sped up.
 *
 * The clock is minutes from a common start. Two ways a chart reveals itself:
 *
 *  - Points carry their own clock (`t`): each series is cut to the points at
 *    or before the clock, plus one in-between point where the clock falls
 *    between two samples. Charging Curves uses this, so a SoC-vs-kW chart can
 *    race: the X axis is not time, but each point knows when it happened.
 *  - The X axis IS the clock (`clockFromX`): the plot is clipped at the
 *    clock. Road Trip's timeline uses this, so its stop boxes and markers,
 *    drawn by its own plugin, are revealed with the lines.
 *
 * A dataset with no clocked point at all is drawn whole (a reference line).
 * While playing, the axes keep the extent of the whole chart, so the scale
 * does not grow as the series do.
 */

/** Speeds are a log scale: the slider's 0..1 position → a speed factor. */
export function speedAt(pos, min, max) {
    const p = Math.min(1, Math.max(0, pos));
    return min * Math.pow(max / min, p);
}

/** The inverse of speedAt. */
export function positionOfSpeed(speed, min, max) {
    return Math.log(speed / min) / Math.log(max / min);
}

/** A speed rounded to 1–2 significant figures, for display and for the slider. */
export function roundSpeed(speed) {
    const mag = Math.pow(10, Math.floor(Math.log10(speed)) - (speed >= 100 ? 1 : 0));
    return Math.round(speed / mag) * mag;
}

/** Minutes → "#m ##s", or "#h ##m" with `hours` (by default, from an hour on).
 *  Units spelled out: "h:mm" and "m:ss" read alike. A clock and its end pass
 *  the same `hours`, so "0h 37m / 7h 51m" reads as one unit. Before the start
 *  (a curve below the start SoC) it is negative: "−2m 30s". */
export function formatClock(min, hours = Math.abs(min) >= 60) {
    const sign = min < 0 ? '−' : '';
    const m = Math.abs(min);
    if (hours) {
        const h = Math.floor(m / 60);
        return `${sign}${h}h ${String(Math.floor(m - h * 60)).padStart(2, '0')}m`;
    }
    const s = Math.floor((m - Math.floor(m)) * 60);
    return `${sign}${Math.floor(m)}m ${String(s).padStart(2, '0')}s`;
}

/** Minutes in words, for the chart's subtitle: "12 min", "3h 25m". */
export function formatElapsed(min) {
    const m = Math.max(0, Math.floor(min));
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Tell whatever shows the clock (PlaybackStamp) that it moved. */
export function notifyPlayback(state) {
    state.listeners?.forEach(fn => fn());
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The points of one series at clock `now`: those with t ≤ now, and where the
 * clock falls between two samples a point interpolated between them, so a
 * line grows smoothly instead of a sample at a time. Points with no clock
 * are kept. Assumes t rises along the series, as a test's samples do.
 */
export function sliceByClock(points, now) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (!isNum(p.t)) { out.push(p); continue; }
        if (p.t <= now) { out.push(p); continue; }
        const prev = out[out.length - 1];
        if (prev && isNum(prev.t) && now > prev.t && isNum(prev.x) && isNum(p.x)) {
            const f = (now - prev.t) / (p.t - prev.t);
            const lerp = (a, b) => (isNum(a) && isNum(b) ? a + (b - a) * f : a);
            out.push({ ...prev, x: lerp(prev.x, p.x), y: lerp(prev.y, p.y), t: now });
        }
        break;
    }
    return out;
}

/** The y of a series at x, read along its line; null outside it. */
function yAtX(points, x) {
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (!isNum(a.x) || !isNum(b.x) || !isNum(a.y) || !isNum(b.y)) continue;
        if (a.x <= x && x <= b.x) {
            // A vertical run (a stop on a drive-time axis): the value after it.
            if (b.x === a.x) return b.y;
            return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
        }
    }
    return null;
}

const hasClock = (data) => data.some(p => isNum(p?.t));

/** The last clock a series has: when it finishes. */
function lastClock(data) {
    for (let i = data.length - 1; i >= 0; i--) if (isNum(data[i]?.t)) return data[i].t;
    return null;
}

/**
 * "Done at" labels beside finished series' dots, in their colors: right of the
 * dot, or left when it would run off the plot. Labels that would overlap are
 * stepped apart vertically, in order down the chart.
 */
function drawFinishLabels(chart, labels, hours) {
    if (!labels.length) return;
    const { ctx, chartArea } = chart;
    const font = chart.options.font ?? {};
    const size = font.size ?? 12;
    ctx.font = `600 ${size}px ${font.family ?? 'sans-serif'}`;
    ctx.textBaseline = 'middle';
    const gap = size + 4;
    labels.sort((a, b) => a.py - b.py);
    let lastY = -Infinity;
    for (const l of labels) {
        const y = Math.max(l.py, lastY + gap);
        lastY = y;
        const text = formatClock(l.end, hours);
        const w = ctx.measureText(text).width;
        const right = l.px + 9 + w <= chartArea.right;
        ctx.textAlign = right ? 'left' : 'right';
        ctx.fillStyle = l.color;
        ctx.fillText(text, right ? l.px + 9 : l.px - 9, y);
    }
}

/**
 * Where playback runs: from the earliest clock any series has (below zero
 * when a curve starts before the start SoC; never above zero) to the last.
 */
export function clockExtent(datasets, clockFromX) {
    let start = 0, end = 0;
    for (const ds of datasets) {
        for (const p of ds._playbackFull ?? ds.data ?? []) {
            const c = clockFromX ? p?.x : p?.t;
            if (!isNum(c)) continue;
            if (c > end) end = c;
            if (c < start) start = c;
        }
    }
    return { start, end };
}

/**
 * The Chart.js plugins, reading `state` (a ref's current): { active, now,
 * clockFromX, onExtent }. Two, because a clip must open before every other
 * plugin draws under the datasets and close after the last draws over them:
 * `open` goes first in a chart's plugin list, `close` last, or before a
 * plugin that draws labels past the clip and gates them itself.
 */
export function playbackPlugins(stateRef) {
    const st = () => stateRef.current;
    const open = {
        id: 'playbackOpen',
        beforeDatasetsDraw(chart) {
            const s = st();
            if (!s.active || !s.clockFromX) return;
            const { left, top, right, bottom } = chart.chartArea;
            const edge = Math.min(right, Math.max(left, chart.scales.x.getPixelForValue(s.now)));
            chart.ctx.save();
            chart.ctx.beginPath();
            chart.ctx.rect(left, top, edge - left, bottom - top);
            chart.ctx.clip();
            chart.$playbackClipped = true;
        },
    };
    const close = {
        id: 'playbackClose',
        beforeUpdate(chart) {
            const s = st();
            for (const ds of chart.data.datasets) {
                ds._playbackFull ??= ds.data;
                ds.data = (s.active && !s.clockFromX && hasClock(ds._playbackFull))
                    ? sliceByClock(ds._playbackFull, s.now)
                    : ds._playbackFull;
            }
            s.extent = clockExtent(chart.data.datasets, s.clockFromX);
            s.onExtent?.(s.extent);
        },
        // Hold the axes at the whole chart's extent, so they do not grow as the
        // series do. A limit the reader set stands.
        afterDataLimits(chart, { scale }) {
            const s = st();
            if (!s.active || s.clockFromX || (scale.axis !== 'x' && scale.axis !== 'y')) return;
            const key = scale.axis;
            let lo = Infinity, hi = -Infinity;
            chart.data.datasets.forEach((ds, i) => {
                if (!chart.isDatasetVisible(i)) return;
                if ((ds[`${key}AxisID`] ?? key) !== scale.id) return;
                for (const p of ds._playbackFull ?? []) {
                    const v = p?.[key];
                    if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
                }
            });
            if (scale.options.min == null && lo < scale.min) scale.min = lo;
            if (scale.options.max == null && hi > scale.max) scale.max = hi;
        },
        afterDatasetsDraw(chart) {
            const s = st();
            if (chart.$playbackClipped) { chart.ctx.restore(); chart.$playbackClipped = false; }
            if (!s.active) return;
            const { ctx, chartArea, scales } = chart;
            const xScale = scales.x;
            ctx.save();
            if (s.clockFromX) {
                // The "now" line.
                const px = xScale.getPixelForValue(s.now);
                if (px >= chartArea.left && px <= chartArea.right) {
                    ctx.strokeStyle = chart.options.plugins?.legend?.labels?.color ?? '#888';
                    ctx.globalAlpha = 0.5;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(px, chartArea.top);
                    ctx.lineTo(px, chartArea.bottom);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.globalAlpha = 1;
                }
            }
            // A dot at the head of each series: where each one is now. A series
            // whose points have run out is done, not slow: a square, labeled
            // with when it finished.
            const finished = [];
            chart.data.datasets.forEach((ds, i) => {
                if (!chart.isDatasetVisible(i) || ds.spreadOf != null || ds._spread) return;
                const full = ds._playbackFull ?? ds.data;
                let head;
                if (s.clockFromX) {
                    const y = yAtX(full, s.now);
                    if (y != null) head = { x: s.now, y };
                } else if (hasClock(full)) {
                    const last = ds.data[ds.data.length - 1];
                    if (last && isNum(last.x) && isNum(last.y)) head = last;
                }
                if (!head) return;
                const yScale = scales[ds.yAxisID ?? 'y'];
                if (!yScale) return;
                const px = xScale.getPixelForValue(head.x), py = yScale.getPixelForValue(head.y);
                if (px < chartArea.left || px > chartArea.right || py < chartArea.top || py > chartArea.bottom) return;
                const color = typeof ds.borderColor === 'string' ? ds.borderColor : '#888';
                const r = ds.yAxisID === 'y2' ? 3.5 : 5;
                // Done: its last clock is behind the playback clock. Not where X
                // is the clock — those charts label their own finishes.
                const end = s.clockFromX ? null : lastClock(full);
                const done = end != null && s.now >= end;
                ctx.fillStyle = color;
                ctx.beginPath();
                // Moving, a dot; done, a square — and one label a series, not
                // on the right axis' twin.
                if (done) ctx.rect(px - r, py - r, r * 2, r * 2);
                else ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.fill();
                if (done && ds.yAxisID !== 'y2') finished.push({ px, py, color, end });
            });
            drawFinishLabels(chart, finished, Math.max(-(s.extent?.start ?? 0), s.extent?.end ?? 0) >= 60);
            ctx.restore();
        },
    };
    return { open, close };
}
