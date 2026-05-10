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
function pickBestSlot(orderedCandidates, placed) {
    let bestColor    = orderedCandidates[0];
    let bestMinDelta = -1;

    for (const candidate of orderedCandidates) {
        const minDelta = placed.length === 0
            ? Infinity
            : Math.min(...placed.map(p => deltaE(candidate, p)));
        if (minDelta > bestMinDelta) {
            bestMinDelta = minDelta;
            bestColor    = candidate;
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
            const candidates =
                mode === 'auto' && !isDefaultColor(run.color)
                    ? [...OKABE_ITO].sort((a, b) => deltaE(a, run.color) - deltaE(b, run.color))
                    : OKABE_ITO;

            chosen = pickBestSlot(candidates, placed);
        }

        result[run.id] = chosen;
        placed.push(chosen);
    }

    return result;
}
