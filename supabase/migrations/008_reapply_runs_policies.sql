-- ============================================================
-- Re-apply runs RLS policies idempotently.
--
-- The 001_rbac migration may not have fully applied in the live
-- database if it was run statement-by-statement via the SQL editor
-- and an earlier statement failed. This migration explicitly drops
-- and re-creates only the runs policies so contributors can
-- insert/update runs on vehicles they don't own.
-- ============================================================

-- Drop all existing runs policies (catches any legacy names too)
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'runs'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.runs', pol.policyname);
    END LOOP;
END;
$$;

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;

-- SELECT: runs visible if the parent vehicle is visible
CREATE POLICY "rbac: runs select" ON public.runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = runs.vehicle_id
        AND (
          v.visibility = 'public'
          OR v.user_id  = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );

-- INSERT: vehicle owner, contributor, or admin
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

-- DELETE: vehicle owner or admin only (contributors cannot delete)
CREATE POLICY "rbac: runs delete" ON public.runs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = runs.vehicle_id
        AND (
          v.user_id  = auth.uid()
          OR public.current_user_role() = 'admin'
        )
    )
  );
