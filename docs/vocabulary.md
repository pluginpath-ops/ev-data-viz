# Vocabulary

One name per thing, and where that thing lives.

A word with no fixed meaning soaks up whatever needs naming next, until two
people describe different things with the same sentence. Use the industry word
where one exists (the **Established by** column) so a new reader already knows
it.

---

## The shell

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| Everything that is UI furniture rather than data | **chrome** | "browser chrome", Mozilla | a category, not a component |
| The pinned block at the top of every page | **header** | HTML `<header>`; Material *top app bar* | `.app-nav`, [App.jsx](../src/App.jsx) |
| Its measured height, published for CSS | **`--app-header-h`** | — | [useHeaderHeight.js](../src/hooks/useHeaderHeight.js) |
| Row 1 — wordmark, tabs, account | **nav bar** | Bootstrap *navbar* | `.app-nav-bar`, [AppNav.jsx](../src/components/shell/AppNav.jsx) |
| The section buttons in the nav bar | **tabs** | WAI-ARIA `tablist` | `.btn-tab` |
| Row 2 — a tab's own sub-tabs | **sub-nav** | common web | `.subtab-strip`, [SubTabStrip.jsx](../src/components/shell/SubTabStrip.jsx) |
| Either row, collapsed below 1000px | **nav menu** | — | `.nav-menu`, [NavMenu.jsx](../src/components/shell/NavMenu.jsx) |
| The mark before a collapsed row's current name | **the menu icon** — three bars on the nav bar, a bulleted list on the sub-nav | common web ("hamburger", "list") | `.nav-menu-icon` |
| A labeled group of items in a sub-nav | **a section** — its label, its items, a rule between sections | — | `group` on an item; `.subtab-section-label`, `.subtab-section-rule`, `.nav-menu-section` |
| The one width at which the chrome collapses | **compact** — the only breakpoint | — | [useIsCompact.js](../src/hooks/useIsCompact.js) |
| The circle at the right end, and what it opens | **account menu** | Material *account* | `.account-menu`, [AccountMenu.jsx](../src/components/shell/AccountMenu.jsx) |
| A signed-in user's yes to rare emails about major changes | **email opt-in** — off until they tick it; in the account menu. Not "newsletter", "subscribe" or "marketing" | — | `profiles.email_opt_in`, `.account-opt-in` |
| What sign-in keeps and promises, under the sign-in buttons | **privacy note** | — | `.auth-privacy`, [AuthModal.jsx](../src/components/AuthModal.jsx) |
| A button stating its value, opening a panel | **menu button** | WAI-ARIA *menu button* | `.menu-button`, [MenuButton.jsx](../src/components/shell/MenuButton.jsx) |
| Anything that floats above the page | **popover** | common web | `.popover` + one `.popover--<placement>` |
| Where it opens relative to its anchor | **placement** | Floating UI | `--above`, `--below`, `--center`, `--right`, `--end`, `--stretch` |
| A row of controls above a table or chart | **controls strip** | — | `.controls-strip` |
| One always-visible choice of two or three — more if every option is a short word and the row may scroll | **segmented control** | Apple HIG | `.stats-segmented`, `.account-segmented`; `.preset-picker` wraps one |
| Row 3 — the removable selected-vehicle pills; also a vehicle picker's chosen vehicle, closed | **chips** | Material *input chips* | `.selected-strip`, `.selected-vehicle-chip`; `.combobox-chip` in [VehicleCombobox.jsx](../src/components/VehicleCombobox.jsx) — name reopens search, × clears, `.combobox-detail` beside it tells lookalikes apart |
| The capped box the chips scroll inside | **chip scroller** — two rows, then scrolls | — | `.selected-chip-scroll` |
| "＋ Add" at the end of the chips row, and its search-and-tick list | **the vehicle quick-add** — a click toggles a vehicle at once; the panel stays open. Not "picker" alone, which is the run picker | — | [VehicleQuickAdd.jsx](../src/components/VehicleQuickAdd.jsx), `.vehicle-quick-add` |
| The centered max-width content column | **page container** | — | `.page-container` |
| A breadcrumb above a page's title | **the breadcrumb** | WAI-ARIA | `.page-crumb` |

`.app-nav` is the header **and** its rows; see [Deferred renames](#deferred-renames).

### Tabs and pages

| Thing | Call it | Lives in |
|---|---|---|
| The first tab and the landing: a featured comparison, every chart drawn at once | **Home** (`?tab=home`). Draws no chips. A bare or unknown address lands here. Say Home, not "landing page" | [HomeView.jsx](../src/components/home/HomeView.jsx) |
| What EVBench is, above the featured comparison — alone when nothing is featured | **the intro**. Not "hero" (no photo) or "banner". The owner writes it | [HomeIntro.jsx](../src/components/home/HomeIntro.jsx), `.home-intro` |
| Seeing and selecting vehicles, and comparing what they are | **Vehicles & Specs** (key `vehicles`). Sub-nav sections: **Summary** (Cards · List · Lineage) and **Specifications & Data** (Table · Chart) | [AppNav.jsx](../src/components/shell/AppNav.jsx), `VEHICLES_STRIP_ITEMS` |
| One vehicle's tests, EPA configurations and performance | **the vehicle's page** (`?tab=runs&vid=…`). What it shows is **Tests & Data** ("View Tests & Data"). Not a tab | [RunsView.jsx](../src/components/RunsView.jsx) |
| The vehicle whose page was last opened, kept in the header | **the opened vehicle** — "↳ name ×" under Vehicles & Specs. Never a chip: it isn't the selection | `.opened-vehicle`; `activeVehicle` in App.jsx |
| Taking it out of the header | **Close vehicle** — the button on the page, or × in the header. The breadcrumb only goes back | `.vehicle-page-close`, `closeVehicle` |
| Vehicles & Specs' one-line-per-vehicle view | **List** — fixed columns under a **header row** that sorts on click. Table is for comparing any columns | `.vehicle-list`, [VehicleListHeader.jsx](../src/components/vehicles/VehicleListHeader.jsx) |
| The ⋯ at the end of a List row | **the row menu** | [VehicleRowMenu.jsx](../src/components/vehicles/VehicleRowMenu.jsx) |
| Search and dropdowns above Cards, List and Table, and the chips under it | **the filter bar**; dropdowns are **facets** (Make, Model, Year, Drive, Tags, Test data); the chip line is **Narrowed by**. One filter set for all three views | [VehicleFilterBar.jsx](../src/components/vehicles/VehicleFilterBar.jsx), [vehicleFilters.js](../src/utils/vehicleFilters.js) |
| Leaving out every row with a value | **exclude** — the value's **not** button; chip reads "not Truck" | `GuideFacetMenu` `onExclude`; `tg=-Truck` in the URL |
| Whether a multi-value facet needs any or every chosen value | **match any / all** — Tags default any, Test data all | `onAllChange`, `<param>_all=1` |
| Analysis of EVBench's tested charging and range | **Charging & Range** (key stays `efficiency`). Not "Charging & Efficiency" — efficiency is also EPA's subject | [chartNav.js](../src/constants/chartNav.js) |
| Its sub-tabs | **Charging Curves** (`charging`) · **Range & Efficiency** · **Charge Stop** (`compare`: range added in X minutes, time to add M miles) · **Road Trip** · **Trip Optimizer** (`optimizer`: best speed and charge per stop, searched together). Not "Charging", "Charge Compare" or "sweeps" | chartNav.js |
| On Trip Optimizer | **Fastest legal** — quickest plan within the reader's **legal range** (speeds under Your plan); **Fastest** — quickest at any speed. Not "best plan" in UI text (`BestPlanTable` keeps it internally) | |
| EPA's efficiency against speed, modeled | **Modeled Efficiency**, in two EPA sub-nav sections: **All EVs** (`?sub=curves`) and **Selected vehicles** (with EVBench's range tests over it; mode `epacurves`, category `epatested`). Never "curves" in UI text | [EpaCurveExplorer.jsx](../src/components/epa/curves/EpaCurveExplorer.jsx) |
| What is true of every EV, selected or not | **Reference** — **Explainers** then **Platforms**. Bare `?tab=reference` opens Explainers; `sub=platforms` the list, `pid=` one platform | [ReferenceSection.jsx](../src/components/reference/ReferenceSection.jsx) |
| Every platform, what it provides, how many vehicles | **the platform list** | [PlatformList.jsx](../src/components/reference/PlatformList.jsx) |
| One platform's page | **the platform page** — where "from <platform>" leads | [PlatformPage.jsx](../src/components/reference/PlatformPage.jsx), `PlatformLink`, `openPlatform` |
| An article on how something works, with diagrams | **an explainer**. Not "guide" (the Fuel Economy Guide) or "glossary" | `src/explainers/` |

### Home and featured comparisons

| Thing | Call it | Lives in |
|---|---|---|
| A curator's answer to one question, told in several charts | **a featured comparison** (owner's pick). Parts: **title**, **blurb**, **vehicles** (one ordered set), **charts** (each a chart link). Listed/unlisted like a vehicle; Home shows the **newest listed**. Not "scenario", **preset** or "view" | `featured_comparisons`, [featuredComparisons.js](../src/utils/featuredComparisons.js); `?tab=home&fc=<slug>` |
| One chart of it on Home, with title and **Open chart →** | **a panel** — a shop window: fed the comparison's own state, so the reader's selection never reaches it. A click opens the chart on its tab | [FeaturedChartPanel.jsx](../src/components/home/FeaturedChartPanel.jsx), [PresentedChart.jsx](../src/components/PresentedChart.jsx), `.home-panel` |
| The vehicle table as a panel | **a table panel**, full width, read-only (no checkboxes, filters, sorting; touches neither the address nor the reader's columns). Always names its preset (`vt_preset=overview` by default), since no preset means "your last columns" | [PresentedVehicleTable.jsx](../src/components/vehicles/PresentedVehicleTable.jsx), [VehicleTableGrid.jsx](../src/components/vehicles/VehicleTableGrid.jsx), `explicitChartParams` |
| A curator's line or two under a panel's title | **a caption**, in basic Markdown. Not the plot's **subtitle** (the conditions line inside the frame, which code sometimes calls a caption) | `charts[].caption`; [MarkdownText.jsx](../src/components/MarkdownText.jsx) |
| The Markdown blurbs and captions understand | **basic Markdown** — its own small parser. Same inline syntax as the explainers' parser, which handles articles and sits behind the explainers boundary | [miniMarkdown.js](../src/utils/miniMarkdown.js) |
| Putting the chart on screen into a featured comparison | **Save as featured comparison** — toolbar button **★ Feature**, curators only; opens **the featured comparison editor**. Delete is admin only | [FeatureChartButton.jsx](../src/components/home/FeatureChartButton.jsx), [FeaturedComparisonEditor.jsx](../src/components/home/FeaturedComparisonEditor.jsx) |
| Putting the site back to a featured comparison: its vehicles and its first chart's correction; other settings at defaults, each chart's arriving when opened | **reset to the comparison** | `resetStateOf`, `resetToComparison` in App.jsx |
| What a reader did that the site counts | **a site event** — under the anonymous browser token, never a user, email or IP; curators' clicks and the pop-out aren't counted. Not "analytics", "tracking" or "logging" (that's `access_logs`) | `site_events`, `log_site_event`, [siteEvents.js](../src/utils/siteEvents.js) |
| The Admin sub-tab reading those counts | **Site Events** — counted in **browsers**, never people; under 10 observations is **too few** and unranked. A chart open is **from Home** or **other ways** | [SiteEventsPanel.jsx](../src/components/admin/SiteEventsPanel.jsx), [siteEventStats.js](../src/utils/siteEventStats.js) |

## Charts

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| The 320px control column beside a plot | **sidebar** | HTML `<aside>` | `.chart-rail`, `.chart-main` |
| The bordered box a PNG export captures | **figure** | HTML `<figure>` | [PlotFrame.jsx](../src/components/charts/PlotFrame.jsx), `.plot-frame` |
| The "Data: …" credit along a figure's bottom | **source line** | dataviz convention | [SourceLine.jsx](../src/components/charts/SourceLine.jsx), [useSourceLine.js](../src/hooks/useSourceLine.js) |
| The box listing every series' value at the cursor's X, on line and scatter charts | **readout**. Bar charts keep a per-bar **tooltip**; the readout isn't one because its rows carry links | Highcharts *shared tooltip* | [ChartReadout.jsx](../src/components/charts/ChartReadout.jsx), [useChartReadout.jsx](../src/hooks/useChartReadout.jsx), [readoutAtX.js](../src/utils/readoutAtX.js) |
| The vertical line at that X, and a dot per line | **crosshair** — a ring where the value was interpolated | Highcharts, Grafana | `.chart-crosshair`, `.chart-crosshair-dot` |
| A readout held by a click | **fixed**. Not "pinned" (see Tables). Cleared by a second click, Esc or a click outside; local to the window. PNG redraws it; **Side readout** puts it beside the plot instead | — | `chart-readout--fixed`, [drawFixedReadout.js](../src/utils/drawFixedReadout.js), [readoutBox.js](../src/utils/readoutBox.js) |
| The strip of Colors, ★ Feature, URL and PNG | **toolbar** | WAI-ARIA `toolbar` | `.chart-export-strip` |
| Undoing a box-zoom | **Reset zoom** (button in the Axis Scale controls, only while zoomed) and **the zoom hint** (line under the plot). Not in the toolbar | — | [useChartZoom.js](../src/hooks/useChartZoom.js), [ZoomHint.jsx](../src/components/ZoomHint.jsx) |
| Min/Max a reader types to set an axis | **axis limits** — six fields, Auto when empty; link parameter `ax`. The heading stays **Axis Scale**. Not "zoom" or "bounds" | — | [axisLimits.js](../src/utils/axisLimits.js), [useAxisLimits.jsx](../src/hooks/useAxisLimits.jsx), [AxisScaleControls.jsx](../src/components/AxisScaleControls.jsx) |
| The thumbnail of what PNG copied | **export preview** | — | [useChartPng.js](../src/hooks/useChartPng.js) |
| Canvas type sizes from `--fs-body` | **chart fonts** | — | `chartFonts()` in [chartTheme.js](../src/utils/chartTheme.js) |
| Canvas colors from the tokens | **chart theme** | — | `chartTheme()` |
| The address that reopens a chart as left | **a chart link**; its parts are **parameters** (`r`, `rc`, `eff` …), read and written in one module | — | [chartUrlState.js](../src/utils/chartUrlState.js) |
| The chart link packed into `?k=1.…` | **a short link**; after `k=` is its **key**, `1.` its **version**. Packs the chart link, stores nothing. Writes defaults out so it doesn't shift when a default does. An unreadable key opens Home and says why | URL shortener | [shortLink.js](../src/utils/shortLink.js), [CopyLinkButton.jsx](../src/components/charts/CopyLinkButton.jsx) |
| Bar of one column or scatter of two, from the vehicle table's columns | **Chart** under Specifications & Data; **the spec chart** elsewhere. Kinds **Bar** and **Scatter** (modes `specs`, `specscatter`). Plots the table's own cell values. **Vehicles: Selection** (default) or **All** (what the filters leave; `ss=all`) | — | [SpecChart.jsx](../src/components/SpecChart.jsx), [SpecChartKind.jsx](../src/components/SpecChartKind.jsx) |
| The spec chart's list for choosing columns to plot | **field picker** — its items are **fields** ("Filter fields"). The table's own menu stays **Columns** (the **column picker**) | Material *listbox* | [FieldPicker.jsx](../src/components/tables/FieldPicker.jsx) |
| Charging Curves' list for choosing X, Y and Y2 | **axis picker** — items are **axes**. Each has a full `label` (titles the plot) and a short `name` | — | [AxisPicker.jsx](../src/components/AxisPicker.jsx), [chargingAxes.js](../src/utils/chargingAxes.js) |
| The icon beside a column header that plots it | **chart icon** (not "plot button"). Disabled while nothing is selected. On the EPA guide table only where `plotAs` is set | — | `.column-plot-button`, [SortHeader.jsx](../src/components/tables/SortHeader.jsx) |
| A closed section, above the help bubble, that works one figure through by the page's own code with the reader's settings — each step's formula, the values filled in, and where each value came from | **Show the math** in UI text; **calculation trace** (`trace`) in code. Closed by default; closed costs nothing. Carries a **Beta** badge (`.badge-micro.is-warning`, orange in the dark theme) while it is new. On the Range, Charge Stop, Cost & Time and Performance › Compare pages, and under the vehicle table. Not "debug" or "audit" (Data Checks is the audit) | — | [calcTrace.js](../src/utils/calcTrace.js), [components/calcTrace/](../src/components/calcTrace/) |

### Series color

| Thing | Call it | Lives in |
|---|---|---|
| The color one series is drawn in | **series color** | `resolveChartColors()` in [colorUtils.js](../src/utils/colorUtils.js) |
| The small square reporting it | **series swatch** — 10px, read-only | `.series-swatch` |
| The control that changes it | **series color picker** | [SeriesColorPicker.jsx](../src/components/SeriesColorPicker.jsx) |
| The color a pick becomes slot 1 of | **the base** | the rest of the set derives from it |
| A base asked of one car for this session | **a session base** — travels to the pop-out | `chartConfig.vehicleBases`, [vehicleBase.js](../src/utils/vehicleBase.js) |
| The control that sets a vehicle's base | **vehicle swatch** — on a chip or a run group's accent border; no scope control | [VehicleSwatch.jsx](../src/components/VehicleSwatch.jsx) |
| Reordering a palette to lead with the base | **rotation** — different hues for unrelated tests | `rotatePaletteFrom()` |
| One hue in lightness steps | **the ramp** — one vehicle's runs | `rampFrom()` |
| How much a pick recolors | **scope** — this test · this vehicle · **all tests** (never "all vehicles") | |
| The base every un-picked series draws from | **the palette** — set in the **Colors field** (a palette, or Vehicle color). The run picker's **color source note** links to vehicle colors while a palette is on | |
| A color set on one series this session | **a hand-set color**, or **a pick** — never saved | |
| Picks applied over the palette | **hand-set mode** — "Hand-set (3) over EVBench", orange outline | |
| Picks kept but not drawn | **parked** — choosing a palette parks them; Hand-set brings them back | |

Rules:

- **Stored** color (`vehicles.color`) and **drawn** color often differ; don't call
  them the same thing.
- **The swatch always reports the drawn color.** A parked pick may peek out
  behind it, never in front.
- Layers, bottom to top: palette → base (curated or session) → shades across a
  vehicle's tests → a test's pick. Setting a base keeps the picks.
- Only **Back to auto** or **Clear picks** removes a pick; parking doesn't.
- Nothing on a chart writes color to the database except a vehicle swatch's
  **Save to vehicle**. The durable color is edited in Tests & Data.

`.chart-rail` is a **sidebar**, not Material's *navigation rail*; say sidebar.

## Cost to Drive

The tab that prices a reader's own week of driving against their gas car
(plan: [cost-to-drive-plan.md](cost-to-drive-plan.md)). Owner's names, 2026-11-07.

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| The tab | **Cost & Time** — tab key `cost`. Its sub-tabs: **Your Driving** (`drivesetup`, the landing, every setting on one page), **Compare** (`drivecost`, the selected vehicles against the gas car), **Weekly Charging Plan** (`driveplan`), **Home Charger** (`drivecharger`). Mode keys frozen like every chart mode's. Not "Cost to Drive", its name through the build: that stays the plan's and the code's name (`costToDrive`), not the reader's (owner, 2026-11-07) | — | [chartNav.js](../src/constants/chartNav.js) |
| Every Cost to Drive setting packed into one address parameter, `cd=1.…` | **the Cost to Drive key** — a **key**, as the short link's part after `k=` is: packed on purpose, not meant to be read (owner: "encoded = key"). Only the vehicles (`v`) stay readable beside it. `1.` is its version; its defaults are frozen with it | — | [costToDriveKey.js](../src/utils/costToDriveKey.js) |
| The reader's week: seven days, each **Daily**, **Long day** or **Off** | **Your week**; a day's kind is its **day type**. A **planned fast charge** is a day the reader always stops (a grocery run), topped up to the cap and skipped when already above it | — | `week`, `planned` in [costToDrive.js](../src/constants/costToDrive.js) |
| The fast-stop settings | **Stop to charge by** (the SoC the car stops at), **Charge no higher than** (the cap), **Keep battery above** (a floor that holds all day, not only on arrival home — so not "get home with"), **Time to start and pay** (minutes per stop beyond charging; not "plug in and pay"), **Detour to a charger** (minutes off the route and back) | — | `stopBy`, `capTo`, `keepAbove`, `startMin`, `detourMin` |
| The reader's own car, priced against | **your gas car** — with a cost, mpg and fill-ups. Not Road Trip's **ICE Reference**, a time-only line that stops every three hours; the two are different things and keep different names | — | `simulateGasWeek` |

## Cards and rows

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| The colored left edge encoding state | **accent border** — orange = selected or overridden, red = queued for deletion, run color = series | CSS `border-left` | `.vehicle-card`, `.vehicle-row`, `.vehicle-run-group`, `.routing-row` |
| The ✓ on a selected card | **selected indicator** | ARIA | `.vehicle-card.is-selected::before` |
| The photo band with the title over a scrim | **media band** | Material *media* | [VehicleMedia.jsx](../src/components/vehicles/VehicleMedia.jsx) |
| The slice of the photo the band shows | **the band window** — not a fixed fraction (62–79% of height on desktop cards); previews draw the tightest case | — | `bandWindow()` in [cardBand.js](../src/utils/cardBand.js) |
| The vertical point (0 top – 100 foot) the band centers on; null is centered | **focal point** — not a crop: nothing is thrown away, so reposition freely. Belongs to the photo: replacing it clears the point, and a variant showing its source's photo uses the source's point. Say **crop a little wide** | Cloudinary, Contentful | `vehicles.image_focal_y`, `focalY()` |
| Moving a photo within the band | **repositioning** | — | [CardBandPreview.jsx](../src/components/vehicles/CardBandPreview.jsx) |
| A full-width labeled divider in the sidebar that opens its section | **section band** — all-caps label, caret, a count when picking from a list. `.subgroup-header` is the smaller in-panel toggle | — | [SectionBand.jsx](../src/components/SectionBand.jsx) |
| The orange dot on a section band while something inside is in force | **applied dot**. Not a badge (badges carry words) | — | `.section-band-dot` |
| Small mono state labels in a bar or row | **badges** | Material | `.badge-micro`, `.badge-default`, `.badge-status` |

## Type and color

| Thing | Call it | Lives in |
|---|---|---|
| The one type axis every size derives from | **the scale** — `--fs-body` × `--fs-step` | [index.css](../src/index.css) TYPOGRAPHY SYSTEM |
| Size + weight + color, picked as a set | **a role** — `.text-body`, `.text-micro`, `.text-nano`, `.text-caption` | same |
| The global size multiplier | **the UI scale** — `--ui-scale` | [typographyKnobs.js](../src/styles/typographyKnobs.js) |
| Named color values | **tokens** — `--color-*` | index.css |
| Appearance outside the theme, counted | **drift** | [driftProbes.js](../scripts/driftProbes.js) |
| A count asserted exactly, so a fall fails too | **a ratchet** | drift, `KNOWN_OFFENDERS`, the dark-override cap |

**Blue** leads the chrome. **Orange** is the one active/now signal and means
nothing else. **Green** is data and status, never chrome.

## Data

### Tests

| Thing | Call it | Lives in |
|---|---|---|
| One recorded test with its points | **a run** in code; **a test** in UI text | `runs`, `run_data_points` |
| A range run tied to a charging run | **a pairing** | [pairings.js](../src/utils/pairings.js) |
| Several runs from one outing | **a session** | [testSessions.js](../src/utils/testSessions.js) |
| Whether viewers see a test in pickers, charts and Tests & Data | **listed** / **unlisted** ("List", "Unlist"). Unlisted is still reachable and still counts unless excluded. Not "hidden", "public" or "private" — the filter is client-side | `runs.is_hidden` (see Deferred renames); `isListed` in [runListing.js](../src/utils/runListing.js) |
| A test left out of the statistics (composites, spreads, best windows, error bars) | **excluded** ("Exclude from statistics", "⊖ Excluded"). Counting is the default and has no word. Not "verified", and not the filter bar's **exclude** | `runs.is_excluded`; `statisticalRuns` in runListing.js; [RunCurationToggle.jsx](../src/components/runs/RunCurationToggle.jsx) |
| A vehicle's tests that are unlisted but count | **the pool**. An unlisted range test joins only with speed and temperature recorded ("Not counted: no speed"). Shown after listed, in grey: "Charging (4/2)" | `vehicle.pooledRuns`, `poolOf`; [RunListingBadges.jsx](../src/components/runs/RunListingBadges.jsx) |
| A curator's "I've looked; count it" | **override quality checks** ("⚑ Override checks"). Overrides only the range spread's pack-coverage rule and the pool's speed/temperature rule. Not **Data Checks** | `runs.quality_override`; `rangeCoverageOk` in [rangeTestSpread.js](../src/utils/rangeTestSpread.js) |
| The test behind a tested figure — which, why, its conditions, where it lives | **a test reference**; its peek is **the test peek**; the card a link lands on is **the link target** | [testDetails.js](../src/utils/testDetails.js), [TestPeek.jsx](../src/components/TestPeek.jsx), `?tab=runs&run=` |
| The range test a vehicle's tested figures come from | **the reported range test** — the default range test, else the newest full-pack one | `reportedRangeRun()` in [testedRange.js](../src/utils/testedRange.js) |
| Charger class a charging test used | **charger voltage class** (400 or 800; null = not recorded). "Charger: 400 V class". Not "charger type" | `runs.charger_voltage_class`, [ChargerClassSelect.jsx](../src/components/ChargerClassSelect.jsx) |
| The most current that charger could give (350, 500, 600, 700+ A) | **charger current class**. Null reads as 500 A but is never stored as 500. A composite splits by it only when a lower class is seen limited. Not "charger rating" or "amperage" | `runs.charger_current_class_a`, [chargerCurrentClass.js](../src/utils/chargerCurrentClass.js), [ChargerCurrentSelect.jsx](../src/components/ChargerCurrentSelect.jsx) |
| A stretch where the charger, not the car, set the rate | **charger-limited**; a composite **leaves out** that stretch (`heldBack` in code) | `PLATEAU_SHARE`, `HELD_BACK_MARGIN` in [compositeCurve.js](../src/utils/compositeCurve.js); `CHARGER_LIMITED_SHARE` in [chargeWindows.js](../src/utils/chargeWindows.js) |
| Whether one charging test was preconditioned | **preconditioned** — yes, no, or not recorded. Never write "not preconditioned" for "not recorded" | `runs.preconditioned`, [runPreconditioning.js](../src/utils/runPreconditioning.js) |

### Composites and correction

| Thing | Call it | Lives in |
|---|---|---|
| One stored line standing for a vehicle's charging, from its own and inherited tests | **composite curve** — a real run, italic in lists: "Composite (3 tests)", or one per charger class ("Composite on 800 V chargers (2 tests)"). The **default charging curve** unless a test is marked DEF. A mean, quoted with its conditions. Not "nominal", "typical", "representative" or "average curve" | [compositeCurve.js](../src/utils/compositeCurve.js); `runs.composite`; `defaultChargingRun` in [runUtils.js](../src/utils/runUtils.js) |
| Shading around a composite curve: best test at each SoC down to one SD below the mean | **test spread** — lopsided on purpose. None when one test stands alone. Not a **confidence band**, not a bare "band" | `testSpread`; `extra_data` `{ n, spreadHi, spreadLo }`; `?cspread=0` |
| Range tests corrected to one set of conditions and averaged | **composite range** / **composite efficiency** — "Composite range, 70 mph", "composite of 3 tests". Never stored. Leaves out mixed cycles, tests far from the target speed, and tests outside the temperature band. Not "corrected range" alone | [compositeRange.js](../src/utils/compositeRange.js); `COMPOSITE_RANGE_TEMP_BAND`, `COMPOSITE_RANGE_SPEED_GAP_MPH` |
| Correcting range tests, and the conditions corrected to — one setting for every chart and the table | **correction** (the mode: "Correct:") and **correction target** ("Correct to 70 mph, 70°F, 0 ft, calm air", with **accessory load** beneath). Default is the **standard conditions** (Admin knob). Not "reference conditions" (`REFERENCE_SPEED_MPH` is something else) | [correctionSettings.js](../src/utils/correctionSettings.js); [conditionCorrection.js](../src/utils/conditionCorrection.js); [CorrectionTargetFields.jsx](../src/components/CorrectionTargetFields.jsx) |
| Heating, cooling and other non-traction draw a correction swaps | **accessory load** (watts). A test's is **assumed** from its temperature, never measured; one line for every car. Not "aux", "auxiliary load" or "HVAC load" | [accessoryLoad.js](../src/utils/accessoryLoad.js); `ACCESSORY_*` in [epa.js](../src/constants/epa.js) |
| Whether that load follows temperature or the reader set it | **auto** (follows Temp, not in the link) / **set by you** (stays put, in `c_acc`). Not "default", "manual" or "override" in UI text | `.assumption-slider.is-auto`; `effectiveAccessoryW` |
| Modeled Efficiency's two controls outside the correction | **Wind & elevation change**. Not in the link (they ride the pop-out sync). Retired in UI text: "viewing conditions" | [WindAndElevationFields.jsx](../src/components/epa/WindAndElevationFields.jsx) |
| Composite range over the EPA label's highway range | **% of EPA hwy** — a reference point, not a pass mark: EPA's highway cycle averages about 48 mph | `calc.pctOfEpaHwy` in [vehicleTable.js](../src/utils/vehicleTable.js) |
| Reported range test scaled to a new pack | **when-new range** — shown only where capacity retention is. Not "original", "nominal" or "degraded range" | `whenNewRange()` in testedRange.js |
| Share of new-pack capacity the test delivered | **capacity retention** — shown only below 95%. Not "fade", "battery health" or "SoH" | `CAPACITY_RETENTION_SHOWN_BELOW` |

### Vehicle figures and specs

| Thing | Call it | Lives in |
|---|---|---|
| Maker's usable and gross pack capacity | **Usable** / **Gross** | `specs.charging.battery_usable_kwh`, `specs.powertrain.battery_gross_kwh` |
| DC energy EPA measured on the multi-cycle test | **EPA tested** — never a bare "Tested", which is EVBench's range test on the card | `epa_tests.total_dc_energy_kwh` |
| Energy between the car's 0% and 100% | **the SoC window** (`socWindowKwh`): EPA tested, else Usable, else Gross, else unsorted. Not the **charge window** | [vehicleFigures.js](../src/utils/vehicleFigures.js) |
| Where a resolved figure came from | **its basis** | `socWindowBasis`, `epaRangeBasis`, `.stat-cell-basis` |
| A vehicle's EPA range as read | **EPA range** — primary configuration's label, else Expected EPA Range, else unsorted | `epaRangeMi` |
| A curator's figure for a car with no EPA label | **Expected EPA Range**, with a basis (Manufacturer, Independent test) | `specs.range.expected_epa_mi` |
| A value from `vehicles.battery`/`vehicles.range` no source confirms | **unsorted** — last tier, deleted with its column | |
| What a vehicle is built on: body, structure, suspension | **the mechanical platform** | [platforms.js](../src/utils/platforms.js), `platforms.kind = 'mechanical'` |
| Pack, drive units, power electronics | **the electrical platform**. Not "architecture" alone | `platforms.kind = 'electrical'` |
| Either, when clear from context | **platform** | [PlatformLine.jsx](../src/components/vehicles/PlatformLine.jsx) |
| What a platform does for a vehicle | **provides** values ("from <platform>"). Specs resolve **own → source vehicle → platform**; only the vehicle's own platform | `PLATFORM_PROVIDES`; `specProvenance` in [specHelpers.js](../src/utils/specHelpers.js) |
| 400 or 800 V architecture | **voltage class** — the platform's, else from nominal voltage (under 475 V = 400 V class). "900 V" is marketing for 800. Not "voltage" (the nominal field) | `resolveVoltageClass`, `VOLTAGE_CLASSES` |
| How a car takes DC from a 400 V charger | **400 V support**: native, DC booster, motor boost, split pack, not possible. Vehicle's field, else its platform's. Not "boost" or "conversion" | `specs.charging.dc_400v_charging` |
| Fastest DC rate on a 400 V charger | **max DC on 400 V** — the vehicle's, never the platform's | `specs.charging.max_dc_400v_kw` |
| Chemistries a platform's packs come in | **the platform's chemistries** — suggestions for the vehicle's **battery chemistry** (LFP, LMFP, NMC, NCA, NMCA) | `platforms.chemistries` |
| Warming the battery before a charging stop | **preconditioning** — None, Manual, Automatic, Both. None is an answer; blank is not recorded | `specs.charging.preconditioning` |

### Variants and lineage

| Thing | Call it | Lives in |
|---|---|---|
| A vehicle whose specs, tests, color, photo and tags come from another until set | **a variant**; it **inherits from** its source. Made with **＋ Variant** | `spec_source_vehicle_id`, [vehicleInheritance.js](../src/utils/vehicleInheritance.js) |
| The vehicle it inherits from | **its source** / **source vehicle** ("Inherits from"). None = an origin. Not "parent". Not a performance-result **source** | [SourceVehiclePicker.jsx](../src/components/SourceVehiclePicker.jsx) |
| What a variant shows but doesn't set | **inherited** — "Inherited from *source*" | `vehicle.inheritedFrom` |
| A vehicle's values before inheritance | **its own** — what editors read and write | `vehicle.own`, `ownValues()` |
| A source's charging tests reaching its variants automatically | they **come down the lineage**. Charging only; range tests need a link | [lineageCharging.js](../src/utils/lineageCharging.js) |
| A variant whose pack differs in chemistry or build, so nothing comes down to it | **a battery revision** — a cut on one edge, not a branch. Not "disconnect", "detach" or "cut-off" | `vehicles.battery_revision`, [BatteryRevisionNote.jsx](../src/components/vehicles/BatteryRevisionNote.jsx) |
| Same battery, different size | **capacity factor** — a vehicle's scales every test coming down, multiplied down the chain; a link's scales one test. 1 unless set | `vehicles.capacity_factor`, `spec_links.capacity_factor` |
| A link on a test the lineage already brings, holding its own factors, color or DEF | **an override** — "Reset" removes it | `spec_links`; `_viaLineage` |
| Deleting a source | its values are **passed down** to variants with none of their own, and they re-point one level up. The database requires it. Its tests can't move. Not "orphaning", "push down" or "merge down" | `delete_vehicle_passing_down()`, [vehicleDeletion.js](../src/utils/vehicleDeletion.js) |
| A new vehicle holding its own duplicates | **a copy** ("⧉ Copy"). A variant points; a copy duplicates | `duplicateVehicle` |
| EPA configurations offered on a vehicle's EPA section | **suggested configurations** — from the source, else the vehicle's make and model. A variant never inherits EPA figures (they were wrong on live data) | [variantEpaSuggestions.js](../src/utils/variantEpaSuggestions.js) |
| A brand's default series color | **brand color** — "<brand> brand color". Not "manufacturer color" | `manufacturers.color`, [BrandRegistry.jsx](../src/components/admin/BrandRegistry.jsx) |
| Setting a vehicle's color from its photo | **Pull color** (curators, only where none is set; skips white, black, silver; offers Undo). **Clear color** removes one | [PullColorButton.jsx](../src/components/vehicles/PullColorButton.jsx), [imageColor.js](../src/utils/imageColor.js) |
| Whether a vehicle appears in lists and charts | **listed** / **unlisted** (LISTED / UNLISTED badge). Unlisted shows to curators and its creator; others see it only as **"Unlisted record"** in a lineage. Still lends values to variants. Not "private" or "public" — every row is readable | `vehicles.visibility` (see Deferred renames); [vehicleListing.js](../src/utils/vehicleListing.js); `vehicles` vs `fleet` in AppContext |

Tags are one set: a variant with any tags of its own shows only those.

"Variant" unqualified means the vehicle record. An EPA wheel or trim variant is
a **configuration**.

### Accuracy signals and checks

| Thing | Call it | Lives in |
|---|---|---|
| Anyone's signal that data looks right or wrong | **accuracy signals** | `votes`, `vehicles.flagged_specs`, [VoteButtons.jsx](../src/components/VoteButtons.jsx) |
| Saying specs or a run look accurate | **a vouch** — "Vouch for accuracy" | `votes.vote_type = 'vouch'` |
| Saying a spec value or a run may be wrong | **a flag** | `flagged_specs`; `votes.vote_type = 'flag'` |
| A spec flag not yet saved | **a pending flag** | `pendingFlags` in [ViewSpecsModal.jsx](../src/components/ViewSpecsModal.jsx) |
| An admin removing a spec flag | **clearing a flag** | `unflagSpecField` |
| A table cell whose value is flagged | **a flagged cell** | `.guide-td.is-flagged` |
| Admin sub-tab of vehicles disagreeing with their sources | **Data Checks** | [DataChecksPanel.jsx](../src/components/admin/DataChecksPanel.jsx), [dataChecks.js](../src/utils/dataChecks.js) |
| Two sources further apart than a limit | **disagrees** | `.is-disagrees` |
| Something missing that would let a figure be checked | **a gap** | `.is-gap` |
| A change a curator makes from a finding | **a fix**; a column fix is **a move** | [dataCheckFixes.js](../src/utils/dataCheckFixes.js) |
| A recorded decision that nothing needs doing | **a skip** — holds while the judged values hold; changing them brings the finding back. Moving a limit doesn't | `fe_guide_skipped_at`, `data_check_skips` |
| Who published a performance result | **a source**; other spellings are **aliases** | `sources`, [SourcePicker.jsx](../src/components/SourcePicker.jsx) |
| Whether a printed 0–60 counts the first foot | **the rollout basis** — *1-ft rollout omitted* or *standing start* | `ROLLOUT_BASES` |
| Admin sub-tab importing results in bulk | **Published Results** | [PublishedResultsPanel.jsx](../src/components/admin/PublishedResultsPanel.jsx) |

- A run's vouch and flag are counted, one per browser, one or the other. A spec
  vouch is per vehicle and counted; a spec flag is per field, on or off, with
  no count. Say "flagged", not "flagged by N people".
- A Data Checks finding is not a flag.
- **Checks, not integrity.** `epaIntegrity` asks if a record is possible
  against itself; a check compares against another source.

### EPA

Three sources, named for where the data comes from: **EPA Label** (the Fuel
Economy Guide, one row per configuration), **EPA Certification** (one CSI filing
per Test Group, so per model year), and the **EPA test vehicle** inside it (one
per Vehicle ID). Certifications and test vehicles are many-to-many. A heading
names the source and its description says what one point is — Label Statistics
counts configurations, Certification Statistics counts test vehicles.

| Thing | Call it | Lives in |
|---|---|---|
| The car EPA put in the lab, keyed by Vehicle ID | **an EPA test vehicle** — "Test vehicle" in UI text. Never a bare "vehicle". Not "test group" | `epa_test_vehicles`, `test_vehicle_id` |
| One EPA filing for one model year, named by its **Test Group** | **an EPA Certification** ("cert" where short; **certification record** when ambiguous). Test Group is always capitalized | `epa_test_vehicles.test_group` |
| What is read from a CSI document | **certification data** | [parseEpaCsiPdf.js](../src/utils/parseEpaCsiPdf.js) |
| The figures on the window sticker | **EPA Label** — capitalized. The **Fuel Economy Guide** is the file it's imported from | `epa_fe_guide`, `label_*`, [parseFeGuide.js](../src/utils/parseFeGuide.js) |
| One test EPA ran, numbered by **test number** | **an EPA test** — never "run". Also matched by **fingerprint** (procedure, date, CD range, AC energy) because EPA renumbers refiled tests | `epa_tests`; `testFingerprint` in [epaTestVehicleIdentity.js](../src/utils/epaTestVehicleIdentity.js) |
| A Vehicle ID EPA reused for a different car | stored as **`<Vehicle ID>@<Test Group>`** — only when they share no test and differ in carline or by over a quarter in weight | `resolveTestVehicleIds` |
| Which test vehicles stand behind an EPA Label | **Tested via** (owner's pick): **exact**, **near**, **blend** (shown as the **span**, never a weighting), **untested** (nearest tested trim suggested, not linked), **no lab data**. Not "basis" or "configuration" | [guideTestedVia.js](../src/utils/guideTestedVia.js) |
| An EPA test vehicle linked to a vehicle | **a configuration** / **EPA configuration** | `epa_vehicle_mappings` |
| The one whose label range, EPA tested and weight are the vehicle's | **the primary configuration** | `is_primary`, [PrimaryConfigurationPicker.jsx](../src/components/epa/PrimaryConfigurationPicker.jsx) |
| A Guide row linked to a vehicle | the vehicle's **EPA Label** ("link an EPA Label"). Configurations come through its Tested via; unlinking removes what it brought | `vehicle_guide_rows`, [vehicleGuideLinks.js](../src/utils/vehicleGuideLinks.js) |
| How a configuration stands against the vehicle's EPA Label | its **standing**: **tested via label**, **other label**, **not behind label** (the only one the Admin move removes), **unconfirmed** | `configurationStanding` |
| How one test vehicle matches a Guide row | its **match**: **exact**, **near**, **blend** (with **nearest**), **alternative**, **possible**, **other label**, **no match**, **no lab data**. Not "standing" | [guideRowMatches.js](../src/utils/guideRowMatches.js), [GuideRowMatchList.jsx](../src/components/epa/GuideRowMatchList.jsx) |
| A test vehicle no Guide row stands on | **behind no EPA Label** (provisional). Marked, never deleted; its links removed; lifted if a row appears. Not "orphan" or "culled" | [epaBehindNoLabel.js](../src/utils/epaBehindNoLabel.js) |
| AC loss between wall and pack (charger, cable, idle draw) | **charger efficiency** — always AC; 0.885 assumed. Never for DC | `ASSUMED_CHARGER_EFF`, `deriveChargerEfficiency` |
| DC fast loss from port to pack output | **DC fast charging loss** — 0.09, one value for all. Not the station's loss, not charger efficiency. Say **port to pack output**, not "terminals" | `DC_FAST_LOSS` in epa.js |
| The person maintaining EPA records | **the curator** (admin or contributor) | |

Years and filings: **Since MY2023** (first year in a certification),
**MY2023 to MY2025** (gaps written out: "MY2022, MY2024 to MY2025"),
**From MY2024** (a figure standing in from another year — not "flag"),
**Basis** (how a certification record came to exist: `csi` / `csv` / `guide` /
`manual`), and **Recertified** (same Test Group filed again; EPA's field is
`certificate_revision_date`, but "revised" would imply a change).

**`total_voltage_v` is not nominal.** Makers file different points on the
voltage range (GM files full charge). Never compare it across makers or copy
it into `battery_nominal_voltage_v` unchecked. Evidence:
`epa-voltage-points-differ` in `src/explainers/facts.json`.

### Listed, unlisted, excluded

Two questions: does a viewer see it (listed), and does it count (excluded). All
four answers are real — listed and counted, unlisted and counted (the pool),
unlisted and excluded (disputed), listed but excluded (illustration only, like
a towing run). A figure that **aggregates** tests counts the pool; a figure
that **quotes** one test quotes a listed one, so readers can find it.

## Statistics and uncertainty

| Thing | Call it | Lives in |
|---|---|---|
| A bound a derived EPA figure must fall inside | **a validity band** | `ETA_BAND`, `CHARGER_EFF_BAND`, `PACK_KWH_BAND`, `SS_SPEED_BAND` in epa.js |
| Falling outside one | **out of band** | `eta-out-of-band`, `charger-out-of-band`, `implied-ss-speed-out-of-band` |
| The observed spread shown beside one | **band evidence** | [epaBandEvidence.js](../src/utils/epaBandEvidence.js) |
| How far a repeat would likely land | **a confidence band** (line) / **error bar** (bar) | [#314](https://github.com/pluginpath-ops/ev-data-viz/issues/314) — not built |

**Never write a bare "band."** A validity band says *this figure is
implausible*; a confidence band says *this measurement is uncertain*. Qualify
both. `HIGHWAY_BAND_MPH` is a third sense — a **reference band** drawn on the
EPA curve, nothing flagged against it.

## Tables

| Thing | Call it | Established by | Lives in |
|---|---|---|---|
| Every vehicle a row, any field a column | **the vehicle table** — "Table" under Specifications & Data | — | [VehicleTable.jsx](../src/components/VehicleTable.jsx), [vehicleTable.js](../src/utils/vehicleTable.js); mode `specstable` |
| A row kept at the top of one table only | **pinned**, in **the pinned band** | common web | [GuideTable.jsx](../src/components/epa/guide/GuideTable.jsx), `.guide-pinned-head` |
| A vehicle chosen for the whole app | **selected** | ARIA | `selectedVehicles`, the chips |
| The selected vehicles at the top of the vehicle table | **the selected band** — the pinned band's look, selection's meaning | — | `.vehicle-table-band` |
| The cell at the top of a column — click sorts, drag moves | **a column header** — always qualified; "header" alone is the page header | HTML `<th>` | [SortHeader.jsx](../src/components/tables/SortHeader.jsx), [useColumnDrag.js](../src/hooks/useColumnDrag.js) |
| A proportional fill behind a value | **a bar cell**. Not a sparkline | — | `computeBarMaxima()` |
| Choosing which columns show, in what order | **the column picker** | — | [ColumnPicker.jsx](../src/components/tables/ColumnPicker.jsx) |
| A named, ordered column set with a sort (Road trips, Value…) | **a preset** — labeled **"Compare for"** on screen. Not "view" | common web | [vehicleTablePresets.js](../src/utils/vehicleTablePresets.js), [PresetPicker.jsx](../src/components/tables/PresetPicker.jsx) |
| A preset changed since chosen | **modified** — "modified from Value" | — | `modifiedFrom` |
| A column worked out from others | **a calculated column** | — | `CALCULATED_COLUMNS` |
| An input the reader sets for calculated columns | **an assumption**; menu **Assumptions**, showing only ones a shown column reads | calculators | [VehicleTableAssumptions.jsx](../src/components/VehicleTableAssumptions.jsx) |
| The SoC span a charging stop covers (10→80% default) | **the charge window**. Never "SoC window" | — | `windowFrom`/`windowTo` |
| What a figure is measured in, beside every number | **the unit** — case kept (`kWh`, `MPGe`); the header doesn't repeat it; never read from the column name | SI | `.stat-cell-unit`, `CANONICAL_UNITS` in [tableColumns.js](../src/utils/tableColumns.js) |

**Pin is local, select is global.** Unpinning rearranges one table; deselecting
changes every chart. A table of vehicles says **select**, never pin, even though
it borrows the pinned band.

---

## Retired

| Do not write | Write | Why |
|---|---|---|
| "the rail" for a card's left edge | accent border | collided with the sidebar |
| "the rail" for the sub-nav | sub-nav | |
| "chrome" for the header | header | chrome is the category |
| "selection strip" | chips | collided with "selection bar" |
| "Runs" in UI text | Tests / Tests & Data | the UI says tests |
| "pinning" for choosing vehicles | selecting | pin is local; selection drives every chart |
| "sparkline" | bar cell | nothing here is a series |
| a bare "band" | validity band / confidence band | two meanings, opposite jobs |
| "test group", "certification group", "cert group" for the Vehicle ID record | **EPA test vehicle**; **Test Group** only for EPA's identifier | the record is the car |
| `epa_test_groups`, `test_group_id`, `testGroupId`, `epaGroup`, `epa_test_family_id` | `epa_test_vehicles`, `test_vehicle_id`, `testVehicleId`, `epaTestVehicle`, `test_group` | renamed in migration 081 |
| "Hidden" / "Hide" for a test, in UI text | **Unlisted** / Unlist — or **Excluded** for statistics | one word carried two questions |
| "nominal" for a measured curve | composite | *nominal* means rated, as filed |

## Open names

Names not yet settled. Record them here rather than guess in code.

| The thing | Where | Candidates | Leaning |
|---|---|---|---|
| Shrinkage weight trading a vehicle's spread against the fleet's | [#314](https://github.com/pluginpath-ops/ev-data-viz/issues/314) | — | undecided |
| A figure column whose header names its speed and whose note is as long | `holds: 'noted-figures'`, `.guide-th.noted-figures` | noted · conditioned · wide · stated | **noted-figures** (owner's pick). Not "conditioned" (collides with preconditioned and correction conditions). Sibling `long-figures` still open |
| One source above a card on the Cards grid | [RolodexCard.jsx](../src/components/vehicles/RolodexCard.jsx) | rolodex card · peek · spine | **rolodex card** for now (owner's pick) |
| The one solid button a view may carry, for its main action | `.btn-commit`, `--color-commit*` | commit · cta · key | **commit**, provisionally. Not "CTA" |
| A card with its source chain stacked above it | [VehicleStack.jsx](../src/components/vehicles/VehicleStack.jsx) | stack · variant stack | **stack** |
| Summary's third view: every lineage from its origin down | [LineageTree.jsx](../src/components/vehicles/LineageTree.jsx), key `lineage` | lineage tree · family tree | **Lineage** (sub-tab), **lineage tree** (prose) |
| A vehicle's place in its lineage, as an icon | [LineageIcon.jsx](../src/components/vehicles/LineageIcon.jsx) | | **origin**, **has variants**, **end variant** |
| Spec chart bars for a text or yes/no column (equal height, value inside) | [SpecsChartView.jsx](../src/components/SpecsChartView.jsx), `plot.kind === 'text'` | Lineup · Labeled bars · Tiles | **Decided:** **labeled bars** internally; **Lineup** if ever shown in the UI (it isn't today) |
| A test vehicle no Guide row stands on | [epaBehindNoLabel.js](../src/utils/epaBehindNoLabel.js) | behind no EPA Label · unlabeled · off-label · retest | **behind no EPA Label**. Not "retest" (most are unsold variants) or "off-label" |
| How far apart a vehicle's range tests landed — every test shown | [rangeTestSpread.js](../src/utils/rangeTestSpread.js), [roadTripSpread.js](../src/utils/roadTripSpread.js); "Test spread" meanwhile | test spread (widened) · tested span | **test spread**, widened: same idea for the reader as the curve's, different construction. Never "range", "error bar" or "confidence band" |

## Deferred renames

Kept on purpose. Each has a revisit date; past it, do the rename or record why
not.

| Old name | Means now | Revisit |
|---|---|---|
| `.guide-table`, `.guide-th`, `.guide-td`, `.guide-row`, `.guide-spark`, `.guide-filter-strip` … | a browse table, shared by the EPA guide and the vehicle table — wants a neutral prefix | 2027-02 |
| `useViewingConditions`, `.chart-viewing-conditions`, `.viewing-row`, "viewing condition" comments in epaDerivations.js | **Wind & elevation change** only | 2027-02 |
| `.chart-rail` → `.chart-sidebar`; `.app-nav` → `.app-header` | sidebar; header (~40 CSS references plus five views) | 2027-02 |
| `vehicles.visibility` ('public'/'private'), `visibility_type` | **listed / unlisted** — renaming touches every policy and import path | 2027-02 |
| `runs.is_hidden`, `isHidden`, `.badge-hidden` | **unlisted** | 2027-02 |

Until renamed, code keeps the old name and prose uses the new one.
