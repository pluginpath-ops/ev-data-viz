-- Migration 032: reformat chart_help "key terms" with line breaks
--
-- 031 seeded key_terms as one run-on paragraph. The bubble renders with
-- `whitespace-pre-line`, so newlines show as line breaks — this migration
-- rewrites each key_terms with one term per line for readability.
--
-- Idempotent: UPDATEs by chart_key. Rows that don't exist are simply not
-- touched (the app falls back to the bundled defaults in
-- src/utils/chartHelpContent.js, which carry the same formatting). Run after 031.
-- These UPDATEs only overwrite key_terms — any edits to other fields are kept.

UPDATE chart_help SET key_terms = $help$SoC (State of Charge) — how full the battery is, 0–100%.
Charge Rate (kW) — power flowing into the battery right now.
C-rate — charge power ÷ battery size (kW ÷ kWh); ~1C ≈ adding a full pack in an hour, regardless of car size.
Range Rate — miles of range gained per minute.
SoC Added / Range Added — change since the start of the plotted window.
Range – EPA vs Range – Tested — EPA-rated range projected from SoC, vs the range actually logged in the test.$help$ WHERE chart_key = 'charging';

UPDATE chart_help SET key_terms = $help$Projected range — distance scaled up to a full 0–100% charge.
Efficiency — energy used per unit distance.
mi/kWh — miles per kilowatt-hour (higher is better).
Wh/mi — watt-hours per mile (lower is better).
SoC used — the test’s start % minus end %.$help$ WHERE chart_key = 'range';

UPDATE chart_help SET key_terms = $help$Starting SoC — the common battery level all cars are normalized to.
Range added — miles gained in the chosen minutes.
Time to add — minutes to gain the chosen miles.
Interpolation — reading a value between two logged points.
Extrapolation — estimating past the ends of the logged data (flagged amber).$help$ WHERE chart_key = 'compare';

UPDATE chart_help SET key_terms = $help$Road-load (A, B, C) — the rolling, speed-proportional and aerodynamic resistance from EPA coast-down testing: Force = A + B·speed + C·speed².
η (drivetrain efficiency) — the share of battery energy that reaches the wheels, back-solved from the EPA highway test.
MPGe — miles per gallon-equivalent (33.7 kWh = 1 gallon).
kWh/100mi, Wh/mi — energy used per distance.
Useable kWh — the battery capacity used for the range estimate.$help$ WHERE chart_key = 'epacurves';

UPDATE chart_help SET key_terms = $help$SoC — battery %.
mi/kWh — driving efficiency.
Leg / distance between charges — how far you drive before each stop.
Overhead — fixed minutes added per stop (park, plug in, break).
ICE Reference — a gas car driving 3-hour legs with the same per-stop overhead.
Charge stop — modelled from the real charging curve between your start and minimum SoC.$help$ WHERE chart_key = 'roadtrip';

UPDATE chart_help SET key_terms = $help$Spec — a structured attribute on the vehicle (battery kWh, horsepower, seats, …).
Numeric / boolean / text — the three value types, drawn differently.
Units follow your imperial/metric toggle.$help$ WHERE chart_key = 'specs';

UPDATE chart_help SET key_terms = $help$Trend line — a least-squares straight-line fit through the dots.
Outlier — a vehicle far from the trend.
Correlation — how tightly the dots track the line.
Axes are numeric specs only; units follow your imperial/metric toggle.$help$ WHERE chart_key = 'specscatter';
