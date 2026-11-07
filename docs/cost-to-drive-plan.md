# Cost to Drive — the plan

A new top-level tab that answers one question for a reader's own week of
driving: what would an EV cost me, and how much time would it take, against the
gas car I drive now? It started from a friend's "my work drives are often 220 mi
a day, and Michigan winters hurt range; EV is rough for me" (2026-11-07).

This file is written for the agents who build it. Every decision below is the
owner's and was settled over the mockup rounds; do not re-ask them. The
mockups are a Design canvas (private, owner's account):
https://claude.ai/artifact/4ay3LFps47wPt4e5fXaurw — boards Your Driving,
Cost & Time, Weekly Charging Plan, Home Charger, the shared header and the
sidebar. Its numbers come from a toy sim with made-up vehicles; the layout and
wording are what carry over.

## What the reader sets

One state, shared by every sub-tab and kept when switching between them.

| Group | Settings (default) |
|---|---|
| Home charging | charger level: 120 V · 12 A, 240 V · 16 / 24 / 32 / **48** / 80 A (no 40 or 64 A — dropped for simplicity); plugged in from **10 pm** until **7 am**; charge to **80**%; 100% the night before a long day (**on**); home price **$0.17**/kWh |
| Your week | seven days, each **Daily**, **Long day** or **Off** (default L D L D L D Off); a **planned fast charge** on any days (default Sunday); Daily: **45** mi, highway at **70** mph, city share **40**%; Long day: **220** mi, **70** mph, **15**% |
| Fast charging | detour to a charger **10** min (5–30, as miles at 40 mph, energy too); stop to charge by **30**% (10–50); charge no higher than **70**%; keep battery above **10**%; time to start and pay **5** min; fast price **$0.48**/kWh |
| Season | shown: summer / **winter**; summer **75**°F, winter **15**°F; winter lasts **4** months; elevation **800** ft |
| Your gas car | city **18** mpg, highway **24** mpg, **$3.20**/gal, tank **26** gal, fill up at **15**% left, each fill-up **8** min (its detour included) |
| Efficiency from | **Tested + EPA** / EPA only |

Prices default to `vehicleTable.DEFAULT_ASSUMPTIONS` (0.17 / 0.48) so the two
places agree until a reader moves one.

## The model (pure, `src/utils/costToDrive.js`)

Per vehicle, three inputs are resolved, then a week is simulated.

**Efficiency.** Highway miles are priced from EVBench's range tests: the
composite (`compositeRange`) corrected to the day's highway speed, the season's
temperature and the elevation, accessory load on auto. City miles are priced
from the EPA **highway** figure (label highway range ÷ usable kWh) with the same
temperature, elevation and accessory correction at the HWFET average speed —
EPA's city figure flatters an EV with regen in a way a real commute does not.
"EPA only" prices both from that EPA figure. A car with no range test uses EPA
for both and says so. Winter is a floor: the correction prices denser air and
cabin heat, not battery warming or cold tires, and the page says so. No new
cold knobs.

**Home charging.** Power is the lesser of the level and the car's `max_ac_kw`
(an assumed 11.5 kW when the spec is blank, said so). What reaches the pack:
`ASSUMED_CHARGER_EFF` at 240 V, a new 120 V constant (0.80) for a wall outlet.
The window is the plug-in hours; a night that runs out says so.

**Fast stops — the rule.** A stop is on the route, not a dash at the end:
- When the day cannot stay above **keep battery above**, the car stops when it
  reaches **stop to charge by**. If the day STARTS below that, the stop waits
  until it is needed (keep-above + the detour's energy + 2%), never at mile 0.
- It charges enough, detour included, to finish the day above the floor.
- It adds at least **10%** (no 30→37% stops).
- It stays under **charge no higher than**, but stretches to **80%** when that
  saves a second stop. A day that still needs more stops twice.
- Minutes come from the car's own charging curve (`chargeTimeSession`, the same
  pick as every chart's default curve), else the spec's 10→80% time, else a
  generic taper from `max_dc_kw`. Detour minutes and time to start and pay are
  added. Energy bought = added ÷ (1 − `DC_FAST_LOSS`).
- A **planned fast charge** tops up to the cap and is skipped when the car is
  already above it. It happens at **5 pm** by default (`plannedHour`, a
  setting): at that hour on a day off, and on a driving day in the gap between
  drives nearest it — before the drive home on a Daily, after a Long day.

**The week.** Days drive in two spans (Long day 7–12 and 12–18; Daily 7–8 and
17–18) so a stop has a time and a mile. The sim runs three weeks and reports the
third, so Monday starts from a settled state.

**Gas car.** Same miles, same city share, mpg blended per day; fills at the set
level; minutes per fill-up. Fill-ups per week are reported as an average, since
one sample week is lumpy.

**A year.** Monthly figures are for the season shown; the annual line blends
winter months with summer ones.

## The link

`?tab=cost&m=<sub-tab>&v=<vehicle ids>&cd=1.<key>`.

`v` stays the readable vehicle parameter every tab shares. Every setting above
is packed into ONE versioned parameter, `cd` — **the Cost to Drive key**, not
meant to be read (owner, 2026-11-07). `src/utils/costToDriveKey.js`:
- `<version>.<URL-safe base64>`; fields in a fixed order, each a small whole
  number on its slider's step (amps by level index, prices in cents, SoC in %).
  The week is two bits a day, the planned days a 7-bit mask.
- Version 1's defaults are frozen with it (like `IMPLIED_V1`): a key shared now
  opens the same week after a default moves. A later change is version 2.
- All defaults → no `cd` at all. A key that cannot be read falls back to the
  defaults and says so.
- The short link (`k=`) carries `cd` as a string: append `cd` to `NAMES_V1`
  (and the tab's mode keys to `WORDS_V1`), never insert.
- Golden keys in the tests fail if a field moves.

## The tab

A chart category, key `cost`, label **Cost to Drive**, so it gets the chips,
the pop-out, the URL state and a help bubble like every chart tab. Mode keys
are frozen once merged (chartNav.js says why):

| Mode | Sub-tab | What it is |
|---|---|---|
| `drivesetup` | **Your Driving** | the landing: every setting on one page, presets (Commuter 40 mi, Road warrior 220 mi days, Reset), a live preview of the selected cars against the gas car, links on |
| `drivecost` | **Compare** ("Cost & Time" until the tab took the name, 2026-11-07) | cards below the charts (chart first); the selected vehicles against the gas car: everything per month (the week × 52 ÷ 12): $/month and extra minutes/month on the cards, stops a month; bars "Cost per month" and "Time per month"; a stop line per car |
| `driveplan` | **Weekly Charging Plan** | one vehicle (a dropdown of the selection) and a chart dropdown: **day by day** (default, mockup A3, in time order — a grey bar for the day out from the morning's battery to arriving home, each fast stop inside it at the levels it charged between, striped on the route and solid when planned, then the night at home up to the next morning; `utils/dayBars.js`), **day by day, charge in and used** (the same figures from zero), or **the week as a line** (range left in miles, SoC on the right, dashed lines at 10% and 80% — fades over 0–10% and 80–100% until the owner found them distracting — stop bands), the day-by-day table under the chart, transposed (a column a day; rows Day type, Home adds, Starts at, Ready at — the time the night filled or the window ended, asterisked and footnoted when the plug-in schedule cut it short — Home cost, then Fast stops, Fast time and Fast cost outlined in orange; the % in the figure, one plain line a cell), an optional comparison chart (another charger level or the other season) stacked below, and the gas car's chart collapsed by default |
| `drivecharger` | **Home Charger** | each level against each selected vehicle — the table transposed: a column a level (yours marked), per vehicle a fast-charging row and a total-cost-a-week row (home + fast), one plain line a cell, notes as marks under the table — where "enough" begins (the first level within `ENOUGH_MARGIN_MIN`, 5 min a week, of the best any level manages), where the car's onboard charger caps it (by more than 0.25 kW: a 48 A circuit's 11.52 kW against an 11.5 kW car is not capped) |

Your Driving is the PRIMARY place to set things. The analysis sub-tabs keep a
sidebar with EVERY setting too — the secondary way in, not a summary. Number
fields are one row each: label, a narrow box, the unit (`NumberInput`).

## Reuse, not rebuild (owner, 2026-11-07)

The charts and tables use the site's own machinery, so each affordance is
present here exactly as on every other chart tab:
- **Charts are Chart.js**, as every chart tab's are — not the canvas's
  hand-drawn SVG. That brings the PNG capture (`useChartPng` +
  `CopyPngButton`, frame caption and source line drawn on), the copy-link
  button (`CopyLinkButton`, which carries the `cd` key), the readout
  (`useChartReadout` / `ChartReadout`), `PlotFrame`, `SourceLine`,
  `chartTheme` colors, series colors (`useStickyChartColors`, the vehicle's own
  color) and the pop-out (`useChartSync`, PopoutView).
- **Tables** (the day-by-day plan, Home Charger's grid) use `components/tables`
  (`SortHeader`, `TableCell`) and the table classes, not new markup.
- **Inputs**: `NumberInput` for every number, the existing segmented and
  slider classes (`.assumption-slider`, the sidebar's `.chart-rail` groups),
  `SectionBand` for the sidebar's collapsible groups.
- **Help**: a `CHART_HELP_DEFAULTS` entry per mode, drawn by `ChartInfoBubble`.

## Build — a stack (`gh stack`, prefix `cost-to-drive/`)

1. **model** — `costToDrive.js` (resolve a vehicle's inputs, simulate a week,
   the gas car, the summaries), `costToDriveKey.js` (the codec, golden keys),
   the 120 V constant, tests. No UI.
2. **tab + Your Driving** — the category and modes in chartNav, App render
   branch (and the ChargingView fall-through list), PopoutView branch, chart
   help defaults, the `cd` state hook in chartUrlState, the short-link names,
   the Your Driving page and the shared sidebar. The analysis sub-tabs render a
   placeholder until their layer.
3. **Cost & Time**.
4. **Weekly Charging Plan** — the chart.
5. **Home Charger**.

Every layer: `npm test`, `npm run lint`, `npm run drift`, `npm run vocab`,
`vite build`. New semantic classes in `index.css` from tokens; no inline colour
or size.

## Open, not blocking

- A car with no usable range test is priced from the EPA highway label, NOT
  re-priced for speed (re-pricing the cycle's 48 mph to 70 as if held
  double-counts the label adjustment: a Model Y read ~400 Wh/mi at 70 in
  summer). Properly it wants Modeled Efficiency's curve from the car's EPA
  test record (`buildEpaCurveFromModel`), fetched per car — a later layer.
- The detour model (minutes → miles at 40 mph) is a guess the owner is unsure
  of; it is one constant, easy to revisit.
- "Your gas car" here vs Road Trip's "ICE Reference" — both stand; recorded in
  vocabulary as different things (a reader's own car with a cost vs a time-only
  reference line).
- Road Trip / Trip Optimizer may move under this tab later; not now.
- The Weekly Charging Plan's vehicle and its "Compare with" are picked on the
  page and are not in the link. The key holds the week; adding them is a key
  version 2 or a separate parameter, if a shared link should open on them.
