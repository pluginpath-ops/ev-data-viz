-- ============================================================
-- Migration 043: Performance testing — eighth-mile and 60 ft figures
--
-- Drag exports report a ladder of distance splits (60ft, 330ft, 500ft, 1/8,
-- 1000ft, 1/4), each with a time AND a trap speed. The splits themselves go to
-- performance_run_points, which already carries distance_ft alongside
-- elapsed_s and speed_mph — no schema change needed for those, and keeping the
-- full ladder costs nothing while discarding it is irreversible.
--
-- These three columns are for the PUBLISHED case, where a source quotes the
-- headline figures with no trace behind them. Same rule as the quarter mile:
-- fixed windows that every drag source reports get promoted columns, while
-- windows that vary between sources stay in performance_intervals.
--
-- For an imported session the equivalents are NOT stored — they're already in
-- the points (label '1/8', '1/4') and are read from there, so they can't drift
-- from the splits they came from.
-- ============================================================

ALTER TABLE performance_summaries
    ADD COLUMN IF NOT EXISTS eighth_mile_sec      numeric,
    ADD COLUMN IF NOT EXISTS eighth_mile_trap_mph numeric,
    ADD COLUMN IF NOT EXISTS sixty_ft_sec         numeric;

COMMENT ON COLUMN performance_summaries.eighth_mile_sec IS
    'Elapsed time to the 1/8 mile (660 ft).';
COMMENT ON COLUMN performance_summaries.eighth_mile_trap_mph IS
    'Speed at the 1/8-mile mark.';
COMMENT ON COLUMN performance_summaries.sixty_ft_sec IS
    'Elapsed time to 60 ft — the standard measure of launch quality.';
