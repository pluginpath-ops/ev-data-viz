-- 077: composite curves stored as runs (#313)
--
-- A composite curve is one line standing for a vehicle's charging behavior:
-- the mean of its charging tests at each SoC, with charger-limited stretches
-- left out, one per charger class on an 800 V car (src/utils/compositeCurve.js).
--
-- It is stored as a RUN — kind 'charging', synthetic — rather than derived in
-- each view, so every picker, pairing, color, URL, DEF tag and the vehicle
-- table's charge-time column take it the way they take a test, with no second
-- identity system. This column is what marks a run as one, and carries how it
-- was made:
--
--   {
--     "chargerClassV": 800 | 400 | null,   null = one composite, no class split
--     "version":       n,                  COMPOSITE_VERSION it was built with
--     "fingerprint":   "...",              the inputs it was built from; a
--                                          mismatch means it is out of date
--     "tests":         [{ "runId", "name" }],
--     "heldBack":      [{ "runId", "name", "from", "to" }],
--     "inferredTests": [ "name", ... ],
--     "conditions":    { "tempMinF", "tempMaxF", "preconditioned": { yes, no, unknown } }
--   }
--
-- NULL on every real test. The points live in data_points like any run's, with
-- each point's contributor count and test spread in data_points.extra_data
-- ({ "n", "spreadHi", "spreadLo" }).
--
-- Written by curators only, through DataService.rebuildComposites, after any
-- write to one of the vehicle's charging tests and from Admin → Data checks.
-- Rebuilt IN PLACE, so a composite keeps its id — and with it its DEF tag, its
-- range pairings and every shared link — across rebuilds.
--
-- Additive and safe to run twice.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS composite jsonb;

-- One composite per vehicle per charger class. COALESCE because a NULL class
-- (the single composite of a 400 V car) would never collide with itself.
CREATE UNIQUE INDEX IF NOT EXISTS runs_one_composite_per_class
  ON runs (vehicle_id, COALESCE(composite->>'chargerClassV', 'all'))
  WHERE composite IS NOT NULL;

-- A rebuild deletes a composite its vehicle's tests no longer support (a test
-- hidden or reclassified leaves a charger class with one test). Contributors
-- rebuild, but "rbac: runs delete" lets only the owner or an admin delete a
-- run — right for tests, which are someone's work. A composite is the
-- system's own output, so contributors may delete those and nothing else.
-- Permissive policies OR together; this adds no reach over real tests.
DROP POLICY IF EXISTS "rbac: runs delete composite" ON runs;
CREATE POLICY "rbac: runs delete composite" ON runs
  FOR DELETE USING (
    composite IS NOT NULL
    AND public.current_user_role() IN ('admin', 'contributor')
  );

COMMENT ON COLUMN runs.composite IS
  'Composite curves only (#313): how this synthetic run was built from the vehicle''s charging tests — charger class, version, input fingerprint, contributing tests. NULL on every real test.';
