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
 * cannot reach is here, and these two constants are that boundary rather than a
 * stack retyped at each draw call.
 */
export const MONO_STACK = "'JetBrains Mono Variable', ui-monospace, monospace";
export const DISPLAY_STACK = "'Space Grotesk Variable', system-ui, sans-serif";

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
