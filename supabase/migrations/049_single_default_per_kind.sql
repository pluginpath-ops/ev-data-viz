-- ─────────────────────────────────────────────────────────────────────────────
-- 049: make the single-default rule kind-aware.
--
-- A vehicle has TWO defaults since migration 046 split dual-role runs: a
-- default charging run (the fallback curve) and a default range test (rank 2 of
-- the range-source resolution order). #183 taught the application to scope its
-- clearing per kind — and it had no effect, because the database was undoing it.
--
-- `enforce_single_default_run` clears every other default row for the vehicle,
-- regardless of kind. Setting a range default therefore cleared the charging
-- default in the same statement. The symptom was that both defaults appeared to
-- work in-session (the optimistic UI is per-kind and correct) and only the last
-- one survived a reload.
--
-- Evidence: on vehicle 26 every run carries the identical updated_at of
-- 2026-08-10T13:11:15 — one write, fanned out across the whole vehicle.
--
-- This trigger and its function appear in NO migration; they were created out of
-- band, like runs.elevation_gain_ft before migration 047. Both are (re)created
-- here so the migration set finally describes the real database.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ensure_single_default_run() RETURNS trigger AS $$
DECLARE
    v_kind text;
BEGIN
    IF NEW.is_default IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    -- The kind this row will actually have once every BEFORE trigger has run.
    --
    -- Same-timing triggers fire in alphabetical order, so this one runs BEFORE
    -- trg_runs_sync_kind — which means NEW.kind may not yet be synced from the
    -- legacy boolean pair on an INSERT. Deriving it here makes the result
    -- independent of trigger order rather than dependent on a naming accident.
    v_kind := COALESCE(NEW.kind, runs_derive_kind(NEW.has_charging, NEW.has_range));

    UPDATE runs
       SET is_default = false
     WHERE vehicle_id = NEW.vehicle_id
       AND id IS DISTINCT FROM NEW.id
       AND is_default
       AND COALESCE(kind, runs_derive_kind(has_charging, has_range)) = v_kind;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreated so the trigger exists for a database built from these files alone.
DROP TRIGGER IF EXISTS enforce_single_default_run ON runs;
CREATE TRIGGER enforce_single_default_run
    BEFORE INSERT OR UPDATE ON runs
    FOR EACH ROW EXECUTE FUNCTION ensure_single_default_run();

COMMENT ON FUNCTION ensure_single_default_run() IS
    'Keeps at most one default run per vehicle PER KIND: a vehicle may have both a default charging run and a default range test.';
