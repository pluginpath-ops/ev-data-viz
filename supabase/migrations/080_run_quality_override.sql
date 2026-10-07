-- 080: a curator's override of a test's quality checks (#394)
--
-- Two automatic checks keep a test out of the statistics even when the curator
-- knows it is sound:
--
--   - a range figure only from a test that saw most of the pack
--     (testedRange.coversPracticalPack: 80→10 %, or 85 points), because scaling
--     a narrow start→end SoC up to 100 % multiplies its error;
--   - an UNLISTED range test only with its speed and temperature recorded
--     (runListing.poolGateMissing), because without them it cannot be
--     corrected to standard conditions.
--
-- Both are right as defaults and wrong for, say, a set of short constant-speed
-- sweeps a curator has checked by hand. This flag says "I have looked; count
-- it". It overrides those two checks and nothing else: a test with no
-- start/end SoC still has no range to scale, one without energy still has no
-- efficiency, and exclusion (079) is the curator's own decision.
--
-- Not to be confused with Data Checks (Admin), which are findings about a
-- vehicle's figures. Written by whoever may write the run (the existing runs
-- UPDATE policy), through DataService.updateRun.
--
-- Additive and safe to run twice.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS quality_override boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN runs.quality_override IS
  'A curator overrode this test''s quality checks: the range spread''s pack-coverage rule and the pool''s speed/temperature rule. Not exclusion, not missing data. See #394.';
