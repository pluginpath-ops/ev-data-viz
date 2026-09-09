# Typography

Semantic text classes, defined in `src/index.css` under the **TYPOGRAPHY SYSTEM**
banner. Specimens for all of them are on `?tab=playground`.

## One axis

**A role carries its own size, weight and color. Pick exactly one and you are
done.** There is no color tier to compose with.

It used to be two axes — a size class plus a color class — and the pair
drifted. `.text-caption` alone appeared with three different colors across 55
sites, so "caption" had come to mean nothing except "one step down". A role says
what the text *is*, and the appearance follows from that (#277).

| Role | Element | What it is | Size |
|---|---|---|---|
| `.page-title` | `h2` | Page heading | body × 1.71 |
| `.section-title` | `h3` | Card / section heading | body × 1.29 |
| `.subsection-title` | `h4` | Group heading inside a card | body |
| `.text-body` | `p`, `span` | Default body copy — the anchor | **body** |
| `.text-secondary` | `p`, `span` | Supporting copy. Body's size, quieter | body |
| `.text-note` | `p`, `span` | A gloss on the thing beside it. *Italic* | one step down |
| `.text-meta` | `span` | Counts, ids, glyphs, parentheticals. Roman | one step down |
| `.text-label` | `label` | Form / field labels. Heavier | one step down |
| `.text-control` | — | Control surfaces — a chart sidebar, a run row | one step down |
| `.text-data` | `span` | Numeric / monospace values, tabular | body |
| `.text-caption` | `span` | A quiet mono annotation — a count, an axis end | nano |
| `.text-micro` | `span` | A label naming a region. **MONO, UPPERCASE, tracked** | body × 0.71 |
| `.text-nano` | `span` | The same, one step down — inside a chip or a swatch | body × 0.64 |

The three title roles carry `--font-display` and tighter tracking. **Only titles
do** — the display face is a role, not something a component reaches for, which
is why `--font-display` has no Tailwind utility of its own.

### `.text-note` vs `.text-meta`

Both sit one step below body, and the difference is real. `.text-note` is
*italic*, because that is what italic is for: marking text as commentary rather
than content. `.text-meta` is roman, because a count or a chevron is incidental
detail, not a sentence. **Never italicise a glyph.**

### `.text-micro`/`.text-nano` vs `.text-caption`

Same family and size, different treatment. The first two are **uppercased and
letterspaced** — the label treatment, for text that is scanned. `.text-caption`
is neither, for text that is read.

## Sizes are relative, never typed

Two variables anchor everything:

```css
--fs-body: 0.875rem;   /* 14px — the anchor */
--fs-step: 0.857;      /* one step down = 12px; one step up = 16.3px */
```

Every other size derives from those through `calc()`. Moving body moves the
whole scale coherently, instead of leaving eight independent numbers to drift
apart.

```css
/* the shape every role uses */
font-size: var(--fs-note, calc(var(--fs-body) * var(--fs-step)));
```

The `calc()` sits **inside the fallback**, so an unset `--fs-<role>` derives and
a set one pins. That is what lets the knob panel override one role without
detaching the rest.

**A literal `font-size` in this stylesheet is drift**, because it stops
following `--fs-body` and stops responding to the `--ui-scale` knob — which is
the whole reason the scale is relative. `npm run drift off-scale-font-size`
lists the ones that remain.

Titles are the one deliberate exception to `--fs-step`: they carry their own
multiple of body (1.71, 1.29, 1.00) rather than compounding the step three
times, which would have moved the page title from 24px to 22.2px — a change
nobody asked for, smuggled in by a refactor.

## In JSX

Prefer these over `text-gray-*` or an arbitrary `text-[11px]`. Neither is
theme-aware: they look fine in light mode and illegible on dark navy. The drift
ledger counts both — `npm run drift palette-text`, `npm run drift
arbitrary-text-size`.

```jsx
<h3 className="section-title">Model Constants</h3>
<p className="text-body">Tune the EPA math on this browser only.</p>
<p className="text-note">Constant parasitic draw assumed in the back-solve.</p>

<label className="text-label">Accessory load</label>
<span className="text-data">0.88</span>
<span className="text-micro">Conditions</span>
```

## Live knobs

Admin → **Interface Settings → Typography** tunes the system live, per browser,
never the database.

- Defaults, knob metadata and the store: `src/styles/typographyKnobs.js`
- Applied as custom properties on `:root`, re-applied before first paint in
  `src/main.jsx` via `applyTypographyOverrides()`
- Panel: `src/components/admin/TypographyKnobs.jsx`
- `--ui-scale` on the root font-size scales every rem-based size at once

To expose a new tunable: variable-ise the property in the role, then add a knob
entry to `TYPO_GROUPS`. Color is not a knob — it is theme-specific, and a role
owning its own color is the point of the one-axis model.

## See also

- [`design-tokens.md`](design-tokens.md) — the color and radius tokens
- [`vocabulary.md`](vocabulary.md) — one name per thing
