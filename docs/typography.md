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
| `.text-caption` | p, span | Small secondary copy (`text-xs`) |
| `.text-label` | label | Form / field labels |
| `.text-hint` | p, span | Helper text under a control (faint) |
| `.text-data` | span | Numeric / monospace values (tabular) |

### Color tiers (theme-aware)
Use to dim text below primary. They adapt to light/dark automatically.

| Class | Light | Dark |
|---|---|---|
| `.text-secondary` | gray-600 | slate-300 |
| `.text-muted` | gray-500 | slate-400 |
| `.text-faint` | gray-400 | slate-500 |

## Examples

```jsx
<h3 className="section-title">Model Constants</h3>
<p className="text-body text-secondary">Tune the EPA math on this browser only.</p>

<label className="text-label">Accessory load</label>
<p className="text-hint">Constant parasitic draw assumed in the back-solve.</p>

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
| `text-gray-500` | `.text-muted` |
| `text-gray-400` | `.text-faint` |
| `text-[10px]` / `[11px]` / `[13px]` | nearest role / `text-xs` |
| `bg-gray-*`, `border-gray-*` | `var(--color-surface-*)`, `var(--color-border)` |

## Future: live style knobs

Once text styling flows through these classes/variables, exposing them as
live-tunable knobs (a "Typography" group in Admin → Interface Settings) reuses
the same machinery as the EPA Model Constants panel
(`src/constants/overrides.js`, `knobs.js`, `components/admin/ConstantsKnobs.jsx`).
Deferred until after the migration.
