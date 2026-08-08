-- ============================================================
-- Migration 046: Split dual-role runs — the destructive one
--
-- One drive recorded as a single row, carrying both a charging curve and a
-- measured range test, becomes two rows joined by a session. That is what the
-- dual role always meant: not a scientific category, just provenance — "these
-- were measured together". A session says it explicitly, and can say it across
-- rows, which a flag on one row never could.
--
-- ⚠️ TAKE A BACKUP FIRST. This cannot be un-run. See LocalDev/backup-and-apply.md.
--
-- The ORIGINAL row becomes the CHARGING half and keeps its id. That is
-- deliberate: data_points.run_id and spec_links.source_run_id both point at it,
-- and the charging curve is the time series those data points are. The range
-- half is a new row. Nothing has to be re-pointed.
--
-- The shape of the result, whatever the count: N dual-role rows in → N new
-- range rows + N sessions out, total runs N higher.
--
-- Do not trust a remembered N. A census on 2026-08-05 found 35 dual-role rows;
-- by 2026-08-08 it was 28, after duplicate charging tests were retired. Take the
-- count immediately before running:
--
--     SELECT count(*) FILTER (WHERE has_charging AND has_range) AS dual_role,
--            count(*)                                           AS total
--     FROM runs;
-- ============================================================

BEGIN;

-- ── 0. Clear vestigial off-role columns ──────────────────────────────────────
--
-- Some rows that are NOT dual-role still carry a column belonging to the other
-- role. On the live database these are six charging tests whose range values
-- were duplicated across charging events and then un-flagged as range — the
-- numbers are leftovers, reviewed and confirmed as not belonging to those runs.
-- Their `kind` already says charging, so nothing reads them; they would simply
-- fail the CHECK constraints added at the end.
--
-- Cleared explicitly and counted out loud, rather than being silently dropped by
-- a wider UPDATE or blocking the migration behind a constraint violation that
-- would name neither the rows nor the reason.
DO $$
DECLARE
    cleared_charging int;
    cleared_range    int;
BEGIN
    WITH stripped AS (
        UPDATE runs
        SET distance_miles = NULL, energy_kwh = NULL, speed_mph = NULL,
            url = NULL, avg_wind_speed_mph = NULL, wind_direction_deg = NULL
        WHERE NOT (has_charging AND has_range)      -- dual rows are split below
          AND kind = 'charging'
          AND (distance_miles IS NOT NULL OR energy_kwh IS NOT NULL
               OR speed_mph IS NOT NULL OR url IS NOT NULL
               OR avg_wind_speed_mph IS NOT NULL OR wind_direction_deg IS NOT NULL)
        RETURNING 1
    ) SELECT count(*) INTO cleared_charging FROM stripped;

    WITH stripped AS (
        UPDATE runs
        SET charging_url = NULL, charge_energy_kwh = NULL
        WHERE NOT (has_charging AND has_range)
          AND kind = 'range'
          AND (charging_url IS NOT NULL OR charge_energy_kwh IS NOT NULL)
        RETURNING 1
    ) SELECT count(*) INTO cleared_range FROM stripped;

    RAISE NOTICE 'Cleared vestigial columns: % charging run(s) carrying range values, % range run(s) carrying charging values.',
        cleared_charging, cleared_range;
END $$;


-- ── 1. A session per dual-role row ───────────────────────────────────────────
--
-- The session carries what both halves shared, so the halves stop repeating it.
-- Named after the run, since that name is what the tester actually called the
-- outing; it also becomes the short chart label for the pair (see #170).

CREATE TEMP TABLE dual_split ON COMMIT DROP AS
SELECT id AS charging_run_id
FROM runs
WHERE has_charging AND has_range;

CREATE TEMP TABLE session_map (
    charging_run_id bigint PRIMARY KEY,
    session_id      bigint NOT NULL
) ON COMMIT DROP;

WITH inserted AS (
    INSERT INTO test_sessions (name, tested_at, temperature_f, notes)
    SELECT r.name,
           -- runs.date is text; only a parseable date becomes a timestamp.
           CASE WHEN r.date ~ '^\d{4}-\d{2}-\d{2}' THEN r.date::timestamp ELSE NULL END,
           r.temperature_f,
           'Created by migration 046 from a dual-role run.'
    FROM runs r
    JOIN dual_split d ON d.charging_run_id = r.id
    ORDER BY r.id
    RETURNING id
), numbered_sessions AS (
    SELECT id, row_number() OVER (ORDER BY id) AS rn FROM inserted
), numbered_runs AS (
    SELECT charging_run_id, row_number() OVER (ORDER BY charging_run_id) AS rn FROM dual_split
)
INSERT INTO session_map (charging_run_id, session_id)
SELECT nr.charging_run_id, ns.id
FROM numbered_runs nr
JOIN numbered_sessions ns ON ns.rn = nr.rn;


-- ── 2. The range half — a new row ────────────────────────────────────────────
--
-- start_soc / end_soc are copied to BOTH halves: the charging side needs them
-- for its curve, the range side to price miles per %SoC. Shared context
-- (temperature, elevation, trim, conditions, colour) is copied so each half
-- stands alone in the charts that show it.
--
-- is_default is NOT copied — it currently scopes the vehicle's default CHARGING
-- run, and handing that flag to a range row would make it the default for both
-- roles at once. Range defaults resolve by recency until a curator sets one.

INSERT INTO runs (
    vehicle_id, name, date, color, synthetic,
    has_charging, has_range,
    software_version, conditions, source, url,
    start_soc, end_soc, speed_mph,
    distance_miles, energy_kwh,
    temperature_f, elevation_gain_ft,
    avg_wind_speed_mph, wind_direction_deg,
    trim_id, session_id,
    paired_charging_run_id
)
SELECT
    r.vehicle_id, r.name, r.date, r.color, r.synthetic,
    false, true,                       -- the trigger derives kind='range' from these
    r.software_version, r.conditions, r.source, r.url,
    r.start_soc, r.end_soc, r.speed_mph,
    r.distance_miles, r.energy_kwh,
    r.temperature_f, r.elevation_gain_ft,
    r.avg_wind_speed_mph, r.wind_direction_deg,
    r.trim_id, sm.session_id,
    -- The pairing arrives pre-made: these two halves were measured together, so
    -- the range row names its charging partner outright — one correct pairing
    -- per split, with no curation.
    r.id
FROM runs r
JOIN session_map sm ON sm.charging_run_id = r.id;


-- ── 3. The charging half — the original row, stripped of range columns ───────

UPDATE runs r
SET has_range          = false,
    session_id         = sm.session_id,
    distance_miles     = NULL,
    energy_kwh         = NULL,
    speed_mph          = NULL,
    url                = NULL,
    avg_wind_speed_mph = NULL,
    wind_direction_deg = NULL
FROM session_map sm
WHERE r.id = sm.charging_run_id;


-- ── 4. Retire the transitional machinery ─────────────────────────────────────
--
-- `kind` has been derived from the booleans by a trigger since 044, so the app
-- could read one column while the booleans stayed authoritative on write. With
-- no dual-role rows left there is nothing for the booleans to say that `kind`
-- cannot, and keeping them would let the two disagree.

DROP TRIGGER IF EXISTS trg_runs_sync_kind ON runs;
DROP FUNCTION IF EXISTS runs_sync_kind();
DROP FUNCTION IF EXISTS runs_derive_kind(boolean, boolean);

ALTER TABLE runs DROP COLUMN has_charging;
ALTER TABLE runs DROP COLUMN has_range;

ALTER TABLE runs ALTER COLUMN kind SET DEFAULT 'charging';


-- ── 5. Enforce the union ─────────────────────────────────────────────────────
--
-- Now that a row has exactly one role, say so in the schema rather than trusting
-- every future insert to remember.

ALTER TABLE runs ADD CONSTRAINT runs_charging_has_no_range_columns CHECK (
    kind <> 'charging' OR (
        distance_miles IS NULL AND energy_kwh IS NULL AND speed_mph IS NULL
        AND url IS NULL AND avg_wind_speed_mph IS NULL AND wind_direction_deg IS NULL
    )
);

ALTER TABLE runs ADD CONSTRAINT runs_range_has_no_charging_columns CHECK (
    kind <> 'range' OR (charging_url IS NULL AND charge_energy_kwh IS NULL)
);

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- 1. The countable expectation, against the census taken just before running:
--    total_runs should rise by exactly N, and sessions should equal N.
--
--      SELECT
--        (SELECT count(*) FROM runs)                              AS total_runs,
--        (SELECT count(*) FROM test_sessions)                     AS sessions,
--        (SELECT count(*) FROM runs WHERE session_id IS NOT NULL) AS runs_in_sessions;
--
-- 2. Every session holds exactly one charging row and one range row — expect 0:
--
--      SELECT count(*) FROM (
--        SELECT session_id,
--               count(*) FILTER (WHERE kind = 'charging') AS c,
--               count(*) FILTER (WHERE kind = 'range')    AS r
--        FROM runs WHERE session_id IS NOT NULL GROUP BY session_id
--      ) s WHERE c <> 1 OR r <> 1;
--
-- 3. The pairings arrived pre-made — expect one per session:
--
--      SELECT count(*) FROM runs WHERE paired_charging_run_id IS NOT NULL;
--
-- 4. Nothing lost its time series. data_points stayed with the charging half,
--    which kept the original id, so this should be unchanged from before:
--
--      SELECT count(*) FROM data_points dp
--      LEFT JOIN runs r ON r.id = dp.run_id WHERE r.id IS NULL;   -- expect 0
--
-- 5. Inherited runs still resolve — spec_links point at charging rows, which
--    kept their ids — expect 0:
--
--      SELECT count(*) FROM spec_links sl
--      LEFT JOIN runs r ON r.id = sl.source_run_id WHERE r.id IS NULL;
