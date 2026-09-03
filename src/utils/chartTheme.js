/**
 * The chart palette, read from the stylesheet instead of retyped in JS.
 *
 * Chart.js takes colours as strings, so every chart view carried its own copy
 * of the theme:
 *
 *     const tickColor   = isDark ? 'rgb(226,232,240)' : 'rgb(107,114,128)';
 *     const gridColor   = isDark ? 'rgba(100,116,139,0.4)' : 'rgba(229,231,235,0.8)';
 *     const legendColor = isDark ? 'rgb(241,245,249)' : 'rgb(55,65,81)';
 *
 * — eleven files, forty-eight literals, none of them reachable from the token
 * layer. The re-skin re-valued the tokens and every one of these kept painting
 * the old palette. The clearest symptom: all five PNG exports flattened onto
 * `rgb(8,12,28)`, the card colour from BEFORE the re-skin, so an exported chart
 * had a background the site no longer used anywhere.
 *
 * ── Why a function and not a constant ───────────────────────────────────────
 *
 * The values live on the document root and change when `data-theme` does. Call
 * this while building the chart, inside the effect that already depends on
 * `isDark` — `useTheme`'s MutationObserver re-renders those components on a
 * theme flip, so the next build picks up the new palette. Caching the result at
 * module load would pin the charts to whichever theme happened to be applied
 * first.
 *
 * ── Why fallbacks ───────────────────────────────────────────────────────────
 *
 * The vitest suite runs in `environment: 'node'` with no DOM, and a component
 * test harness would hit this before jsdom applies a stylesheet. Returning the
 * dark values rather than throwing keeps a chart drawable in both cases; they
 * are a safety net, not a second source of truth, so they are deliberately the
 * shipped dark values and nothing more.
 */

/**
 * The font stacks, for text drawn straight onto a canvas.
 *
 * Chart.js and the custom plugins take a CSS font shorthand string, which
 * cannot read a custom property — so the one place the type system genuinely
 * cannot reach is here, and these constants are that boundary rather than a
 * stack retyped at each draw call. `chartFonts()` below pairs them with sizes
 * derived from the same scale the stylesheet uses.
 */
export const MONO_STACK = "'JetBrains Mono Variable', ui-monospace, monospace";
export const DISPLAY_STACK = "'Space Grotesk Variable', system-ui, sans-serif";
export const SANS_STACK = "'Public Sans Variable', ui-sans-serif, system-ui, sans-serif";

/** The type scale's anchor when no stylesheet can be read — matches --fs-body. */
const FALLBACK_BODY_PX = 14;

/**
 * `--fs-body` in real pixels.
 *
 * Read off a probe element rather than off the custom property, because an
 * unregistered custom property comes back as its DECLARED text — `0.875rem` —
 * and canvas needs a number. Resolving it through a real element also means the
 * `--ui-scale` knob is already folded in (rem resolves against the scaled root)
 * and a knob that pins `--fs-body` in px works exactly as well as one in rem.
 */
let bodyPxCache = null;

function bodyPx() {
    if (typeof document === 'undefined' || !document.documentElement) return FALLBACK_BODY_PX;
    const cs = getComputedStyle(document.documentElement);
    // Two cheap style reads guard one DOM mutation. Some of these plugins draw
    // on every frame of a zoom drag, and appending a probe element per frame to
    // re-derive a number that changes only when a knob moves is the kind of
    // cost that makes people go back to hardcoding 11px. The key is everything
    // the answer depends on: the root size (which carries --ui-scale) and the
    // declared --fs-body.
    const key = `${cs.fontSize}|${cs.getPropertyValue('--fs-body')}`;
    if (bodyPxCache && bodyPxCache.key === key) return bodyPxCache.px;

    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;font-size:var(--fs-body)';
    document.documentElement.appendChild(probe);
    const measured = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();

    const px = Number.isFinite(measured) && measured > 0 ? measured : FALLBACK_BODY_PX;
    bodyPxCache = { key, px };
    return px;
}

/**
 * The canvas type scale — the one surface the stylesheet cannot reach.
 *
 * Chart.js and the custom plugins take a CSS font shorthand, which cannot hold
 * a custom property, so every chart drew its labels in a hardcoded
 * `11px system-ui` while the rest of the site moved to Public Sans. Fifteen
 * literals across seven files, none of them reachable from the type scale and
 * none of them moving when the --ui-scale knob did.
 *
 * The ratios are the roles' own ratios, and they are chosen so that at the
 * default 14px body every one resolves to the pixel size that was hardcoded
 * before — so this ties the charts into the scale without moving a single
 * label today. Three of the five ARE existing roles: `label` is one --fs-step
 * down, `micro` and `nano` are .text-micro and .text-nano.
 *
 * Call it while building the chart, next to chartTheme(), for the same reason:
 * the scale can change under a knob, and a value cached at module load pins the
 * charts to whatever it was at first import.
 */
export function chartFonts() {
    const body = bodyPx();
    const at = (ratio) => Math.round(body * ratio * 10) / 10;
    return {
        sans: SANS_STACK,
        mono: MONO_STACK,
        display: DISPLAY_STACK,
        frame: at(1.2143),  // 17px — the PNG frame's title, the largest canvas text
        axis:  at(0.9286),  // 13px — axis titles and tick labels
        label: at(0.8571),  // 12px — one full --fs-step down; in-bar primary
        badge: at(0.7857),  // 11px — in-bar secondary
        micro: at(0.7143),  // 10px — .text-micro
        nano:  at(0.6429),  //  9px — .text-nano
    };
}

/**
 * Point Chart.js's own text at the site's typeface.
 *
 * Chart.js defaults to Helvetica/Arial, and nothing here ever changed the
 * FAMILY — so every tick label, legend entry and axis title on the site was
 * drawn in a font the design never chose. The size was set, once, as a module
 * side-effect in ChargingView.jsx: charts reachable without loading that module
 * (Compare Specs, Performance) silently got a different size as well.
 *
 * Called from inside each chart's build effect, so it re-applies on a theme
 * flip or a scale change rather than depending on which module loaded first.
 */
export function applyChartDefaults(Chart) {
    const fonts = chartFonts();
    Chart.defaults.font.family = fonts.sans;
    Chart.defaults.font.size = fonts.axis;
    return fonts;
}

/** The dark palette, for when no stylesheet can be read. */
const FALLBACK = {
    tick:       'rgb(139, 149, 165)',
    legend:     'rgb(168, 178, 193)',
    grid:       'rgb(26, 33, 44)',
    axis:       'rgb(61, 74, 90)',
    background: 'rgb(17, 22, 31)',
};

/**
 * Resolve the chart palette for whatever theme is currently applied.
 *
 * @returns {{tick: string, legend: string, grid: string, axis: string, background: string}}
 *   tick       — axis tick labels
 *   legend     — legend entries, axis titles and the chart title
 *   grid       — gridlines inside the plot area
 *   axis       — the axis lines themselves, a step stronger than the grid
 *   background — the flat fill a PNG export is composited onto
 */
export function chartTheme() {
    if (typeof document === 'undefined' || !document.documentElement) {
        return { ...FALLBACK };
    }
    const cs = getComputedStyle(document.documentElement);
    // An unset custom property returns '' rather than throwing, so each read
    // falls back on its own — one missing token must not blank the whole chart.
    const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;

    return {
        tick:       read('--color-text-muted', FALLBACK.tick),
        legend:     read('--color-text-secondary', FALLBACK.legend),
        grid:       read('--color-chart-grid', FALLBACK.grid),
        axis:       read('--color-chart-axis', FALLBACK.axis),
        // The panel, not the page: a chart is exported as the thing it sits in,
        // and the frame it will gain in a later phase is that same panel.
        background: read('--color-card', FALLBACK.background),
    };
}
