/**
 * Chart navigation — the top-level data categories and their sub-tabs.
 *
 * Each category here is a TOP-LEVEL tab, sitting alongside Vehicles, Tests &
 * Data and Admin. There is no "Charts" wrapper tab; a category IS the tab, and
 * its `modes` are that tab's sub-nav. This file is the single source of truth
 * for that structure; App.jsx renders directly from it.
 *
 * ── WHY THE MODE KEYS ARE FROZEN ────────────────────────────────────────────
 *
 * The `key` of each mode is NOT just a nav label — it's a stable identifier
 * three other systems depend on, none of which fail loudly if it changes:
 *
 *   1. Pop-out presentation windows. useChartSync broadcasts `chartMode` over a
 *      BroadcastChannel and PopoutView switches on the raw string. A renamed key
 *      makes the popout render nothing, or silently fall through to the wrong
 *      chart.
 *   2. Chart help bubbles. `chart_help.chart_key` in the database uses these
 *      exact strings (migrations 031/032), and each view passes its own literal
 *      to ChartInfoBubble. A rename orphans the DB rows — the bubble goes blank
 *      rather than erroring.
 *   3. Shareable URLs. The `?m=<mode>` param is how a chart link is shared, so
 *      renaming breaks links people already sent each other.
 *
 * So categories are a presentation layer laid OVER the existing keys. Grouping
 * changed; identifiers did not. Adding a genuinely new view is fine — just give
 * it a new key here, add its render branch in App.jsx (including the fall-
 * through guard noted there), a PopoutView branch, and a CHART_HELP_DEFAULTS
 * entry.
 *
 * NOTE: 'specs' is the Spec CHART (bar). Compare Specs — the table — is
 * 'specstable'. The two are easy to confuse; 'specs' is the older key and is
 * kept as-is for the reasons above.
 */

export const CHART_CATEGORIES = [
    {
        // "Charging & Efficiency", not "Range & Efficiency": the 'range' mode
        // below already carries that name, and a tab sharing a label with one of
        // its own sub-tabs made the nav ambiguous. The key stays 'efficiency' —
        // it's the ?tab= token, and churning it would gain nothing visible.
        key: 'efficiency',
        label: 'Charging & Efficiency',
        modes: [
            { key: 'charging',  label: 'Charging' },
            { key: 'range',     label: 'Range & Efficiency' },
            { key: 'compare',   label: 'Charge Compare' },
            { key: 'roadtrip',  label: 'Road Trip' },
            { key: 'epacurves', label: 'EPA Curves' },
        ],
    },
    {
        key: 'specifications',
        label: 'Specifications',
        modes: [
            { key: 'specstable',  label: 'Compare Specs' },
            { key: 'specs',       label: 'Spec Chart' },
            { key: 'specscatter', label: 'Spec Scatter' },
        ],
    },
];

/** Mode shown when none is specified, and the fallback for an unknown `?m=`. */
export const DEFAULT_CHART_MODE = 'charging';

/** Every valid mode key, for validating URL input. */
export const ALL_CHART_MODES = CHART_CATEGORIES.flatMap(c => c.modes.map(m => m.key));

/** Category keys — these double as top-level `view` values in App.jsx. */
export const CHART_CATEGORY_KEYS = CHART_CATEGORIES.map(c => c.key);

/** True when a top-level view is one of the chart categories. */
export const isChartCategory = (view) => CHART_CATEGORY_KEYS.includes(view);

/** The category object for a top-level view key, or null if it isn't one. */
export function categoryByKey(view) {
    return CHART_CATEGORIES.find(c => c.key === view) ?? null;
}

/** The category containing `mode`, or the first category if it isn't found. */
export function categoryForMode(mode) {
    return CHART_CATEGORIES.find(c => c.modes.some(m => m.key === mode)) ?? CHART_CATEGORIES[0];
}

/** Human label for a mode key, for titles and tooltips. */
export function labelForMode(mode) {
    for (const c of CHART_CATEGORIES) {
        const found = c.modes.find(m => m.key === mode);
        if (found) return found.label;
    }
    return mode;
}
