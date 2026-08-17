-- ============================================================
-- Migration 054: server-side aggregates for two reads that counted in JS
--
-- Additive only. Creates two functions; touches no table, no column, no policy.
--
-- ── Why these exist ─────────────────────────────────────────────────────────
--
-- PostgREST has aggregate functions disabled on this project, so both callers
-- fetched whole result sets and reduced them in JavaScript. That is wasteful,
-- but the reason it became a bug is the row cap: Supabase truncates a response
-- at db-max-rows (1000) with no error and no flag, just a short array. A read
-- that aggregates client-side therefore returns a confidently wrong answer the
-- moment the underlying data outgrows the cap.
--
-- It did. The Fuel Economy Guide summary showed 2024-2027 and silently omitted
-- 2022 and 2023 — the four visible years summed to exactly 1000 rows. And
-- get_soc_ranges reads every SoC sample for every selected run in one request,
-- so at ~200 points per run the cap arrives at about FIVE runs, which is
-- ordinary use. Past that it returned a min/max computed from part of the data.
--
-- Aggregating in Postgres removes the cap from the picture entirely: the
-- functions return one row per group, so there is no large result set to
-- truncate.
--
-- ── SECURITY INVOKER, deliberately ──────────────────────────────────────────
--
-- Both are INVOKER (the default, stated explicitly here because it matters).
-- RLS therefore still applies and neither function can see a row its caller
-- could not read directly. SECURITY DEFINER would turn a counting helper into
-- a way to observe restricted rows in aggregate, which is not a trade worth
-- making for a summary table.
--
-- STABLE, not IMMUTABLE: both read tables, so their results depend on data
-- rather than arguments alone.
-- ============================================================

BEGIN;

-- ── 1. Fuel Economy Guide import summary ─────────────────────────────────────
--
-- Returns one row per staged model year — the Admin import summary — instead of
-- ~1600 rows of (model_year, division) to be counted in the browser.
--
-- `divisions` is a DISTINCT count: a model year holds one row per configuration
-- and thirty-odd rows per make, and the summary reports how many makes are
-- represented, not how many rows they occupy.

CREATE OR REPLACE FUNCTION public.fe_guide_summary()
RETURNS TABLE (
    model_year integer,
    row_count  bigint,
    divisions  bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        g.model_year,
        count(*)                   AS row_count,
        count(DISTINCT g.division) AS divisions
    FROM epa_fe_guide g
    GROUP BY g.model_year
    ORDER BY g.model_year DESC;
$$;

GRANT EXECUTE ON FUNCTION public.fe_guide_summary() TO anon, authenticated;


-- ── 2. Real SoC span per run ─────────────────────────────────────────────────
--
-- runs.start_soc / end_soc cannot be trusted for a charging test — migration
-- 046 copied them from the original dual-role row, where they described the
-- DISCHARGE — so the span is computed from the points, which are the actual
-- measurement. See DataService.getSocRanges.
--
-- Takes the run ids as an array so one request covers every selected run.
-- Returns one row per run that has at least one non-null SoC sample; a run with
-- none is simply absent, which the caller already treats as "no span known".

CREATE OR REPLACE FUNCTION public.run_soc_ranges(p_run_ids bigint[])
RETURNS TABLE (
    run_id  bigint,
    min_soc numeric,
    max_soc numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
    SELECT
        d.run_id,
        min(d.soc) AS min_soc,
        max(d.soc) AS max_soc
    FROM data_points d
    WHERE d.run_id = ANY(p_run_ids)
      AND d.soc IS NOT NULL
    GROUP BY d.run_id;
$$;

GRANT EXECUTE ON FUNCTION public.run_soc_ranges(bigint[]) TO anon, authenticated;

COMMIT;
