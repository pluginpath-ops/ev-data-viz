/**
 * The catalogue of controls the site is allowed to draw with.
 *
 * Data, not markup, and deliberately so. It is read twice: `Playground.jsx`
 * renders it, and `playground.test.js` checks the stylesheet against it. That
 * second reader is the point — a catalogue nobody verifies drifts out of date
 * within a month and then actively misleads, which is worse than not having one.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * Three jobs, in order of how much they matter:
 *
 *   1. SEEING. Every button, pill and field on one page, in both themes, so
 *      divergence in size, weight and contrast is obvious side by side instead
 *      of being noticed a tab at a time. #277 is the backlog that produced.
 *   2. CHOOSING. A menu. "Use the filter pill, not a fourth kind of button" is
 *      a sentence you can only say if there is a list to point at.
 *   3. CONSTRAINING. A new class in an owned family fails the coverage test
 *      until it is catalogued or explicitly excused, so the list stays true and
 *      additions stay deliberate.
 *
 * ── Owned families ─────────────────────────────────────────────────────────
 *
 * Coverage is asserted only within `OWNED_FAMILIES`. The stylesheet has ~411
 * classes and most are layout, tables and chart internals that need real data
 * to mean anything — cataloguing them would be a list of empty boxes. The
 * families here are the ones a feature actually picks FROM, which is the
 * decision this page exists to inform. Widen them as later sections land.
 */

/** A class is expected in the catalogue when it matches one of these. */
export const OWNED_FAMILIES = [
    { id: 'buttons', label: 'Buttons', match: (n) => /^btn(-|$)/.test(n) },
    { id: 'pills',   label: 'Pills, chips & badges',
      match: (n) => /(chip|badge|pill)/.test(n) || /^tag-(filter|pill)/.test(n) },
    { id: 'forms',   label: 'Form controls', match: (n) => /^form-input$/.test(n) },
    { id: 'type',    label: 'Typography',
      match: (n) => /^(text-(body|caption|control|data|label|meta|micro|nano|note|secondary)|page-title|section-title|subsection-title)$/.test(n) },
    { id: 'notices', label: 'Notices & panels',
      match: (n) => /^(note-panel|state-panel|drop-zone|empty-state|fixed-action-bar)/.test(n) },
    { id: 'menus',   label: 'Menus & popovers',
      match: (n) => /^(menu-button|guide-facet-|disclosure-caret|nav-menu|account-|popover|info-icon|color-|series-swatch)/.test(n) },
    { id: 'figures', label: 'Figures — frames, bars, cells',
      match: (n) => /^(plot-frame|stat-cell|guide-spark|guide-cell-stack|stats-box-|stats-histogram-|run-band|run-cell)/.test(n) },
];

/**
 * In an owned family, but deliberately not rendered as a specimen.
 *
 * A reason is required. These are containers and layout wrappers that carry no
 * appearance of their own — a specimen of them would be an empty box that
 * teaches nothing — or variants whose parent is already shown.
 */
export const NOT_CATALOGUED = {
    'info-icon':        'Layout wrapper — an inline-flex span holding the glyph. The glyph is catalogued.',
    'popover-foot-gap': 'A flex spacer inside the action row — it has no appearance at '
        + 'all, it is the gap that keeps Auto away from Apply. The row is catalogued.',
    'popover--anchored': 'Position and layer only, no appearance: it carries the `fixed` that lets a panel leave a scrolling sidebar. Its two tiers are catalogued.',
    'cert-chips':        'Layout wrapper — a flex row that holds chips. The chips are catalogued.',
    'tag-filter-bar':    'Layout wrapper for the filter row.',
    'tag-filter-legend': 'The "AND / OR / NOT" key beside the bar, not a control.',
    'run-stat-badges':   'Layout wrapper — a flex row of badges.',
    'guide-chip-count':  'The count suffix inside .guide-chip; shown as part of that specimen.',
    'text-control': 'A size, not a role — the one step down that control surfaces run at. '
        + 'It has no color of its own, so a specimen would be body text at 12px.',
    'text-caption': 'Shown inside the histogram and run-band composites, which is where it '
        + 'is actually used: a count beside a heading, an axis end.',
    'state-panel-title': 'The heading inside a state panel; it takes the panel\'s own '
        + 'color rather than restating it, so it is shown by those specimens.',
    'guide-facet-panel-search': 'The filter box that appears above eight options; shown by '
        + 'the facet-menu composite only when the list is long enough to need it.',
    'guide-facet-label': 'Superseded by the menu button — a leftover of the chip wall 5a '
        + 'replaced, still styling one label in the stats controls.',
    'guide-facet-values': 'Layout wrapper for a row of chips. The chips are catalogued.',
    'guide-facet-search': 'Layout wrapper for the search input beside a facet row.',
    'guide-facet-columns': 'Layout wrapper — a grid of facet columns.',
    'fixed-action-bar':
        'position: fixed. A specimen of it would leave the stage and pin itself to the '
        + 'bottom of the window, over the page it is meant to be illustrating. Its three '
        + 'intents are the same success / warning / danger triad the state panel shows.',
    'selected-chip-scroll':
        'The capped, scrolling box the selected-vehicle chips sit in. It is a '
        + 'height budget for the sticky header, not a control — a specimen of it '
        + 'would be an empty 60px rectangle. The chips inside it are catalogued.',
    'btn-toggle-clear':  'The × inside an active .btn-toggle; shown as part of that specimen.',
    'vehicle-media-badge':
        'Absolutely positioned over a vehicle photograph, on a dark plate that only '
        + 'makes sense against one. A specimen on the flat playground surface would '
        + 'show the plate and not the thing it exists to survive.',
};

/**
 * Classes styled by a `[data-theme="dark"] .foo` override rather than by tokens.
 *
 * These CANNOT scope to a subtree. The selector is a descendant of the document
 * root, so a `.badge-default` inside a `[data-theme="light"]` pane is still
 * inside `html[data-theme="dark"]` and keeps the dark styling — light-mode
 * background under dark-mode text, at 1.38:1. The side-by-side view is telling
 * the truth about the CSS and lying about the theme.
 *
 * So it is marked rather than hidden. This list IS the migration backlog for
 * #277: a class drawn from tokens works in both panes and under any future
 * reskin; one of these works only at the document root. `playground.test.js`
 * keeps it honest against the stylesheet, so the list shrinks as classes move
 * and cannot silently grow.
 */
export const DARK_OVERRIDE_CLASSES = new Set([
    'badge-hidden',
    'brand-alias-chip', 'chart-copy-btn-active',
    'guide-row', 'guide-tested-note',
    'merge-target-banner', 'stats-suppressed-flag',
    'sweep-batch', 'vote-btn-vouch'
]);

/** Whether a specimen's class list contains one that cannot scope. */
export function hasDarkOverride(cls) {
    return cls.split(/\s+/).some(c => DARK_OVERRIDE_CLASSES.has(c));
}

/**
 * The specimens, by section.
 *
 * `cls` is what a call site would write. `as` picks the element so the specimen
 * behaves like the real thing — a button that can be clicked and focused, an
 * input that can be typed into — because half of what this page is for is
 * checking interaction and focus states, which a div cannot show.
 */
export const SECTIONS = [
    {
        id: 'notices',
        title: 'Notices & panels',
        blurb: 'A block carrying an intent. `.note-panel` is the small bordered notice — '
             + 'warning by default, because most of them are warnings and a notice with no '
             + 'intent is a paragraph. `.state-panel` is the larger block that says what an '
             + 'operation is about to do, and whether that is fine.',
        specimens: [
            { cls: 'note-panel', as: 'span', label: '⚠ Set the battery capacity to derive charging axes.',
              note: 'Warning is the default.' },
            { cls: 'note-panel is-danger', as: 'span', label: 'Could not read that file.' },
            { cls: 'note-panel is-info', as: 'span', label: '📅 Timestamps detected — will be converted.',
              note: 'The brand surface, not a status one: nothing is wrong.' },
            { cls: 'state-panel', as: 'span', label: 'Neutral — nothing to report yet.' },
            { cls: 'state-panel is-good', as: 'span', label: '✓ Range will be estimated from test data.' },
            { cls: 'state-panel is-warning', as: 'span', label: 'No SoC column mapped.' },
            { cls: 'state-panel is-danger', as: 'span', label: '⚠ Map at least one of SoC or Time.' },
            { cls: 'drop-zone', as: 'span', label: 'Drop a CSV here' },
            { cls: 'drop-zone is-over', as: 'span', label: 'Drop a CSV here', note: 'While a file is over it.' },
            { cls: 'empty-state', as: 'span', label: 'No configurations match these filters.' },
        ],
    },
    {
        id: 'menus',
        title: 'Menus & popovers',
        blurb: 'A button that states its value and opens a panel — WAI-ARIA calls it a menu '
             + 'button. One component (`MenuButton`) behind every one of them: Browse\'s nine '
             + 'facet menus, the column picker, the statistics measure and group-by. The panel '
             + 'contents stay with the caller.',
        specimens: [
            { cls: 'guide-facet-btn', as: 'button', label: 'Make ▾', note: 'Resting — nothing selected.' },
            { cls: 'guide-facet-btn active', as: 'button', label: 'Make Rivian ▾', note: 'Narrowing something.' },
            { cls: 'disclosure-caret', as: 'span', label: '▾',
              note: 'The glyph that says a thing opens. Secondary at rest, primary on the button\'s hover — it was --color-text-faint, which in dark is the DISABLED color.' },
            { cls: 'popover popover--below', as: 'span', label: 'Popover',
              note: 'The base every floating surface uses — one fill, one radius, one shadow, one layer. Width comes from --popover-w, placement from a --<placement> modifier.' },
            { composite: 'facet-panel', label: 'Facet menu, open',
              covers: ['menu-button', 'popover--stretch', 'popover--end', 'guide-facet-panel', 'guide-facet-panel-head', 'guide-facet-panel-list', 'guide-facet-panel-foot', 'guide-facet-option', 'guide-facet-option-name', 'guide-facet-option-count', 'guide-facet-btn-value', 'guide-facet-caret'],
              note: 'A value that would leave nothing is disabled rather than hidden: a make vanishing reads as a bug, a greyed one reads as an answer.' },
            { cls: 'nav-menu-item', as: 'button', label: 'Charging & Efficiency',
              note: 'One destination in the collapsed nav. 40px of target — this is the control every other screen is reached through on a phone.' },
            { cls: 'nav-menu-item active', as: 'button', label: 'EPA' },
            { cls: 'account-btn signed-in', as: 'button', label: 'G',
              note: 'Signed in reads differently from signed out at a glance: filled and lettered vs outlined and generic.' },
            { composite: 'account-menu', label: 'Account menu, open',
              covers: ['account-menu', 'account-panel', 'account-identity', 'account-email', 'account-row', 'account-segmented', 'account-action'],
              note: 'What used to sit beside it in the nav bar: the signed-in email, the role, and the unit system. The Sign In button it replaced cost 111px of a 375px phone bar.' },
            { cls: 'info-icon-glyph', as: 'button', label: 'ⓘ',
              note: 'A real button, not a glyph in a span: before the popover pass there was no keyboard route to any of the 21 of them, and the four carrying a reference table had no accessible name at all.' },
            { composite: 'popover-peek', label: 'Peek — hover or focus',
              covers: ['popover--peek', 'popover-more'],
              note: 'Pointer-transparent, so it never eats a click on what it explains, and it closes on scroll rather than being scrolled. The height cap fits the copy: the design asked for four lines, but the shortest explainer measured five and the longest twenty.' },
            { composite: 'popover-pinned', label: 'Pinned — click',
              covers: ['popover--pinned', 'popover-head', 'popover-title', 'popover-close'],
              note: 'Fixed, selectable, scrollable, one at a time. It is where a reference table goes — 520px, which no sidebar has, which is the whole reason the panel had to leave.' },
            { composite: 'popover-sheet', label: 'Sheet — narrow screens',
              covers: ['popover--sheet', 'popover-grabber'],
              note: 'There is no hover to peek with on touch, so a tap opens this directly rather than reproducing a hover tier as a tap.' },
            { composite: 'series-swatch', label: 'Series swatch — the read-only one',
              covers: ['series-swatch'],
              note: 'The 10px sibling of the picker\'s trigger: it REPORTS which line a row is, it does not change it. Hollow when the row is not plotted, so it says "not on the chart" rather than claiming a color it does not have; orange dot when the series rests on an assumption.' },
            { composite: 'series-color-picker', label: 'Series color picker (live)',
              covers: ['popover-anchor', 'popover-foot', 'series-swatch--button',
                       'color-picker-body', 'color-row', 'color-scope', 'color-switch',
                       'color-slots', 'color-slot', 'color-hex', 'color-hex-chip',
                       'color-auto', 'color-manual', 'color-seed-radio', 'color-seed-name',
                       'color-slider', 'color-slider-input', 'color-seed', 'color-seed-row',
                       'color-seed-chips', 'color-readout', 'color-warning', 'color-note'],
              note: 'The one live specimen on this page, because a picker is a mechanism rather than an appearance. It replaced five <input type="color"> boxes — the browser\'s own dialog, one color at a time, with no view of the set you are picking against. A pick here is a BASE: it becomes slot 1 and the rest of the set is re-derived from it, by rotation across hues or by lightness steps along one. Scope decides who that set is. Nothing at any scope reaches the database. Cancel, ×, Escape and an outside click all discard.' },
            { composite: 'nav-menu', label: 'Nav menu, collapsed',
              covers: ['nav-menu', 'nav-menu-main', 'nav-menu-sub', 'nav-menu-btn', 'nav-menu-current', 'nav-menu-panel', 'nav-menu-item-hint'],
              note: 'A gated destination says WHY in the row — a title attribute is invisible on touch, which is the only place this form appears.' },
        ],
    },
    {
        id: 'figures',
        title: 'Figures — frames, bars, cells',
        blurb: 'The marks that carry a measurement. All of them are drawn with positioned '
             + 'divs against a shared domain rather than a chart library, because each is a '
             + 'line, a band and a tick — and the axis has to match the data exactly.',
        specimens: [
            { composite: 'plot-frame', label: 'Plot frame',
              covers: ['plot-frame', 'plot-frame-head', 'plot-frame-title', 'plot-frame-subtitle', 'plot-frame-mark'],
              note: 'The figure boundary a PNG export captures — title, subtitle, and the accent mark.' },
            { composite: 'stat-cell', label: 'Stat cell',
              covers: ['stat-cell', 'stat-cell-value', 'stat-cell-unit', 'stat-cell-empty'],
              note: 'A measured figure with its name above and its unit beside. Unrecorded is a dim dash, never blank.' },
            { composite: 'distribution-bar', label: 'Distribution bar',
              covers: ['stats-box-track', 'stats-box-whisker', 'stats-box-iqr', 'stats-box-median'],
              note: 'Min–max line, IQR band, orange median tick. Every row is drawn against the CORPUS domain, never its own — the lower one is the corpus, which spans by definition.' },
            { composite: 'sparkline', label: 'Sparkline',
              covers: ['guide-spark', 'guide-cell-stack'],
              note: 'The value, then its bar beneath. Soft-to-strong left to right, so a short bar is dimmer as well as shorter.' },
            { composite: 'histogram', label: 'Histogram',
              covers: ['stats-histogram', 'stats-histogram-head', 'stats-histogram-plot', 'stats-histogram-bars', 'stats-histogram-bar', 'stats-histogram-axis', 'stats-histogram-median', 'stats-histogram-median-chip', 'stats-histogram-median-value', 'text-caption'],
              note: 'Four steps of one blue by height; an empty bin gets none of them. The median rides on a chip ABOVE the plot area — never over the bars it measures.' },
            { composite: 'run-band', label: 'Run band',
              covers: ['run-bands', 'run-band', 'run-band-label', 'run-band-cells', 'run-cell', 'run-cell-label', 'run-cell-value', 'run-cell-missing', 'run-cell-tags', 'run-cell-action'],
              note: 'A solid label rail and an auto-fit track grid: as many columns as the run actually records, no padding columns.' },
        ],
    },

    {
        id: 'buttons',
        title: 'Buttons',
        blurb: 'Solid, rectangular actions. `.btn` is the base; add one intent class. '
             + 'One size — the compact metrics that used to be `.btn-sm` are now the base, '
             + 'and the modifier is gone (#277).',
        specimens: [
            { cls: 'btn btn-primary',   as: 'button', label: 'Primary',   note: 'Additive / available actions — Add, Save, View.' },
            { cls: 'btn btn-secondary', as: 'button', label: 'Secondary', note: 'Cancel, Back, and the unselected half of an exclusive pair.' },
            { cls: 'btn btn-edit',      as: 'button', label: 'Edit',      note: 'Edit actions. Currently the same green as success.' },
            { cls: 'btn btn-warning',   as: 'button', label: 'Warning',   note: 'Attention-drawing but not destructive.' },
            { cls: 'btn btn-danger',    as: 'button', label: 'Danger',    note: 'Destructive. Delete, Remove.' },
            { cls: 'btn-icon-danger',   as: 'button', label: 'Danger · icon',
              note: 'A destructive glyph that stays quiet until you approach it — a row × , a clear-column ×.' },
            { cls: 'btn-tab',        as: 'button', label: 'Nav tab',   note: 'Top-level navigation. Add `.active` for the current one.' },
            { cls: 'btn-tab active', as: 'button', label: 'Nav tab · active' },
            { cls: 'btn-subtab',        as: 'button', label: 'Sub-tab',
              note: 'All second-level navigation — Runs, EPA, Admin and the chart selector. No border, no resting fill: it is a tab, not a button.' },
            { cls: 'btn-subtab active', as: 'button', label: 'Sub-tab · active' },
            { cls: 'btn btn-toggle',        as: 'button', label: 'Toggle · off',
              note: 'A button showing an on/off state — "Set Default" on a test. Quiet when off so it does not compete with Edit and Delete beside it.' },
            { cls: 'btn btn-toggle active', as: 'button', label: 'Toggle · on', note: 'Hover it: clearing is the action when it is already on.' },
            { cls: 'btn btn-restore',       as: 'button', label: 'Restore',
              note: 'The undo state of a queued delete. Warning, not danger — nothing is destroyed yet and the click puts it back.' },
        ],
    },
    {
        id: 'pills',
        title: 'Pills, chips & badges',
        blurb: 'Rounded-full, and now ONE size: guide-chip, tag-filter-btn, path-chip, '
             + 'brand-alias-chip and fe-picker-badge share their metrics and differ only in '
             + 'color. Badges keep their own shape — a label you read is not a control you '
             + 'press. See #277.',
        specimens: [
            { cls: 'guide-chip',        as: 'button', label: 'Filter chip',  note: 'The shared chip metrics — text-xs, px-2 py-0.5.' },
            { cls: 'guide-chip active', as: 'button', label: 'Filter chip · active' },
            { cls: 'tag-filter-btn tag-filter-na',  as: 'button', label: 'Tag filter · off',  note: 'Was text-sm/px-3 py-1; now matches the filter chip.' },
            { cls: 'tag-filter-btn tag-filter-and', as: 'button', label: 'Tag filter · AND',  note: 'Raw bg-blue-500, outside the token system.' },
            { cls: 'tag-filter-btn tag-filter-or',  as: 'button', label: 'Tag filter · OR',   note: 'Raw bg-green-500.' },
            { cls: 'tag-filter-btn tag-filter-not', as: 'button', label: 'Tag filter · NOT',  note: 'Raw bg-red-500.' },
            { cls: 'selected-vehicle-chip', as: 'span', label: 'Selected vehicle', note: 'Persistent selection row. No border — "blue on blue".' },
            { cls: 'session-vehicle-chip',  as: 'span', label: 'Session vehicle' },
            { cls: 'tag-pill',        as: 'span', label: 'Tag' },
            { cls: 'path-chip',       as: 'span', label: 'Path' },
            { cls: 'brand-alias-chip', as: 'span', label: 'Brand alias' },
            { cls: 'guide-badge',        as: 'span', label: 'Guide badge', note: 'Base carries no background of its own — it needs a state below.' },
            { cls: 'guide-badge guide-badge-tested', as: 'span', label: 'Guide badge · tested' },
            { cls: 'guide-badge guide-badge-multi',  as: 'span', label: 'Guide badge · multi' },
            { cls: 'stats-histogram-median-chip', as: 'span', label: 'Histogram median',
              note: 'Rides above the plot area, never over the bars it measures.' },
            { cls: 'badge-micro',            as: 'span', label: 'Micro badge',
              note: 'The metrics every run-row marker shares. Mono, because a badge on a run row almost always carries a figure — "70 mph", "72 °F", "291 mi". Neutral by default: most are readings, not states.' },
            { cls: 'badge-micro is-qualified', as: 'span', label: 'Micro badge · qualified',
              note: 'A reading that is true but carries a caveat — a cycle average where the column means a held speed. Neutral background, because nothing is wrong with the number; the dagger beside it does the rest, since a marker that exists only as a hue is invisible to a reader who cannot see the hue.' },
            { cls: 'badge-micro is-warning', as: 'span', label: 'Micro badge · warning' },
            { cls: 'badge-micro is-danger',  as: 'span', label: 'Micro badge · danger' },
            { cls: 'badge-default',   as: 'span', label: 'Default',
              note: 'DEF. The one accent-colored marker, because it is the only one saying which row is privileged rather than what a row measured.' },
            { cls: 'badge-hidden',    as: 'span', label: 'Hidden' },
            { cls: 'badge-status',    as: 'span', label: 'Status' },
            { cls: 'owner-badge',     as: 'span', label: 'Owner' },
            { cls: 'badge-micro is-qualified', as: 'span', label: 'Corrected' },
            { cls: 'guide-narrowed-chip', as: 'button', label: '2026 ✕',
              note: 'Removes its own value. The opposite of the chips it replaced, which selected one — hence the ✕ and the danger-colored hover.' },
            { cls: 'fe-picker-badge', as: 'span', label: 'FE picker' },
            { cls: 'pair-more-badge', as: 'span', label: '+2 more' },
            { cls: 'spec-link-kind-pill', as: 'span', label: 'Link kind' },
            { cls: 'spec-link-type-badge', as: 'span', label: 'Link type' },
            { cls: 'import-badge-create', as: 'span', label: 'Create' },
            { cls: 'import-badge-update', as: 'span', label: 'Update' },
            { cls: 'import-badge-skip',   as: 'span', label: 'Skip' },
            { cls: 'import-badge-error',  as: 'span', label: 'Error' },
        ],
    },
    {
        id: 'forms',
        title: 'Form controls',
        blurb: '.form-input carries its own size, and every text control on the site now '
             + 'uses it — 148 of them had no styling at all and were rendering as browser '
             + 'defaults. Width and alignment stay per-field; nothing else does (#277).',
        specimens: [
            { cls: 'form-input',  as: 'input', label: 'form-input', note: 'The one field style. px-2 py-1, text-sm.' },
            { cls: 'form-input',  as: 'select', label: 'select' },
            { cls: 'form-input',  as: 'textarea', label: 'textarea' },
            { cls: 'data-cell-input', as: 'input', label: 'Data cell',
              note: 'The one field that is NOT .form-input, deliberately: it is transparent until hover or focus, because a hundred-row grid of bordered boxes is a wall. Hover it.' },
            { cls: 'form-input reorder-position-input', as: 'input', label: 'Reorder position',
              note: 'A modifier ON .form-input now — it only sets width, height and centring. It used to restate the surface, border and text color, which is three chances to drift from the field it imitates.' },
        ],
    },
    {
        id: 'type',
        title: 'Typography',
        blurb: 'ONE axis: a role carries its own size, weight and color, and you pick '
             + 'exactly one. The color tiers are gone — text-muted folded into '
             + 'text-secondary, text-faint into text-meta, text-caption dissolved. Sizes '
             + 'derive from --fs-body through --fs-step, so one dial moves the scale (#277). '
             + 'The micro tier at the bottom arrived with the re-skin: the scale used to '
             + 'stop at 12px, so every 9–11px label on the site was a hardcoded text-[10px].',
        specimens: [
            { cls: 'page-title',       as: 'div', label: 'page-title' },
            { cls: 'section-title',    as: 'div', label: 'section-title' },
            { cls: 'subsection-title', as: 'div', label: 'subsection-title' },
            { cls: 'text-body',      as: 'div', label: 'text-body', note: 'The anchor. Every other size derives from it through --fs-step.' },
            { cls: 'text-secondary', as: 'div', label: 'text-secondary', note: 'Body size, quieter. Supporting copy. Absorbed the old text-muted.' },
            { cls: 'text-note',      as: 'div', label: 'text-note',
              note: 'A gloss on the thing beside it — helper text, a status line. Italic because it is commentary, not content. Absorbed text-hint and most of text-caption.' },
            { cls: 'text-meta',      as: 'div', label: 'text-meta',
              note: 'Counts, ids, glyphs, parentheticals. Roman, not italic — never italicise a chevron. Absorbed text-faint, and gained contrast doing it: 2.43:1 to 4.63:1, so it no longer needs the large-text exemption it used to carry.' },
            { cls: 'text-label',     as: 'div', label: 'text-label', note: 'Form and field labels. One step down, heavier.' },
            { cls: 'text-data',      as: 'div', label: 'text-data', note: 'Tabular figures for numbers in tables.' },
            { cls: 'text-micro',     as: 'div', label: 'text-micro',
              note: 'A label naming a region — NARROWED BY, AXES, DISTRIBUTION. Mono, uppercased in CSS so the source string stays readable, and tracked so it reads as apparatus rather than as a very small sentence.' },
            { cls: 'text-nano',      as: 'div', label: 'text-nano',
              note: 'The same one step down: the legend inside a chip, the caption on a swatch. The handoff sets its color at #5a6474, which measures 3.07:1 — below AA at this size, so both micro roles resolve to text-meta instead.' },
        ],
    },
];

/** Every class this catalogue claims to show, flattened. */
export function cataloguedClasses() {
    const out = new Set();
    for (const section of SECTIONS) {
        for (const s of section.specimens) {
            // Only the semantic classes count — a `py-1` in a specimen is
            // demonstrating an override, not claiming to catalogue a utility.
            //
            // The size utilities are listed WHOLE rather than as a prefix with
            // a trailing hyphen: `text-xs` has no hyphen after `xs`, so a
            // pattern ending in `-` never excluded it and it was reported as a
            // class the stylesheet had lost.
            // A composite renders markup this file cannot see — its JSX lives
            // in specimens.jsx, out of reach of `scripts/health.js`, which
            // imports this in plain node. So it DECLARES what it shows. That
            // is a list to keep in step, and deliberately so: the alternative
            // is a composite quietly claiming to catalogue whatever it happens
            // to contain today.
            for (const c of (s.cls ?? (s.covers ?? []).join(' ')).split(/\s+/).filter(Boolean)) {
                const isUtility = /^(p|px|py|m|mx|my|w|h)-[\d.]/.test(c)
                    || /^text-(xs|sm|base|lg|xl)$/.test(c)
                    || c === 'active';
                if (!isUtility) out.add(c);
            }
        }
    }
    return out;
}
