-- ============================================================
-- Migration 045: Curated pairing — point the durable pairing the right way
--
-- Migration 044 added runs.paired_range_run_id: on a CHARGING run, its default
-- RANGE partner. The pairing UI then landed the other way round — the chart
-- enumerates range tests and you pick a charging curve for each, because a
-- charging curve is a property of the car and varies little, while a range test
-- is a property of the day, moved by wind, temperature, HVAC, tyres, elevation,
-- humidity and load.
--
-- So the durable pairing belongs on the RANGE run, naming its charging partner.
-- Nothing ever wrote paired_range_run_id — it was groundwork, populated by no
-- code path — so it is replaced rather than repurposed under a name that would
-- describe the opposite of what it holds.
--
-- Directional rather than a single symmetric paired_run_id: symmetric would work
-- from either side, but permits two rows to disagree (A names B while B names C)
-- with no principled tiebreak.
-- ============================================================

BEGIN;

ALTER TABLE runs
    ADD COLUMN paired_charging_run_id bigint REFERENCES runs(id) ON DELETE SET NULL;

CREATE INDEX idx_runs_paired_charging ON runs(paired_charging_run_id);

COMMENT ON COLUMN runs.paired_charging_run_id IS
    'Curator-set default charging test for this range test. Overrides the automatic pick (is_default, else most recent); a URL pairing still overrides this. App-enforced to reference a kind=charging run.';

-- Unused groundwork from 044, pointing the wrong way. Safe to drop: no code
-- ever read or wrote it, so there is no data to migrate.
DROP INDEX IF EXISTS idx_runs_paired_range;

ALTER TABLE runs DROP COLUMN paired_range_run_id;

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- 1. The new column exists and the old one is gone — expect one row, 'f':
--
--      SELECT
--        EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_name='runs' AND column_name='paired_charging_run_id') AS added,
--        EXISTS (SELECT 1 FROM information_schema.columns
--                WHERE table_name='runs' AND column_name='paired_range_run_id')    AS old_still_there;
--
-- 2. Nothing was silently dropped — expect the same count as before applying:
--
--      SELECT count(*) FROM runs;
--
-- 3. A curated pairing survives its partner being deleted (SET NULL, not
--    cascade). Rolled back, so it writes nothing:
--
--      BEGIN;
--      UPDATE runs SET paired_charging_run_id = (
--          SELECT id FROM runs WHERE kind = 'charging' LIMIT 1
--      ) WHERE kind = 'range' LIMIT 1;
--      SELECT count(*) AS paired FROM runs WHERE paired_charging_run_id IS NOT NULL;
--      DELETE FROM runs WHERE id = (SELECT id FROM runs WHERE kind = 'charging' LIMIT 1);
--      SELECT count(*) AS still_paired FROM runs WHERE paired_charging_run_id IS NOT NULL;
--      ROLLBACK;
