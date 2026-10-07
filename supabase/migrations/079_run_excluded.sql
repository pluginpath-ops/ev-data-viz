-- 079: whether a test counts in the statistics, apart from whether it is listed (#394)
--
-- Until now one flag answered two questions. runs.is_hidden (034) was made for
-- "disputed data pending review, incomplete uploads", and every statistic skips
-- a hidden test on purpose: composite curves (compositeEligible), best charge
-- windows (countsTowardBest), the test spreads. That leaves no way to keep a
-- good test out of view while still counting it — and that is how n grows: a
-- curator brings in many tests of acceptable quality, lists the few that
-- represent the vehicle, and pools the rest.
--
-- So exclusion becomes its own flag, and is_hidden narrows to mean UNLISTED
-- (kept out of viewers' pickers, charts and Tests & Data) and nothing more.
-- The column keeps its name; docs/vocabulary.md records the narrowing. The
-- rules that read the two live in src/utils/runListing.js.
--
-- BACKFILL: every test hidden today was hidden for not being trusted, so each
-- starts EXCLUDED. A curator then includes the ones that belong in the pool.
-- The backfill runs only when the column is created — a second application
-- must not re-exclude tests a curator has since moved into the pool.
--
-- Written by whoever may write the run (the existing runs UPDATE policy),
-- through DataService.updateRun. Read by everyone with the run, like is_hidden.
--
-- Safe to run twice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'runs' AND column_name = 'is_excluded'
  ) THEN
    ALTER TABLE runs ADD COLUMN is_excluded boolean NOT NULL DEFAULT false;
    UPDATE runs SET is_excluded = true WHERE is_hidden;
  END IF;
END $$;

COMMENT ON COLUMN runs.is_excluded IS
  'Left out of the statistics (composite curves, test spreads, best charge windows). Independent of is_hidden, which now means unlisted. See #394.';
COMMENT ON COLUMN runs.is_hidden IS
  'Unlisted: kept out of viewers'' pickers, charts and Tests & Data. Still counts in the statistics unless is_excluded. See #394.';
