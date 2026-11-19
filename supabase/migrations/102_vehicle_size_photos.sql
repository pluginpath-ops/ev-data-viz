-- 102: size photos — a vehicle's side and front photo for the Size chart
-- (docs/size-photos-plan.md)
--
-- Additive. One row per vehicle per view. The image is a cutout (PNG, the
-- background removed) in the vehicle-images bucket at
-- size/<vehicle_id>-<view>.png; the file as uploaded is kept beside it at
-- size/<vehicle_id>-<view>-original.<ext> so the cutout can be redone.
--
-- `marks` place the photo on the chart: where its bumpers, axles and ground
-- are, as fractions of the cutout (0–1, x across, y down), so a resize never
-- moves them. The chart scales the photo from the vehicle's length spec (front
-- view: its width spec); the marks are never a source of length or width.
--
--   side   { front, frontAxle, rearAxle, rear, ground, roof? }
--   front  { left, right, ground, roof? }      left/right: body, not mirrors
--
-- `trim` is where the cutout sits in the original, so a new cutout from the
-- same original can carry the marks across.
--
-- A variant without its own photo uses the nearest one in its model line, as
-- the card photo does (vehicleInheritance.js). That is resolved when read.
--
-- Safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicle_size_photos (
    vehicle_id    bigint      NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    view          text        NOT NULL CHECK (view IN ('side', 'front')),
    image_url     text        NOT NULL,
    original_url  text,
    width_px      integer     NOT NULL CHECK (width_px > 0),
    height_px     integer     NOT NULL CHECK (height_px > 0),
    marks         jsonb       NOT NULL,
    trim          jsonb,
    mirrored      boolean     NOT NULL DEFAULT false,
    source_url    text,
    credit        text,
    updated_by    uuid        DEFAULT auth.uid(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (vehicle_id, view)
);

COMMENT ON TABLE public.vehicle_size_photos IS
    'A vehicle''s side or front photo for the Size chart: a cutout with its bumpers, axles and ground marked (docs/size-photos-plan.md).';
COMMENT ON COLUMN public.vehicle_size_photos.marks IS
    'Fractions of the cutout, x across and y down. side: front, frontAxle, rearAxle, rear, ground, roof?; front: left, right, ground, roof?.';
COMMENT ON COLUMN public.vehicle_size_photos.trim IS
    'Where the cutout sits in the original upload: { x, y, w, h } as fractions of the original.';
COMMENT ON COLUMN public.vehicle_size_photos.mirrored IS
    'Flipped from the original so the vehicle faces left. Said under the chart.';
COMMENT ON COLUMN public.vehicle_size_photos.credit IS
    'Who the photo belongs to, as the source line prints it ("Ford Media").';

ALTER TABLE public.vehicle_size_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read vehicle_size_photos"  ON public.vehicle_size_photos;
DROP POLICY IF EXISTS "Curators write vehicle_size_photos" ON public.vehicle_size_photos;
CREATE POLICY "Public read vehicle_size_photos" ON public.vehicle_size_photos
    FOR SELECT USING (true);
-- Curators manage a vehicle's photos the way they manage its tags (087).
CREATE POLICY "Curators write vehicle_size_photos" ON public.vehicle_size_photos
    FOR ALL
    USING (public.current_user_role() IN ('admin', 'contributor'))
    WITH CHECK (public.current_user_role() IN ('admin', 'contributor'));

COMMIT;
