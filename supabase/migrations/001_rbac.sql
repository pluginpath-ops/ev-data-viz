-- ============================================================
-- RBAC Migration: Replace is_owner boolean with role text
-- Roles: 'admin' | 'contributor' | 'user'
-- ============================================================

-- 1. Add role column, defaulting existing owners to admin
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('admin', 'contributor', 'user'));

UPDATE public.profiles SET role = 'admin' WHERE is_owner = true;

-- 2. Cached helper function — avoids per-row subquery in RLS policies
CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- 3. Admin RPC: list all registered users with their roles
-- Must be SECURITY DEFINER to read auth.users
CREATE OR REPLACE FUNCTION public.get_admin_users()
  RETURNS TABLE (
    id        uuid,
    email     text,
    created_at timestamptz,
    role      text
  )
  LANGUAGE sql
  SECURITY DEFINER
AS $$
  SELECT
    au.id,
    au.email,
    au.created_at,
    p.role
  FROM auth.users au
  JOIN public.profiles p ON p.id = au.id
  ORDER BY au.created_at DESC;
$$;

-- Only admins can call get_admin_users
REVOKE ALL ON FUNCTION public.get_admin_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO authenticated;
-- (RLS check inside the function body)
-- We enforce admin-only via a guard at the top:
CREATE OR REPLACE FUNCTION public.get_admin_users()
  RETURNS TABLE (
    id        uuid,
    email     text,
    created_at timestamptz,
    role      text
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    au.id,
    au.email::text,
    au.created_at,
    COALESCE(p.role, 'user')::text AS role
  FROM auth.users au
  LEFT JOIN public.profiles p ON p.id = au.id
  ORDER BY au.created_at DESC;
END;
$$;

-- 4. Admin RPC: update a user's role
CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id uuid, new_role text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  IF public.current_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  IF new_role NOT IN ('admin', 'contributor', 'user') THEN
    RAISE EXCEPTION 'Invalid role: %', new_role;
  END IF;

  UPDATE public.profiles SET role = new_role WHERE id = target_user_id;
END;
$$;

-- ============================================================
-- RLS POLICIES — Vehicles
-- ============================================================

-- Drop old policies if they exist (re-creating cleanly)
DROP POLICY IF EXISTS "Public vehicles are viewable by all" ON public.vehicles;
DROP POLICY IF EXISTS "Users can insert their own vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Users can update their own vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Owners can update any vehicle" ON public.vehicles;
DROP POLICY IF EXISTS "Owners can delete any vehicle" ON public.vehicles;
-- RBAC policies
DROP POLICY IF EXISTS "rbac: vehicles select" ON public.vehicles;
DROP POLICY IF EXISTS "rbac: vehicles insert" ON public.vehicles;
DROP POLICY IF EXISTS "rbac: vehicles update" ON public.vehicles;
DROP POLICY IF EXISTS "rbac: vehicles delete" ON public.vehicles;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- SELECT: public vehicles visible to all; private visible to owner, contributors, admins
CREATE POLICY "rbac: vehicles select" ON public.vehicles
  FOR SELECT USING (
    visibility = 'public'
    OR user_id = auth.uid()
    OR public.current_user_role() IN ('admin', 'contributor')
  );

-- INSERT: any authenticated user can add vehicles (defaults to private)
CREATE POLICY "rbac: vehicles insert" ON public.vehicles
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- UPDATE: owner, contributor, or admin
CREATE POLICY "rbac: vehicles update" ON public.vehicles
  FOR UPDATE USING (
    user_id = auth.uid()
    OR public.current_user_role() IN ('admin', 'contributor')
  );

-- DELETE: owner or admin only (contributors cannot delete others' vehicles)
CREATE POLICY "rbac: vehicles delete" ON public.vehicles
  FOR DELETE USING (
    user_id = auth.uid()
    OR public.current_user_role() = 'admin'
  );

-- ============================================================
-- RLS POLICIES — Runs
-- Note: runs don't have user_id; ownership is inherited via vehicles
-- ============================================================

DROP POLICY IF EXISTS "Public runs viewable by all" ON public.runs;
DROP POLICY IF EXISTS "Owners can insert runs" ON public.runs;
DROP POLICY IF EXISTS "Owners can update runs" ON public.runs;
DROP POLICY IF EXISTS "Owners can delete runs" ON public.runs;
DROP POLICY IF EXISTS "rbac: runs select" ON public.runs;
DROP POLICY IF EXISTS "rbac: runs insert" ON public.runs;
DROP POLICY IF EXISTS "rbac: runs update" ON public.runs;
DROP POLICY IF EXISTS "rbac: runs delete" ON public.runs;

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;

-- SELECT: runs visible if the parent vehicle is visible
CREATE POLICY "rbac: runs select" ON public.runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = runs.vehicle_id
      AND (
        v.visibility = 'public'
        OR v.user_id = auth.uid()
        OR public.current_user_role() IN ('admin', 'contributor')
      )
    )
  );

-- INSERT: authenticated user who owns the vehicle, or contributor/admin
CREATE POLICY "rbac: runs insert" ON public.runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = runs.vehicle_id
      AND (
        v.user_id = auth.uid()
        OR public.current_user_role() IN ('admin', 'contributor')
      )
    )
  );

-- UPDATE: vehicle owner, contributor, or admin
CREATE POLICY "rbac: runs update" ON public.runs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = runs.vehicle_id
      AND (
        v.user_id = auth.uid()
        OR public.current_user_role() IN ('admin', 'contributor')
      )
    )
  );

-- DELETE: vehicle owner or admin only
CREATE POLICY "rbac: runs delete" ON public.runs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = runs.vehicle_id
      AND (
        v.user_id = auth.uid()
        OR public.current_user_role() = 'admin'
      )
    )
  );
