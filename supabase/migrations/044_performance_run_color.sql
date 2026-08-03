-- ============================================================
-- Migration 044: Performance testing — per-run chart colour
--
-- Mirrors runs.color, which is how charging and range runs carry a
-- contributor-set colour. Without it the acceleration curve could only ever
-- auto-assign, and a session sweeping seven drive modes puts seven lines on one
-- chart with no way to pin a particular one to a colour you can point at.
--
-- Nullable: null means "let the auto palette decide", which is the default for
-- every run imported so far.
-- ============================================================

ALTER TABLE performance_runs
    ADD COLUMN IF NOT EXISTS color text;

COMMENT ON COLUMN performance_runs.color IS
    'Contributor-set chart colour. Null lets the Okabe-Ito auto palette assign one.';
