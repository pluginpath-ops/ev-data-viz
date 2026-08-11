-- ─────────────────────────────────────────────────────────────────────────────
-- 051: a second, card-sized rendition of each vehicle image.
--
-- Every vehicle image is stored at 1600×900 and every place that displays one
-- renders it into a box no wider than ~394 CSS px. On the Vehicles grid that
-- meant 4.7 MB of images on a cold first load — 91% of the page's total bytes —
-- to fill roughly 0.9 MB worth of pixels, and none of it deferred: all 23
-- requests fire in the same tick once the vehicle list resolves.
--
-- The full-resolution original is deliberately KEPT. It is the only copy we
-- have, it is what future features (lightbox, comparison hero art, print) will
-- want, and regenerating it from a thumbnail is impossible. So this is a second
-- object alongside the first, not a replacement:
--
--   vehicle-images/<id>.jpg          full,  ≤1600×900   (unchanged, authoritative)
--   vehicle-images/thumbs/<id>.jpg   thumb, ≤800×450    (new, what the UI renders)
--
-- The column is nullable and the UI falls back to image_url when it is null, so
-- rows are correct before the backfill runs and stay correct for any image
-- uploaded by an older client.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS image_thumb_url text;

COMMENT ON COLUMN vehicles.image_url IS
    'Public URL of the full-resolution vehicle image (<=1600x900). Authoritative original; not what the grid renders.';
COMMENT ON COLUMN vehicles.image_thumb_url IS
    'Public URL of the card-sized rendition (<=800x450) derived from image_url. Null means no thumbnail yet — callers fall back to image_url.';
