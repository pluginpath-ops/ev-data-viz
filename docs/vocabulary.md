# Vocabulary

One name per thing, and where that thing lives.

This exists because three words drifted. "Rail" was used for the chart sidebar,
the sub-nav, *and* the colored left edge of a vehicle card. "Chrome" was used
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
| Row 1 — wordmark, section tabs, account | **nav bar** | Bootstrap *navbar* | `.app-nav-bar`, [AppNav.jsx](../src/components/shell/AppNav.jsx) |
| The six section buttons | **tabs** | WAI-ARIA `tablist` | `.btn-tab` |
| Row 2 — Charging / Range & Efficiency / … | **sub-nav** | common web | `.subtab-strip`, [SubTabStrip.jsx](../src/components/shell/SubTabStrip.jsx) |
| Either row of tabs, collapsed below 1000px | **nav menu** | — | `.nav-menu`, [NavMenu.jsx](../src/components/shell/NavMenu.jsx) |
| The one width at which the chrome collapses | **compact** | — | [useIsCompact.js](../src/hooks/useIsCompact.js) — the only breakpoint |
| The circle at the right end, and what it opens | **account menu** | Material *account* | `.account-menu`, [AccountMenu.jsx](../src/components/shell/AccountMenu.jsx) |
| A button stating its value, opening a panel | **menu button** | WAI-ARIA *menu button* | `.menu-button`, [MenuButton.jsx](../src/components/shell/MenuButton.jsx) |
| Anything that floats above the page | **popover** | common web | `.popover` + one `.popover--<placement>` |
| Where it opens relative to its anchor | **placement** | Floating UI *placement* | `--above`, `--below`, `--center`, `--right`, `--end`, `--stretch` |
| A row of them above a table or chart | **controls strip** | — | `.controls-strip` — one class, shared |
| One choice, always visible, of two or three | **segmented control** | Apple HIG *segmented control* | `.stats-segmented`, `.account-segmented` |
| Row 3 — the removable selected-vehicle pills | **chips** | Material *input chips* | `.selected-strip`, `.selected-vehicle-chip` |
| The capped box the chips scroll inside | **chip scroller** | — | `.selected-chip-scroll` — two rows, then it scrolls |
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
| Canvas colors read from the tokens | **chart theme** | — | [chartTheme.js](../src/utils/chartTheme.js) `chartTheme()` |
| The color one plotted series is drawn in | **series color** | — | [colorUtils.js](../src/utils/colorUtils.js) `resolveChartColors()` |
| The small square REPORTING that color | **series swatch** | common web | `.series-swatch` — 10px, read-only |
| The bigger one that CHANGES it | **series color picker** | — | [SeriesColorPicker.jsx](../src/components/SeriesColorPicker.jsx), `.series-swatch--button` |
| The color a pick becomes slot 1 of | **the base** | — | the rest of the set is re-derived from it |
| Re-ordering a palette to lead with the base | **rotation** | — | `rotatePaletteFrom()` — different hues, for unrelated tests |
| One hue in lightness steps from the base | **the ramp**, or light→dark | — | `rampFrom()` — one vehicle's runs, handoff 3c |
| How much of the plot a pick recolors | **scope** | — | this test · this vehicle · all tests |

A series color has two values that routinely differ and must not be called the
same thing: the **stored** color is the durable preference — `vehicles.color`
since #308, `runs.color` before it — and the **drawn** color is what is actually
on the chart. The picker says both out loud; before it, nothing did.

The rule that matters here is that the **swatch always reports the drawn color**.
It exists because the two came apart once: the chip beside a vehicle showed one
color while the chart drew another, and there was no way to tell which was
lying. Anything that can change what is drawn has to change the swatch with it.

A parked hand-set color is the one thing a swatch says besides the drawn color,
and it does not break that rule: the FACE stays the drawn color and the parked
one peeks out behind it as a chip, so the swatch reads "this is what is on the
chart, and there is another color under here". Never the other way round.

What has the last say depends on the mode, and the two are named:

| The base every un-picked series is drawn from | **the palette** | the `Colors:` field — a palette, or Vehicle color |
| A color a person set on one series this session | **a hand-set color**, or **a pick** | session-only; never reaches the database |
| Hand-set colors applied over the palette | **hand-set mode** | `Colors: Hand-set (3)` |
| Hand-set colors kept but not drawn | **parked** | choosing a palette parks them; selecting Hand-set brings them back |

In hand-set mode a pick has the last say, which is the older rule and still
true. Choosing a palette turns the mode off, so the palette draws everything and
the picks are parked — kept, invisible, and absent from the swatches too, because
the swatch reports what is drawn. Parking is not discarding: only **Back to
auto**, at whichever scope, removes a pick.

Say **all tests**, never "all vehicles" — the widest scope reseeds every run
currently ticked in the run picker, which is a set of tests and may be several
per vehicle. Nothing at any scope writes to the database: the charting page has
no durable color path, whatever role you hold. The durable preference is edited
in Tests & Data, which is the screen that owns it.

**Careful with "rail."** Material Design 3 has a *navigation rail* — a slim
vertical strip of navigation icons. We do not have one. Our `.chart-rail` is a
control **sidebar**, so prose should say sidebar even while the class still says
rail.

## Cards and rows

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| The colored left edge encoding state | **accent border** | CSS `border-left`; common in design systems | `.vehicle-card`, `.vehicle-row`, `.vehicle-run-group`, `.routing-row` |
| The ✓ on a selected card | **selected indicator** | ARIA `aria-selected` | `.vehicle-card.is-selected::before` |
| The photo band with the title over a scrim | **media band** | Material *media* | [VehicleMedia.jsx](../src/components/vehicles/VehicleMedia.jsx), `.vehicle-media` |
| A full-width labelled divider inside the sidebar | **section band** | — | `.run-selector-header`, `.subgroup-header` |
| Small mono state labels inside a bar or row | **badges** | Material *badge* | `.badge-micro`, `.badge-default`, `.badge-status` |

Accent-border colors carry meaning and are not decorative: orange = selected or
overridden, red = queued for deletion, per-run color = series identity.

## Type and color

| Thing | Call it | Lives in |
|---|---|---|
| The one type axis every size derives from | **the scale** — `--fs-body` × `--fs-step` | [index.css](../src/index.css) TYPOGRAPHY SYSTEM |
| Named size + weight + color, picked as a set | **a role** — `.text-body`, `.text-micro`, `.text-nano`, `.text-caption` | same |
| The global size multiplier | **the UI scale** — `--ui-scale` | [typographyKnobs.js](../src/styles/typographyKnobs.js) |
| Named color values | **tokens** — `--color-*` | [index.css](../src/index.css) Color Tokens |
| Un-tokenised appearance, counted | **drift** | [driftProbes.js](../scripts/driftProbes.js), `npm run drift` |
| A count asserted with `toBe` so a fall fails too | **a ratchet** | drift ledger, `KNOWN_OFFENDERS`, the dark-override cap |

Color vocabulary, from the design handoff: **blue** leads the chrome, **orange**
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

## Statistics and uncertainty

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| A validity bound a derived EPA figure must fall inside | **a validity band** | this repo | [epa.js](../src/constants/epa.js) — `ETA_BAND`, `CHARGER_EFF_BAND`, `PACK_KWH_BAND`, `SS_SPEED_BAND` |
| Falling outside one | **out of band** | same | flag strings `eta-out-of-band`, `charger-out-of-band`, `implied-ss-speed-out-of-band` |
| The observed spread printed beside one, to inform the knob | **band evidence** | — | [epaBandEvidence.js](../src/utils/epaBandEvidence.js), Admin → Model Constants |
| How far a repeat of a measurement would likely land | **a confidence band** (line) / **error bar** (bar) | standard statistics | [#314](https://github.com/pluginpath-ops/ev-data-viz/issues/314) — not yet built |

**Never write a bare "band."** The word already means a validity bound, and that
meaning is live in four places: `epaDerivations` raises the flags,
`epaIntegrity` turns them into record issues, `EpaVehicleSection` and
`EpaPdfImportModal` surface them to the curator, and `DerivedValues` draws the
⚠. A confidence band is a completely different object — a validity band says
*this figure is implausible*, a confidence band says *this measurement is
uncertain* — and one of them is a data-integrity check while the other is a
finding. Qualify both, every time.

`HIGHWAY_BAND_MPH` is a third sense again — a speed range drawn on the EPA
curve as a reference. It is not a validity check and nothing is flagged against
it; read it as a *reference band* where it appears.

## Tables

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| A row kept at the top of one table, affecting only that table | **pinned** | common web | [GuideTable.jsx](../src/components/epa/guide/GuideTable.jsx), `.guide-pinned-head` |
| The band those rows sit in | **the pinned band** | — | `.guide-pinned-head`, `.guide-pinned-spacer` |
| A vehicle chosen for the whole app, driving every chart | **selected** | ARIA `aria-selected` | `selectedVehicles` in [App.jsx](../src/App.jsx), `toggleVehicleSelection`, the chips |
| A proportional fill behind a value, scaled per column | **a bar cell** | — | `computeBarMaxima()` in [feGuideBrowse.js](../src/utils/feGuideBrowse.js) |
| Choosing which columns show, and in what order | **the column picker** | — | [GuideColumnPicker.jsx](../src/components/epa/guide/GuideColumnPicker.jsx) |

**Pin is local, select is global**, and the difference is what a second click
costs. Unpinning an FE Guide row rearranges one table. Deselecting a vehicle
removes it from the chips and from every chart on the site.

So a table whose rows are vehicles says **select**, never pin — even though it
borrows the pinned band to show the selection at the top. The mechanism is
shared; the word is not. In the specs table of
[#315](https://github.com/pluginpath-ops/ev-data-viz/issues/315) the click reads
*add to selection*, the band above reads as the vehicles you already have, and
"pin" appears nowhere.

Not a **sparkline**. A sparkline is a series drawn small; a bar cell encodes one
number against the column's maximum. No spec field or guide column carries a
series, so nothing here is a sparkline and the word should not appear.

---

## Retired

| Do not write | Write | Why |
|---|---|---|
| "the rail" for a card's left edge | accent border | collided with the chart sidebar |
| "the rail" for the sub-nav | sub-nav | the class is `.subtab-strip` |
| "chrome" for the header specifically | header | keep chrome as the category |
| "selection strip" | chips | collided with "selection bar" |
| "Runs" in UI text | Tests / Tests & Data | pre-existing rule, see CLAUDE.md |
| "pinning" for choosing vehicles in the specs table | selecting | pin is view-scoped; that click drives every chart |
| "sparkline" for an in-cell magnitude bar | bar cell | nothing here is a series |
| a bare "band" | validity band / confidence band | two live meanings, opposite jobs |

## Open names

Names the issues in flight need and this file cannot yet supply. Recorded rather
than guessed at — a class name is the whole value of extracting one, and CLAUDE.md
says to stop and ask when the right name is not obvious.

| The thing | Where it lands | Candidates | Leaning |
|---|---|---|---|
| The aggregate curve standing for a vehicle's charging behaviour | [#313](https://github.com/pluginpath-ops/ev-data-viz/issues/313) | typical curve · representative curve · composite curve · nominal curve | **typical curve** |
| Compare Specs once it is a fleet-wide browse-and-select table | [#315](https://github.com/pluginpath-ops/ev-data-viz/issues/315) | the specs table · the vehicle table · keep "Compare Specs" | undecided |
| The shrinkage weight that trades a vehicle's own spread against the fleet's | [#314](https://github.com/pluginpath-ops/ev-data-viz/issues/314) | — | undecided |

**Why not "nominal curve."** In this codebase *nominal* already means **rated**,
as filed — `nominal_pack_kwh`, `battery_nominal_voltage_v`, `epa_fe_guide.total_voltage_v`.
The charging curve in #313 is the opposite kind of thing: measured, aggregated,
and typical rather than specified. Reusing the word would make "nominal" mean
both *what the manufacturer claims* and *what we observed on average*, which is
the exact failure this document was written about.

**"Compare Specs" may stop being true.** The tab compares what you already
selected. Once the table lists the whole fleet and selecting happens *in it*,
comparing is one of the things it does rather than the thing it is. Whether the
tab keeps the name is a UI-text decision, not a class-name one — but the two
should be settled together.

## Deferred renames

`.chart-rail` → `.chart-sidebar` and `.app-nav` → `.app-header` are correct but
touch ~40 CSS references plus JSX across five views. Worth doing on its own
branch, not folded into unrelated work. Until then the classes keep the old
names and the prose uses the new ones — a gap this file exists to record rather
than hide.
