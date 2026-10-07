-- ============================================================
-- Who may call the data_points write RPCs
--
-- replace_run_data_points and merge_run_data_points are SECURITY DEFINER, so
-- they bypass the data_points RLS policies in 007. The check therefore has to
-- live inside each function, and it should say the same thing 007 says: the
-- caller owns the run's vehicle, or is an admin or contributor.
--
-- What production was actually running (from the 2026-09-28 dump) differed from
-- what this directory claims in two ways, and both are corrected here:
--
--   * Both functions checked ownership only — `v.user_id = auth.uid()`. That
--     refused anonymous callers, but it also refused a contributor editing
--     someone else's vehicle, which 007 allows. A contributor's edit-and-save
--     raised "Not authorized".
--   * merge_run_data_points had no migration at all, and replace_run_data_points
--     had been redefined outside 024: it returns integer, not void, and it
--     dropped 024's `timestamp` column, so wall-clock timestamps imported from a
--     CSV were erased whenever the run was edited and saved. The `timestamp` read
--     is restored below; DataService.replaceRunData already sends it.
--
-- And EXECUTE was granted to anon (PUBLIC by default, and Supabase's default
-- privileges add anon explicitly), so the function body was the only line of
-- defence. It is revoked: an anonymous visitor has no business reaching these.
--
-- The check is written INSIDE an EXISTS, as 007 writes it, and that is not a
-- style choice. For an anonymous caller current_user_role() is NULL, so
-- `IF NOT (owner OR role IN (...))` becomes `IF NOT (NULL)` — NULL, which plpgsql
-- treats as false, and the call would go through. In a WHERE clause NULL simply
-- fails to match.
--
-- Safe to run twice. replace_run_data_points is DROPped first because CREATE OR
-- REPLACE cannot change a return type (void in 024, integer in production), and
-- the whole migration is one transaction so the function is never absent.
-- Apply in the Supabase SQL editor.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.replace_run_data_points(bigint, jsonb);

CREATE FUNCTION public.replace_run_data_points(
    p_run_id bigint,
    p_rows   jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
BEGIN
    -- Same rule as the 007 policies: owner of the run's vehicle, or admin/contributor.
    IF NOT EXISTS (
        SELECT 1
        FROM public.runs r
        JOIN public.vehicles v ON v.id = r.vehicle_id
        WHERE r.id = p_run_id
          AND (
            v.user_id = auth.uid()
            OR public.current_user_role() IN ('admin', 'contributor')
          )
    ) THEN
        RAISE EXCEPTION 'Not authorized to edit data for run %', p_run_id
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.data_points WHERE run_id = p_run_id;

    INSERT INTO public.data_points
        (run_id, frame, timestamp, soc, charge_rate, time_value, range_value, temperature)
    SELECT
        p_run_id,
        (r->>'frame')::integer,
        NULLIF(r->>'timestamp', '')::timestamptz,
        ROUND(NULLIF(r->>'soc',         '')::numeric, 1)::float8,
        ROUND(NULLIF(r->>'charge_rate', '')::numeric, 2)::float8,
        ROUND(NULLIF(r->>'time_value',  '')::numeric, 1)::float8,
        ROUND(NULLIF(r->>'range_value', '')::numeric, 1)::float8,
        ROUND(NULLIF(r->>'temperature', '')::numeric, 1)::float8
    FROM jsonb_array_elements(p_rows) AS r;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Body unchanged from production apart from the check at the top.
CREATE OR REPLACE FUNCTION public.merge_run_data_points(
    p_run_id   bigint,
    p_join_key text,
    p_rows     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_updated  integer := 0;
    v_inserted integer := 0;
BEGIN
    -- Same rule as the 007 policies: owner of the run's vehicle, or admin/contributor.
    IF NOT EXISTS (
        SELECT 1
        FROM public.runs r
        JOIN public.vehicles v ON v.id = r.vehicle_id
        WHERE r.id = p_run_id
          AND (
            v.user_id = auth.uid()
            OR public.current_user_role() IN ('admin', 'contributor')
          )
    ) THEN
        RAISE EXCEPTION 'Not authorized to edit data for run %', p_run_id
            USING ERRCODE = '42501';
    END IF;

    IF p_join_key = 'soc' THEN
        UPDATE public.data_points dp SET
            charge_rate = COALESCE(inc.charge_rate, dp.charge_rate),
            time_value  = COALESCE(inc.time_value,  dp.time_value),
            range_value = COALESCE(inc.range_value, dp.range_value),
            temperature = COALESCE(inc.temperature, dp.temperature)
        FROM (
            SELECT
                ROUND((r->>'soc')::numeric,         1)::float8 AS soc,
                ROUND((r->>'charge_rate')::numeric, 2)::float8 AS charge_rate,
                ROUND((r->>'time_value')::numeric,  1)::float8 AS time_value,
                ROUND((r->>'range_value')::numeric, 1)::float8 AS range_value,
                ROUND((r->>'temperature')::numeric, 1)::float8 AS temperature
            FROM jsonb_array_elements(p_rows) r
        ) inc
        WHERE dp.run_id = p_run_id AND dp.soc = inc.soc;
        GET DIAGNOSTICS v_updated = ROW_COUNT;

        INSERT INTO public.data_points (run_id, frame, soc, charge_rate, time_value, range_value, temperature)
        SELECT
            p_run_id,
            (SELECT COALESCE(MAX(frame), -1) FROM public.data_points WHERE run_id = p_run_id)
                + (ROW_NUMBER() OVER ())::int,
            inc.soc, inc.charge_rate, inc.time_value, inc.range_value, inc.temperature
        FROM (
            SELECT
                ROUND((r->>'soc')::numeric,         1)::float8 AS soc,
                ROUND((r->>'charge_rate')::numeric, 2)::float8 AS charge_rate,
                ROUND((r->>'time_value')::numeric,  1)::float8 AS time_value,
                ROUND((r->>'range_value')::numeric, 1)::float8 AS range_value,
                ROUND((r->>'temperature')::numeric, 1)::float8 AS temperature
            FROM jsonb_array_elements(p_rows) r
        ) inc
        WHERE NOT EXISTS (
            SELECT 1 FROM public.data_points dp
            WHERE dp.run_id = p_run_id AND dp.soc = inc.soc
        );
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

    ELSIF p_join_key = 'time' THEN
        UPDATE public.data_points dp SET
            soc         = COALESCE(inc.soc,         dp.soc),
            charge_rate = COALESCE(inc.charge_rate, dp.charge_rate),
            range_value = COALESCE(inc.range_value, dp.range_value),
            temperature = COALESCE(inc.temperature, dp.temperature)
        FROM (
            SELECT
                ROUND((r->>'soc')::numeric,         1)::float8 AS soc,
                ROUND((r->>'charge_rate')::numeric, 2)::float8 AS charge_rate,
                ROUND((r->>'time_value')::numeric,  1)::float8 AS time_value,
                ROUND((r->>'range_value')::numeric, 1)::float8 AS range_value,
                ROUND((r->>'temperature')::numeric, 1)::float8 AS temperature
            FROM jsonb_array_elements(p_rows) r
        ) inc
        WHERE dp.run_id = p_run_id AND dp.time_value = inc.time_value;
        GET DIAGNOSTICS v_updated = ROW_COUNT;

        INSERT INTO public.data_points (run_id, frame, soc, charge_rate, time_value, range_value, temperature)
        SELECT
            p_run_id,
            (SELECT COALESCE(MAX(frame), -1) FROM public.data_points WHERE run_id = p_run_id)
                + (ROW_NUMBER() OVER ())::int,
            inc.soc, inc.charge_rate, inc.time_value, inc.range_value, inc.temperature
        FROM (
            SELECT
                ROUND((r->>'soc')::numeric,         1)::float8 AS soc,
                ROUND((r->>'charge_rate')::numeric, 2)::float8 AS charge_rate,
                ROUND((r->>'time_value')::numeric,  1)::float8 AS time_value,
                ROUND((r->>'range_value')::numeric, 1)::float8 AS range_value,
                ROUND((r->>'temperature')::numeric, 1)::float8 AS temperature
            FROM jsonb_array_elements(p_rows) r
        ) inc
        WHERE NOT EXISTS (
            SELECT 1 FROM public.data_points dp
            WHERE dp.run_id = p_run_id AND dp.time_value = inc.time_value
        );
        GET DIAGNOSTICS v_inserted = ROW_COUNT;

    ELSE
        RAISE EXCEPTION 'Invalid join key: %. Must be ''soc'' or ''time''.', p_join_key;
    END IF;

    RETURN jsonb_build_object('updated', v_updated, 'inserted', v_inserted);
END;
$$;

COMMENT ON FUNCTION public.replace_run_data_points(bigint, jsonb) IS
    'Replace every data point of one run. Owner of the run''s vehicle, admin or contributor only, checked here (078); anon has no EXECUTE.';
COMMENT ON FUNCTION public.merge_run_data_points(bigint, text, jsonb) IS
    'Merge data points into one run on soc or time. Owner of the run''s vehicle, admin or contributor only, checked here (078); anon has no EXECUTE.';

REVOKE EXECUTE ON FUNCTION public.replace_run_data_points(bigint, jsonb)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.merge_run_data_points(bigint, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.replace_run_data_points(bigint, jsonb)     TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.merge_run_data_points(bigint, text, jsonb) TO authenticated, service_role;

COMMIT;
