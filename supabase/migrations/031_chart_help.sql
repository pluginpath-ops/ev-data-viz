-- Migration 031: Chart help / "About this chart" copy
--
-- Backs the collapsible ℹ️ "About this chart" bubble at the bottom of each
-- Charts sub-tab with admin/contributor-editable text. One row per chart, keyed
-- by a stable `chart_key`. Four content fields per the original brief: what data
-- & where from, why/how to read, key terms & units, and the high-level math.
--
-- RLS mirrors `manufacturers` (010): public read; insert/update for
-- admin+contributor; delete admin-only.
--
-- The seed below mirrors the bundled fallback in src/utils/chartHelpContent.js
-- (the app falls back to that copy when a row is missing). Dollar-quoted strings
-- ($help$…$help$) so apostrophes need no escaping.

CREATE TABLE chart_help (
    chart_key     text PRIMARY KEY,
    title         text,
    data_source   text,
    how_to_read   text,
    key_terms     text,
    math_approach text,
    updated_at    timestamptz DEFAULT now(),
    updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE chart_help ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read chart_help"
    ON chart_help FOR SELECT USING (true);

CREATE POLICY "Contributors can insert chart_help"
    ON chart_help FOR INSERT
    WITH CHECK (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Contributors can update chart_help"
    ON chart_help FOR UPDATE
    USING (current_user_role() IN ('admin', 'contributor'));

CREATE POLICY "Admins can delete chart_help"
    ON chart_help FOR DELETE
    USING (current_user_role() = 'admin');

-- ── Seed ────────────────────────────────────────────────────────────────────

INSERT INTO chart_help (chart_key, title, data_source, how_to_read, key_terms, math_approach) VALUES
(
    'charging',
    $help$About the Charging chart$help$,
    $help$Plots the time-series readings from your saved charging tests — the log uploaded from a CSV or Tableau export of a real charging session. Each reading stores state-of-charge, elapsed time, charge power, range and temperature (the data points attached to a run marked “has charging”). Pick any field for each axis. A few fields are computed on the fly rather than stored: C-rate, range rate, SoC added, range added and EPA-rated range. If a charging run has no range column, range is filled in from the vehicle’s default range test by matching state-of-charge.$help$,
    $help$Each line is one charging session. Use it to see how fast a car charges and how that changes as the battery fills — for most EVs charge power is highest at a low state-of-charge and tapers as the pack fills. The classic view is Charge Rate (kW) vs State of Charge. Turn on the right-hand (Y2) axis to overlay a second measure, e.g. rate plus range added. “Race mode” (available when the X axis is Time) lines runs up at a common starting state-of-charge so you can compare them head-to-head from the same point.$help$,
    $help$SoC (State of Charge) — how full the battery is, 0–100%.
Charge Rate (kW) — power flowing into the battery right now.
C-rate — charge power ÷ battery size (kW ÷ kWh); ~1C ≈ adding a full pack in an hour, regardless of car size.
Range Rate — miles of range gained per minute.
SoC Added / Range Added — change since the start of the plotted window.
Range – EPA vs Range – Tested — EPA-rated range projected from SoC, vs the range actually logged in the test.$help$,
    $help$Mostly the raw measured points drawn as-is — no smoothing or curve-fitting. The computed fields are simple arithmetic: C-rate = charge kW ÷ battery kWh; range rate = (rated miles ÷ battery kWh) × charge kW ÷ 60; EPA range = (SoC ÷ 100) × the car’s rated miles; the “added” fields subtract the first reading in view. The optional range backfill matches each SoC to the range from the vehicle’s range test by linear interpolation.$help$
),
(
    'range',
    $help$About the Range & Efficiency chart$help$,
    $help$Compares saved range tests (runs marked “has range”). Unlike the Charging chart, this uses each test’s summary numbers — distance driven, start and end state-of-charge, energy used (kWh), test speed and ambient temperature — not the second-by-second log. These are entered or uploaded per run. Bar views group runs by vehicle; line views plot one point per test against speed or temperature.$help$,
    $help$Use it to compare how far cars go and how efficiently they use energy, side by side. When a test didn’t run the battery all the way down, the range bar shows a projected full-pack range (marked ⟳) rather than the miles actually driven. The Range-by-Speed and Range-by-Temperature line views show how range falls off as speed or cold rises. Toggle efficiency between mi/kWh (higher is better) and Wh/mi (lower is better).$help$,
    $help$Projected range — distance scaled up to a full 0–100% charge.
Efficiency — energy used per unit distance.
mi/kWh — miles per kilowatt-hour (higher is better).
Wh/mi — watt-hours per mile (lower is better).
SoC used — the test’s start % minus end %.$help$,
    $help$Projected range = miles driven × (100 ÷ percent of battery used); if start and end SoC aren’t recorded it falls back to the raw miles driven. Efficiency = distance ÷ energy for mi/kWh, or energy ÷ distance for Wh/mi. The projection assumes the car uses energy at the same average rate across the whole pack as it did during the tested segment — a simplification, not a guarantee.$help$
),
(
    'compare',
    $help$About the Charge Compare charts$help$,
    $help$Answers two road-trip questions from your charging logs: how much range you’d add in a set number of minutes, and how long it takes to add a set amount of range — both starting from a common state-of-charge you choose. It reads the same time-series charging points (state-of-charge, time, range) used by the Charging chart. For each range test it uses that test’s own charging data when present, otherwise the vehicle’s default (or most recent) charging run.$help$,
    $help$These charts put every car on equal footing — same starting state-of-charge, same target — so you can compare real-world fast-charging speed for trip planning. In “range added”, longer bars are better; in “time to add”, shorter bars are better. An amber pill warns when a bar relied on extrapolating beyond the logged data (e.g. the session didn’t actually start that low, or didn’t run long enough), so treat amber bars as rougher estimates.$help$,
    $help$Starting SoC — the common battery level all cars are normalized to. Range added — miles gained in the chosen minutes. Time to add — minutes to gain the chosen miles. Interpolation — reading a value between two logged points. Extrapolation — estimating past the ends of the logged data (flagged amber).$help$,
    $help$Linear interpolation between logged points. It finds the time and range at your starting SoC (extending backward if the log starts higher), then reads the range at “start time + X minutes”, or the time at “start range + M miles”. Range added = end range − start range; time to add = end time − start time. Estimates that run past the edge of the data are extrapolated along the last segment’s slope and flagged amber.$help$
),
(
    'epacurves',
    $help$About the EPA Curves chart$help$,
    $help$A theoretical efficiency-vs-speed curve built from a vehicle’s official EPA lab data — the road-load coefficients and test phases stored in the linked EPA test group (imported from EPA’s CSI lab documents). It is not plotted from your own driving tests; it’s computed from physics. The “confidence” badge shows how certain the link between the vehicle and the EPA test group is.$help$,
    $help$Use it to see how a car’s energy use and range change with steady cruising speed, and to compare cars on the same physical basis regardless of marketing claims. The shaded band marks typical 65–75 mph highway speeds. Switch the Y axis between energy use (kWh/100mi, Wh/mi), efficiency (mi/kWh, MPGe) and estimated Range. It assumes flat ground, no wind, steady speed and a fixed accessory load — real trips with hills, weather and stop-and-go will differ.$help$,
    $help$Road-load (A, B, C) — the rolling, speed-proportional and aerodynamic resistance from EPA coast-down testing: Force = A + B·speed + C·speed². η (drivetrain efficiency) — the share of battery energy that reaches the wheels, back-solved from the EPA highway test. MPGe — miles per gallon-equivalent (33.7 kWh = 1 gallon). kWh/100mi, Wh/mi — energy used per distance. Useable kWh — the battery capacity used for the range estimate.$help$,
    $help$At each speed: resistance Force = A + B·v + C·v²; wheel energy comes from that force; battery energy = wheel energy ÷ η + a fixed ~0.3 kW accessory draw ÷ speed. η is solved so the curve matches the car’s measured EPA highway energy at 48.3 mph (preferring the multi-cycle test, falling back to the highway test, then a 0.88 default). Range = useable battery kWh ÷ energy per mile. Altitude, when set, thins the air by scaling only the aerodynamic (C) term at display time.$help$
),
(
    'roadtrip',
    $help$About the Road Trip chart$help$,
    $help$Simulates a long-distance trip for each selected charging test. It combines that run’s real measured charging curve (the time-series charging points) with an efficiency (mi/kWh) derived from the vehicle’s range data — either directly (distance ÷ energy) or estimated from the SoC drop × battery size. You set the trip: total distance, travel speed, miles between charging stops (or a target charge time), start/min SoC, and a per-stop overhead. A dashed grey “ICE Reference” line models a gas car for comparison.$help$,
    $help$Read it as a race against the clock (and against gas). The default view plots distance covered vs elapsed time; flat steps are charging stops, and each car’s total trip time — and how it compares to ICE — is labelled at the finish. You can also chart cumulative charge time, per-car SoC “lanes”, or sweep travel speed / distance-between-stops to find the sweet spot. Because charging follows each car’s actual curve, a faster-charging car can win a long trip even with less range. Cars that can’t finish (battery depleted, or a stop would need >95% charge) are dropped.$help$,
    $help$SoC — battery %. mi/kWh — driving efficiency. Leg / distance between charges — how far you drive before each stop. Overhead — fixed minutes added per stop (park, plug in, break). ICE Reference — a gas car driving 3-hour legs with the same per-stop overhead. Charge stop — modelled from the real charging curve between your start and minimum SoC.$help$,
    $help$For each car it steps through drive legs and charge stops: a leg drains the battery at the speed-corrected efficiency; a stop adds energy by following the measured charging curve for the set time (or until there’s enough range for the next leg). Efficiency is scaled for travel speed (faster = less efficient). Trip time = driving time + charging time + per-stop overhead. The ICE line drives fixed 3-hour legs with the same overhead. It’s a model — real charger availability, weather and traffic will vary.$help$
),
(
    'specs',
    $help$About the Spec Chart$help$,
    $help$A simple side-by-side bar comparison of one spec across the selected vehicles. Values come from each vehicle’s structured spec sheet (the `specs` data on the vehicle record, including any custom fields) — not from test data. Pick any field from the dropdown.$help$,
    $help$One bar per vehicle for the chosen spec, so you can rank them at a glance. Numeric specs (battery, power, price…) are drawn to scale with the value shown inside the bar; yes/no specs show a green “Yes” or red “No”; text specs (e.g. drivetrain) just show the label. A grey stub means the value is missing for that vehicle.$help$,
    $help$Spec — a structured attribute on the vehicle (battery kWh, horsepower, seats, …). Numeric / boolean / text — the three value types, drawn differently. Units follow your imperial/metric toggle.$help$,
    $help$No calculation — it reads the stored spec value and converts units for display only (e.g. kW↔hp, mi↔km). Bars show the raw values; missing values are drawn as a small grey stub.$help$
),
(
    'specscatter',
    $help$About the Spec Scatter chart$help$,
    $help$Plots two numeric specs against each other — one dot per selected vehicle — to reveal relationships (e.g. battery size vs range, power vs price). Both axes come from the vehicles’ structured spec sheets (`specs`); only numeric fields are offered.$help$,
    $help$Each dot is a vehicle (X = one spec, Y = another); the dashed grey line is a best-fit trend across all plotted vehicles. Use it to spot correlations and outliers — a car well above the line is doing better than its peers on the Y spec for its X value. Vehicles missing either value aren’t plotted.$help$,
    $help$Trend line — a least-squares straight-line fit through the dots. Outlier — a vehicle far from the trend. Correlation — how tightly the dots track the line. Axes are numeric specs only; units follow your imperial/metric toggle.$help$,
    $help$Dots are the stored spec values (unit-converted for display). The trend line is an ordinary least-squares regression (the slope and intercept that minimise squared vertical error), drawn from the lowest to the highest X. It’s descriptive only — it doesn’t imply causation, and a few vehicles can swing the slope.$help$
);
