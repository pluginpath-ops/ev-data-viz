-- ============================================================
-- Add timestamp support to replace_run_data_points RPC
--
-- Previously the function only inserted soc, charge_rate,
-- time_value, range_value, and temperature.  The timestamp
-- column (timestamptz, nullable) on data_points was silently
-- ignored, so any wall-clock timestamps imported via CSV
-- would be erased when the run was edited and saved.
--
-- This replaces the function body to also read an optional
-- "timestamp" key from each p_rows element.  Existing callers
-- that do not supply timestamp will not be affected — the
-- column simply remains NULL for those rows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.replace_run_data_points(
    p_run_id bigint,
    p_rows   jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Remove all existing data points for this run
    DELETE FROM public.data_points WHERE run_id = p_run_id;

    -- Re-insert with the supplied rows (timestamp is optional)
    INSERT INTO public.data_points
        (run_id, frame, timestamp, soc, charge_rate, time_value, range_value, temperature)
    SELECT
        p_run_id,
        (r->>'frame')::integer,
        NULLIF(r->>'timestamp', '')::timestamptz,
        NULLIF(r->>'soc',         '')::numeric,
        NULLIF(r->>'charge_rate', '')::numeric,
        NULLIF(r->>'time_value',  '')::numeric,
        NULLIF(r->>'range_value', '')::numeric,
        NULLIF(r->>'temperature', '')::numeric
    FROM jsonb_array_elements(p_rows) AS r;
END;
$$;
