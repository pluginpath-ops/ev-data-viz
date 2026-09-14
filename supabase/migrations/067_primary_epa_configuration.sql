-- ============================================================
-- Migration 067: one primary EPA configuration per vehicle (#322)
--
-- Additive. One column, one index, one trigger function. Nothing dropped.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
--
-- epa_vehicle_mappings links a vehicle to any number of EPA test groups, and one
-- vehicle row often spans wheel and trim variants: 22 of the 51 linked vehicles
-- link to more than one, and their label ranges differ by up to a third
-- (Gravity Grand Touring: 337–450 mi). Nothing said which configuration stands
-- for the vehicle, so "the vehicle's EPA range" was not one number — nor its
-- EPA tested capacity, nor the test weight its curb weight is checked against.
-- #323 and #324 both need that one number.
--
-- `confidence` (verified / likely / inferred) says how sure a match is;
-- `is_primary` says which match represents the vehicle. Different facts, both
-- kept.
--
-- ── The rules ───────────────────────────────────────────────────────────────
--
--   1. At most one primary per vehicle — a partial unique index, as
--      epa_coefficient_sets does for its primary set (027).
--   2. Making a link primary clears the vehicle's previous one, in the same
--      statement, so the client writes a single UPDATE and the index is never
--      violated. Same shape as ensure_single_default_run (049/050).
--   3. A vehicle's ONLY link is its primary. There is nothing to choose between,
--      so there is no reason to make a curator say so:
--        - the backfill marks every vehicle that has exactly one link;
--        - a vehicle's first link is marked as it is inserted;
--        - unlinking down to one link marks the one left.
--      A vehicle with several links and no primary is legitimate — it is what
--      the backfill leaves for the 22 — and Admin → Data Checks lists it.
--
-- Rule 3 never picks between two links. Adding a second link to a vehicle keeps
-- the first as primary, and the curator can move it; that is visible on the
-- vehicle's EPA section, beside the label range and EPA tested of each.
--
-- ── Applying it ─────────────────────────────────────────────────────────────
--
-- Safe before or after the app change: getVehicles() reads the mapping with a
-- wildcard, so an unapplied column comes back undefined and the app treats a
-- sole link as primary on its own. Choosing a primary fails until it is applied.
-- Safe to run twice.
-- ============================================================

BEGIN;

ALTER TABLE epa_vehicle_mappings
    ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN epa_vehicle_mappings.is_primary IS
    'The linked EPA configuration that stands for the vehicle: its label range, EPA tested capacity and test weight. At most one per vehicle; a sole link is always primary (#322).';

-- Rule 1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_epa_mappings_one_primary
    ON epa_vehicle_mappings(vehicle_id)
    WHERE is_primary;

-- Rule 3, for the links that already exist. Before the trigger, so the backfill
-- is not also clearing rows it has no reason to touch.
UPDATE epa_vehicle_mappings m
   SET is_primary = true
 WHERE NOT m.is_primary
   AND (SELECT count(*) FROM epa_vehicle_mappings o WHERE o.vehicle_id = m.vehicle_id) = 1;

-- Rules 2 and 3 on insert and update.
CREATE OR REPLACE FUNCTION ensure_single_primary_epa_mapping() RETURNS trigger AS $$
BEGIN
    -- A vehicle's first link is its primary.
    IF TG_OP = 'INSERT' AND NOT NEW.is_primary AND NOT EXISTS (
        SELECT 1 FROM epa_vehicle_mappings WHERE vehicle_id = NEW.vehicle_id
    ) THEN
        NEW.is_primary := true;
    END IF;

    IF NEW.is_primary THEN
        -- BEFORE the row is written, so the old primary is already cleared when
        -- the unique index checks the new one.
        UPDATE epa_vehicle_mappings
           SET is_primary = false
         WHERE vehicle_id = NEW.vehicle_id
           AND id IS DISTINCT FROM NEW.id
           AND is_primary;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ensure_single_primary_epa_mapping() IS
    'Keeps at most one primary EPA configuration per vehicle, and makes a vehicle''s first link primary (#322).';

DROP TRIGGER IF EXISTS enforce_single_primary_epa_mapping ON epa_vehicle_mappings;
CREATE TRIGGER enforce_single_primary_epa_mapping
    BEFORE INSERT OR UPDATE OF is_primary ON epa_vehicle_mappings
    FOR EACH ROW EXECUTE FUNCTION ensure_single_primary_epa_mapping();

-- Rule 3 on delete. AFTER, and per row: when a vehicle is deleted its links
-- cascade in one statement, and by the time these fire none are left to mark.
CREATE OR REPLACE FUNCTION promote_sole_epa_mapping() RETURNS trigger AS $$
BEGIN
    UPDATE epa_vehicle_mappings m
       SET is_primary = true
     WHERE m.vehicle_id = OLD.vehicle_id
       AND NOT m.is_primary
       AND (SELECT count(*) FROM epa_vehicle_mappings o WHERE o.vehicle_id = OLD.vehicle_id) = 1;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION promote_sole_epa_mapping() IS
    'After an unlink, marks the vehicle''s one remaining EPA link as primary (#322).';

DROP TRIGGER IF EXISTS promote_sole_epa_mapping ON epa_vehicle_mappings;
CREATE TRIGGER promote_sole_epa_mapping
    AFTER DELETE ON epa_vehicle_mappings
    FOR EACH ROW EXECUTE FUNCTION promote_sole_epa_mapping();

COMMIT;

-- The API caches the schema. Without this the column exists in Postgres but a
-- write naming it is refused — "Could not find the 'is_primary' column of
-- 'epa_vehicle_mappings' in the schema cache" — until the cache next refreshes.
-- Reads were unaffected, which is why the site loaded and only choosing failed.
NOTIFY pgrst, 'reload schema';

-- ── Verification ────────────────────────────────────────────────────────────
--
-- No vehicle has two primaries (expect 0 rows):
--   SELECT vehicle_id FROM epa_vehicle_mappings WHERE is_primary
--    GROUP BY vehicle_id HAVING count(*) > 1;
--
-- Every sole link is primary (expect 0 rows):
--   SELECT vehicle_id FROM epa_vehicle_mappings GROUP BY vehicle_id
--   HAVING count(*) = 1 AND NOT bool_or(is_primary);
--
-- The vehicles still to choose for (22 at the time of writing):
--   SELECT vehicle_id, count(*) FROM epa_vehicle_mappings GROUP BY vehicle_id
--   HAVING count(*) > 1 AND NOT bool_or(is_primary);
