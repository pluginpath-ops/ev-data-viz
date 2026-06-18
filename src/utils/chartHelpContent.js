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
            'SoC (State of Charge) — how full the battery is, 0–100%. ' +
            'Charge Rate (kW) — power flowing into the battery right now. ' +
            'C-rate — charge power ÷ battery size (kW ÷ kWh); ~1C means adding roughly a ' +
            'full pack in an hour, regardless of car size. ' +
            'Range Rate — miles of range gained per minute. ' +
            'SoC Added / Range Added — change since the start of the plotted window. ' +
            'Range – EPA vs Range – Tested — EPA-rated range projected from SoC, vs the ' +
            'range actually logged in the test.',
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
            'Projected range — distance scaled up to a full 0–100% charge. ' +
            'Efficiency — energy used per unit distance. ' +
            'mi/kWh — miles per kilowatt-hour (higher is better). ' +
            'Wh/mi — watt-hours per mile (lower is better). ' +
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
            'Starting SoC — the common battery level all cars are normalized to. ' +
            'Range added — miles gained in the chosen minutes. ' +
            'Time to add — minutes to gain the chosen miles. ' +
            'Interpolation — reading a value between two logged points. ' +
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
            'Road-load (A, B, C) — the rolling, speed-proportional and aerodynamic ' +
            'resistance from EPA coast-down testing: Force = A + B·speed + C·speed². ' +
            'η (drivetrain efficiency) — the share of battery energy that reaches the ' +
            'wheels, back-solved from the EPA highway test. ' +
            'MPGe — miles per gallon-equivalent (33.7 kWh = 1 gallon). ' +
            'kWh/100mi, Wh/mi — energy used per distance. ' +
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
