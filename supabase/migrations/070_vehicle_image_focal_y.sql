-- 070: where a photo is framed inside the card's band (#340)
--
-- A vehicle photo is stored as a 16:9 crop, and the card draws it in a band
-- about 2.4:1 to 2.9:1 depending on how wide the card is. The band fills with
-- `background-size: cover`, so the photo is scaled to the band's WIDTH and the
-- top and bottom run off the edges -- on a desktop card, roughly 38% of the
-- photo's height is cut, always split evenly between the top and the bottom.
--
-- Always centered is a guess, and it is wrong often. A car framed well in 16:9
-- -- roof near the top edge, wheels near the bottom -- loses its roof AND its
-- wheels on the card. The curator had no way to see that while cropping and no
-- way to fix it afterwards short of re-uploading, which cannot recover what the
-- crop already threw away.
--
-- So: the focal point, the industry word for this (Cloudinary, Contentful,
-- Drupal's Focal Point module all use it). 0 aligns the top of the photo with
-- the top of the band, 100 aligns the feet, 50 is centered.
--
-- NULLABLE, and null is not a missing value: it means centered, which is what
-- every photo does today. So every existing row renders at exactly the same
-- pixels until someone moves one -- `background-position: center 50%` is the
-- same declaration as the `center` the stylesheet has always had.
--
-- Vertical only. The photo is already cropped to the band's width, so there is
-- no horizontal slack to spend and a second column would store a number that
-- could never change anything.
--
-- It belongs to the PHOTO, not to the vehicle: it is meaningless without the
-- image it frames. Two consequences the code keeps to --
--   * replacing a photo clears it (DataService.uploadVehicleImage), because the
--     old number frames a picture that no longer exists;
--   * a variant showing its source's photo inherits the source's focal point
--     with it, as one unit (vehicleInheritance.js PHOTO_KEYS), so the two can
--     never come from different vehicles.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS image_focal_y smallint
  CHECK (image_focal_y IS NULL OR (image_focal_y >= 0 AND image_focal_y <= 100));

COMMENT ON COLUMN vehicles.image_focal_y IS
  'Vertical focal point of image_url, 0 (top) to 100 (bottom). Null means centered -- see #340. Belongs to the photo: cleared when the photo is replaced, inherited with it.';
