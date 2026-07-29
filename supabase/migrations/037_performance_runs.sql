-- ============================================================
-- Migration 037: Performance testing — Part 2 (individual runs)
--
-- One launch (accel) or one stop (braking) within a session. Accel and
-- braking share this table — test_type is inherited from the parent session
-- rather than repeated here, so a session can't contain a mix.
--
-- ROLLOUT: the two 0-60 figures are NOT interchangeable and are ~0.27 s apart.
--   zero_to_60_sec          — clock starts at 0 mph ("0–60 mph" in the source
--                             CSV). This is what publications label "no rollout".
--   zero_to_60_rollout_sec  — 1-foot rollout, drag-strip convention
--                             ("0–60(1ft)" in the source CSV).
-- Swapping them silently corrupts every cross-vehicle comparison, hence the
-- explicit names over a bare `zero_to_60`.
-- ============================================================

CREATE TABLE performance_runs (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id      bigint NOT NULL
                        REFERENCES performance_sessions(id) ON DELETE CASCADE,
    sequence        integer NOT NULL,   -- order within the session

    -- Vehicle drive-mode setting, e.g. "Insane + Launch Mode", "Chill".
    -- Repeats across runs — the same mode is usually tested several times.
    drive_mode      text,
    run_at          timestamp,   -- wall-clock at the test site; see migration 036

    -- Per-run conditions (these vary between runs in the same session)
    altitude_ft         numeric,
    density_altitude_ft numeric,
    slope_pct           numeric,   -- + = uphill
    distance_run_ft     numeric,   -- length of the measured run

    -- Results
    max_g_force             numeric,
    zero_to_60_sec          numeric,  -- no rollout (see header)
    zero_to_60_rollout_sec  numeric,  -- 1ft rollout (see header)
    braking_distance_ft     numeric,
    braking_from_mph        numeric,
    braking_to_mph          numeric DEFAULT 0,

    created_at      timestamptz DEFAULT now(),

    UNIQUE (session_id, sequence)
);

COMMENT ON COLUMN performance_runs.zero_to_60_sec IS
    'Clock starts at 0 mph — the "no rollout" figure. Distinct from zero_to_60_rollout_sec.';
COMMENT ON COLUMN performance_runs.zero_to_60_rollout_sec IS
    '1-foot-rollout figure (drag-strip convention), typically ~0.3s quicker than zero_to_60_sec.';

CREATE INDEX idx_performance_runs_session ON performance_runs(session_id);

ALTER TABLE performance_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read performance_runs"
    ON performance_runs FOR SELECT USING (true);

CREATE POLICY "Curators insert performance_runs"
    ON performance_runs FOR INSERT
    WITH CHECK (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators update performance_runs"
    ON performance_runs FOR UPDATE
    USING (current_user_role() IN ('admin','contributor'));

CREATE POLICY "Curators delete performance_runs"
    ON performance_runs FOR DELETE
    USING (current_user_role() IN ('admin','contributor'));
