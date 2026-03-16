-- Migration 004: Vehicle trims
-- Adds a `trims` table for named trim configurations per vehicle
-- (e.g. wheel size, tire size). One vehicle can have many trims.
-- RLS mirrors the runs table: visible when parent vehicle is visible,
-- mutable by vehicle owner or admin/contributor.

CREATE TABLE public.trims (
  id         bigint       PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vehicle_id bigint       NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  name       text         NOT NULL,
  wheel_size text,
  tire_size  text,
  created_at timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE public.trims ENABLE ROW LEVEL SECURITY;

-- Readable if the parent vehicle is readable by the requesting user
CREATE POLICY "trims: select" ON public.trims
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = trims.vehicle_id
        AND (
          v.visibility = 'public'
          OR v.user_id = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );

-- Insertable by vehicle owner or admin/contributor
CREATE POLICY "trims: insert" ON public.trims
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = trims.vehicle_id
        AND (
          v.user_id = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );

-- Updatable by vehicle owner or admin/contributor
CREATE POLICY "trims: update" ON public.trims
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = trims.vehicle_id
        AND (
          v.user_id = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );

-- Deletable by vehicle owner or admin/contributor
CREATE POLICY "trims: delete" ON public.trims
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.vehicles v
      WHERE v.id = trims.vehicle_id
        AND (
          v.user_id = auth.uid()
          OR public.current_user_role() IN ('admin', 'contributor')
        )
    )
  );
