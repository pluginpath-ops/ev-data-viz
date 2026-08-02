-- ============================================================
-- Migration 038: Performance testing — Part 3 (split series)
--
-- The segment splits reported alongside a run. `label` keeps the raw source
-- name because braking's segment labels aren't known yet, so this stays
-- freeform rather than a fixed enum. speed_mph/elapsed_s/distance_ft are all
-- nullable so one table serves both shapes:
--   accel:   { label: '0-60(1ft)', speed_mph: 60, elapsed_s: 3.300 }
--   braking: { label: '75-0',      speed_mph: 0,  distance_ft: 188.4 }
--
-- This is the series a speed-vs-time acceleration curve is plotted from —
-- the performance analogue of data_points.
-- ============================================================

CREATE TABLE performance_run_points (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      bigint NOT NULL REFERENCES performance_runs(id) ON DELETE CASCADE,
    sequence    integer NOT NULL,
    label       text,
    speed_mph   numeric,
    elapsed_s   numeric,
    distance_ft numeric,

    UNIQUE (run_id, sequence)
);

CREATE INDEX idx_performance_run_points_run ON performance_run_points(run_id);

ALTER TABLE performance_run_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read performance_run_points"
    ON performance_run_points FOR SELECT USING (true);

CREATE POLICY "Curators insert performance_run_points"
    ON performance_run_points FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators update performance_run_points"
    ON performance_run_points FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators delete performance_run_points"
    ON performance_run_points FOR DELETE
    USING (current_user_role() IN ('admin','contributor'));
