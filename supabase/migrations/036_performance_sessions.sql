-- ============================================================
-- Migration 036: Performance testing — Part 1 (sessions)
--
-- A testing outing: one vehicle, one location, one weather reading, one
-- test type. The detail CSVs pair a single location/weather sample with
-- many individual launches, so that context lives here and is not repeated
-- per run.
--
-- Deliberately NOT a row in `runs`. A performance session yields ~8 runs in
-- 90 seconds, and `runs` rows are consumed broadly (charging/range selectors,
-- chart series, vehicle-card counts) where isChargingRun() treats anything
-- without has_charging=false as a charging run. Performance data also shares
-- none of runs' SoC/energy/distance columns.
--
-- wind_bearing_deg is METEOROLOGICAL (the direction wind comes FROM, as the
-- source CSVs report it). This is a different coordinate system from
-- runs.wind_direction_deg, which is relative to the vehicle's direction of
-- travel (see migration 035) — hence the distinct name.
-- ============================================================

CREATE TABLE performance_sessions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id      bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    -- Which configuration was tested. NULL when the source doesn't say.
    trim_id         bigint REFERENCES trims(id) ON DELETE SET NULL,

    test_type       text NOT NULL CHECK (test_type IN ('accel','braking')),
    -- Wall-clock time AT THE TEST SITE. Sources report "(local)" with no UTC
    -- offset and we can't infer one from lat/long without a tz database, so
    -- this is deliberately zone-less rather than a falsely-precise instant.
    tested_at       timestamp,

    -- Location
    location_name   text,          -- e.g. "North Carolina, United States"
    latitude        numeric(9,6),
    longitude       numeric(9,6),

    -- Weather at the time of testing
    temperature_f   numeric,
    humidity_pct    numeric,
    pressure_inhg   numeric,
    wind_speed_mph  numeric,
    wind_bearing_deg numeric,      -- meteorological: direction wind comes FROM
    cloud_cover_pct numeric,
    visibility_mi   numeric,

    -- Provenance
    source_name     text,          -- e.g. "Out of Spec Testing"
    youtube_url     text,
    spreadsheet_url text,
    notes           text,

    created_at      timestamptz DEFAULT now()
);

COMMENT ON COLUMN performance_sessions.wind_bearing_deg IS
    'Meteorological bearing — the direction the wind is coming FROM (0=N, 90=E). NOT the same as runs.wind_direction_deg, which is relative to direction of travel.';

CREATE INDEX idx_performance_sessions_vehicle ON performance_sessions(vehicle_id);

ALTER TABLE performance_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read performance_sessions"
    ON performance_sessions FOR SELECT USING (true);

CREATE POLICY "Curators insert performance_sessions"
    ON performance_sessions FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators update performance_sessions"
    ON performance_sessions FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators delete performance_sessions"
    ON performance_sessions FOR DELETE
    USING (current_user_role() IN ('admin','contributor'));
