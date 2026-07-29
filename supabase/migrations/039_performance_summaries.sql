-- ============================================================
-- Migration 039: Performance testing — Part 4 (reported results)
--
-- A published headline result from ONE source, for a vehicle (optionally a
-- specific trim). This is the leaderboard layer: often the only data available,
-- with no backing detail session.
--
-- Deliberately NO unique constraint on (vehicle_id, trim_id) — several
-- publications test the same car and report different numbers, and all of them
-- are worth keeping. `source_name` distinguishes them.
--
-- Stores ENTERED values only (manual or imported). Values derived from detail
-- sessions are computed at read time by src/utils/performanceDerivations.js and
-- are never written here — mirroring epaDerivations.js, and avoiding stale
-- copies when the underlying run data changes. That also sidesteps needing a
-- session FK: accel and braking figures come from different sessions, so no
-- single link column could express it.
--
-- Separate from the existing vehicle_performance table, which holds
-- MANUFACTURER-CLAIMED figures. Comparing the two is the point.
-- ============================================================

CREATE TABLE performance_summaries (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vehicle_id      bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    trim_id         bigint REFERENCES trims(id) ON DELETE SET NULL,
    -- Free-text configuration as the source described it (e.g. "Dual Standard
    -- LFP", "Performance"). Source trim names rarely map onto trims rows, and
    -- requiring one would add friction to quick manual entry.
    trim_label      text,

    source_name     text,          -- who tested it, e.g. "Out of Spec"

    zero_to_60_sec          numeric,  -- no rollout (see migration 037 header)
    zero_to_60_rollout_sec  numeric,  -- 1ft rollout
    quarter_mile_sec        numeric,
    quarter_mile_trap_mph   numeric,
    fifty_to_ninety_sec     numeric,
    braking_distance_ft     numeric,
    braking_from_mph        numeric,
    braking_to_mph          numeric DEFAULT 0,

    youtube_url     text,
    spreadsheet_url text,
    notes           text,

    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_performance_summaries_vehicle ON performance_summaries(vehicle_id);

ALTER TABLE performance_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read performance_summaries"
    ON performance_summaries FOR SELECT USING (true);

CREATE POLICY "Curators insert performance_summaries"
    ON performance_summaries FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators update performance_summaries"
    ON performance_summaries FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators delete performance_summaries"
    ON performance_summaries FOR DELETE
    USING (current_user_role() IN ('admin','contributor'));
