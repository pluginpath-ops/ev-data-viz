-- 103_size_photo_rear.sql
--
-- A rear size photo, beside the side and front (docs/size-photos-plan.md).
-- Marked like the front: body edges, mirrors, ground, underbody, roof. Not yet
-- drawn on the Size chart; kept so curators mark it once, while they are
-- adding photos.
--
-- Additive: only the view check widens. Marks are free-form JSONB, so the new
-- marks (axle heights, underbody, mirrors) need no change.

ALTER TABLE public.vehicle_size_photos
    DROP CONSTRAINT IF EXISTS vehicle_size_photos_view_check;
ALTER TABLE public.vehicle_size_photos
    ADD CONSTRAINT vehicle_size_photos_view_check CHECK (view IN ('side', 'front', 'rear'));
