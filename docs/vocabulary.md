# Vocabulary

One name per thing, and where that thing lives.

This exists because three words drifted. "Rail" was used for the chart sidebar,
the sub-nav, *and* the coloured left edge of a vehicle card. "Chrome" was used
both as a category ("blue leads the chrome") and as the name of one specific
region. A word with no fixed referent attracts whatever needs naming next, and
by the time you notice, two people are describing different objects with the
same sentence.

Prefer the **standard** column. Where a term is established outside this repo,
the source is named — the point is to use the industry word rather than invent
a house one, so that a new reader already knows it.

---

## The shell

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| Everything that is UI furniture rather than data | **chrome** | "browser chrome", Mozilla | a category, not a component |
| The pinned block at the top of every page | **header** | HTML `<header>`; Material *top app bar* | `.app-nav`, [App.jsx](../src/App.jsx) |
| Its measured height, published for CSS | **`--app-header-h`** | — | [useHeaderHeight.js](../src/hooks/useHeaderHeight.js) |
| Row 1 — wordmark, section tabs, Sign In | **nav bar** | Bootstrap *navbar* | `.app-nav-bar`, [AppNav.jsx](../src/components/shell/AppNav.jsx) |
| The six section buttons | **tabs** | WAI-ARIA `tablist` | `.btn-tab` |
| Row 2 — Charging / Range & Efficiency / … | **sub-nav** | common web | `.subtab-strip`, [SubTabStrip.jsx](../src/components/shell/SubTabStrip.jsx) |
| Row 3 — the removable selected-vehicle pills | **chips** | Material *input chips* | `.selected-strip`, `.selected-vehicle-chip` |
| The centred max-width content column | **page container** | — | `.page-container` |

`.app-nav` is the header **and** its rows; the class predates this document.
Renaming it is [tracked separately](#deferred-renames).

## Charts

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| The 320px control column beside a plot | **sidebar** | HTML `<aside>` | `.chart-rail`, `.chart-main` |
| The bordered box that a PNG export captures | **figure** | HTML `<figure>` / `<figcaption>` | [PlotFrame.jsx](../src/components/charts/PlotFrame.jsx), `.plot-frame` |
| The strip of PNG / URL / Reset-zoom buttons | **toolbar** | WAI-ARIA `toolbar` | `.chart-export-strip` |
| The thumbnail of what PNG just copied | **export preview** | — | [useChartPng.js](../src/hooks/useChartPng.js), `.chart-png-preview` |
| Canvas type sizes derived from `--fs-body` | **chart fonts** | — | [chartTheme.js](../src/utils/chartTheme.js) `chartFonts()` |
| Canvas colours read from the tokens | **chart theme** | — | [chartTheme.js](../src/utils/chartTheme.js) `chartTheme()` |

**Careful with "rail."** Material Design 3 has a *navigation rail* — a slim
vertical strip of navigation icons. We do not have one. Our `.chart-rail` is a
control **sidebar**, so prose should say sidebar even while the class still says
rail.

## Cards and rows

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| The coloured left edge encoding state | **accent border** | CSS `border-left`; common in design systems | `.vehicle-card`, `.vehicle-row`, `.vehicle-run-group`, `.routing-row` |
| The ✓ on a selected card | **selected indicator** | ARIA `aria-selected` | `.vehicle-card.is-selected::before` |
| The photo band with the title over a scrim | **media band** | Material *media* | [VehicleMedia.jsx](../src/components/vehicles/VehicleMedia.jsx), `.vehicle-media` |
| A full-width labelled divider inside the sidebar | **section band** | — | `.run-selector-header`, `.subgroup-header` |
| Small mono state labels inside a bar or row | **badges** | Material *badge* | `.badge-micro`, `.badge-default`, `.badge-status` |

Accent-border colours carry meaning and are not decorative: orange = selected or
overridden, red = queued for deletion, per-run colour = series identity.

## Type and colour

| Thing | Call it | Lives in |
|---|---|---|
| The one type axis every size derives from | **the scale** — `--fs-body` × `--fs-step` | [index.css](../src/index.css) TYPOGRAPHY SYSTEM |
| Named size + weight + colour, picked as a set | **a role** — `.text-body`, `.text-micro`, `.text-nano` | same |
| The global size multiplier | **the UI scale** — `--ui-scale` | [typographyKnobs.js](../src/styles/typographyKnobs.js) |
| Named colour values | **tokens** — `--color-*` | [index.css](../src/index.css) Color Tokens |
| Un-tokenised appearance, counted | **drift** | [driftProbes.js](../scripts/driftProbes.js), `npm run drift` |
| A count asserted with `toBe` so a fall fails too | **a ratchet** | drift ledger, `KNOWN_OFFENDERS`, the dark-override cap |

Colour vocabulary, from the design handoff: **blue** leads the chrome, **orange**
is the single active/now signal and means nothing else, **green** is data and
status and is never chrome.

## Data

| Thing | Call it | Lives in |
|---|---|---|
| One recorded test with its data points | **a run** | `runs`, `run_data_points` |
| A range run tied to a charging run | **a pairing** | [pairings.js](../src/utils/pairings.js) |
| Several runs from one outing | **a session** | [testSessions.js](../src/utils/testSessions.js) |
| An EPA config with its coefficients and tests | **a test group** | `epa_test_groups` |
| The person maintaining EPA records | **the curator** | admin + contributor |

---

## Retired

| Do not write | Write | Why |
|---|---|---|
| "the rail" for a card's left edge | accent border | collided with the chart sidebar |
| "the rail" for the sub-nav | sub-nav | the class is `.subtab-strip` |
| "chrome" for the header specifically | header | keep chrome as the category |
| "selection strip" | chips | collided with "selection bar" |
| "Runs" in UI text | Tests / Tests & Data | pre-existing rule, see CLAUDE.md |

## Deferred renames

`.chart-rail` → `.chart-sidebar` and `.app-nav` → `.app-header` are correct but
touch ~40 CSS references plus JSX across five views. Worth doing on its own
branch, not folded into unrelated work. Until then the classes keep the old
names and the prose uses the new ones — a gap this file exists to record rather
than hide.
