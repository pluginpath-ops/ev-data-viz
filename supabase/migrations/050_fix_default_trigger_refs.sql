-- ─────────────────────────────────────────────────────────────────────────────
-- 050: repair 049 — it referenced a column and a function that no longer exist.
--
-- 049 guarded against a trigger-ordering hazard by deriving the kind:
--
--     v_kind := COALESCE(NEW.kind, runs_derive_kind(NEW.has_charging, NEW.has_range));
--
-- Every part of that fallback is dead. Migration 046 dropped runs.has_charging,
-- runs.has_range, the runs_derive_kind() function, AND trg_runs_sync_kind — the
-- very trigger whose firing order the fallback existed to survive. There is no
-- ordering hazard left to defend against.
--
-- plpgsql resolves record fields at EXECUTION time, so the migration applied
-- cleanly and the function only failed when a default was actually set:
--
--     Error setting default run: record "new" has no field "has_charging"
--
-- runs.kind is NOT NULL in practice and set explicitly by the application on
-- insert, so it can simply be trusted.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ensure_single_default_run() RETURNS trigger AS $$
BEGIN
    IF NEW.is_default IS NOT TRUE THEN
        RETURN NEW;
    END IF;

    -- Per KIND: a vehicle may hold both a default charging run and a default
    -- range test. Clearing across kinds is what this migration series fixes.
    UPDATE runs
       SET is_default = false
     WHERE vehicle_id = NEW.vehicle_id
       AND id IS DISTINCT FROM NEW.id
       AND is_default
       AND kind = NEW.kind;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ensure_single_default_run() IS
    'Keeps at most one default run per vehicle PER KIND: a vehicle may have both a default charging run and a default range test.';
