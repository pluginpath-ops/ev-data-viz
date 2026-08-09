/**
 * Perceptual color contrast resolution for chart runs.
 *
 * Uses CIE Lab ΔE76 (Euclidean distance in Lab space) to measure perceptual
 * similarity between colors, then assigns Okabe-Ito palette slots to runs
 * whose color hasn't been explicitly set by a contributor.
 *
 * Two modes:
 *   'manual' (default) — only runs with the default blue get nudged; all
 *                        other stored colors are used as-is.
 *   'auto'             — every run gets an Okabe-Ito slot regardless of its
 *                        stored color.  When a run has an explicit non-default
 *                        color, the Okabe-Ito candidates are sorted by ΔE
 *                        proximity to that color first (hue-family preference),
 *                        so e.g. a warm-orange run tends to land on #E69F00 or
 *                        #D55E00 rather than jumping to a cool blue.
 */

// Colorblind-safe 7-color Okabe-Ito palette (excludes black)
export const OKABE_ITO = [
    '#E69F00', // orange
    '#56B4E9', // sky blue
    '#009E73', // bluish green
    '#F0E442', // yellow
    '#0072B2', // blue
    '#D55E00', // vermilion
    '#CC79A7', // reddish purple
];

/** The "no preference" sentinel stored when a run color is unset. */
const DEFAULT_RUN_COLOR = '#3b82f6';

// ── CIE Lab math ─────────────────────────────────────────────────────────────

function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
    };
}

function linearize(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function cbrtF(t) {
    return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function rgbToLab({ r, g, b }) {
    const rl = linearize(r), gl = linearize(g), bl = linearize(b);
    const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
    const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
    const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
    const fx = cbrtF(x / 0.95047);
    const fy = cbrtF(y / 1.00000);
    const fz = cbrtF(z / 1.08883);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE ΔE76 — Euclidean distance in Lab space. */
function deltaE(hexA, hexB) {
    const a = rgbToLab(hexToRgb(hexA));
    const b = rgbToLab(hexToRgb(hexB));
    return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

function isDefaultColor(color) {
    return !color || color === DEFAULT_RUN_COLOR;
}

/**
 * Greedy max-min-ΔE selection: pick the candidate from `orderedCandidates`
 * that maximises the minimum perceptual distance to all already-placed colors.
 * `orderedCandidates` controls the priority when distances are tied (first
 * element wins ties), which is used in auto mode to express hue preference.
 */
/**
 * Shift a hex colour's lightness, keeping its hue. Used to extend the palette
 * past its length: the second time round every base colour reappears lighter,
 * the third time darker, so a 15-run chart still reads as 15 distinguishable
 * lines rather than repeats of the same seven.
 *
 * @param {string} hex
 * @param {number} amount  -1..1; positive lightens toward white, negative darkens
 */
function shiftLightness(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const mix = (c) => amount >= 0
        ? Math.round(c + (255 - c) * amount)
        : Math.round(c * (1 + amount));
    const to2 = (n) => Math.max(0, Math.min(255, mix(n))).toString(16).padStart(2, '0');
    return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/** Lightness offsets applied on each successive pass through the palette. */
const PALETTE_PASSES = [0, 0.42, -0.32, 0.66, -0.52];

/**
 * The candidate list extended far enough to cover `count` runs, by cycling the
 * base palette through progressively lighter and darker variants.
 */
function expandedCandidates(base, count) {
    const out = [...base];
    for (let pass = 1; pass < PALETTE_PASSES.length && out.length < count; pass++) {
        for (const c of base) out.push(shiftLightness(c, PALETTE_PASSES[pass]));
    }
    return out;
}

/**
 * Pick the candidate furthest from everything already used.
 *
 * Ties are broken by how many times a colour has already been placed, then by
 * palette order. Without the usage tiebreak, once every candidate has been used
 * they all score deltaE 0 against `placed`, the strict `>` never fires again,
 * and every remaining run collapses onto `orderedCandidates[0]` — which is
 * exactly what happened past the 7th run before this.
 */
function pickBestSlot(orderedCandidates, placed) {
    const usage = new Map();
    for (const p of placed) usage.set(p, (usage.get(p) || 0) + 1);

    let bestColor = orderedCandidates[0];
    let bestMinDelta = -1;
    let bestUsage = Infinity;

    for (const candidate of orderedCandidates) {
        const used = usage.get(candidate) || 0;
        const minDelta = placed.length === 0
            ? Infinity
            : Math.min(...placed.map(p => deltaE(candidate, p)));

        // Least-used first; among equally-used, the most visually distant.
        if (used < bestUsage || (used === bestUsage && minDelta > bestMinDelta)) {
            bestUsage = used;
            bestMinDelta = minDelta;
            bestColor = candidate;
        }
    }
    return bestColor;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve display colors for a set of runs.
 *
 * Priority per run:
 *   1. sessionOverrides[runId]   — always wins (transient user pick)
 *   2. (manual mode only) run.color !== DEFAULT — contributor-set; used as-is
 *   3. Okabe-Ito slot via greedy max-min-ΔE.
 *      In auto mode with an explicit stored color, candidates are sorted by
 *      proximity to that color first (hue-family bias) before the greedy pass.
 *
 * Runs are processed in stable created_at → id order so assignments are
 * deterministic across re-renders.
 *
 * @param {Array}  runs             — run objects with { id, color, created_at }
 * @param {object} sessionOverrides — { [runId]: hexColor }, default {}
 * @param {'manual'|'auto'} mode    — color resolution mode, default 'manual'
 * @returns {{ [runId]: string }}   map of run ID → resolved hex color
 */
export function resolveChartColors(runs, sessionOverrides = {}, mode = 'manual') {
    if (!runs?.length) return {};

    // Stable ordering so color assignments don't shuffle on re-render
    const sorted = [...runs].sort((a, b) => {
        const da = a.created_at ?? '', db = b.created_at ?? '';
        if (da !== db) return da < db ? -1 : 1;
        return (a.id ?? 0) < (b.id ?? 0) ? -1 : 1;
    });

    const result = {};
    const placed = [];  // hex strings of already-resolved colors

    for (const run of sorted) {
        let chosen;

        if (sessionOverrides[run.id]) {
            // 1. Transient session override — highest priority
            chosen = sessionOverrides[run.id];

        } else if (mode === 'manual' && !isDefaultColor(run.color)) {
            // 2. Manual mode: contributor-set color wins, seeds the placed list
            //    so nudged runs avoid clashing with it
            chosen = run.color;

        } else {
            // 3. Assign an Okabe-Ito slot.
            //    Auto mode with an explicit color: sort candidates by proximity
            //    to the stored color so the family preference is expressed first.
            //    Default / unset colors: use the standard palette order.
            // Extended so there are always at least as many candidates as runs;
            // otherwise every run past the palette length ties and collapses.
            const pool = expandedCandidates(OKABE_ITO, sorted.length);
            const candidates =
                mode === 'auto' && !isDefaultColor(run.color)
                    ? [...pool].sort((a, b) => deltaE(a, run.color) - deltaE(b, run.color))
                    : pool;

            chosen = pickBestSlot(candidates, placed);
        }

        result[run.id] = chosen;
        placed.push(chosen);
    }

    return result;
}

// ── Pair colours ─────────────────────────────────────────────────────────────

/**
 * Lightness offsets for the successive partners of one primary. The first
 * partner keeps the primary's colour exactly, so a chart where nothing is
 * paired more than once looks precisely as it did before.
 */
const PARTNER_SHADES = [0, 0.3, -0.26, 0.52, -0.44];

/**
 * Colour a set of paired series so related ones read as related.
 *
 * The pairing work let one range test appear several times, once per charging
 * partner. Colour came from the range test alone, so those rows rendered in the
 * SAME colour and only the label told them apart — on a bar chart, two identical
 * bars side by side.
 *
 * Giving each row an unrelated palette slot would fix the collision and lose the
 * relationship: the whole point is that these rows share a range basis. So the
 * hue family comes from the primary and lightness varies by partner. Two shades
 * of one blue read as "the same test, two charging curves" at a glance.
 *
 * Only primaries that actually appear more than once are shaded. A primary with
 * one partner keeps its colour untouched, so this is invisible until it matters.
 *
 * @param {Array} rows  [{ key, primaryId, baseColor }] in display order
 * @returns {Object} key → colour
 */
export function resolvePairColors(rows) {
    const byPrimary = new Map();
    for (const row of rows ?? []) {
        const id = String(row.primaryId);
        if (!byPrimary.has(id)) byPrimary.set(id, []);
        byPrimary.get(id).push(row);
    }

    const out = {};
    for (const group of byPrimary.values()) {
        group.forEach((row, i) => {
            const base = row.baseColor || DEFAULT_RUN_COLOR;
            const shade = group.length > 1 ? PARTNER_SHADES[i % PARTNER_SHADES.length] : 0;
            // Pass a zero offset straight through: shiftLightness would return
            // the same colour lower-cased, and stored hexes get compared as
            // strings elsewhere.
            out[row.key] = shade === 0 ? base : shiftLightness(base, shade);
        });
    }
    return out;
}
