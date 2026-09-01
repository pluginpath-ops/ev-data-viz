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
      match: (n) => /^(text-(body|caption|data|faint|hint|label|muted|secondary)|page-title|section-title|subsection-title)$/.test(n) },
];

/**
 * In an owned family, but deliberately not rendered as a specimen.
 *
 * A reason is required. These are containers and layout wrappers that carry no
 * appearance of their own — a specimen of them would be an empty box that
 * teaches nothing — or variants whose parent is already shown.
 */
export const NOT_CATALOGUED = {
    'cert-chips':        'Layout wrapper — a flex row that holds chips. The chips are catalogued.',
    'tag-filter-bar':    'Layout wrapper for the filter row.',
    'tag-filter-legend': 'The "AND / OR / NOT" key beside the bar, not a control.',
    'run-stat-badges':   'Layout wrapper — a flex row of badges.',
    'guide-chip-count':  'The count suffix inside .guide-chip; shown as part of that specimen.',
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
    'app-header-compact', 'badge-default', 'badge-hidden', 'brand-alias-chip',
    'btn-chart-mode', 'btn-tab', 'chart-copy-btn-active', 'curve-picker-row',
    'curve-tier-badge', 'guide-chip', 'guide-row', 'guide-tested-note',
    'merge-target-banner', 'specs-table-container', 'stats-suppressed-flag',
    'sweep-batch', 'vote-btn-vouch',
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
            { cls: 'btn-tab',        as: 'button', label: 'Nav tab',   note: 'Top-level navigation. Add `.active` for the current one.' },
            { cls: 'btn-tab active', as: 'button', label: 'Nav tab · active' },
            { cls: 'btn-chart-mode',        as: 'button', label: 'Chart mode',   note: 'Chart sub-tab selector.' },
            { cls: 'btn-chart-mode active', as: 'button', label: 'Chart mode · active' },
        ],
    },
    {
        id: 'pills',
        title: 'Pills, chips & badges',
        blurb: 'Rounded-full, and now ONE size: guide-chip, tag-filter-btn, path-chip, '
             + 'brand-alias-chip and fe-picker-badge share their metrics and differ only in '
             + 'colour. Badges keep their own shape — a label you read is not a control you '
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
            { cls: 'badge-default',   as: 'span', label: 'Default' },
            { cls: 'badge-hidden',    as: 'span', label: 'Hidden' },
            { cls: 'badge-status',    as: 'span', label: 'Status' },
            { cls: 'owner-badge',     as: 'span', label: 'Owner' },
            { cls: 'curve-tier-badge', as: 'span', label: 'Curve tier' },
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
        blurb: 'One base class, and no size modifier — which is why call sites re-specify '
             + 'padding and text size ~100 times. The sizes below are what they write, '
             + 'not what the class provides.',
        specimens: [
            { cls: 'form-input',                as: 'input', label: 'form-input',            note: 'The base. p-2.' },
            { cls: 'form-input py-1',           as: 'input', label: '+ py-1',                note: '34 call sites.' },
            { cls: 'form-input py-0.5 text-xs', as: 'input', label: '+ py-0.5 text-xs',      note: '21 call sites.' },
            { cls: 'form-input text-sm py-1',   as: 'input', label: '+ text-sm py-1',        note: 'The tidy one — the size to standardise on.' },
            { cls: 'form-input',  as: 'select', label: 'select' },
            { cls: 'form-input',  as: 'textarea', label: 'textarea' },
            { cls: 'data-cell-input', as: 'input', label: 'Data cell', note: 'Transparent until hover/focus. Hover it.' },
            { cls: 'reorder-position-input', as: 'input', label: 'Reorder position' },
        ],
    },
    {
        id: 'type',
        title: 'Typography',
        blurb: 'The semantic text scale. Never reach for text-gray-* — these carry the '
             + 'dark theme with them.',
        specimens: [
            { cls: 'page-title',       as: 'div', label: 'page-title' },
            { cls: 'section-title',    as: 'div', label: 'section-title' },
            { cls: 'subsection-title', as: 'div', label: 'subsection-title' },
            { cls: 'text-body',      as: 'div', label: 'text-body' },
            { cls: 'text-secondary', as: 'div', label: 'text-secondary' },
            { cls: 'text-muted',     as: 'div', label: 'text-muted' },
            { cls: 'text-faint', as: 'div', label: 'text-faint', minRatio: 3,
              note: 'Deliberately quiet — a row number, a placeholder. Held to 3:1, not 4.5:1, and dense tables become noise if it is raised.' },
            { cls: 'text-label',   as: 'div', label: 'text-label' },
            { cls: 'text-caption', as: 'div', label: 'text-caption' },
            { cls: 'text-hint', as: 'div', label: 'text-hint', minRatio: 3,
              note: 'Also on --color-text-faint, so the same allowance applies.' },
            { cls: 'text-data',    as: 'div', label: 'text-data', note: 'Tabular figures for numbers in tables.' },
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
            for (const c of s.cls.split(/\s+/)) {
                const isUtility = /^(p|px|py|m|mx|my|w|h)-[\d.]/.test(c)
                    || /^text-(xs|sm|base|lg|xl)$/.test(c)
                    || c === 'active';
                if (!isUtility) out.add(c);
            }
        }
    }
    return out;
}
