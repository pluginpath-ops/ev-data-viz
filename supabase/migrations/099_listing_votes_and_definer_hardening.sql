-- ============================================================
-- 099: only curators list; votes, two open functions, and two views
--
-- From the SQL audit after 097 (2026-11-08). Each part below was confirmed
-- against the local mirror; the read leaks were also seen in production.
--
-- 1. LISTING IS FOR CURATORS. Anyone signed in may add a vehicle, but only a
--    curator (contributor or admin) may list it. Before this, a signed-in
--    viewer could insert a vehicle with visibility = 'public', or flip their
--    own to public, straight through the API; the UI's canPublish() was the
--    only gate. Now one function, can_write_vehicle(), says who may write a
--    vehicle and everything under it (tests, points, trims, CSV metadata):
--    a curator, or the owner of an UNLISTED vehicle. Once a curator lists a
--    viewer's vehicle, its owner can no longer change it or its tests.
--
-- 2. VOTES. "votes: delete" was USING (true): anyone could delete every vote.
--    And every browser_token was readable, so a token was no secret anyway.
--    Writes now go through cast_vote(), which only touches the caller's own
--    token, and the token column is no longer readable; my_votes() answers
--    "which did this browser cast".
--
-- 3. TWO OPEN FUNCTIONS. flag_spec_field stays open to everyone on purpose
--    (069), but now takes only a spec-shaped key. log_access_attempt took the
--    user id and email as arguments, so anyone could write a log row in
--    someone else's name; it now records who is actually calling.
--
-- 4. TWO VIEWS. all_vehicles_with_stats and public_vehicles were unused, and
--    views run as their owner, past RLS: the first served every vehicle with
--    profiles.full_name to the anon key. Dropped.
--
-- 5. search_path pinned on every SECURITY DEFINER function that lacked it.
--
-- Safe to run twice.
-- ============================================================


-- ── 1. Listing is for curators ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_write_vehicle(p_vehicle_id bigint)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT public.is_owner()
      OR public.current_user_role() IN ('admin', 'contributor')
      OR EXISTS (
           SELECT 1 FROM public.vehicles v
           WHERE v.id = p_vehicle_id
             AND v.user_id = auth.uid()
             AND v.visibility <> 'public'
         );
$$;

COMMENT ON FUNCTION public.can_write_vehicle(bigint) IS
  'Who may write a vehicle and what hangs off it: a curator, or the owner of an unlisted vehicle (099).';

-- vehicles. "Users can manage their own vehicles" was FOR ALL with no WITH
-- CHECK, which is what let a viewer insert a listed vehicle.
DROP POLICY IF EXISTS "Users can manage their own vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Owner can insert vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles insert" ON public.vehicles;
CREATE POLICY "vehicles insert" ON public.vehicles
  FOR INSERT WITH CHECK (
    public.is_owner()
    OR (
      user_id = auth.uid()
      AND (visibility <> 'public' OR public.current_user_role() IN ('admin', 'contributor'))
    )
  );

DROP POLICY IF EXISTS "rbac: vehicles update" ON public.vehicles;
CREATE POLICY "rbac: vehicles update" ON public.vehicles
  FOR UPDATE
  USING (public.can_write_vehicle(id))
  -- The row as it will be: a viewer may not list it, nor hand it to someone else.
  WITH CHECK (
    public.is_owner()
    OR public.current_user_role() IN ('admin', 'contributor')
    OR (user_id = auth.uid() AND visibility <> 'public')
  );

DROP POLICY IF EXISTS "Owner can delete any vehicle, users can delete own" ON public.vehicles;
DROP POLICY IF EXISTS "vehicles delete" ON public.vehicles;
CREATE POLICY "vehicles delete" ON public.vehicles
  FOR DELETE USING (
    public.is_owner()
    OR public.current_user_role() = 'admin'
    OR (user_id = auth.uid() AND visibility <> 'public')
  );

-- runs
DROP POLICY IF EXISTS "rbac: runs insert" ON public.runs;
CREATE POLICY "rbac: runs insert" ON public.runs
  FOR INSERT WITH CHECK (public.can_write_vehicle(vehicle_id));

DROP POLICY IF EXISTS "rbac: runs update" ON public.runs;
CREATE POLICY "rbac: runs update" ON public.runs
  FOR UPDATE USING (public.can_write_vehicle(vehicle_id))
  WITH CHECK (public.can_write_vehicle(vehicle_id));

-- Contributors still may not delete tests (only composites, by its own policy).
DROP POLICY IF EXISTS "rbac: runs delete" ON public.runs;
CREATE POLICY "rbac: runs delete" ON public.runs
  FOR DELETE USING (
    public.is_owner()
    OR public.current_user_role() = 'admin'
    OR EXISTS (
         SELECT 1 FROM public.vehicles v
         WHERE v.id = runs.vehicle_id
           AND v.user_id = auth.uid()
           AND v.visibility <> 'public'
       )
  );

-- data_points: seven overlapping write policies from three eras, folded to three.
DROP POLICY IF EXISTS "Users can manage data points on their runs" ON public.data_points;
DROP POLICY IF EXISTS "Owner can insert data points" ON public.data_points;
DROP POLICY IF EXISTS "Owner can update data points" ON public.data_points;
DROP POLICY IF EXISTS "Owners can update data points" ON public.data_points;
DROP POLICY IF EXISTS "Owner can delete data points" ON public.data_points;
DROP POLICY IF EXISTS "rbac: data_points insert" ON public.data_points;
DROP POLICY IF EXISTS "rbac: data_points update" ON public.data_points;
DROP POLICY IF EXISTS "rbac: data_points delete" ON public.data_points;
CREATE POLICY "rbac: data_points insert" ON public.data_points
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.runs r WHERE r.id = data_points.run_id AND public.can_write_vehicle(r.vehicle_id))
  );
CREATE POLICY "rbac: data_points update" ON public.data_points
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.runs r WHERE r.id = data_points.run_id AND public.can_write_vehicle(r.vehicle_id))
  );
CREATE POLICY "rbac: data_points delete" ON public.data_points
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.runs r WHERE r.id = data_points.run_id AND public.can_write_vehicle(r.vehicle_id))
  );

-- trims
DROP POLICY IF EXISTS "trims: insert" ON public.trims;
CREATE POLICY "trims: insert" ON public.trims
  FOR INSERT WITH CHECK (public.can_write_vehicle(vehicle_id));
DROP POLICY IF EXISTS "trims: update" ON public.trims;
CREATE POLICY "trims: update" ON public.trims
  FOR UPDATE USING (public.can_write_vehicle(vehicle_id))
  WITH CHECK (public.can_write_vehicle(vehicle_id));
DROP POLICY IF EXISTS "trims: delete" ON public.trims;
CREATE POLICY "trims: delete" ON public.trims
  FOR DELETE USING (public.can_write_vehicle(vehicle_id));

-- csv_uploads
DROP POLICY IF EXISTS "Owner can insert CSV metadata" ON public.csv_uploads;
CREATE POLICY "Owner can insert CSV metadata" ON public.csv_uploads
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.runs r WHERE r.id = csv_uploads.run_id AND public.can_write_vehicle(r.vehicle_id))
  );

-- The two point-writing RPCs are SECURITY DEFINER, so they carry the rule
-- themselves (078). Bodies unchanged apart from the check.
CREATE OR REPLACE FUNCTION public.replace_run_data_points(p_run_id bigint, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_count integer;
BEGIN
    -- The same rule as every vehicle write (099): a curator, or the owner of
    -- an unlisted vehicle.
    IF NOT EXISTS (
        SELECT 1 FROM public.runs r
        WHERE r.id = p_run_id AND public.can_write_vehicle(r.vehicle_id)
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
$function$

;

CREATE OR REPLACE FUNCTION public.merge_run_data_points(p_run_id bigint, p_join_key text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_updated  integer := 0;
    v_inserted integer := 0;
BEGIN
    -- The same rule as every vehicle write (099): a curator, or the owner of
    -- an unlisted vehicle.
    IF NOT EXISTS (
        SELECT 1 FROM public.runs r
        WHERE r.id = p_run_id AND public.can_write_vehicle(r.vehicle_id)
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
$function$

;


-- ── 2. Votes ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "votes: delete" ON public.votes;
DROP POLICY IF EXISTS "votes: insert" ON public.votes;
-- "votes: select" (USING true) stays: counts are public. The token is not.
REVOKE ALL ON public.votes FROM anon, authenticated;
GRANT SELECT (id, target_type, target_id, vote_type, created_at) ON public.votes TO anon, authenticated;

-- One vote per browser per target. The same vote again takes it back; a
-- different one replaces it. Returns this browser's vote after the call.
CREATE OR REPLACE FUNCTION public.cast_vote(
  p_browser_token uuid,
  p_target_type   text,
  p_target_id     bigint,
  p_vote_type     text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  prior text;
BEGIN
  IF p_browser_token IS NULL THEN
    RAISE EXCEPTION 'A browser token is required';
  END IF;

  DELETE FROM public.votes
  WHERE browser_token = p_browser_token
    AND target_type = p_target_type
    AND target_id = p_target_id
  RETURNING vote_type INTO prior;

  IF prior IS NOT DISTINCT FROM p_vote_type THEN
    RETURN NULL;
  END IF;

  -- The table's CHECK constraints reject an unknown type or target.
  INSERT INTO public.votes (browser_token, target_type, target_id, vote_type)
  VALUES (p_browser_token, p_target_type, p_target_id, p_vote_type);
  RETURN p_vote_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_votes(
  p_browser_token uuid,
  p_target_type   text,
  p_target_ids    bigint[]
)
  RETURNS TABLE (target_id bigint, vote_type text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT v.target_id, v.vote_type
  FROM public.votes v
  WHERE v.browser_token = p_browser_token
    AND v.target_type = p_target_type
    AND v.target_id = ANY (p_target_ids);
$$;

GRANT EXECUTE ON FUNCTION public.cast_vote(uuid, text, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_votes(uuid, text, bigint[]) TO anon, authenticated;


-- ── 3. Two open functions ───────────────────────────────────────────────────

-- Open to every reader on purpose (069). A key is 'category.field' (custom
-- fields add a part: 'compute._custom.fsd'), so anything else is refused
-- rather than stored.
CREATE OR REPLACE FUNCTION public.flag_spec_field(p_vehicle_id bigint, p_field_key text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_field_key IS NULL OR length(p_field_key) > 120
     OR p_field_key !~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){1,3}$' THEN
    RAISE EXCEPTION 'Not a spec field: %', left(coalesce(p_field_key, ''), 40);
  END IF;

  UPDATE public.vehicles
  SET flagged_specs = array_append(flagged_specs, p_field_key)
  WHERE id = p_vehicle_id AND NOT (p_field_key = ANY (flagged_specs));
END;
$$;

-- Signature kept so the app's call does not change; the id and email it
-- passes are ignored in favour of who is really asking.
CREATE OR REPLACE FUNCTION public.log_access_attempt(
  p_user_id       uuid,
  p_user_email    text,
  p_operation     text,
  p_resource_type text,
  p_resource_id   text,
  p_error_code    text,
  p_error_message text,
  p_user_agent    text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO access_logs
    (user_id, user_email, operation, resource_type, resource_id,
     error_code, error_message, user_agent)
  VALUES
    (auth.uid(), auth.jwt() ->> 'email',
     left(p_operation, 100), left(p_resource_type, 100), left(p_resource_id, 200),
     left(p_error_code, 50), left(p_error_message, 1000), left(p_user_agent, 500));
END;
$$;


-- ── 4. Two views ────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.all_vehicles_with_stats;
DROP VIEW IF EXISTS public.public_vehicles;


-- ── 5. search_path on the remaining SECURITY DEFINER functions ──────────────

ALTER FUNCTION public.can_access_vehicle(bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.current_user_role()        SET search_path = public, pg_temp;
ALTER FUNCTION public.get_admin_users()          SET search_path = public, pg_temp;
ALTER FUNCTION public.is_owner()                 SET search_path = public, pg_temp;
ALTER FUNCTION public.set_user_role(uuid, text)  SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()          SET search_path = public, pg_temp;
