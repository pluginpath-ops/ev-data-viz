-- 087: curators (admin + contributor) may edit any vehicle and its tags
--
-- The app has always offered Edit vehicle to every curator (`canEdit` in
-- AppContext), and 001_rbac.sql meant the database to agree: its vehicles
-- UPDATE policy was "owner, contributor, or admin" via current_user_role().
-- Those vehicles policies never landed in production. What is there was made
-- in the dashboard and checks `is_owner()`, the profiles.is_owner flag that
-- 001 replaced with `role`:
--
--   "Owner can update any vehicle, users can update own"
--     UPDATE USING (is_owner() OR user_id = auth.uid())
--   "Owners can manage vehicle tags"
--     ALL USING (profiles.is_owner)
--
-- Every vehicle belongs to the one is_owner account, so no other admin and no
-- contributor could save a vehicle. RLS does not refuse a filtered UPDATE. It
-- matches 0 rows and PostgREST answers 204, so every such save looked like it
-- had worked. DataService now reads the row back and raises on 0 rows. This
-- migration makes the database allow what the UI offers.
--
-- Every sibling table (runs, trims, data_points, manufacturers, platforms, the
-- epa_* tables) already admits curators through current_user_role(), so this
-- uses the same check.
--
-- Unchanged on purpose (owner's call, 2026-10-20):
--   - INSERT on vehicles: owner, or a row the user creates as their own.
--   - DELETE on vehicles: owner or the creator.
--   - `tags`, the tag list itself (create, rename, merge, delete): owner only.
--     A curator can put existing tags on a vehicle or take them off, but cannot
--     change the list.
--
-- Safe to run twice: each policy is dropped IF EXISTS before it is created.

-- ── vehicles: UPDATE ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Owner can update any vehicle, users can update own" ON public.vehicles;
DROP POLICY IF EXISTS "rbac: vehicles update" ON public.vehicles;
CREATE POLICY "rbac: vehicles update" ON public.vehicles
  FOR UPDATE USING (
    public.is_owner()
    OR user_id = auth.uid()
    OR public.current_user_role() IN ('admin', 'contributor')
  );

-- ── vehicle_tags: which tags a vehicle carries ──────────────────────────────
-- Added beside "Owners can manage vehicle tags", which stays: policies are
-- OR'd, so the owner keeps access through either one.
DROP POLICY IF EXISTS "rbac: vehicle_tags write" ON public.vehicle_tags;
CREATE POLICY "rbac: vehicle_tags write" ON public.vehicle_tags
  FOR ALL
  USING (public.current_user_role() IN ('admin', 'contributor'))
  WITH CHECK (public.current_user_role() IN ('admin', 'contributor'));
