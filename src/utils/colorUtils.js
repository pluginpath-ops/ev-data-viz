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

/**
 * The same seven, named. These sat in the comments above and were unreachable,
 * which was fine while the palette was only ever assigned FROM. The picker
 * offers them to a person, and "swatch 4 of 7" is not something a screen reader
 * can act on — so the name moves out of the comment and into the API.
 */
export const OKABE_ITO_NAMES = [
    'orange', 'sky blue', 'bluish green', 'yellow', 'blue', 'vermilion', 'reddish purple',
];

/**
 * The "no preference" sentinel stored when a run color is unset.
 *
 * It is a SENTINEL, not a choice, and the difference matters now that a person
 * can pick a color by hand: a run explicitly set to this exact blue is
 * indistinguishable from one nobody has touched, and gets reassigned. The
 * picker avoids minting it — `onReset` writes null rather than this — but a
 * Custom pick can still land on it. Telling the two apart needs a stored flag,
 * which is a schema change and is filed, not smuggled in here.
 */
export const DEFAULT_RUN_COLOR = '#3b82f6';

/**
 * The color a run reports now that color belongs to the VEHICLE (#308).
 *
 * `runs.color` still exists in the database and still holds whatever a curator
 * set — perhaps ten to twenty rows across the corpus — because dropping a column
 * in the same change that stops reading it leaves no way back if the new look is
 * wrong. So the column stays and the APP stops seeing it: every run arrives
 * carrying this instead.
 *
 * It is hot magenta on purpose. A code path we failed to find does not throw and
 * does not quietly look plausible — it draws in a color no curator would ever
 * choose and no palette contains, on a chart someone is looking at. Loud, and
 * still a working chart.
 *
 * If nothing has gone magenta after a few weeks, the column can be dropped and
 * this constant with it.
 */
export const RETIRED_RUN_COLOR = '#FF00FF';

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

/**
 * Is this color "unset"? Null, empty, or the sentinel — the three ways a run
 * says it has no stored preference. Exported so the picker asks the resolver's
 * own question rather than reimplementing it and drifting.
 */
export function isUnsetColor(color) {
    return !color || color === DEFAULT_RUN_COLOR;
}

/**
 * Greedy max-min-ΔE selection: pick the candidate from `orderedCandidates`
 * that maximises the minimum perceptual distance to all already-placed colors.
 * `orderedCandidates` controls the priority when distances are tied (first
 * element wins ties), which is used in auto mode to express hue preference.
 */
/**
 * Shift a hex color's lightness, keeping its hue. Used to extend the palette
 * past its length: the second time round every base color reappears lighter,
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

/**
 * Successive passes through the palette, as HSL deltas.
 *
 * Both axes move, and that is the point. Lightness alone was what this did
 * before, and a second pass that is only "the same color, lighter" reads as a
 * faded version of the first rather than as its own series — worse on a plot
 * than a slightly different color would be. Pulling saturation at the same
 * time separates the passes from each other as well as from the base.
 *
 * Contrast within a pass stays Okabe-Ito's; contrast BETWEEN passes is
 * deliberately weaker than that. Past seven series there is no arrangement of
 * colors that is all strongly distinct, so the honest goal is that no two are
 * ever the SAME — which is what the caller can actually rely on.
 */
const PALETTE_PASSES = [
    { l:   0, s:   0 },   // the palette itself
    { l:  20, s: -30 },   // lighter, washed
    { l: -18, s:   8 },   // darker, deeper
    { l:  34, s: -50 },   // pale
    { l: -30, s: -18 },   // near-black, muted
];

/** Degrees of hue added each time the passes run out and start over. */
const PASS_HUE_NUDGE = 11;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Below this saturation a color has no usable hue to vary. */
const ACHROMATIC_S = 20;

/**
 * One palette color, on a given pass, or null where it should not be varied.
 *
 * Clamped away from pure white and black, which are not series colors at all —
 * invisible on one theme or the other.
 *
 * A near-grey is skipped entirely after the first pass. Measured: the worst
 * pair in a 16-series set was #dccfd6 against #d3d7de at ΔE 6.3, and BOTH were
 * pale variants of the neutral slot. Varying a color with no hue only produces
 * more colors with no hue, and they then collide with every other pale variant
 * in the set. The grey stays available as itself; it just stops breeding.
 */
function passVariant(hex, pass, skipAchromatic = true) {
    if (pass === 0) return hex;
    const { h, s, l } = hexToHsl(hex);
    if (skipAchromatic && s < ACHROMATIC_S) return null;
    const step = PALETTE_PASSES[pass % PALETTE_PASSES.length];
    const wrap = Math.floor(pass / PALETTE_PASSES.length);
    return hslToHex({
        h: (h + wrap * PASS_HUE_NUDGE) % 360,
        s: clamp(s + step.s, ACHROMATIC_S + 5, 100),
        l: clamp(l + step.l, 14, 88),
    });
}

/**
 * The palette extended to at least `count` colors, never repeating one.
 *
 * The repeat is the whole reason this exists. Auto Color has always extended
 * the palette this way; the picker's own rotation did not, and wrapped with a
 * modulo — so a twelve-car chart recolored from one base got eight colors and
 * four exact duplicates, which is precisely what a reader assumes the tool is
 * preventing. One function now, used by both, so they cannot drift apart again.
 *
 * Duplicates are skipped rather than counted: clamping can land two passes of a
 * very light color on the same lightness, and a candidate list containing the
 * same hex twice would hand two series one color by construction.
 */
export function expandPalette(colors, count) {
    // Whether skipping the greys is affordable. In a palette that is ALL grey —
    // a monochrome one — refusing to vary them would return fewer colors than
    // asked for, and the caller would fall back to a modulo and repeat.
    const hasChromatic = colors.some(c => hexToHsl(c).s >= ACHROMATIC_S);
    const out = [];
    const seen = new Set();
    for (let pass = 0; out.length < count && pass < 40; pass++) {
        for (const c of colors) {
            const v = passVariant(c, pass, hasChromatic);
            if (v == null) continue;
            const key = v.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(v);
            if (out.length >= count) break;
        }
    }
    return out;
}

/**
 * Pick the candidate furthest from everything already used.
 *
 * Ties are broken by how many times a color has already been placed, then by
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
 *   2. (VEHICLE_PALETTE only) the run's VEHICLE color, shaded across that
 *      vehicle's tests on this chart — one test takes the base exactly
 *   3. A slot from the chosen palette via greedy max-min-ΔE.
 *      With a palette chosen over a curated vehicle, candidates are sorted by
 *      proximity to its color first (hue-family bias) before the greedy pass.
 *
 * Step 2 read `run.color` until #308. Color is a property of the CAR now: per
 * run it did not survive hundreds of vehicles at two to ten tests each, and it
 * was never what a reader was trying to recognise. Passing `vehicles` is what
 * turns step 2 on; without it every run falls through to the palette, which is
 * what the callers that do not know their vehicles get.
 *
 * Runs are processed in stable created_at → id order so assignments are
 * deterministic across re-renders.
 *
 * @param {Array}  runs             — run objects with { id, created_at }
 * @param {object} sessionOverrides — { [runId]: hexColor }, default {}
 * @param {string} [palette]        — VEHICLE_PALETTE (default) to honour curated
 *                                    vehicle colors, or a SERIES_PALETTES id to
 *                                    assign from that set instead
 * @param {Array}  [vehicles]       — the runs' vehicles, each with .runs and
 *                                    .color; omit to skip step 2 entirely
 * @returns {{ [runId]: string }}   map of run ID → resolved hex color
 */
export function resolveChartColors(runs, sessionOverrides = {}, palette = VEHICLE_PALETTE, vehicles = null) {
    if (!runs?.length) return {};

    // Stable ordering so color assignments don't shuffle on re-render
    const sorted = [...runs].sort((a, b) => {
        const da = a.created_at ?? '', db = b.created_at ?? '';
        if (da !== db) return da < db ? -1 : 1;
        return (a.id ?? 0) < (b.id ?? 0) ? -1 : 1;
    });

    const result = {};

    // Every color the caller has already fixed — a session override, or an
    // assignment useStickyChartColors is holding still — is on the chart no
    // matter where its run falls in this order. They go in UP FRONT.
    //
    // Without that, `placed` only knew about runs already visited, so an
    // unassigned run could take a color that a LATER run was pinned to and
    // nothing would ever compare them. It needed the pinned run to sort after
    // the free one, which is why it showed up only once runs were ticked in an
    // order different from their creation dates: thirteen runs, nine colors,
    // and a resolver that returns thirteen distinct ones when asked directly.
    const placed = sorted.map(r => sessionOverrides[r.id]).filter(Boolean);

    // What each run takes from its VEHICLE's curated color (#308).
    //
    // Color used to be stored per run, and a run's own hex was consulted here.
    // It is stored per vehicle now, so the family is resolved in one pass before
    // the loop: `rampFrom` needs to know how many of a vehicle's runs are on this
    // chart before it can space their shades, which a run-at-a-time walk cannot
    // answer. It returns the base first, so a vehicle contributing one test is
    // drawn in exactly the color the curator picked rather than a shade off it.
    const curated = new Map();
    if (vehicles?.length) {
        const onChart = new Set(sorted.map(r => String(r.id)));
        for (const vehicle of vehicles) {
            if (isUnsetColor(vehicle.color)) continue;
            // In `sorted` order, so the shade a run gets does not depend on the
            // order its vehicle happens to list its runs in.
            const mine = sorted.filter(r => (vehicle.runs ?? []).some(
                vr => String(vr.id) === String(r.id) && onChart.has(String(r.id))));
            const shades = rampFrom(vehicle.color, mine.length);
            mine.forEach((run, i) => curated.set(String(run.id), shades[i]));
        }
    }

    for (const run of sorted) {
        let chosen;

        if (sessionOverrides[run.id]) {
            // 1. Transient session override — highest priority, and already in
            //    `placed` from the pass above, so it is not pushed again below.
            result[run.id] = sessionOverrides[run.id];
            continue;

        } else if (palette === VEHICLE_PALETTE && curated.has(String(run.id))) {
            // 2. The vehicle's curated color, shaded across its tests.
            //
            //    Honoured EXACTLY, with no clash nudge — which is the one place
            //    this departs from the per-run behaviour it replaces. A stored
            //    run color was often incidental, so two runs sharing a hex was
            //    usually an accident worth correcting; a curated vehicle color
            //    is a deliberate statement that this car is always drawn this
            //    way, and nudging it would break that on the charts where it
            //    matters most. Two cars given the same color is a curation
            //    question, visible to whoever asks it.
            chosen = curated.get(String(run.id));

        } else {
            // 3. Assign an Okabe-Ito slot.
            // Extended so there are always at least as many candidates as runs;
            // otherwise every run past the palette length ties and collapses.
            // The chosen palette, not a hardcoded one. `resolveChartColors`
            // always assigned from Okabe-Ito regardless of what the picker was
            // set to, so choosing House and then clearing an override brought
            // Okabe-Ito back (#307).
            const pool = expandPalette(paletteColorsById(palette) ?? TAB10, sorted.length);

            // A palette over a curated vehicle: sort candidates by proximity to
            // the curated color, so a palette still leans toward the car's own
            // hue where it can. A palette OVERRIDES the curated color — that is
            // what choosing one is for — but a preference expressed as a
            // tiebreak costs nothing when the palette has room.
            const near = curated.get(String(run.id));
            const candidates = (palette !== VEHICLE_PALETTE && near)
                ? [...pool].sort((a, b) => deltaE(a, near) - deltaE(b, near))
                : pool;
            chosen = pickBestSlot(candidates, placed);
        }

        result[run.id] = chosen;
        placed.push(chosen);
    }

    return result;
}

// ── Pair colors ─────────────────────────────────────────────────────────────

/**
 * Lightness offsets for the successive partners of one primary. The first
 * partner keeps the primary's color exactly, so a chart where nothing is
 * paired more than once looks precisely as it did before.
 */
const PARTNER_SHADES = [0, 0.3, -0.26, 0.52, -0.44];

/**
 * Color a set of paired series so related ones read as related.
 *
 * The pairing work let one range test appear several times, once per charging
 * partner. Color came from the range test alone, so those rows rendered in the
 * SAME color and only the label told them apart — on a bar chart, two identical
 * bars side by side.
 *
 * Giving each row an unrelated palette slot would fix the collision and lose the
 * relationship: the whole point is that these rows share a range basis. So the
 * hue family comes from the primary and lightness varies by partner. Two shades
 * of one blue read as "the same test, two charging curves" at a glance.
 *
 * Only primaries that actually appear more than once are shaded. A primary with
 * one partner keeps its color untouched, so this is invisible until it matters.
 *
 * @param {Array} rows  [{ key, primaryId, baseColor }] in display order
 * @returns {Object} key → color
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
            // the same color lower-cased, and stored hexes get compared as
            // strings elsewhere.
            out[row.key] = shade === 0 ? base : shiftLightness(base, shade);
        });
    }
    return out;
}

// ── What the picker says about a color ──────────────────────────────────────

/**
 * Reconcile the color a series HAS with the color it is DRAWN in.
 *
 * These come apart routinely and nothing said so. Auto Color assigns an
 * Okabe-Ito slot over the stored preference; a session override replaces both;
 * a run with no preference at all is drawn in whatever the resolver picked.
 * The old control expressed all of that as one swatch and a `title` attribute,
 * so the answer to "why is this line orange when I set it to blue?" was hidden
 * behind a hover and only present at one of the five pickers.
 *
 * Three states, because there are three:
 *
 *   auto      nothing stored — the palette is choosing, and that is fine
 *   saved     stored and drawn in the same color, so there is nothing to say
 *   diverged  stored one thing, drawn another. The only one worth words
 *
 * @param {string|null} stored   the durable preference — the VEHICLE's curated
 *                                color (#308) — where the caller has one
 * @param {string} plotted       what is actually on the chart right now
 * @returns {{kind: 'auto'|'saved'|'diverged', stored?: string, plotted: string}}
 */
export function seriesColorNote(stored, plotted) {
    if (isUnsetColor(stored)) return { kind: 'auto', plotted };
    if (stored.toLowerCase() === String(plotted).toLowerCase()) {
        return { kind: 'saved', plotted };
    }
    return { kind: 'diverged', stored, plotted };
}

// ── The set a base seeds ─────────────────────────────────────────────────────

/**
 * The neutral eighth slot.
 *
 * Canonical Okabe-Ito is eight including black. Black is invisible on a dark
 * plot, so the slot carries a mid grey instead — the same grey a spec-linked
 * run already falls back to, rather than a ninth color nobody chose.
 */
export const SERIES_NEUTRAL = '#9ca3af';

/** Okabe-Ito as the picker offers it: seven hues plus the neutral. */
export const OKABE_ITO_SET = [...OKABE_ITO, SERIES_NEUTRAL];

/**
 * The default set series are assigned from — offered as **Colorful**.
 *
 * It is matplotlib / seaborn's `tab10`. The constant keeps that name because
 * that is what the ten values ARE and where to go to check them; the id and the
 * label are what a curator picks, and "tab10" names a library rather than
 * anything about the colours.
 *
 * It replaced Okabe-Ito in that role by request. The trade is explicit and worth
 * stating rather than discovering: Okabe-Ito was chosen for being separable by a
 * colourblind reader, and tab10 is not — it is the set most readers of technical
 * charts already recognise, and ten hues where Okabe-Ito has seven, which is the
 * difference between running out at eight series and at eleven.
 *
 * Okabe-Ito is still offered and still marked safe, so the accessible answer is
 * one selection away rather than gone. See #305 on what happens past ~12 series,
 * where no palette is the answer and line style has to be the second channel.
 */
export const TAB10 = [
    '#1f77b4', // blue
    '#ff7f0e', // orange
    '#2ca02c', // green
    '#d62728', // red
    '#9467bd', // purple
    '#8c564b', // brown
    '#e377c2', // pink
    '#7f7f7f', // gray
    '#bcbd22', // olive
    '#17becf', // cyan
];

/**
 * The palette that was here before Okabe-Ito, kept switchable rather than
 * deleted: matching an existing screenshot or a partner's brand is a real
 * curator task, and the honest way to allow it is a named palette you have to
 * choose — not a hex field that quietly leaves the safe set.
 *
 * It lives here, not in specHelpers, so the picker and `vehicleColor()` read
 * one definition. DataService still carries its own eight for newly imported
 * and duplicated runs, and those had ALREADY drifted from this set — a
 * different eight colors entirely. Left alone here because changing them
 * changes what color new records are born with, which is a data decision
 * rather than a picker one.
 */
export const LEGACY_PALETTE = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444',
    '#3b82f6', '#a855f7', '#ec4899', '#14b8a6',
];

/**
 * The house accents, as a series palette.
 *
 * Values are the dark theme's own `--color-accent-*` tokens, not new colors:
 * blue #2d7ff9, orange #f28b3c, green #23b47e, violet #9b8cf0, grey #6b7a8f.
 * "White" is `--color-text-primary`, #f2f5f9, which is an extremely faint blue
 * rather than a true white — a real white on a dark plot is a glare, and this
 * one already belongs to the theme.
 *
 * The yellow is Okabe-Ito's, reused rather than invented: the theme has no
 * yellow token, and adding one is a design decision rather than a palette one.
 *
 * A caveat worth stating where it will be read: the design vocabulary reserves
 * orange as the single active/now signal and lets nothing else use it. That
 * rule is about CHROME. A series color is data, and a curator choosing the
 * EVBench palette is choosing to draw with the site's own colors — but if the
 * orange series ever reads as "this one is selected", this is why.
 */
export const HOUSE_PALETTE = [
    '#2d7ff9', // accent-blue
    '#f28b3c', // accent-orange
    '#f2f5f9', // text-primary — the faint blue that stands in for white
    '#23b47e', // accent-green
    '#F0E442', // Okabe-Ito yellow; the theme has none
    '#9b8cf0', // accent-violet
    '#6b7a8f', // accent-grey
];

/**
 * `count` evenly spaced lightness steps of one color, light to dark.
 *
 * Not `rampFrom`: that anchors an END on a base a person picked and travels
 * away from it, which is right for deriving a set and wrong for building a
 * palette. A palette wants the whole usable range regardless of where its seed
 * happens to sit.
 */
function monochrome(hex, count, from = 84, to = 24) {
    const { h, s } = hexToHsl(hex);
    return Array.from({ length: count }, (_, i) =>
        hslToHex({ h, s, l: from + (to - from) * (i / (count - 1)) }));
}

/**
 * The palettes the picker can switch between, in offer order.
 *
 * Adding one is a data edit, which is the point — it is also where the
 * "everything in one hue" look went when it stopped being a fourth radio. A
 * monochrome palette IS that look, and says so by its name rather than by a
 * derivation nobody could tell from its neighbour.
 *
 * `safe` marks a palette a colorblind reader can separate. The monochromes
 * qualify for a different reason from Okabe-Ito: they carry no hue information
 * at all, so there is none to lose.
 */
export const SERIES_PALETTES = [
    // First, and so the default: SERIES_PALETTES[0] is what a picker with no
    // plot behind it opens on, and what the resolver assigns from.
    { id: 'colorful',  label: 'Colorful',       safe: false, colors: TAB10 },
    { id: 'okabe-ito', label: 'Okabe-Ito',      safe: true,  colors: OKABE_ITO_SET },
    { id: 'evbench',   label: 'EVBench',        safe: false, colors: HOUSE_PALETTE },
    { id: 'mono-blue', label: 'Mono · blue',    safe: true,  colors: monochrome('#2d7ff9', 8) },
    { id: 'mono-green', label: 'Mono · green',  safe: true,  colors: monochrome('#009E73', 8) },
    { id: 'mono-orange', label: 'Mono · orange', safe: true, colors: monochrome('#f28b3c', 8) },
    // "Ice" rather than "faint blue", which read as a weaker version of the
    // palette above it rather than as its own thing. It starts lighter than the
    // other two as well: the near-white top is the whole identity of this one,
    // and the shared 84 clipped it to an ordinary pale blue.
    { id: 'mono-ice', label: 'Mono · ice', safe: true, colors: monochrome('#f2f5f9', 8, 93, 30) },
    { id: 'legacy',    label: 'Legacy',         safe: false, colors: LEGACY_PALETTE },
];

/**
 * The default series mode: draw every vehicle in the color its curator gave it.
 *
 * A member of the same field as a palette id rather than a separate boolean,
 * because it answers the same question — where does a series' color come from?
 * As a checkbox called "Auto Color" it was the OFF position of a control whose
 * on-state assigned Okabe-Ito, which read backwards once vehicles owned their
 * colors: switching "auto" ON is what threw the curation away.
 */
export const VEHICLE_PALETTE = 'vehicle';

/** The colors a palette id names, or null for the vehicle-color mode. */
export function paletteColorsById(id) {
    return SERIES_PALETTES.find(p => p.id === id)?.colors ?? null;
}

/** Hex equality that does not care how either side was written. */
export function sameHex(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Which slot a color occupies, 1-based, or null when it is off-palette.
 *
 * The picker says "slot 3 of 8" so that a color has an ADDRESS and not just a
 * value: the whole set is never visible at once, and knowing you are on slot 3
 * is what makes "rotate from here" a sentence you can predict the result of.
 */
export function paletteSlotOf(hex, colors) {
    const i = colors.findIndex(c => sameHex(c, hex));
    return i === -1 ? null : i + 1;
}

// ── HSL, for the two sliders ─────────────────────────────────────────────────

/** @returns {{h: number, s: number, l: number}} h 0-360, s and l 0-100. */
export function hexToHsl(hex) {
    const { r, g, b } = hexToRgb(hex);
    const [rn, gn, bn] = [r / 255, g / 255, b / 255];
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l: l * 100 };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
    const sn = s / 100, ln = l / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = ln - c / 2;
    const seg = Math.floor(((h % 360) + 360) % 360 / 60);
    const [r1, g1, b1] = [
        [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ][seg];
    const to2 = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${to2(r1)}${to2(g1)}${to2(b1)}`;
}

// ── Deriving the rest of the set from the base ───────────────────────────────

/**
 * The palette re-ordered so `base` leads it.
 *
 * A pick is a BASE, not just one series' color: it becomes slot 1 and
 * everything else is re-derived from where it landed. Rotating rather than
 * re-sorting keeps the palette's own spacing — Okabe-Ito's order is already
 * chosen so that neighbours are far apart, and sorting by distance from the
 * base would throw that away to solve a problem the palette has already solved.
 *
 * A base that is not in the palette simply leads it, because there is no slot
 * to rotate from.
 */
export function rotatePaletteFrom(base, colors, count = 0) {
    const i = colors.findIndex(c => sameHex(c, base));
    const rotated = i === -1 ? [base, ...colors] : [...colors.slice(i), ...colors.slice(0, i)];
    // Asked for more series than the palette holds, it extends rather than
    // wrapping — see expandPalette. Without a count it is just the rotation,
    // which is what the four-swatch preview wants.
    return count > rotated.length ? expandPalette(rotated, count) : rotated;
}

/** The most lightness the ramp will travel, in L points. */
const RAMP_SPAN_L = 58;
/** Kept clear of pure white and black, which are not series colors at all. */
const RAMP_L_MIN = 14;
const RAMP_L_MAX = 88;

/**
 * A lightness ramp of `count` colors, anchored so the base is an END of it.
 *
 * The direction is chosen by the base rather than fixed: a light base darkens,
 * a dark base lightens. That is the difference between a ramp that runs AWAY
 * from the base and one that runs THROUGH it — and running through it is what
 * `PALETTE_PASSES` does today, which is why a pale yellow base there produces
 * a set whose lightest member is lighter than the color you actually chose.
 */
export function rampFrom(base, count) {
    if (count <= 1) return [base];
    const { h, s, l } = hexToHsl(base);
    const away = l > 50 ? -1 : 1;
    // Travel only as far as there is room, so the far end never clamps and
    // collapses the last two steps onto one color.
    const span = Math.min(RAMP_SPAN_L, away > 0 ? RAMP_L_MAX - l : l - RAMP_L_MIN);
    const out = [base];
    for (let i = 1; i < count; i++) {
        // HSL, holding h and s fixed. shiftLightness mixes toward white or
        // black in RGB, which desaturates AND drags the hue — measured at a
        // degree per step, so "shades of one hue" was not quite true of its own
        // output. Here it is exactly true, which is the whole claim.
        out.push(hslToHex({ h, s, l: l + away * span * (i / (count - 1)) }));
    }
    return out;
}

/**
 * What the panel's "base seeds the set" preview shows for one derivation.
 *
 * @param {string} base
 * @param {number} count  how many series the base is seeding, including itself
 * @param {'rotation'|'ramp'} mode
 * @param {string[]} colors  the active palette
 */
export function seedPreview(base, count, mode, colors) {
    const n = Math.max(1, count);
    return mode === 'ramp'
        ? rampFrom(base, n)
        : rotatePaletteFrom(base, colors).slice(0, n);
}

/**
 * Fold a set of picker answers into a session override map.
 *
 * `null` REMOVES a key rather than storing null under it. That is what "Back to
 * auto" sends, and the two are not the same thing: `resolveChartColors` reads a
 * null value as falsy and falls through to the run's own stored color — the
 * right answer by accident in manual mode, and the wrong one in auto, where the
 * point of Auto is to hand the run back to the palette.
 *
 * One function because the views hold their overrides in different places —
 * `useStickyChartColors` in session state, EPA Curves in `epaConfig` so they
 * survive the trip to the pop-out window — while the rule about null belongs to
 * the picker rather than to either store. It was written twice and a third
 * caller would have written it a third time.
 *
 * @param {Record<string,string>} current  the map as it stands
 * @param {Record<string,string|null>} changes  one id or a whole derived set
 * @returns {Record<string,string>} a new map; `current` is not touched
 */
export function applyColorOverrides(current, changes) {
    const next = { ...current };
    for (const [id, color] of Object.entries(changes)) {
        if (color == null) delete next[id];
        else next[id] = color;
    }
    return next;
}

/**
 * The plotted set, in the shape the picker's wider scopes need.
 *
 * Takes the runs a view is ALREADY coloring rather than its selection ids,
 * and that is the whole point: two of the four chart views key selection by
 * pair rather than by run, so a helper reading `selectedRunIds` would quietly
 * return nothing there and the scope control would vanish with no error. Every
 * view computes "the runs on the chart" regardless.
 *
 * The vehicle comes from a lookup because a run does not carry its owner, and
 * "this vehicle" is the scope that needs it.
 *
 * @param {Array} runs      the runs being colored, in plot order
 * @param {Array} vehicles  selected vehicles, each with .runs, for the lookup
 * @param {(id) => boolean} [isOverridden]  whether a run is showing a
 *        hand-picked color. Without it every row reads as auto
 * @returns {Array<{id, vehicleId, stored, auto}>}
 */
export function seriesRowsOf(runs, vehicles, isOverridden) {
    const owner = new Map();
    for (const v of vehicles ?? []) {
        for (const r of v.runs ?? []) owner.set(String(r.id), v.id);
    }
    const seen = new Set();
    const rows = [];
    for (const r of runs ?? []) {
        // Pair mode plots one range run against several charging partners, so
        // the same run arrives more than once. It is still one series color.
        if (!r || r._synthetic || seen.has(String(r.id))) continue;
        seen.add(String(r.id));
        rows.push({
            id: r.id,
            vehicleId: owner.get(String(r.id)) ?? null,
            stored: r.color ?? null,
            auto: !(isOverridden?.(r.id) ?? false),
        });
    }
    return rows;
}

/**
 * Color a whole plot from one base — the two derivations, together or apart.
 *
 * Applying ONE of them across every series was the mistake this replaces.
 * Rotation alone gives thirteen unrelated hues and throws away the fact that
 * four of them are the same car; shading alone gives thirteen steps of one hue
 * and throws away everything else. Neither is what a multi-vehicle chart wants,
 * and the panel offered no way to say "both" because the two were a radio.
 *
 * Together they are handoff 3c applied to the whole plot: each VEHICLE takes
 * the next color of the rotation, and each of that vehicle's TESTS takes a
 * step along it. A chart then reads as families first and runs second, which is
 * the entire reason 3c exists.
 *
 * Vehicles are ordered by first appearance rather than by id, so the base lands
 * on the row you opened the panel from and the rest follow in reading order.
 *
 * @param {string} base
 * @param {Array<{id, vehicleId}>} rows  the plotted set, in display order
 * @param {{rotate?: boolean, shade?: boolean}} how
 * @param {string[]} colors  the active palette
 * @returns {Object} row id → color
 */
export function seedPlot(base, rows, { rotate = true, shade = true } = {}, colors) {
    if (!rows?.length) return {};

    // Neither selected is not a state the panel offers, but a caller can still
    // ask for it. Rotation is the safer answer: distinct beats identical.
    const useShade = shade && (rotate || shade);
    const useRotate = rotate || !useShade;

    if (useRotate && useShade) {
        const order = [];
        const byVehicle = new Map();
        for (const r of rows) {
            const key = String(r.vehicleId ?? r.id);
            if (!byVehicle.has(key)) { byVehicle.set(key, []); order.push(key); }
            byVehicle.get(key).push(r);
        }
        const bases = rotatePaletteFrom(base, colors, order.length);
        const out = {};
        order.forEach((key, i) => {
            const group = byVehicle.get(key);
            // rampFrom returns the base first, so a vehicle with one test keeps
            // its rotated color exactly rather than being shaded off it.
            const shades = rampFrom(bases[i % bases.length], group.length);
            group.forEach((row, j) => { out[row.id] = shades[j]; });
        });
        return out;
    }

    const flat = useShade
        ? rampFrom(base, rows.length)
        : rotatePaletteFrom(base, colors, rows.length);
    return Object.fromEntries(rows.map((r, i) => [r.id, flat[i % flat.length]]));
}
