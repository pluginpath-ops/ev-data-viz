/**
 * Chart help / "About this chart" copy.
 *
 * Layman-friendly explanations shown in the collapsible ℹ️ bubble at the bottom
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
        title: 'About the Charging chart',
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
            'Range Rate — miles of range gained per minute.\n' +
            'SoC Added / Range Added — change since the start of the plotted window.\n' +
            'Range – EPA vs Range – Tested — EPA-rated range projected from SoC, vs the range actually logged in the test.',
        math_approach:
            'Mostly the raw measured points drawn as-is — no smoothing or curve-fitting. ' +
            'The computed fields are simple arithmetic: C-rate = charge kW ÷ battery kWh; ' +
            'range rate = (rated miles ÷ battery kWh) × charge kW ÷ 60; EPA range = ' +
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
        title: 'About the Charge Compare charts',
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
        title: 'About the EPA Curves chart',
        data_source:
            'A theoretical efficiency-vs-speed curve built from a vehicle’s official EPA ' +
            'lab data — the road-load coefficients and test phases stored in the linked ' +
            'EPA test group (imported from EPA’s CSI lab documents). It is not plotted ' +
            'from your own driving tests; it’s computed from physics. The “confidence” ' +
            'badge shows how certain the link between the vehicle and the EPA test group ' +
            'is.',
        how_to_read:
            'Use it to see how a car’s energy use and range change with steady cruising ' +
            'speed, and to compare cars on the same physical basis regardless of ' +
            'marketing claims. The shaded band marks typical 65–75 mph highway speeds. ' +
            'Switch the Y axis between energy use (kWh/100mi, Wh/mi), efficiency (mi/kWh, ' +
            'MPGe) and estimated Range. It assumes flat ground, no wind, steady speed and ' +
            'a fixed accessory load — real trips with hills, weather and stop-and-go will ' +
            'differ.',
        key_terms:
            'Road-load (A, B, C) — the rolling, speed-proportional and aerodynamic resistance from EPA coast-down testing: Force = A + B·speed + C·speed².\n' +
            'η (drivetrain efficiency) — the share of battery energy that reaches the wheels, back-solved from the EPA highway test.\n' +
            'MPGe — miles per gallon-equivalent (33.7 kWh = 1 gallon).\n' +
            'kWh/100mi, Wh/mi — energy used per distance.\n' +
            'Useable kWh — the battery capacity used for the range estimate.',
        math_approach:
            'At each speed: resistance Force = A + B·v + C·v²; wheel energy comes from ' +
            'that force; battery energy = wheel energy ÷ η + a fixed ~0.3 kW accessory ' +
            'draw ÷ speed. η is solved so the curve matches the car’s measured EPA ' +
            'highway energy at 48.3 mph (preferring the multi-cycle test, falling back to ' +
            'the highway test, then a 0.88 default). Range = useable battery kWh ÷ energy ' +
            'per mile. Altitude, when set, thins the air by scaling only the aerodynamic ' +
            '(C) term at display time.',
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
            'grey “ICE Reference” line models a gas car for comparison.',
        how_to_read:
            'Read it as a race against the clock (and against gas). The default view plots ' +
            'distance covered vs elapsed time; flat steps are charging stops, and each ' +
            'car’s total trip time — and how it compares to ICE — is labelled at the ' +
            'finish. You can also chart cumulative charge time, per-car SoC “lanes”, or ' +
            'sweep travel speed / distance-between-stops to find the sweet spot. Because ' +
            'charging follows each car’s actual curve, a faster-charging car can win a long ' +
            'trip even with less range. Cars that can’t finish (battery depleted, or a stop ' +
            'would need >95% charge) are dropped.',
        key_terms:
            'SoC — battery %.\n' +
            'mi/kWh — driving efficiency.\n' +
            'Leg / distance between charges — how far you drive before each stop.\n' +
            'Overhead — fixed minutes added per stop (park, plug in, break).\n' +
            'ICE Reference — a gas car driving 3-hour legs with the same per-stop overhead.\n' +
            'Charge stop — modelled from the real charging curve between your start and minimum SoC.',
        math_approach:
            'For each car it steps through drive legs and charge stops: a leg drains the ' +
            'battery at the speed-corrected efficiency; a stop adds energy by following the ' +
            'measured charging curve for the set time (or until there’s enough range for ' +
            'the next leg). Efficiency is scaled for travel speed (faster = less ' +
            'efficient). Trip time = driving time + charging time + per-stop overhead. The ' +
            'ICE line drives fixed 3-hour legs with the same overhead. It’s a model — real ' +
            'charger availability, weather and traffic will vary.',
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
        title: 'About Compare Specs',
        data_source:
            'A side-by-side table of every structured spec for the selected vehicles, ' +
            'read from each vehicle’s spec sheet (the `specs` data on the vehicle record, ' +
            'including custom fields). These are published figures — manufacturer claims ' +
            'and road-test results cited from elsewhere — not values measured by EVBench.',
        how_to_read:
            'One column per selected vehicle, one row per spec, grouped by category. ' +
            'Blank cells mean the value hasn’t been entered for that vehicle. Community ' +
            'members can vouch for a value’s accuracy or flag it as suspect; flagged ' +
            'fields are highlighted until an admin clears them.',
        key_terms:
            'Spec — a structured attribute on the vehicle (battery kWh, horsepower, seats, …).\n' +
            'Custom field — a free-form spec added outside the standard schema.\n' +
            'Vouch / flag — community accuracy signals on an individual value.\n' +
            'Units follow your imperial/metric toggle.',
        math_approach:
            'No calculation — values are shown as stored, converted only for unit display ' +
            '(e.g. kW↔hp, mi↔km).',
    },

    specs: {
        title: 'About the Spec Chart',
        data_source:
            'A simple side-by-side bar comparison of one spec across the selected ' +
            'vehicles. Values come from each vehicle’s structured spec sheet (the `specs` ' +
            'data on the vehicle record, including any custom fields) — not from test ' +
            'data. Pick any field from the dropdown.',
        how_to_read:
            'One bar per vehicle for the chosen spec, so you can rank them at a glance. ' +
            'Numeric specs (battery, power, price…) are drawn to scale with the value ' +
            'shown inside the bar; yes/no specs show a green “Yes” or red “No”; text specs ' +
            '(e.g. drivetrain) just show the label. A grey stub means the value is missing ' +
            'for that vehicle.',
        key_terms:
            'Spec — a structured attribute on the vehicle (battery kWh, horsepower, seats, …).\n' +
            'Numeric / boolean / text — the three value types, drawn differently.\n' +
            'Units follow your imperial/metric toggle.',
        math_approach:
            'No calculation — it reads the stored spec value and converts units for ' +
            'display only (e.g. kW↔hp, mi↔km). Bars show the raw values; missing values ' +
            'are drawn as a small grey stub.',
    },

    specscatter: {
        title: 'About the Spec Scatter chart',
        data_source:
            'Plots two numeric specs against each other — one dot per selected vehicle — ' +
            'to reveal relationships (e.g. battery size vs range, power vs price). Both ' +
            'axes come from the vehicles’ structured spec sheets (`specs`); only numeric ' +
            'fields are offered.',
        how_to_read:
            'Each dot is a vehicle (X = one spec, Y = another); the dashed grey line is a ' +
            'best-fit trend across all plotted vehicles. Use it to spot correlations and ' +
            'outliers — a car well above the line is doing better than its peers on the Y ' +
            'spec for its X value. Vehicles missing either value aren’t plotted.',
        key_terms:
            'Trend line — a least-squares straight-line fit through the dots.\n' +
            'Outlier — a vehicle far from the trend.\n' +
            'Correlation — how tightly the dots track the line.\n' +
            'Axes are numeric specs only; units follow your imperial/metric toggle.',
        math_approach:
            'Dots are the stored spec values (unit-converted for display). The trend line ' +
            'is an ordinary least-squares regression (the slope and intercept that ' +
            'minimise squared vertical error), drawn from the lowest to the highest X. ' +
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
