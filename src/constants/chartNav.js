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
 * ── A CATEGORY THAT LIVES UNDER ANOTHER TAB ─────────────────────────────────
 *
 * A category with `navParent` is not a tab of its own. It is drawn under that
 * tab — its modes join the parent's sub-nav, and the parent's tab is the one
 * lit — while keeping everything a chart mode has: the selection chips, the
 * pop-out, the URL state and its help bubble. The navigation plan on #338 put
 * EPA Curves under the EPA tab, as Modeled Efficiency in its "Selected
 * vehicles" section, beside the all-EVs Modeled
 * Efficiency, which is not a chart mode; this is how it gets there without
 * losing any of that.
 *
 * NOTE: 'specs' is the Spec CHART (bar). Compare Specs — the table — is
 * 'specstable'. The two are easy to confuse; 'specs' is the older key and is
 * kept as-is for the reasons above.
 */

export const CHART_CATEGORIES = [
    {
        key: 'performance',
        label: 'Performance',
        modes: [
            { key: 'perfcompare', label: 'Compare' },
            { key: 'perfcurve',   label: 'Acceleration Curve' },
        ],
    },
    {
        // "Charging & Range" (#338): the analysis of EVBench's tested results.
        // Not "Range & Efficiency", which is one of its own sub-tabs; not
        // "Charging & Efficiency" any more, since efficiency is also the EPA
        // tab's subject. The key stays 'efficiency' — it's the ?tab= token, and
        // churning it would break links for nothing visible.
        key: 'efficiency',
        label: 'Charging & Range',
        modes: [
            // Labels renamed (#338) for what each shows; keys unchanged.
            { key: 'charging',  label: 'Charging Curves' },
            { key: 'range',     label: 'Range & Efficiency' },
            // A charging stop's worth: range added in X minutes, time to add M miles.
            { key: 'compare',   label: 'Charge Stop' },
            { key: 'roadtrip',  label: 'Road Trip' },
        ],
    },
    {
        // EPA Curves, renamed (#338) and moved under the EPA tab. It stays a
        // chart mode — the selected vehicles' modeled efficiency with EVBench's
        // range tests laid over it — so it keeps the chips, pop-out and URL
        // state. Its key is frozen like every mode's (see the top); the tab
        // key is new, and old ?tab=efficiency&m=epacurves links land here
        // because the URL restore lands on whichever category owns the mode.
        // Its label is the sub-nav SECTION it heads (#338). The view shares
        // its name with EPA's own Modeled Efficiency on purpose: one model,
        // two scopes — every EV EPA rated, or the selected vehicles with their
        // tests — and the section says which.
        key: 'epatested',
        label: 'Selected vehicles',
        navParent: 'epa',
        modes: [
            { key: 'epacurves', label: 'Modeled Efficiency',
              description: 'The selected vehicles’ efficiency against speed, modeled from their EPA data, with EVBench’s range tests laid over it.' },
        ],
    },
    {
        // The Specifications tab, folded into Vehicles & Specs (#338) as its
        // "Specifications & Data" section: views of the same fleet the cards
        // and list show. The tab key stays, so ?tab=specifications links land
        // here, under Vehicles & Specs.
        key: 'specifications',
        label: 'Specifications & Data',
        navParent: 'vehicles',
        modes: [
            // Key kept: it is the URL and chart-help identifier (see the note
            // at the top). The table it names became the vehicle table in #315.
            // It needs no selection because it is where one is made.
            { key: 'specstable',  label: 'Table', needsSelection: false },
            // One sub-nav item, "Chart", for the two spec charts: a bar or a
            // scatter of the table's columns, switched above the plot. The
            // scatter is drawn AS the bar's item (`navAlias`), so the sub-nav
            // lights Chart for either.
            { key: 'specs',       label: 'Chart' },
            { key: 'specscatter', label: 'Chart', navAlias: 'specs' },
        ],
    },
];

/** Mode shown when none is specified, and the fallback for an unknown `?m=`. */
export const DEFAULT_CHART_MODE = 'charging';

/** Every valid mode key, for validating URL input. */
export const ALL_CHART_MODES = CHART_CATEGORIES.flatMap(c => c.modes.map(m => m.key));

/** Category keys — these double as top-level `view` values in App.jsx. */
export const CHART_CATEGORY_KEYS = CHART_CATEGORIES.map(c => c.key);

/** The chart categories that are top-level tabs: every one without a `navParent`. */
export const TOP_CHART_CATEGORIES = CHART_CATEGORIES.filter(c => !c.navParent);

/**
 * The top-level tab a view is shown under: its category's `navParent`, else
 * the view itself. What the header lights, and which sub-nav is drawn.
 */
export function navTabFor(view) {
    return categoryByKey(view)?.navParent ?? view;
}

/**
 * The chart modes drawn in a non-chart tab's sub-nav (a category's
 * `navParent`), one item each, each carrying its category's label as `group`
 * so the sub-nav can head the section. A mode drawn as another's item
 * (`navAlias`) is left out: that item stands for both.
 */
export function chartModesUnder(tab) {
    return CHART_CATEGORIES.filter(c => c.navParent === tab)
        .flatMap(c => c.modes.filter(m => !m.navAlias).map(m => ({ ...m, group: c.label })));
}

/** The sub-nav item a mode is drawn as: its `navAlias`, else itself. */
export function navItemForMode(mode) {
    for (const c of CHART_CATEGORIES) {
        const found = c.modes.find(m => m.key === mode);
        if (found) return found.navAlias ?? found.key;
    }
    return mode;
}

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

/**
 * Whether a mode can show anything with no vehicles selected. Every chart
 * plots the selection, so that is the default; a mode opts out by saying so.
 */
export const modeNeedsSelection = (mode) => mode?.needsSelection !== false;

/**
 * The mode to open a category on. The remembered one when it can show
 * something, otherwise the first mode that can — so a tab entered with nothing
 * selected lands on a view that works rather than on an empty chart.
 */
export function entryModeFor(category, remembered, hasSelection) {
    const usable = category.modes.filter(m => hasSelection || !modeNeedsSelection(m));
    return usable.find(m => m.key === remembered)?.key ?? usable[0]?.key ?? null;
}

/** Human label for a mode key, for titles and tooltips. */
export function labelForMode(mode) {
    for (const c of CHART_CATEGORIES) {
        const found = c.modes.find(m => m.key === mode);
        if (found) return found.label;
    }
    return mode;
}
