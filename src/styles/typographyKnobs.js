/**
 * Live typography knobs — a per-browser sandbox for tuning the semantic type
 * system (src/index.css TYPOGRAPHY SYSTEM banner).
 *
 * Each knob maps to a CSS custom property on :root. Overrides are stored in
 * localStorage (a SEPARATE key from the EPA constants store so the two panels'
 * "Reset all" don't clobber each other) and applied LIVE — setting a CSS var on
 * document.documentElement cascades instantly, no reload needed. Defaults live
 * here (single source of truth) and match the unmodified values in index.css, so
 * an unset knob == the shipped design.
 *
 * Leaf module: depends only on localStorage + the DOM. Apply once at startup
 * (main.jsx) so vars are set before first paint.
 */
const KEY = 'evbench.typography.overrides';

// kind: 'scale' → unitless multiplier; 'size' → px in UI, stored as rem var;
//       'weight' → CSS font-weight (100–900).
export const TYPO_GROUPS = [
    {
        title: 'Global',
        blurb: 'Scales every rem-based size on the site at once (text, spacing, controls) — like a UI zoom.',
        knobs: [
            { var: '--ui-scale', label: 'UI scale', kind: 'scale', min: 0.8, max: 1.4, step: 0.05, default: 1 },
        ],
    },
    {
        title: 'Role sizes',
        blurb: 'Body is the anchor; every other role derives from it through the step ratio. The per-role dials below pin one role and stop it deriving.',
        knobs: [
            // Body is the anchor and every other role derives from it — moving
            // this one moves the whole scale, which is the point of making the
            // sizes relative (#277).
            { var: '--fs-body',             label: 'Body (anchor)',    kind: 'size', min: 11, max: 22, step: 1, default: 14 },
            // The interval between steps. Below 1; smaller = more contrast
            // between a heading and its body.
            { var: '--fs-step',             label: 'Step ratio',       kind: 'scale', min: 0.7, max: 0.95, step: 0.007, default: 0.857 },

            // Per-role pins. Each is UNSET by default, so the role derives; set
            // one and it overrides the derivation for that role alone.
            { var: '--fs-page-title',       label: 'Page title',       kind: 'size', min: 14, max: 48, step: 1, default: 24 },
            { var: '--fs-section-title',    label: 'Section title',    kind: 'size', min: 12, max: 36, step: 1, default: 18 },
            { var: '--fs-subsection-title', label: 'Subsection title', kind: 'size', min: 10, max: 28, step: 1, default: 14 },
            { var: '--fs-note',             label: 'Note',             kind: 'size', min: 9,  max: 18, step: 1, default: 12 },
            { var: '--fs-meta',             label: 'Meta',             kind: 'size', min: 9,  max: 18, step: 1, default: 12 },
            { var: '--fs-label',            label: 'Label',            kind: 'size', min: 9,  max: 18, step: 1, default: 12 },
            { var: '--fs-data',             label: 'Data (mono)',      kind: 'size', min: 11, max: 22, step: 1, default: 14 },
        ],
    },
    {
        title: 'Role weights',
        blurb: 'Font weight of the heading and label roles.',
        knobs: [
            { var: '--fw-page-title',       label: 'Page title',       kind: 'weight', default: 700 },
            { var: '--fw-section-title',    label: 'Section title',    kind: 'weight', default: 700 },
            { var: '--fw-subsection-title', label: 'Subsection title', kind: 'weight', default: 600 },
            { var: '--fw-label',            label: 'Label',            kind: 'weight', default: 500 },
        ],
    },
];

export const WEIGHT_OPTIONS = [400, 500, 600, 700, 800];

/** Flat list of all knobs. */
export const TYPO_KNOBS = TYPO_GROUPS.flatMap(g => g.knobs);

/** The CSS value to write for a knob's numeric value (px→rem for sizes). */
export function cssValueFor(knob, value) {
    if (knob.kind === 'size') return `${value / 16}rem`;
    return String(value); // scale (unitless) + weight
}

// ── Override store (localStorage) ───────────────────────────────────────────
let cache = null;
function load() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { cache = {}; }
    return cache;
}

/** Current overrides keyed by CSS var name (copy). */
export function getTypographyOverrides() {
    return { ...load() };
}

/** Set (value==null clears) one override, persist, and apply it live. */
export function setTypographyOverride(cssVar, value) {
    const ov = load();
    if (value == null) delete ov[cssVar];
    else ov[cssVar] = value;
    cache = ov;
    try { localStorage.setItem(KEY, JSON.stringify(ov)); } catch { /* ignore */ }
    applyOne(cssVar, value);
}

/** Drop all overrides, persist, and revert every var live. */
export function clearTypographyOverrides() {
    const prev = Object.keys(load());
    cache = {};
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    prev.forEach(v => document.documentElement.style.removeProperty(v));
}

function applyOne(cssVar, value) {
    const root = document.documentElement;
    if (value == null) { root.style.removeProperty(cssVar); return; }
    const knob = TYPO_KNOBS.find(k => k.var === cssVar);
    if (knob) root.style.setProperty(cssVar, cssValueFor(knob, value));
}

/** Apply all stored overrides to :root. Call once at startup. */
export function applyTypographyOverrides() {
    const ov = load();
    for (const [cssVar, value] of Object.entries(ov)) applyOne(cssVar, value);
}
