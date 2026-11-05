-- 085: vehicles and their tests are readable by everyone; "private" becomes
-- "unlisted"
--
-- `vehicles.visibility = 'private'` was access control: a private vehicle,
-- with its runs, data points and trims, could be read only by the account that
-- created it and the site owner. That belonged to a site where people uploaded
-- their own vehicles and data. EVBench is no longer that site, and nothing in
-- a vehicle record needs a gate.
--
-- What the flag still does is keep a vehicle out of the lists, which is the
-- app's job, not the database's: docs/vocabulary.md names it **unlisted**, the
-- word tests already use for the same thing (#394). The column keeps its name
-- and its values ('public' = listed, 'private' = unlisted) — see Deferred
-- renames.
--
-- Why now: a vehicle can inherit from another (spec_source_vehicle_id), and
-- the gate broke inheritance for every reader who could not see the source. A
-- listed variant of an unlisted source lost its inherited specs, color, photo
-- and tests, and its lineage stopped at a source the reader could not read,
-- even when the next one up was listed. With every row readable, inheritance
-- resolves the same for everyone and the app decides what to list.
--
-- The gate also never let curators through: the runs, data_points and trims
-- policies admitted admins and contributors, but each checked the vehicle
-- through `vehicles`' own policy, which did not.
--
-- Only the read (SELECT) policies change. Who may write is untouched.
--
-- Two of the vehicles policies were made in the dashboard rather than in a
-- migration, so every name is dropped IF EXISTS.

-- ── vehicles ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public vehicles are viewable by everyone" ON public.vehicles;
DROP POLICY IF EXISTS "Users can view public and own vehicles" ON public.vehicles;
CREATE POLICY "Vehicles are readable by everyone" ON public.vehicles
  FOR SELECT USING (true);

-- ── runs ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "rbac: runs select" ON public.runs;
CREATE POLICY "rbac: runs select" ON public.runs
  FOR SELECT USING (true);

-- ── data_points ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Data points viewable with their run" ON public.data_points;
DROP POLICY IF EXISTS "rbac: data_points select" ON public.data_points;
CREATE POLICY "rbac: data_points select" ON public.data_points
  FOR SELECT USING (true);

-- ── trims ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "trims: select" ON public.trims;
CREATE POLICY "trims: select" ON public.trims
  FOR SELECT USING (true);
