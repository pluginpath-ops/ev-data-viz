-- 071: a charging session's best 5, 10 and 15-minute average charge rate (#346)
--
-- The vehicle table wants an EVBench charge rate for every vehicle, and working
-- it out means reading every charging session's time series -- the heaviest
-- read the app has. So each session carries a small summary, computed in
-- JavaScript (src/utils/chargeWindows.js, summarizeChargeSession) whenever its
-- data points are written, and every vehicle's best is chosen from these at
-- read time. Nothing is stored on the vehicle: which session holds the best
-- changes on every add, edit, delete or move of a session, and a stored copy
-- would have to follow all of them.
--
-- Shape (version 1):
--   { "version": 1, "durationMin": 46.8, "startSoc": 0, "peakKw": 163,
--     "windows": { "5":  { "kw": 161.6, "startMin": 5.1, "startSoc": 17, "endSoc": 37 },
--                  "10": { ... }, "15": { ... } },
--     "gaps": { "5": "gap" | "short" },          -- only for windows that are null
--     "computedAt": "2026-09-19T..." }
-- or, for a session that cannot be summarized,
--   { "version": 1, "windows": null, "reason": "no time" | "no power" }
--
-- `version` is the calculation's, not the schema's: when the algorithm changes
-- the constant in chargeWindows.js is bumped, the read side ignores summaries
-- from older versions, and Admin -> Data checks recomputes them.
--
-- NULLABLE, and null means "not computed yet" -- every session until the
-- backfill runs, and range tests always. Written by whoever may write the run
-- (the existing runs UPDATE policy), in the same DataService calls that write
-- its points: addRun, mergeRunData, replaceRunData.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS charge_summary jsonb;

COMMENT ON COLUMN runs.charge_summary IS
  'Best 5/10/15-minute average charge rate of a charging session, with where each window sat. Computed by src/utils/chargeWindows.js when the session''s points are written; null until then. See #346.';
