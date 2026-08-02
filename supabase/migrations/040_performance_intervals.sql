-- ============================================================
-- Migration 040: Performance testing — variable speed-window results
--
-- Replaces the hardcoded passing/braking columns on performance_summaries.
-- Those assumed one fixed window each (50-90, and a single braking result),
-- but real sources vary:
--   passing  — 50-80 or 50-90, sometimes 30-50 / 40-70
--   braking  — 75-0, 70-0 or 60-0, often SEVERAL from the same stop
--              (a 75-0 trace contains the 60-0 distance), and frequently
--              reported metric (100-0 km/h in metres)
--
-- Braking, passing and acceleration are all the same shape — a speed window
-- yielding either a time or a distance — so one table serves all three.
--
-- UNITS: values are stored AS REPORTED, with their unit alongside. "100-0 km/h
-- in 38.5 m" is the standard European braking figure; normalising it to
-- "62.1-0 mph" on write would destroy the label and round-trip badly.
-- Conversion to a common basis happens at read time in
-- performanceDerivations.js, consistent with how every other derived value in
-- this codebase works.
--
-- 0-60 and quarter-mile stay as promoted COLUMNS on performance_summaries:
-- they're fixed-window, universal, and read by every card and chart. Same
-- promoted-field pattern as vehicle_performance vs. the specs JSONB. This
-- table carries everything else, including extra accel windows (0-100, 0-30).
-- ============================================================

CREATE TABLE performance_intervals (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    summary_id      bigint NOT NULL
                        REFERENCES performance_summaries(id) ON DELETE CASCADE,

    kind            text NOT NULL CHECK (kind IN ('accel','passing','braking')),

    -- The window. braking is typically X→0; accel 0→X; passing X→Y.
    from_speed      numeric NOT NULL,
    to_speed        numeric NOT NULL DEFAULT 0,
    speed_unit      text NOT NULL DEFAULT 'mph' CHECK (speed_unit IN ('mph','kph')),

    -- Exactly one of these carries the result: elapsed_s for accel/passing,
    -- distance for braking.
    elapsed_s       numeric,
    distance        numeric,
    distance_unit   text NOT NULL DEFAULT 'ft' CHECK (distance_unit IN ('ft','m')),

    -- Accel only: whether the figure uses the 1ft drag-strip rollout.
    rollout         boolean,

    notes           text,
    created_at      timestamptz DEFAULT now(),

    -- A result is meaningless without a measurement.
    CONSTRAINT performance_intervals_has_value
        CHECK (elapsed_s IS NOT NULL OR distance IS NOT NULL),
    -- One result per window per kind per source.
    UNIQUE (summary_id, kind, from_speed, to_speed, speed_unit)
);

COMMENT ON TABLE performance_intervals IS
    'Variable speed-window results (braking distances, passing times, extra accel windows). Values stored as reported with their units; converted at read time.';

CREATE INDEX idx_performance_intervals_summary ON performance_intervals(summary_id);
-- Cross-vehicle comparison always filters to one comparable window
-- ("75-0 mph across all cars"), so index the window itself.
CREATE INDEX idx_performance_intervals_window
    ON performance_intervals(kind, from_speed, to_speed, speed_unit);

ALTER TABLE performance_intervals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read performance_intervals"
    ON performance_intervals FOR SELECT USING (true);

CREATE POLICY "Curators insert performance_intervals"
    ON performance_intervals FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators update performance_intervals"
    ON performance_intervals FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators delete performance_intervals"
    ON performance_intervals FOR DELETE
    USING (current_user_role() IN ('admin','contributor'));

-- ── Retire the fixed-window columns superseded above ────────────────────────
-- Safe to drop outright: migrations 036-039 were applied minutes ago and these
-- columns have never held data.
ALTER TABLE performance_summaries
    DROP COLUMN IF EXISTS fifty_to_ninety_sec,
    DROP COLUMN IF EXISTS braking_distance_ft,
    DROP COLUMN IF EXISTS braking_from_mph,
    DROP COLUMN IF EXISTS braking_to_mph;
