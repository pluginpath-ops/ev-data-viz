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
| Your gas car | city **18** mpg, highway **24** mpg, **$4.00**/gal (one click picks an F-150, Civic, RAV4, X3 or Pilot and fills in its EPA mpg and tank; editing mpg or tank makes it the reader's own car, named in the Custom field — "Custom" while blank; the charts call the gas car by that name), tank **26** gal, fill up at **15**% left, each fill-up **5** min (about 1 to start the pump, 2–3 to fill, ½–2 to pay; the station on the way). Its mpg drops in the cold: 15% city and 7% highway at 20°F, a straight line to none at 75°F (`GAS_COLD_LOSS`; fueleconomy.gov's cold-weather figures) |
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
at 240 V, the car's own EPA certification figure (DC ÷ AC recharge, measured
or pinned; `epaRange.chargerEfficiency`, as the vehicle table uses), else
`ASSUMED_CHARGER_EFF`; at 120 V, that × `WALL_OUTLET_CHARGER_EFF` (0.80) ÷
`ASSUMED_CHARGER_EFF`, so a car good on 240 V is good on 120 V too (owner,
2026-11-08). Home Charger lists each car's 240 V figure and where it came from.
Below `PACK_WARMING_BELOW_F` (40°F) the Season settings and Home Charger warn
that a car parked outside warms its battery before charging and driving,
unpriced, worst on 120 V.
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
  already above it. It happens at **5 pm** (`PLANNED_HOUR`; a
  setting until 2026-11-10, dropped as one nobody would use): at that hour on a day off, and on a driving day in the gap between
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

`?tab=cost&m=<sub-tab>&v=<vehicle ids>&cd=3.<key>`.

`v` stays the readable vehicle parameter every tab shares. Every setting above
is packed into ONE versioned parameter, `cd` — **the Cost to Drive key**, not
meant to be read (owner, 2026-11-07). `src/utils/costToDriveKey.js`:
- `<version>.<URL-safe base64>`; fields in a fixed order, each a small whole
  number on its slider's step (amps by level index, prices in cents, SoC in %).
  The week is two bits a day, the planned days a 7-bit mask.
- Version 1's defaults are frozen with it (like `IMPLIED_V1`): a key shared now
  opens the same week after a default moves.
- Version 2 (2026-11-07): the daily and long-day miles stored to the mile, not
  in fives (owner: "allow any value"; the spinner still moves in fives), and
  gas at $4.00 and a 5-minute fill-up by default, not $3.20 and 8 min
  (2026-11-08). Same fields and packing otherwise. Keys are written as
  version 2; version-1 keys still read, their miles in fives and their gas
  price and fill-up at version 1's defaults when they left them out.
- Version 3 (2026-11-10): the gas car picked (`gasCar`) and a custom car's
  name (`gasName`, the first text field: its UTF-8 length, then its bytes)
  were added, and the defaults moved to the Commuter week (35 mi
  weekdays half city, one 80 mi weekend day 20% city, nothing planned). Keys
  are written as version 3; version-1 and -2 keys open on the old week (long
  days between short ones, 220 mi, a planned Sunday stop) when they left it
  out.
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
| `drivesetup` | **Your Driving** | the landing: every setting on one page, week buttons after "Start from" in the Your week card (Commuter — the default —, WFH, Supercommuter, On the road, Weekend warrior; each sets every week field, the rest keep) and the gas cars after "Car" in Your gas car — both on this page only, not in the chart sidebars, a live preview of the selected cars against the gas car, links on |
| `drivecost` | **Compare** ("Cost & Time" until the tab took the name, 2026-11-07) | cards below the charts (chart first); the selected vehicles against the gas car: everything per month (the week × 52 ÷ 12): $/month and extra minutes/month on the cards, stops a month; bars "Cost per month" (home solid, fast striped) and "Time per month"; a stop line per car |
| `driveplan` | **Weekly Charging Plan** | one vehicle (a dropdown of the selection) and a chart dropdown: **day by day** (default, mockup A3, in time order — a gray bar for the day out from the morning's battery to arriving home, each fast stop inside it at the levels it charged between, striped on the route and solid when planned, then the night at home up to the next morning, a dashed tick on its bar at the night's **home ceiling** — the most the plug-in window could have added at full power, so the gap over the bar is the charger's margin, pinned to the top edge with an arrow where it is off the plot; `utils/dayBars.js`, `utils/ceilingMark.js`), **day by day, charge in and used** (the same figures from zero), or **the week as a line** (range left in miles, SoC on the right, each night's plug-in window a quiet shading with its last stretch, after the charger finished, a shade darker — the spare time — dashed lines at 10% and 80% — fades over 0–10% and 80–100% until the owner found them distracting — stop bands), the day-by-day table under the chart, transposed (a column a day; rows Day type, Home adds, Starts at, Ready at — the time the night filled or the window ended, asterisked and footnoted when the plug-in schedule cut it short — Spare plug-in time — the window less the hours the charger ran, "None*" where the window cut the night short — Home cost, then Fast stops, Fast time and Fast cost outlined in orange; the % in the figure, one plain line a cell), an optional comparison chart (another charger level or the other season) stacked below, and the gas car's chart collapsed by default |
| `drivecharger` | **Home Charger** | each level against each selected vehicle — everything per month, as on Compare (the week × 52 ÷ 12; owner, 2026-11-07, so the two tabs read in one unit) — a column a car at each level, its cost per month stacked: home underneath in the full color, fast on top striped in the full color over its desaturated shade, as on Compare (the other way round, briefly, left the charts muted; the shade alone read as a faded copy, so stripes, owner 2026-11-08; `utils/stripedFill.js`, shared with the day-by-day fast stops), the total over it and the home figure on the home part where there is fast charging (owner, 2026-11-07; it drew fast minutes until then); a [Cost \| Time] switch above the plot brings the minutes back as a second chart (2026-11-13): one column a car of fast charging per month, time labels (`minutesText`), axis from zero, same level order, colors and legend; home charging is not time the reader spends, so it is not drawn, and neither is the home ceiling below; the choice is `chartConfig.homeChargerChart`, link parameter `hc` (Time only), so the link and pop-out restore it; the table transposed: a column a level (yours marked), per vehicle rows for fast charging, home cost, fast cost and total cost per month, one plain line a cell, notes as marks under the table (bold orange for "enough", ^ for capped) — where "enough" begins (the first level within `ENOUGH_MARGIN_MIN`, 5 min a week, of the best any level manages), where the car's onboard charger caps it (by more than 0.25 kW: a 48 A circuit's 11.52 kW against an 11.5 kW car is not capped); over each car's column a dashed line, its **home ceiling** — the most its home charging could cost a month (the lesser of the charger and the onboard charger, at full power through the whole plug-in window, every night, at the home price; `homeCostCeiling`; owner, 2026-11-11) — one a car, none for no home charging, drawn by a plugin so it never moves the y-axis; one above the plot is pinned to its top edge with an up-arrow, its figure in the tooltip only (a figure on each arrow read as clutter; owner, 2026-11-11) |

Your Driving is the PRIMARY place to set things. The analysis sub-tabs keep a
sidebar with EVERY setting too — the secondary way in, not a summary. Both
open with **Share this comparison** (`ShareSettingsButton`, the chart
toolbar's short link as a page button; owner, 2026-11-10), which replaced the
sidebar's button to Your Driving: the sub-tab row goes there already. Number
fields are one row each: label, a narrow box, the unit (`NumberInput`).

## Reuse, not rebuild (owner, 2026-11-07)

The charts and tables use the site's own machinery, so each affordance is
present here exactly as on every other chart tab:
- **Charts are Chart.js**, as every chart tab's are — not the canvas's
  hand-drawn SVG. That brings the PNG capture (`useChartPng` +
  `CopyPngButton` — its Image button, frame caption and source line drawn on), the Link
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
`vite build`. New semantic classes in `index.css` from tokens; no inline color
or size.

## Open, not blocking

- A car with no usable range test is priced from the EPA highway label, NOT
  re-priced for speed (re-pricing the cycle's 48 mph to 70 as if held
  double-counts the label adjustment: a Model Y read ~400 Wh/mi at 70 in
  summer). Properly it wants Modeled Efficiency's curve from the car's EPA
  test record (`buildEpaCurveFromModel`), fetched per car — a later layer.
- The detour model (minutes → miles at 40 mph) is a guess the owner is unsure
  of; it is one constant, easy to revisit.
- Merged (owner, 2026-11-12; #555): Road Trip's gas-car line is this tab's gas
  car, one picker and one set of settings shared by both tabs, named by the
  car's own name ("Your gas car" while none is picked). Road Trip draws it time
  only and stops it on its tank (`gasTripLegs`). See vocabulary, Cost to Drive.
- Road Trip / Trip Optimizer may move under this tab later; not now.
- The Weekly Charging Plan's vehicle and its "Compare with" are picked on the
  page and are not in the link. The key holds the week; adding them is a new
  key version or a separate parameter, if a shared link should open on them.
