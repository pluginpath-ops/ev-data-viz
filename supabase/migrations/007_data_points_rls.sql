-- ============================================================
-- RLS Policies for data_points table
--
-- data_points was missing RLS policies entirely, which meant
-- the direct INSERT in DataService.addRun() was blocked for
-- contributors on vehicles they don't own.
--
-- The merge_run_data_points / replace_run_data_points RPCs are
-- SECURITY DEFINER and bypass RLS, so they were unaffected.
-- The direct INSERT path in addRun() is not; adding policies here.
-- ============================================================

ALTER TABLE public.data_points ENABLE ROW LEVEL SECURITY;

-- SELECT: readable if the parent vehicle is visible (matches runs + vehicles visibility logic)
DROP POLICY IF EXISTS "rbac: data_points select" ON public.data_points;
CREATE POLICY "rbac: data_points select" ON public.data_points
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      JOIN public.vehicles v ON v.id = r.vehicle_id
      WHERE r.id = data_points.run_id
        AND (
          v.visibility = 'public'
          OR v.user_id  = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );

-- INSERT: vehicle owner, contributor, or admin
DROP POLICY IF EXISTS "rbac: data_points insert" ON public.data_points;
CREATE POLICY "rbac: data_points insert" ON public.data_points
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.runs r
      JOIN public.vehicles v ON v.id = r.vehicle_id
      WHERE r.id = data_points.run_id
        AND (
          v.user_id = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );

-- UPDATE: same as insert
DROP POLICY IF EXISTS "rbac: data_points update" ON public.data_points;
CREATE POLICY "rbac: data_points update" ON public.data_points
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      JOIN public.vehicles v ON v.id = r.vehicle_id
      WHERE r.id = data_points.run_id
        AND (
          v.user_id = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );

-- DELETE: same as insert
DROP POLICY IF EXISTS "rbac: data_points delete" ON public.data_points;
CREATE POLICY "rbac: data_points delete" ON public.data_points
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM public.runs r
      JOIN public.vehicles v ON v.id = r.vehicle_id
      WHERE r.id = data_points.run_id
        AND (
          v.user_id = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );
