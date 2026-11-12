/**
 * Chart help / "About this chart" copy.
 *
 * Layman-friendly explanations shown in the collapsible ⓘ bubble at the bottom
 * of each Charts sub-tab. The authoritative copy lives in the `chart_help` table
 * (admin/contributor-editable, seeded by migration 031); these objects are the
 * BUNDLED FALLBACK used when a row is missing or in localStorage-only mode.
 *
 * Keep these in sync with the seed in supabase/migrations/031_chart_help.sql.
 *
 * Each entry has four content fields (plus a title), matching the table columns:
 *   data_source   — what data is shown and where it comes from
 *   how_to_read   — why it's relevant / how to read it
 *   key_terms     — key terms and units
 *   math_approach — the high-level mathematical approach
 *
 * The prose is written from what the chart code actually does (cross-checked
 * against ChargingView / RangeChartView / ChargeCompareView / EpaCurvesView and
 * the epaPhysics / epaDerivations math), NOT from assumptions.
 */

/** Ordered list of the fields, with editor labels and textarea sizing. */
export const CHART_HELP_FIELDS = [
    { key: 'title',         label: 'Title',                          rows: 1 },
    { key: 'data_source',   label: 'What data & where it comes from', rows: 5 },
    { key: 'how_to_read',   label: 'Why it matters / how to read it', rows: 5 },
    { key: 'key_terms',     label: 'Key terms & units',              rows: 5 },
    { key: 'math_approach', label: 'How it’s calculated',            rows: 5 },
];

/** Content fields only (everything except the title) — for rendering sections. */
export const CHART_HELP_SECTIONS = [
    { key: 'data_source',   heading: 'What you’re looking at' },
    { key: 'how_to_read',   heading: 'How to read it' },
    { key: 'key_terms',     heading: 'Key terms & units' },
    { key: 'math_approach', heading: 'How it’s calculated' },
];

export const CHART_HELP_DEFAULTS = {
    charging: {
        title: 'About the Charging Curves chart',
        data_source:
            'Plots the time-series readings from your saved charging tests — the ' +
            'log uploaded from a CSV or Tableau export of a real charging session. ' +
            'Each reading stores state-of-charge, elapsed time, charge power, range ' +
            'and temperature (the data points attached to a run marked “has charging”). ' +
            'Pick any field for each axis. A few fields are computed on the fly rather ' +
            'than stored: C-rate, range rate, SoC added, range added and EPA-rated ' +
            'range. If a charging run has no range column, range is filled in from the ' +
            'vehicle’s default range test by matching state-of-charge.',
        how_to_read:
            'Each line is one charging session. Use it to see how fast a car charges ' +
            'and how that changes as the battery fills — for most EVs charge power is ' +
            'highest at a low state-of-charge and tapers as the pack fills. The classic ' +
            'view is Charge Rate (kW) vs State of Charge. Turn on the right-hand (Y2) ' +
            'axis to overlay a second measure, e.g. rate plus range added. “Race mode” ' +
            '(available when the X axis is Time) lines runs up at a common starting ' +
            'state-of-charge so you can compare them head-to-head from the same point.',
        key_terms:
            'SoC (State of Charge) — how full the battery is, 0–100%.\n' +
            'Charge Rate (kW) — power flowing into the battery right now.\n' +
            'C-rate — charge power ÷ battery size (kW ÷ kWh); ~1C ≈ adding a full pack in an hour, regardless of car size.\n' +
            'Range Rate — miles of range gained per minute (or per hour).\n' +
            'SoC Rate — percent of the battery added per minute.\n' +
            'Range Added — change since the start of the plotted window. A composite curve is rebuilt from the tests that reach its start — race mode’s start SoC, or otherwise as far back as two of its tests reach. Its test spread there is built from those tests as drawn, and starts off: it is rougher than the charge-rate spread.\n' +
            'Range – EPA vs Range – Tested — EPA-rated range projected from SoC, vs the range actually logged in the test.',
        math_approach:
            'Mostly the raw measured points drawn as-is — no smoothing or curve-fitting. ' +
            'The computed fields are simple arithmetic: C-rate = charge kW ÷ battery kWh; ' +
            'range rate = (rated miles ÷ battery kWh) × charge kW ÷ 60 per minute, or without ' +
            'the ÷ 60 per hour; SoC rate = charge kW ÷ battery kWh × 100 ÷ 60; EPA range = ' +
            '(SoC ÷ 100) × the car’s rated miles; the “added” fields subtract the first ' +
            'reading in view. The optional range backfill matches each SoC to the range ' +
            'from the vehicle’s range test by linear interpolation.',
    },

    range: {
        title: 'About the Range & Efficiency chart',
        data_source:
            'Compares saved range tests (runs marked “has range”). Unlike the Charging ' +
            'chart, this uses each test’s summary numbers — distance driven, start and ' +
            'end state-of-charge, energy used (kWh), test speed and ambient temperature ' +
            '— not the second-by-second log. These are entered or uploaded per run. Bar ' +
            'views group runs by vehicle; line views plot one point per test against ' +
            'speed or temperature.',
        how_to_read:
            'Use it to compare how far cars go and how efficiently they use energy, side ' +
            'by side. When a test didn’t run the battery all the way down, the range bar ' +
            'shows a projected full-pack range (marked ⟳) rather than the miles actually ' +
            'driven. The Range-by-Speed and Range-by-Temperature line views show how ' +
            'range falls off as speed or cold rises. Toggle efficiency between mi/kWh ' +
            '(higher is better) and Wh/mi (lower is better).',
        key_terms:
            'Projected range — distance scaled up to a full 0–100% charge.\n' +
            'Efficiency — energy used per unit distance.\n' +
            'mi/kWh — miles per kilowatt-hour (higher is better).\n' +
            'Wh/mi — watt-hours per mile (lower is better).\n' +
            'SoC used — the test’s start % minus end %.',
        math_approach:
            'Projected range = miles driven × (100 ÷ percent of battery used); if start ' +
            'and end SoC aren’t recorded it falls back to the raw miles driven. ' +
            'Efficiency = distance ÷ energy for mi/kWh, or energy ÷ distance for Wh/mi. ' +
            'The projection assumes the car uses energy at the same average rate across ' +
            'the whole pack as it did during the tested segment — a simplification, not ' +
            'a guarantee.',
    },

    compare: {
        title: 'About the Charge Stop charts',
        data_source:
            'Answers two road-trip questions from your charging logs: how much range ' +
            'you’d add in a set number of minutes, and how long it takes to add a set ' +
            'amount of range — both starting from a common state-of-charge you choose. ' +
            'It reads the same time-series charging points (state-of-charge, time, range) ' +
            'used by the Charging chart. For each range test it uses that test’s own ' +
            'charging data when present, otherwise the vehicle’s default (or most recent) ' +
            'charging run.',
        how_to_read:
            'These charts put every car on equal footing — same starting state-of-charge, ' +
            'same target — so you can compare real-world fast-charging speed for trip ' +
            'planning. In “range added”, longer bars are better; in “time to add”, ' +
            'shorter bars are better. An amber pill warns when a bar relied on ' +
            'extrapolating beyond the logged data (e.g. the session didn’t actually start ' +
            'that low, or didn’t run long enough), so treat amber bars as rougher ' +
            'estimates.',
        key_terms:
            'Starting SoC — the common battery level all cars are normalized to.\n' +
            'Range added — miles gained in the chosen minutes.\n' +
            'Time to add — minutes to gain the chosen miles.\n' +
            'Interpolation — reading a value between two logged points.\n' +
            'Extrapolation — estimating past the ends of the logged data (flagged amber).',
        math_approach:
            'Linear interpolation between logged points. It finds the time and range at ' +
            'your starting SoC (extending backward if the log starts higher), then reads ' +
            'the range at “start time + X minutes”, or the time at “start range + M ' +
            'miles”. Range added = end range − start range; time to add = end time − ' +
            'start time. Estimates that run past the edge of the data are extrapolated ' +
            'along the last segment’s slope and flagged amber.',
    },

    epacurves: {
        title: 'About Modeled Efficiency for selected vehicles',
        data_source:
            'A theoretical efficiency-vs-speed curve built from a vehicle’s official EPA ' +
            'lab data — the road-load coefficients and test phases stored in the linked ' +
            'EPA test vehicle (from EPA’s CSI lab documents, the Test Car List, or curator ' +
            'entry). It is not plotted from your own driving tests; it’s computed from ' +
            'physics. The “confidence” badge shows how certain the link between the ' +
            'vehicle and the EPA test vehicle is, and a second badge names the curve’s ' +
            'tier — how much of the energy model is the vehicle’s own.',
        how_to_read:
            'Use it to see how a car’s energy use and range change with steady cruising ' +
            'speed, and to compare cars on the same physical basis regardless of ' +
            'marketing claims. The shaded band marks typical 65–75 mph highway speeds. ' +
            'Switch the Y axis between energy use (kWh/100mi, Wh/mi), efficiency (mi/kWh, ' +
            'MPGe) and estimated Range. Set the conditions — altitude, temperature ' +
            'and accessory load (the same sliders as the other charts, which always apply ' +
            'here) and wind and elevation change — to see how they move the curve; a ▲ on a ' +
            'label means a condition is applied. Turn on the real-world overlay to plot ' +
            'the vehicle’s own range tests as points, raw or corrected to the same ' +
            'conditions. With no conditions set it assumes flat ground, no wind, steady ' +
            'speed and a fixed accessory load — real trips with hills, weather and ' +
            'stop-and-go will differ.',
        key_terms:
            'Road-load (A, B, C) — the rolling, speed-proportional and aerodynamic resistance from EPA coast-down testing: Force = A + B·speed + C·speed².\n' +
            'η (drivetrain efficiency) — the share of battery energy that reaches the wheels, back-solved from the record’s 65 mph constant-speed phases.\n' +
            'Tier — how much of the model is the vehicle’s own: test cycle (η and capacity both measured), corrected (capacity measured, η borrowed from its highway phase), published pack (default η, guide capacity), road load only (no capacity, so consumption but not range).\n' +
            'MPGe — miles per gallon-equivalent (33.7 kWh = 1 gallon).\n' +
            'kWh/100mi, Wh/mi — energy used per distance.\n' +
            'Useable kWh — the battery capacity used for the range estimate.',
        math_approach:
            'At each speed: resistance Force = A + B·v + C·v²; wheel energy comes from ' +
            'that force; battery energy = wheel energy ÷ η + a fixed ~0.3 kW accessory ' +
            'draw ÷ speed. η is solved from the constant-speed phases at 65 mph, the ' +
            'same steady cruise the curve plots. A record with no constant-speed phase ' +
            'uses its highway η scaled by the fleet-median ratio between the two (the ' +
            '“corrected” tier), and failing that a 0.88 default. Range = useable ' +
            'battery kWh ÷ energy per mile. Altitude thins the air by scaling only the ' +
            'aerodynamic (C) term at display time; temperature, wind and grade adjust ' +
            'the curve for the conditions you set.',
    },

    roadtrip: {
        title: 'About the Road Trip chart',
        data_source:
            'Simulates a long-distance trip for each selected charging test. It combines ' +
            'that run’s real measured charging curve (the time-series charging points) ' +
            'with an efficiency (mi/kWh) derived from the vehicle’s range data — either ' +
            'directly (distance ÷ energy) or estimated from the SoC drop × battery size. ' +
            'You set the trip: total distance, travel speed, miles between charging stops ' +
            '(or a target charge time), start/min SoC, and a per-stop overhead. A dashed ' +
            'gray line models a gas car for comparison: the car picked in the sidebar, the same one ' +
            'Cost & Time uses, labeled with its name (“Your gas car” until you pick or name one).',
        how_to_read:
            'Read it as a race against the clock (and against gas). The default view plots ' +
            'distance covered vs elapsed time; flat steps are charging stops, and each ' +
            'car’s total trip time — and how it compares to the gas car — is labeled at the ' +
            'finish. You can also chart cumulative charge time or per-car SoC “lanes”; the ' +
            'Trip Optimizer tab searches travel speed and stop plan for the sweet spot. Because ' +
            'charging follows each car’s actual curve, a faster-charging car can win a long ' +
            'trip even with less range. Cars that can’t finish (battery depleted, or a stop ' +
            'would need >95% charge) are dropped.',
        key_terms:
            'SoC — battery %.\n' +
            'mi/kWh — driving efficiency.\n' +
            'Leg / distance between charges — how far you drive before each stop.\n' +
            'Overhead — the extra minutes off the route for each charging stop (park, plug in, break). ' +
            'A gas stop has none: its fill-up minutes are already its whole time off the route.\n' +
            'The gas car — the one picked under Your gas car, set once for here and Cost & Time. ' +
            'It stops when its tank runs down to the fill-up level, and each stop takes the fill-up’s ' +
            'minutes, the total time off the route with nothing added. This chart times it; it ' +
            'prices no fuel.\n' +
            'Charge stop — modeled from the real charging curve between your start and minimum SoC.',
        math_approach:
            'For each car it steps through drive legs and charge stops: a leg drains the ' +
            'battery at the speed-corrected efficiency; a stop adds energy by following the ' +
            'measured charging curve for the set time (or until there’s enough range for ' +
            'the next leg). Efficiency is scaled for travel speed (faster = less ' +
            'efficient). Trip time = driving time + charging time + per-stop overhead. The ' +
            'gas car line drives its tank down to the fill-up level at its highway mpg (cut for ' +
            'cold when the trip is corrected to a temperature under 75°F), then stops for its ' +
            'fill-up minutes (the total time off the route). It’s a model — real ' +
            'charger availability, weather and traffic will vary.',
    },

    optimizer: {
        title: 'About the Trip Optimizer',
        data_source:
            'The Road Trip simulation, run over a grid of plans instead of one: every ' +
            'travel speed from 45 to 100 mph against every stop plan — the distance each ' +
            'stop adds (Fixed charging range) or the minutes it lasts (Fixed charge time). ' +
            'Each car uses its real measured charging curve and the efficiency from its ' +
            'range data, re-priced for each speed. The trip defaults to 700 mi, long enough ' +
            'for several stops: on a short trip the answer is mostly where one stop lands.',
        how_to_read:
            'Travel speed and Charge per stop plot trip time against one setting. With ' +
            'the checkbox under X on (“Optimize leg distance” on Travel speed, “Optimize ' +
            'speed” on Charge per stop), each point uses the best value of the other ' +
            'setting, so the lowest point of a line is that car’s best trip; off, the other ' +
            'setting is held at what you entered. On a fast charger the fastest plan is ' +
            'often a speed nobody should drive, so the fastest legal plan keeps to the legal range ' +
            'you set under Your plan (55–80 mph to start) and the fastest is shown apart, labeled as such. ' +
            'The table names each car’s fastest legal plan, the charge window it implies (arrive ' +
            'at, leave with), what it saves over your own plan, and every plan within 2% ' +
            'of its trip time — the optimum is usually broad, and the span is the useful ' +
            'answer. The Map shows one car’s whole grid: more saturated is faster, speeds outside ' +
            'your legal range are dimmed, ★ is the fastest plan, ◆ the fastest within your legal range ' +
            '(Fastest legal), the outline every plan no more than 2% slower than ◆ at any speed, ' +
            'and ○ yours; each carries its figure beside it.',
        key_terms:
            'Fastest — the quickest plan on the whole grid, whatever the speed.\n' +
            'Fastest legal — the quickest plan within your legal range.\n' +
            'Charge window — the average SoC the car arrives at a stop with, and leaves with.\n' +
            'Within 2% — every plan whose trip is no more than 2% slower than the fastest legal plan: about 14 minutes on a 700 mi trip.\n' +
            'Average speed — trip distance ÷ total time, stops included.',
        math_approach:
            'Each cell is one full trip simulation (see Road Trip). Speeds step by 1 mph, ' +
            'stop distances by 10 mi and stop times by 2.5 minutes; a plan that would charge ' +
            'past 95% or cannot finish is left blank. The fastest legal plan is the fastest cell in your legal range — ' +
            'within the grid’s steps, so read it to the nearest step, not exactly. The ' +
            'charge-per-stop axis ends at the longest stop a full charge from your Min SoC ' +
            'to 95% can use: past it every plan is blank or the same trip as the row below.',
    },

    drivecost: {
        title: 'About Compare',
        data_source:
            'Prices the week you set on Your Driving (or in the sidebar) for each selected ' +
            'vehicle, and the same week in your gas car. Highway miles are priced from ' +
            'EVBench’s range tests, corrected to your speed, season and elevation; city ' +
            'miles from the EPA highway figure, corrected the same way. A car with no ' +
            'range test is priced from EPA for both, and says so. Fast-stop minutes come ' +
            'from the car’s own charging curve where EVBench has one.',
        how_to_read:
            'Each card gives a car’s two answers against your gas car: what it saves (or ' +
            'costs) a month, and the time it adds (or saves) a month, with its fast stops. Everything here is a month: the simulated week × 52 ÷ 12. The first chart stacks ' +
            'home charging (solid) and fast charging (striped) per car beside the gas bill; the second sets fast-charging ' +
            'minutes against fill-up minutes. Months are for the season shown; the card’s ' +
            'year line blends winter months with summer ones. Winter is a floor: denser air ' +
            'and cabin heat are priced, battery warming and cold tires are not. The gas car ' +
            'loses mpg in the cold too: about 15% city and 7% highway at 20°F, none from 75°F up.',
        key_terms:
            'Fast stop — a stop on the route, when a day runs short of home charging.\n' +
            'Stop to charge by — the battery level a stop is made at.\n' +
            'Charge no higher than — where a stop ends, stretched to 80% when that saves a second stop.\n' +
            'Keep battery above — the floor the whole day stays over.\n' +
            'Planned fast charge — a day you fast charge anyway, topping up to the cap.',
        math_approach:
            'The week is simulated hour by hour, three times over so Monday starts from a ' +
            'settled battery, and the third week is reported. Home charging is the lesser ' +
            'of your charger and the car’s onboard charger, through the window you plug in, ' +
            'with charger losses. A stop’s minutes are the curve’s, plus the detour and the ' +
            'time to start and pay; fast energy is bought with its charging loss. A month is ' +
            'the week × 52 ÷ 12.',
    },

    driveplan: {
        title: 'About the Weekly Charging Plan',
        data_source:
            'One selected vehicle through the week you set on Your Driving (or in the ' +
            'sidebar), priced the same way as Compare: highway miles from EVBench’s ' +
            'range tests, city miles from the EPA highway figure, both corrected to your ' +
            'speed, season and elevation; fast-stop minutes from the car’s own charging ' +
            'curve where EVBench has one.',
        how_to_read:
            'Pick the chart above it. "Day by day" goes in time order. Each day’s gray bar ' +
            'is the day out, from that morning’s battery (the tick) to where the car ' +
            'gets home. A fast stop on the route sits inside it, striped orange, at the ' +
            'levels it charged between; a planned fast charge is solid orange. The bar in ' +
            'the car’s color is the night at home, up to the next morning, where a dashed ' +
            'line hands over to the next day. The gray bar is how far the battery fell, so ' +
            'a day with a stop used more than it shows; hover a day for both. "Charge in and ' +
            'used" draws the same figures from zero: charge in above, driving below.\n' +
            '"The week as a line" is range left, in miles on the left and the battery’s percent on the ' +
            'right, from Monday midnight to Sunday night. It falls as you drive and climbs ' +
            'at home overnight. Each orange band is a fast stop, labeled with its minutes ' +
            '(detour and time to start and pay in); a lighter one is a planned fast charge. ' +
            'The dashed lines at 10% and 80% mark the everyday range. Under the chart, ' +
            'the week as a table, a column a day: the fast-charging rows (stops, time, ' +
            'cost) are outlined in orange, and "Ready at" gives the time the night filled ' +
            'the battery, or the end of your plug-in window when it ran out. Compare with the other ' +
            'season or another home charger in a second chart below, and open your gas ' +
            'car’s week to see its fill-ups.',
        key_terms:
            'Fast stop — a stop on the route, when a day runs short of home charging.\n' +
            'Planned fast charge — a day you fast charge anyway; skipped when already above the cap.\n' +
            'Home adds — what the night’s window put back, through your charger and the car’s onboard charger.\n' +
            'Ready at — where the battery stands when the next day starts.',
        math_approach:
            'Three weeks are simulated and the third shown, so Monday starts from what ' +
            'Sunday night left. Long days drive 7 am to 6 pm, ordinary days an hour each ' +
            'way. A stop is made at “stop to charge by” (later, when the day starts below ' +
            'it) and adds enough to finish the day above “keep battery above”. Range in ' +
            'miles is the week’s miles per percent of battery, detours in.',
    },

    drivecharger: {
        title: 'About Home Charger',
        data_source:
            'The week you set on Your Driving, priced for each selected vehicle at every ' +
            'home charger level, everything else as you set it. Priced the same way as ' +
            'the Compare sub-tab.',
        how_to_read:
            'The Cost chart: each column is what a car costs a month with that charger at home (the week × 52 ÷ 12, as on Compare): home ' +
            'charging underneath in its color, fast charging on top striped in it over a muted ' +
            'shade, the total over it, and the home figure on the home part when there is fast charging too. The faster the charger, the more the night ' +
            'covers and the smaller the fast part. The Time chart switches the same figures to minutes: one column a car, ' +
            'its fast charging per month at each charger (home charging is overnight, so it is not counted). The table has a column a charger and, ' +
            'for each car, its minutes of fast charging and its home, fast and total cost ' +
            'per month. The bold orange cell is “enough from here”: the smallest charger past ' +
            'which a bigger one saves less than five minutes a week (about 20 a month). A ^ means the car’s own ' +
            'onboard charger, not the wall, sets the pace, so a bigger charger buys nothing.',
        key_terms:
            'Home charger — 120 V on a wall outlet, or 240 V at the amps the circuit allows.\n' +
            'Onboard charger — the car’s own AC charger; it limits how fast any home charger can fill it.\n' +
            'Enough from here — where a bigger charger stops making a difference you would notice.',
        math_approach:
            'Power at home is the lesser of volts × amps and the car’s onboard charger ' +
            '(11.5 kW assumed when the spec is blank), with charger losses: at 240 V the car’s ' +
            'own EPA certification figure where it has one, else the site-wide one; on a 120 V ' +
            'outlet that scaled down to 80% for a car at the site-wide figure. Each level runs ' +
            'the whole week simulation again. Winter below 40°F, parked outside, costs more than ' +
            'shown: the car warms its battery before it charges, which is not priced.',
    },

    perfcompare: {
        title: 'About the Performance Compare chart',
        data_source:
            'Ranks the selected vehicles on one acceleration or braking metric, using ' +
            'every tested figure EVBench holds for them. Two kinds of figure rank ' +
            'together: results derived here from an imported testing session, and ' +
            'results entered from a published source. Manufacturer claims are not ' +
            'included — a marketing number is not a test result.',
        how_to_read:
            'Each bar is the best tested figure for that vehicle and names the source ' +
            'that produced it. A ✦ marks figures EVBench holds the full run data for, ' +
            'which are derived from that data rather than quoted; the tooltip then adds ' +
            'the drive mode, how many comparable runs back it, and the spread between ' +
            'them. Where several sources have tested the same car, the tooltip says so — ' +
            'the bar shows the quickest. Vehicles with no tested figure are listed under ' +
            'the chart rather than dropped, so a missing bar doesn’t read as a slow car.',
        key_terms:
            'Tested — somebody ran the car and timed it, whether or not we hold the trace.\n' +
            'Full data (✦) — the underlying run data is stored here, so the figure is derived, not quoted.\n' +
            'No rollout vs 1 ft — two 0–60 conventions about 0.3 s apart; not interchangeable.\n' +
            'Speed window — a from/to speed pair, e.g. 75–0 mph braking or 50–90 mph passing.\n' +
            'Average rate (g) — the window expressed as an average acceleration.',
        math_approach:
            'Session-backed figures take the best run and report the spread across ' +
            'comparable runs in the same drive mode; nothing is averaged across drive ' +
            'modes, and a figure resting on one run or a run taken on a grade is ' +
            'flagged. Published figures are used as given. Braking distances are ' +
            'converted to a common unit for ranking but displayed as reported. Average ' +
            'rate is Δv/Δt for timed windows and (v₁²−v₂²)/2d for braking.',
    },

    perfcurve: {
        title: 'About the Acceleration Curve',
        data_source:
            'Plots speed against elapsed time from the split times recorded in an ' +
            'imported testing CSV (0–10, 0–20, … 0–60). Only vehicles with imported ' +
            'detail data appear — a reported 0–60 figure on its own carries no trace, ' +
            'and no curve is invented for it.',
        how_to_read:
            'Each line is one run. By default the quickest run per drive mode is shown, ' +
            'because a session is usually eight launches and plotting all of them buries ' +
            'the comparison that matters — what each drive mode actually costs you. Tick ' +
            '“Show every run” to see run-to-run consistency instead. A line that is ' +
            'steeper early is quicker off the line; lines converging at the top mean the ' +
            'difference was all in the launch.',
        key_terms:
            'Split — a recorded time to reach a given speed.\n' +
            'Drive mode — the vehicle setting under test, e.g. a launch mode versus a comfort mode.\n' +
            'Elapsed time — seconds from a standing start.',
        math_approach:
            'The recorded splits drawn as-is, with a zero point added at the origin since ' +
            'every launch starts from rest and exports omit it. The 1 ft-rollout split is ' +
            'excluded — it is the same 60 mph point measured a different way, and would ' +
            'double back on the curve. No smoothing or curve-fitting beyond line tension.',
    },

    specstable: {
        title: 'About the Vehicle Table',
        data_source:
            'Every vehicle, one row each. Spec columns read each vehicle’s spec sheet ' +
            'through inheritance — published figures, not values measured by EVBench. ' +
            'Battery and EPA range are the resolved figures, each with its basis. Tested ' +
            'columns show the best published or EVBench result, with the source that set it.',
        how_to_read:
            'Tick a vehicle to select it: it joins the band at the top and appears on every ' +
            'chart. Sort by any column, filter by make, year, drive or tag, and choose and ' +
            'order columns from the Columns menu. Bars appear only where more or less is ' +
            'plainly better. Click a row to see its full specs and to vouch for or flag a value.',
        key_terms:
            'Basis — where a resolved figure came from: EPA tested, Usable, Gross, an EPA label, an Expected EPA Range.\n' +
            'Tested — the best published or EVBench result; the source is named beneath it.\n' +
            'Bar cell — a figure drawn against the longest or largest among the rows shown.\n' +
            'Units follow your imperial/metric toggle.',
        math_approach:
            'No calculation beyond picking the best tested result per metric and unit conversion ' +
            '(e.g. in↔mm, mi↔km). Bars scale against the filtered rows.',
    },

    specs: {
        title: 'About the Spec Chart',
        data_source:
            'One field of the vehicle table plotted across the selected vehicles. It reads ' +
            'the table’s own figures — specs, resolved battery and EPA range, tested results ' +
            'and the calculated fields — so a bar is the number its table cell shows, under ' +
            'the same correction and assumptions. Pick any field in the sidebar, or click the ' +
            'chart icon on a field header in the table.',
        how_to_read:
            'One bar per vehicle for the chosen field, so you can rank them at a glance. ' +
            'Numeric fields are drawn to scale with the value shown inside the bar; yes/no and ' +
            'text fields give every vehicle an equal-height bar with its value printed ' +
            'inside. A vehicle with no value for the field is not drawn, and a note under the ' +
            'chart says how many were left out.',
        key_terms:
            'Field — one of the figures the vehicle table offers, in the same groups as its field picker.\n' +
            'Assumptions — the inputs behind calculated fields (charge window, stop distance, prices); ' +
            'the same ones the table uses, in the sidebar when a plotted field needs them.\n' +
            'Units follow your imperial/metric toggle.',
        math_approach:
            'No calculation of its own — it plots what the table computes, converting units ' +
            'for display only (e.g. kW↔hp, mi↔km). Bars show the raw values from zero.',
    },

    specscatter: {
        title: 'About the Spec Scatter chart',
        data_source:
            'Plots two numeric fields of the vehicle table against each other — one dot per ' +
            'selected vehicle — to reveal relationships (e.g. battery size vs range, power vs ' +
            'price). Both axes are the table’s own figures; only numeric fields are offered.',
        how_to_read:
            'Each dot is a vehicle (X = one field, Y = another); the dashed gray line is a ' +
            'best-fit trend across all plotted vehicles. Use it to spot correlations and ' +
            'outliers — a car well above the line is doing better than its peers on the Y ' +
            'field for its X value. Vehicles missing either value aren’t plotted; a note ' +
            'under the chart says how many.',
        key_terms:
            'Trend line — a least-squares straight-line fit through the dots.\n' +
            'Outlier — a vehicle far from the trend.\n' +
            'Correlation — how tightly the dots track the line.\n' +
            'Axes are numeric fields only; units follow your imperial/metric toggle.',
        math_approach:
            'Dots are the table’s values (unit-converted for display). The trend line ' +
            'is an ordinary least-squares regression (the slope and intercept that ' +
            'minimize squared vertical error), drawn from the lowest to the highest X. ' +
            'It’s descriptive only — it doesn’t imply causation, and a few vehicles can ' +
            'swing the slope.',
    },
};

/** Merge a DB row (possibly partial/missing) over the bundled default. */
export function resolveChartHelp(chartKey, dbRow) {
    const fallback = CHART_HELP_DEFAULTS[chartKey] || {};
    if (!dbRow) return fallback;
    const merged = { ...fallback };
    for (const { key } of CHART_HELP_FIELDS) {
        const v = dbRow[key];
        if (v != null && String(v).trim() !== '') merged[key] = v;
    }
    return merged;
}
