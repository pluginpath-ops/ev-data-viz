-- ============================================================
-- Migration 042: Performance testing — 0-100 mph as a promoted column
--
-- 0-100 was reachable only as a row in performance_intervals, which was wrong
-- by this schema's own rule: FIXED-window headline figures are promoted columns
-- (0-60, quarter mile), and performance_intervals exists for windows that VARY
-- between sources (75-0 vs 70-0 braking, 50-80 vs 50-90 passing).
--
-- 0-100 never varies, and published test blocks list it right beside 0-60. As
-- an interval it was buried behind an "Add braking / passing figure" button
-- that didn't mention acceleration at all — effectively unfindable.
--
-- Rolling starts (5-60) and other genuinely variable acceleration windows stay
-- in performance_intervals, which is what that table is for.
-- ============================================================

ALTER TABLE performance_summaries
    ADD COLUMN IF NOT EXISTS zero_to_100_sec numeric;

COMMENT ON COLUMN performance_summaries.zero_to_100_sec IS
    'Time to 100 mph. Follows the same rollout convention as the source''s 0-60 figure — check the source''s own footnote.';
