-- Migration 069: clearing a spec flag is admin-only in the database, not just the app
-- Applies: paste into Supabase SQL Editor (safe to re-run)
--
-- -- Why -----------------------------------------------------------------------
--
-- Community members flag a spec value they think is wrong; an admin clears the
-- flag once it has been looked at. 005 made both RPCs SECURITY DEFINER, so an
-- anonymous caller can write vehicles.flagged_specs without UPDATE rights on
-- vehicles. That is deliberate for flag_spec_field: flagging is open to anyone.
--
-- It was not deliberate for unflag_spec_field. Its comment said "admin-only
-- enforcement in application layer", and the only guard was
-- `if (!isAdmin) return;` in AppContext.unflagSpecField. A SECURITY DEFINER
-- function runs with its owner's rights whoever calls it, and PostgREST exposes
-- every function in public as /rpc/<name>. So anyone holding the public anon
-- key could clear every flag on every vehicle with one request, and the app's
-- check never ran.
--
-- -- What changes ----------------------------------------------------------------
--
-- 1. The function checks the caller's role itself, the way the 062 constants
--    RPCs do, and raises for anyone but an admin. The app already handles a
--    thrown error here: it puts the flag back and says the clear failed.
-- 2. EXECUTE is revoked from anon (and from PUBLIC, which every role inherits
--    and which Postgres grants on new functions by default). A signed-out
--    caller now cannot reach the function at all. The role check is still the
--    real guard: a signed-in contributor or viewer holds `authenticated` and
--    can call it, and is refused inside.
-- 3. search_path is pinned. A SECURITY DEFINER function that resolves names
--    through the caller's search_path can be pointed at look-alike objects;
--    everything here is schema-qualified, and the pin makes that hold.
--
-- flag_spec_field is left exactly as it is: open to everyone on purpose.
--
-- plpgsql rather than sql: a sql-language function cannot RAISE.

CREATE OR REPLACE FUNCTION public.unflag_spec_field(p_vehicle_id bigint, p_field_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Access denied: must be an admin to clear a spec flag'
            USING ERRCODE = '42501';   -- insufficient_privilege
    END IF;

    UPDATE public.vehicles
    SET flagged_specs = array_remove(flagged_specs, p_field_key)
    WHERE id = p_vehicle_id;
END;
$$;

COMMENT ON FUNCTION public.unflag_spec_field(bigint, text) IS
    'Clear one community flag on a spec field. Admin only, checked here (069); flag_spec_field stays open to everyone.';

REVOKE EXECUTE ON FUNCTION public.unflag_spec_field(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unflag_spec_field(bigint, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
