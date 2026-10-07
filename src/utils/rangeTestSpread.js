/**
 * The test spread on a bar chart: where a vehicle's range tests landed, drawn
 * on the bar as a thin line from the lowest to the highest with a dot per test.
 *
 * Option B of the four tried in PR #393. A range test is one figure, not a
 * series, and at the n this site has (most vehicles one test, a handful two or
 * three) a mean and an SD say nothing a reader can use — two tests that happen
 * to agree draw a tiny whisker and look precise. So the mark is the tests
 * themselves. The bar stays what it was.
 *
 * NOT an error bar: the line has no caps on purpose. Where a repeat of the
 * test would land is #314's error bar, which will be added to this mark, not
 * replace it. The name of this mark is still open (docs/vocabulary.md, Open
 * names); "Test spread" is the working label.
 *
 * None at n = 1: one test has no spread, and drawing a zero-length one would
 * claim agreement.
 */
import { filterRangeRuns } from './runUtils';
import { resolveRangeSource, miPerKwhFrom } from './rangeSource';
import { statisticalRuns, isUnlisted, unlistedCount, hasQualityOverride } from './runListing';
import { coversPracticalPack, socWindow } from './testedRange';
import { chartTheme, chartFonts } from './chartTheme';
import { fmtSpeed, fmtTemp, speedBasisNote } from './unitConversions';

/**
 * The spread of a set of figures, or null below two.
 *
 * Each entry is a bare number or `{ value, ...anything }` — a test's figure
 * with the test it came from, which the hover reads back.
 *
 * @param {Array<number|{value:number}|null>} entries
 * @returns {{ lo: number, hi: number, n: number, values: number[], points: Array<{value:number}> } | null}
 */
export function spreadOf(entries) {
    const points = (entries || [])
        .map(e => (typeof e === 'number' ? { value: e } : e))
        .filter(p => p && p.value != null && Number.isFinite(p.value));
    if (points.length < 2) return null;
    const values = points.map(p => p.value);
    return { lo: Math.min(...values), hi: Math.max(...values), n: values.length, values, points };
}

/**
 * A vehicle's range tests that count (#394): the listed ones and the pool,
 * less any a curator excluded. utils/runListing decides; this only narrows to
 * range tests.
 */
export function countedRangeTests(vehicle) {
    return filterRangeRuns(statisticalRuns(vehicle));
}

/**
 * Whether a range test may put a RANGE figure in the spread: it saw most of the
 * pack (testedRange.coversPracticalPack), or a curator overrode its quality
 * checks (#394, migration 080) — and it has a start and end SoC to scale from
 * either way. Without one the bar falls back to the raw distance, and a
 * 23-mile sweep is not a 23-mile range however sure the curator is.
 */
export function rangeCoverageOk(run) {
    if (coversPracticalPack(run)) return true;
    return hasQualityOverride(run) && socWindow(run) != null;
}

/**
 * A range test's efficiency for the spreads: measured energy where the test has
 * it, else ESTIMATED from its SoC change and the vehicle's SoC window — the
 * same estimate Road Trip's own line already uses (rangeSource.miPerKwhFrom).
 * The owner's call (#393): an estimate, marked as one, beats a test left out.
 *
 * @returns {{ miPerKwh: number, estimated: boolean, note: string|null } | null}
 */
export function spreadEfficiency(run, socWindowKwh) {
    const { miPerKwh, method } = miPerKwhFrom(run, socWindowKwh);
    if (!(miPerKwh > 0) || !Number.isFinite(miPerKwh)) return null;
    const estimated = method === 'soc-delta-estimate';
    return {
        miPerKwh,
        estimated,
        note: estimated
            ? `Energy estimated: ${run.start_soc}→${run.end_soc}% of a ${Math.round(socWindowKwh * 10) / 10} kWh SoC window`
            : null,
    };
}

/**
 * Every range test of a vehicle as a range basis for one charging run, through
 * the same resolver the bars use — so a dot and the bar for the same test land
 * on the same value. A test the resolver cannot price (no SoC window, say) is
 * left out rather than replaced by its fallback, which would be a different
 * test drawn twice.
 *
 * @returns {Array<{ run: object, miPerSoc: number|null, miPerKwh: number|null }>}
 */
export function rangeBasesFor(chargingRun, vehicle, { correctionMode = 'none', sessionOf = () => null } = {}) {
    return countedRangeTests(vehicle).flatMap(run => {
        const src = resolveRangeSource(chargingRun, {
            vehicle,
            explicitPairing: run,
            correction: { mode: correctionMode },
            session: sessionOf(run),
        });
        if (src.source !== 'paired' || src.sourceRun?.id !== run.id) return [];
        return [{
            run,
            miPerSoc: src.miPerSoc ?? null,
            miPerKwh: src.miPerKwh ?? null,
            note: src.correction?.note ?? null,
        }];
    });
}

/**
 * Draw the mark on one bar, in two passes so the in-bar badges can sit
 * between them: 'line' under the badges, 'dots' over them (a dot hidden under
 * a badge would be a test silently dropped).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} o
 * @param {number}   o.at          the bar's centre, across the bars
 * @param {number[]} o.px          each test's position along the value axis, in pixels
 * @param {boolean}  o.horizontal  bars run along x
 * @param {string}   o.ink         line and dot outline (chartTheme().ink)
 * @param {string}   o.fill        dot fill (chartTheme().background)
 * @param {'line'|'dots'} o.phase
 * @param {boolean[]} [o.dashed]  per dot: an estimated figure, broken outline
 * @param {boolean[]} [o.own]     per dot: the bar's own test, filled in `ownFill`
 * @param {string}   [o.ownFill]  the bar's color
 */
export function drawTestSpread(ctx, { at, px, horizontal, ink, fill, phase, dashed = [], own = [], ownFill = fill }) {
    if (!(px?.length >= 2)) return;
    const point = v => (horizontal ? [v, at] : [at, v]);
    ctx.save();
    ctx.strokeStyle = ink;
    if (phase === 'line') {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(...point(Math.min(...px)));
        ctx.lineTo(...point(Math.max(...px)));
        ctx.stroke();
    } else {
        ctx.lineWidth = 1.25;
        ctx.fillStyle = fill;
        px.forEach((v, k) => {
            // An estimated figure is drawn with a broken outline, so it never
            // passes for a measured one at a glance.
            ctx.setLineDash(dashed[k] ? [2, 2] : []);
            // The bar's own test: filled in the bar's color and a touch
            // larger, so the reader can tell which dot the bar IS.
            ctx.fillStyle = own[k] ? ownFill : fill;
            ctx.beginPath();
            ctx.arc(...point(v), own[k] ? 5.5 : 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
    }
    ctx.restore();
}

/**
 * What a hovered dot says: the test, its figure on this chart, and the
 * conditions that produced it — the same facts the bar's own pills carry.
 */
export function testPointLines(run, valueText, units, note = null, estimateNote = null) {
    const conditions = [
        run.speed_mph != null ? fmtSpeed(run.speed_mph, units) : null,
        speedBasisNote(run),
        run.temperature_f != null ? fmtTemp(run.temperature_f, units) : null,
        run.start_soc != null && run.end_soc != null ? `${run.start_soc}→${run.end_soc}%` : null,
    ].filter(Boolean).join(' · ');
    return [
        run.name,
        isUnlisted(run) ? 'Unlisted test' : null,
        hasQualityOverride(run) ? 'Quality checks overridden by a curator' : null,
        valueText, conditions || null, note, estimateNote,
    ].filter(Boolean);
}

/**
 * "Across 7 range tests (5 unlisted): 236–272 mi" — the count says the pool is
 * in it, so dots with no bar of their own in the picker are not a mystery.
 */
export function spreadSummary(spread, unit, basis = 'range tests') {
    const unlisted = unlistedCount(spread.points.map(p => p.run).filter(Boolean));
    const estimated = spread.points.filter(p => p.estimated).length;
    return `Across ${spread.n} ${basis}${countsAside(unlisted, estimated)}: ${spread.lo}–${spread.hi} ${unit}`;
}

/** " (5 unlisted, 2 estimated)", or "" — what a spread's n is made of. */
export function countsAside(unlisted = 0, estimated = 0) {
    const parts = [unlisted ? `${unlisted} unlisted` : null, estimated ? `${estimated} estimated` : null].filter(Boolean);
    return parts.length ? ` (${parts.join(', ')})` : '';
}

const HIT_PX = 7;

/**
 * Makes the dots hoverable. They are drawn straight onto the canvas, so
 * Chart.js knows nothing of them: this finds the nearest dot under the pointer
 * (mouse or touch), rings it, and draws a label for it. While a dot is
 * hovered the bar's tooltip stands down — pass `suppressBarTooltip` as the
 * chart tooltip's `filter`.
 *
 * Runs `beforeEvent`, so the hover is settled before the tooltip plugin reads
 * it in its own `afterEvent`.
 *
 * @param {Array<{_spread: ?object}>} rows  one per bar, in bar order
 * @param {Object} o
 * @param {boolean} o.horizontal
 * @param {(point: object, row: object) => string[]} o.describe  label lines, first is the title
 */
export function testSpreadHoverPlugin(rows, { horizontal = false, describe }) {
    const hits = (chart) => {
        const meta = chart.getDatasetMeta(0);
        const scale = horizontal ? chart.scales.x : chart.scales.y;
        const out = [];
        rows.forEach((row, i) => {
            const bar = meta.data[i];
            if (!bar || !row?._spread) return;
            for (const point of row._spread.points) {
                const v = scale.getPixelForValue(point.value);
                out.push({ x: horizontal ? v : bar.x, y: horizontal ? bar.y : v, point, row });
            }
        });
        return out;
    };

    return {
        id: 'testSpreadHover',
        beforeEvent(chart, args) {
            const e = args.event;
            if (e.type === 'mouseout') {
                if (chart.$spreadHover) { chart.$spreadHover = null; args.changed = true; }
                return;
            }
            if (!['mousemove', 'click', 'touchstart', 'touchmove'].includes(e.type)) return;
            let best = null;
            let bestD = HIT_PX;
            for (const h of hits(chart)) {
                const d = Math.hypot(h.x - e.x, h.y - e.y);
                if (d <= bestD) { bestD = d; best = h; }
            }
            if (best?.point !== chart.$spreadHover?.point) {
                chart.$spreadHover = best;
                args.changed = true;
                // The tooltip only re-reads its filter when the bar under the
                // pointer changes, and moving onto a dot stays on the same bar.
                // Clearing it makes this very event count as a change.
                chart.tooltip?.setActiveElements([], { x: e.x, y: e.y });
            }
        },
        afterDraw(chart) {
            const h = chart.$spreadHover;
            if (!h) return;
            const { ink, background, axis, tick } = chartTheme();
            const fonts = chartFonts();
            const ctx = chart.ctx;
            const lines = describe(h.point, h.row);

            ctx.save();
            // The hovered dot, ringed.
            ctx.strokeStyle = ink;
            ctx.lineWidth = 2;
            ctx.beginPath();
            // Outside even the bar's own dot (5.5).
            ctx.arc(h.x, h.y, 7.5, 0, Math.PI * 2);
            ctx.stroke();

            // The label: beside the dot, kept inside the plot.
            const lineH = Math.round(fonts.badge * 1.4);
            const pad = 6;
            ctx.font = `600 ${fonts.badge}px ${fonts.sans}`;
            const titleW = ctx.measureText(lines[0]).width;
            ctx.font = `${fonts.badge}px ${fonts.sans}`;
            const w = Math.max(titleW, ...lines.slice(1).map(l => ctx.measureText(l).width)) + pad * 2;
            const ht = lines.length * lineH + pad * 2 - (lineH - fonts.badge);
            const area = chart.chartArea;
            let x = h.x + 12;
            if (x + w > area.right) x = h.x - 12 - w;
            x = Math.max(area.left, x);
            const y = Math.min(Math.max(area.top, h.y - ht / 2), area.bottom - ht);

            ctx.fillStyle = background;
            ctx.strokeStyle = axis;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(x, y, w, ht, 4);
            ctx.fill();
            ctx.stroke();

            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            lines.forEach((line, k) => {
                ctx.font = k === 0 ? `600 ${fonts.badge}px ${fonts.sans}` : `${fonts.badge}px ${fonts.sans}`;
                ctx.fillStyle = k === 0 ? ink : tick;
                ctx.fillText(line, x + pad, y + pad + k * lineH);
            });
            ctx.restore();
        },
    };
}

/** The bar tooltip's `filter` while a dot is hovered: stand down. */
export const suppressBarTooltip = (item) => !item.chart.$spreadHover;
