# Typography & text styles

A small, theme-aware set of semantic text classes that covers all site text.
Defined in `src/index.css` under the **TYPOGRAPHY SYSTEM** banner.

## Why

Two problems this solves:

1. **Dark mode.** Hardcoded Tailwind `text-gray-*` (and arbitrary `text-[11px]`)
   look fine in light mode but render muddy/illegible on the dark-navy theme,
   because they don't follow the `--color-text-*` variables. As of writing there
   were **339** such occurrences across 29 files.
2. **Consistency.** Font sizes had drifted into one-off arbitrary values
   (`text-[9px]`, `[10px]`, `[11px]`, `[13px]`) instead of a shared scale.

## The model — two orthogonal axes

Compose **one ROLE class** with **at most one COLOR class**.

### Role (size + weight)
Roles default to `--color-text-primary` (inherited from `<body>`), so a heading
or body line needs *no* color class unless you want it dimmer.

| Class | Element | Use |
|---|---|---|
| `.page-title` | h2 | Page heading (e.g. "Admin Panel") |
| `.section-title` | h3 | Card / section heading |
| `.subsection-title` | h4 | Group heading inside a card |
| `.text-body` | p, span | Default body copy (`text-sm`) |
| `.text-secondary` | p, span | Supporting copy — body size, quieter |
| `.text-note` | p, span | A gloss on the thing beside it — helper text, a status line. *Italic* |
| `.text-meta` | span | Counts, ids, glyphs, parentheticals. Roman |
| `.text-label` | label | Form / field labels |

| `.text-data` | span | Numeric / monospace values (tabular) |

### Color tiers (theme-aware)
Use to dim text below primary. They adapt to light/dark automatically.

| Class | Light | Dark |
|---|---|---|
| `.text-secondary` | gray-600 | slate-300 |



## Examples

```jsx
<h3 className="section-title">Model Constants</h3>
<p className="text-body text-secondary">Tune the EPA math on this browser only.</p>

<label className="text-label">Accessory load</label>
<p className="text-note">Constant parasitic draw assumed in the back-solve.</p>

<span className="text-data">0.88</span>
```

## Migration

Replacing the 339 `text-gray-*` usages happens **incrementally**, file-by-file,
in small reviewable PRs (highest-traffic views first) — not one big sweep.

Rough mapping when migrating a file:

| Old | New |
|---|---|
| `text-gray-900` / `text-gray-800` (heading) | a role class (no color) |
| `text-gray-700` | `.text-secondary` (or role + secondary) |
| `text-gray-600` | `.text-secondary` |
| `text-gray-500` | `.text-secondary` |
| `text-gray-400` | `.text-meta` |
| `text-[10px]` / `[11px]` / `[13px]` | nearest role / `text-xs` |
| `bg-gray-*`, `border-gray-*` | `var(--color-surface-*)`, `var(--color-border)` |

**Exception — leave intentional arbitrary sizes alone.** An arbitrary `text-[..px]`
with a documented rationale (e.g. the test-count badges in `VehiclesView` are
deliberately `text-[13px]`, 1px smaller than the `text-sm` rows for hierarchy) is
*not* drift — keep it. Only migrate sizes that are incidental/inconsistent. The
color migration (gray → semantic) still applies regardless of size.

## Live style knobs (implemented)

Admin → **Interface Settings → Typography** tunes the type system live. Each role
class reads its font-size/weight from a CSS variable (default = the shipped value,
so an unset var is a no-op), and the root font-size carries a global `--ui-scale`
that scales every rem-based size site-wide.

- Defaults + knob metadata + the localStorage store: `src/styles/typographyKnobs.js`
  (separate store key from the EPA constants, so the two panels are independent).
- Overrides apply **live** as CSS custom properties on `:root` (no reload), and are
  re-applied before first paint in `src/main.jsx` via `applyTypographyOverrides()`.
- Panel: `src/components/admin/TypographyKnobs.jsx` (with a live preview).
- Per-browser only — never the DB or other users.

To expose a new tunable: variable-ize the property in the role class here, then add
a knob entry to `TYPO_GROUPS`. Colour tiers are not yet knobs (they're theme-specific
— a future extension).
