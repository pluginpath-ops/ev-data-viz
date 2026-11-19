# Size photos — plan

Photos for the Size chart: a side and a front photo per vehicle, cut out,
with the bumpers, axles and ground marked, drawn to scale in place of the
silhouette. Part D of the Size chart plan.

## Owner decisions (2026-11-19)

- **Cutouts:** accept a PNG already cut out elsewhere, plus a built-in
  "remove plain background" step for studio shots on white or gray. No AI
  model.
- **Display:** a **Photos / Outlines** switch. Photos by default where one
  exists, outlines for the rest; Outlines draws every vehicle as a silhouette.
- **Inheritance:** like the card photo — a variant uses the nearest photo in
  its model line (`sameModelLine`, `src/utils/vehicleInheritance.js`) unless it
  has its own.
- **Credit:** each photo stores a source URL and credit; the chart's source
  line reads "Photos: Ford Media, Tesla". A flipped photo is marked as
  mirrored.

## What exists to build on

| Need | Reuse |
|---|---|
| Storage | `vehicle-images` bucket, `DataService.#putVehicleImageObject` (JPEG only today — gains a content type) |
| Drag a mark on a photo | `CardBandPreview.jsx`: pointer capture, drag state in a ref, arrow keys, read-only when inherited |
| Resize/encode | `utils/imageRenditions.js` (`renderToJpegBlob` → add a PNG twin) |
| Variant shares a photo | `vehicleInheritance.js` `PHOTO_KEYS` / `sameModelLine` |
| Loaded with the vehicles | the vehicles select embeds side tables (`green_ncap_assessments(...)`, DataService.js:439) |
| Where axles/scale come from | `utils/vehicleProfile.js` (`profileFromSpecs`, `estimated`) |
| Field fixes | Data Checks `size-*` checks + `CHECK_FIELDS` |

## Data

Migration **102_vehicle_size_photos.sql**:

```
vehicle_size_photos
  vehicle_id   bigint  → vehicles(id) ON DELETE CASCADE
  view         text    'side' | 'front'
  image_url    text    vehicle-images/size/<vehicle_id>-<view>.png?v=<stamp>
  original_url text    the file as uploaded, kept so the cutout can be redone
  trim         jsonb   where the cutout sits in the original (x, y, w, h, fractions)
  width_px, height_px  int
  marks        jsonb   fractions of the image, 0–1 (below)
  mirrored     boolean default false
  source_url   text
  credit       text
  updated_by   uuid, updated_at timestamptz
  PRIMARY KEY (vehicle_id, view)
```

RLS: everyone reads; admin and contributor write (the `vehicle_tags` policy
shape, migration 087). One row per view, so a replace is an upsert and a
half-saved photo can't leave two.

**Marks**, x across and y down the image, as fractions so a resize never
moves them:
- side: `front`, `frontAxle`, `rearAxle`, `rear` (x); `ground`, `roof` (y)
- front: `left`, `right` (x, body edges, mirrors not included); `ground`, `roof` (y)

The marks are the truth for drawing (owner, 2026-11-19): each lands where the
specs put that point. Up, ground to roof spans `height_in`. Across, the side
photo is drawn in three pieces cut at the axles, front bumper → front axle on
the front overhang, axle to axle on the wheelbase, rear axle → rear bumper on
the rear overhang (front view: one piece, edge to edge on `width_in`). So the
chart's anchors line up on the photo's own marks. Why: perspective and lenses
squeeze a car's ends, and one scale both ways put the roof wherever the photo
did (two photos 2.9 in apart in spec drew 0.7 in apart). Without a roof mark
or height spec, up takes the across scale; without both axles in order, across
is one piece. For checks, the marks are read at the length scale alone:
- **the overhang split from the photo** fills in when the spec lacks a front
  overhang: the photo's front-to-rear ratio is applied to length − wheelbase
  from the specs, so the two overhangs still add up. Shown as "photo" rather
  than "est." (the profile gains a `fromPhoto` set);
- photo wheelbase and height are checked against the specs (Data Checks).

Specs still win: a photo never overrides a recorded figure.

Loaded with the vehicles (`vehicle_size_photos(*)` in the embed): a few small
rows each. A variant resolves its photo by the same walk as the card photo,
and its own length sets the scale.

## The editor

A **Size photos** section in the vehicle edit form, under Photo, with a Side
and a Front slot. Contributors and admins; read-only (with "from <vehicle>")
when inherited, like the card photo.

1. **Choose a file.** A PNG with transparency goes straight on. Otherwise the
   slot offers **Remove plain background**: flood fill from the border, with a
   tolerance slider, previewed on a checkerboard. A busy background is refused
   with a pointer to cutting it out elsewhere.
2. **Trim and size.** Cropped to the car's visible pixels plus a small margin,
   longest side ≤ 1600 px, saved as PNG.
3. **Face left.** Side photos face left; **Flip** mirrors it and sets
   `mirrored`.
4. **Mark.** Lines start where the cutout says: bumpers at the left/right edge
   of the car's pixels, ground at the bottom, axles at a guess. Drag, or Tab
   between them and nudge with the arrows (Shift = 10 px). A magnified view
   follows the line being moved.
5. **Check, live:** "Wheelbase from photo 112.6 in · spec 113.2 in (−0.5%)",
   the same for height, and the front overhang it implies.
6. **Source and credit**, then Save: upload, then upsert the row. Delete
   removes the row and both files.

**Editing later.** A saved photo reopens in the same editor, any time:
- **Marks, source, credit:** moved and saved as a row update; the file is
  not uploaded again.
- **Flip:** re-saves the image and mirrors the marks (x → 1 − x, front and
  rear swapped) rather than clearing them.
- **Redo the cutout:** the original upload is kept beside the cutout
  (`size/<vehicle_id>-<view>-original.<ext>`, column `original_url`), so
  the background step can be re-run with another tolerance. A new cutout from
  the same original keeps the marks: the row stores where the cutout sits in
  the original (`trim`), so the marks are carried across to the new trim.
- **Replace with a new file:** the one case that clears the marks, because they
  belong to a picture that's gone.

New pure modules (unit-tested):
- `utils/cutout.js` — on `ImageData`: has-transparency, flood-fill a plain
  background, bounds of the visible pixels, trim.
- `utils/sizePhotoMarks.js` — starting marks from bounds, scale from length or
  width, figures from marks, where the photo lands in the chart's world.

Components: `components/sizephotos/SizePhotoSection.jsx` (the slots),
`SizePhotoEditor.jsx` (cutout, flip, marks, check), `MarkLine.jsx` (one
draggable line).

## The chart

- Sidebar Display gains **Draw: Photos | Outlines** (`chartConfig.sizeDraw`,
  link `sd=outlines` only when not the default; NAMES_V1/WORDS_V1 appended).
- A photo is an SVG `<image>` placed in px (outside the flipped group, or it
  draws upside down) by `sizePhotoMarks`. Its series color stays on the
  dimension lines and a thin ground stroke under the car. Hover fades the
  others, as now.
- Mixed selections draw photos where they exist and outlines for the rest.
- Notes: "Mirrored photo: …"; "Front and rear overhang split as the photo shows it: …".
- Source line: `useSourceLine` gains photo credits.
- **Image export:** an SVG loaded as an image can't fetch outside images, so
  `svgRaster.js` inlines each `<image>` as a data URL first (the bucket is
  public; check its CORS on the first try).

## Data Checks

- `size-photo-wheelbase` — wheelbase from the photo vs spec, past 3%.
- `size-photo-height` — height from the photo vs spec, past 4% (roofs racks
  and antennas make this one looser).

Both point at the photo's marks or the spec; the fix fields are the specs.

## Delivery

One plan, three dependent layers, so a `gh stack` (`.claude/skills/stacked-prs/SKILL.md`):

1. **Size chart** — the current `feature/size-comparison` work, after sign-off.
2. **Size photos: storage + editor** — migration 102, DataService load/save,
   `cutout.js`, `sizePhotoMarks.js`, the editor, the two Data Checks.
   Useful alone: curators can start uploading and marking.
3. **Size chart draws photos** — the switch, placement, credits, mirrored note,
   export inlining.

Migration 102 is applied to live before layer 2 merges.

## Verification

- Unit: `cutout.js` on synthetic `ImageData` (plain border, transparent,
  busy); `sizePhotoMarks.js` round trips (marks → figures → placement).
- Migration + RLS on the local mirror (`scripts/localdb.sh` up → migrate 102 →
  serve): a contributor can write a row, a viewer can't, everyone reads.
- **Storage is not in the local mirror.** The upload is tried against the live
  bucket with one test vehicle, with the owner's go-ahead, and deleted after.
- Preview: upload a cutout, a white-background shot and a busy one; flip; mark;
  watch the live check; reload; a variant shows the inherited photo read-only;
  the chart in Photos and Outlines, every alignment, export, phone width.
- Owner signs off the editor and the chart in the preview before each commit.

## Naming (to settle; then docs/vocabulary.md)

- **size photo** for the photo (Open names lists profile photo · side photo ·
  elevation). Leaning "size photo": it says what it is for and can't be
  confused with the card's photo.
- **marks** for the lines a curator sets; each by its anchor name (front
  bumper mark, ground mark).
- **cutout** for a photo with its background removed.
