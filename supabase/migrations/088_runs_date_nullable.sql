-- 088: a test's date may be unknown
--
-- The upload and create forms used to pre-fill today's date, and forgetting to
-- change it recorded bad data. They now start blank and DataService writes a
-- blank date as NULL (also the Tableau import, when the file has none). The
-- column was created NOT NULL, so every such insert failed with:
--   null value in column "date" of relation "runs" violates not-null constraint
-- An unknown date is honest; a made-up one is not. Readers already tolerate
-- null (cards and details show the date only when present; the newest-first
-- sorts treat null as oldest).
--
-- Apply in the Supabase SQL editor. Safe to re-run.

ALTER TABLE runs ALTER COLUMN date DROP NOT NULL;
