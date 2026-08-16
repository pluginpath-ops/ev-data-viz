-- ============================================================
-- Migration 052: url + charging_url → one source_url
--
-- Since migration 046 a run has exactly one role, and the CHECK constraints
-- assert that exactly one of these two columns may be non-NULL:
--
--     kind = 'charging'  →  url IS NULL,          charging_url may be set
--     kind = 'range'     →  charging_url IS NULL, url          may be set
--
-- So two nullable columns encode one fact — "where this test was published" —
-- with the discriminator already sitting in a third column. Every consumer had
-- to branch on `kind` to read or write a link, and the branch kept multiplying:
-- four hand-rolled anchors in the UI (#205), two coalesce pairs in DataService,
-- a case in the import normaliser, two role-gated fields in the run form.
--
-- The names were the other half of the problem. `url` says nothing about what it
-- points at; `charging_url` says it in a way `kind` already did. Migration 041
-- settled the same argument on the performance tables — youtube_url →
-- source_url, because a name that lies about its contents is worse than a
-- generic one — and this lands runs on that same name.
--
-- ⚠️ TAKE A BACKUP FIRST. This drops two columns. See LocalDev/backup-and-apply.md.
--
-- ── What is NOT consolidated, and why ────────────────────────────────────────
--
-- 046 split several column pairs by role, and they do not all mean the same
-- thing on both sides:
--
--     url  /  charging_url          same fact — where the test was published
--     energy_kwh / charge_energy_kwh  DIFFERENT facts — energy OUT on a range
--                                     test, energy IN on a charging test
--
-- Only the first pair collapses. A single `energy_kwh` meaning "consumed if
-- range, added if charging" would need a paragraph to explain; `source_url`
-- needs none. Do not "finish the job" on the energy columns.
--
-- ── Census before running ────────────────────────────────────────────────────
--
--     SELECT count(*) FILTER (WHERE url IS NOT NULL)          AS range_links,
--            count(*) FILTER (WHERE charging_url IS NOT NULL) AS charging_links,
--            count(*) FILTER (WHERE url IS NOT NULL AND charging_url IS NOT NULL)
--                                                             AS both_set,
--            count(*)                                         AS total
--     FROM runs;
--
-- `both_set` must be 0 — the 046 constraints guarantee it. If it is not, stop:
-- the coalesce below would silently prefer `url` and discard the other.
-- ============================================================

BEGIN;

-- ── 1. The new column, filled from whichever old one held the link ───────────
--
-- coalesce is safe precisely because the 046 constraints make the two mutually
-- exclusive. It is not a preference order; there is never anything to prefer.

ALTER TABLE runs ADD COLUMN source_url text;

DO $$
DECLARE
    conflicting int;
    carried     int;
BEGIN
    SELECT count(*) INTO conflicting
    FROM runs WHERE url IS NOT NULL AND charging_url IS NOT NULL;

    IF conflicting > 0 THEN
        RAISE EXCEPTION 'Aborting: % run(s) carry BOTH url and charging_url. '
            'The 046 constraints should make this impossible; resolve by hand '
            'before consolidating, or one of the two links will be discarded.',
            conflicting;
    END IF;

    UPDATE runs SET source_url = coalesce(url, charging_url)
    WHERE coalesce(url, charging_url) IS NOT NULL;

    GET DIAGNOSTICS carried = ROW_COUNT;
    RAISE NOTICE 'Carried % source link(s) onto runs.source_url.', carried;
END $$;

COMMENT ON COLUMN runs.source_url IS
    'Where this test was published — video, article or post. One column for both roles; runs.kind says which kind of test it documents.';


-- ── 2. Rebuild the role constraints without the dropped columns ──────────────
--
-- Postgres would drop both constraints implicitly with the columns they name,
-- and silently leaving them off is exactly the kind of quiet loosening that is
-- worth being explicit about: they are dropped by name and re-added by name, so
-- the diff shows what the row-level guarantee is afterwards.
--
-- `source_url` appears in NEITHER constraint. That is the point of the change —
-- it is legal on both kinds, so there is nothing left to assert about it.

ALTER TABLE runs DROP CONSTRAINT runs_charging_has_no_range_columns;
ALTER TABLE runs DROP CONSTRAINT runs_range_has_no_charging_columns;

ALTER TABLE runs DROP COLUMN url;
ALTER TABLE runs DROP COLUMN charging_url;

ALTER TABLE runs ADD CONSTRAINT runs_charging_has_no_range_columns CHECK (
    kind <> 'charging' OR (
        distance_miles IS NULL AND energy_kwh IS NULL AND speed_mph IS NULL
        AND avg_wind_speed_mph IS NULL AND wind_direction_deg IS NULL
    )
);

ALTER TABLE runs ADD CONSTRAINT runs_range_has_no_charging_columns CHECK (
    kind <> 'range' OR charge_energy_kwh IS NULL
);

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
--
-- 1. Nothing was lost. Against the census taken before running, this should
--    equal range_links + charging_links:
--
--      SELECT count(*) FILTER (WHERE source_url IS NOT NULL) AS links,
--             count(*)                                       AS total
--      FROM runs;
--
-- 2. The old columns are gone — expect 0 rows:
--
--      SELECT column_name FROM information_schema.columns
--      WHERE table_schema = 'public' AND table_name = 'runs'
--        AND column_name IN ('url', 'charging_url');
--
-- 3. Both constraints exist and neither mentions a dropped column:
--
--      SELECT conname, pg_get_constraintdef(oid)
--      FROM pg_constraint
--      WHERE conrelid = 'public.runs'::regclass AND contype = 'c'
--      ORDER BY conname;
--
-- 4. Links now sit on both kinds, which the old schema could not express:
--
--      SELECT kind, count(*) FILTER (WHERE source_url IS NOT NULL) AS with_link,
--             count(*) AS total
--      FROM runs GROUP BY kind ORDER BY kind;
