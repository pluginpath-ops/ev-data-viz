/**
 * A size photo's marks: where its bumpers, axles, ground and roof are, and
 * what follows from them (docs/size-photos-plan.md).
 *
 * Marks are fractions of the cutout, x across and y down, so a resize never
 * moves them. The photo is scaled from the vehicle's SPEC — bumper to bumper
 * is its length, edge to edge (front view) its width — one scale both ways.
 * Everything else the marks say (wheelbase, overhang, height) is read back at
 * that scale, as a check or to fill a figure the specs lack.
 *
 * Pure module.
 */

/** Each view's marks, and which way each runs. */
export const MARKS = {
    side: [
        { key: 'front',     axis: 'x', label: 'Front bumper' },
        { key: 'frontAxle', axis: 'x', label: 'Front axle' },
        { key: 'rearAxle',  axis: 'x', label: 'Rear axle' },
        { key: 'rear',      axis: 'x', label: 'Rear bumper' },
        { key: 'ground',    axis: 'y', label: 'Ground' },
        { key: 'roof',      axis: 'y', label: 'Roof' },
    ],
    front: [
        { key: 'left',   axis: 'x', label: 'Left body edge' },
        { key: 'right',  axis: 'x', label: 'Right body edge' },
        { key: 'ground', axis: 'y', label: 'Ground' },
        { key: 'roof',   axis: 'y', label: 'Roof' },
    ],
};

const axisOf = (view, key) => MARKS[view].find(m => m.key === key)?.axis;

/**
 * Where the marks start on a fresh cutout: the bumpers (or body edges) at the
 * car's visible edges, the ground at its lowest pixel, the roof at its highest,
 * and the axles where the specs put them (else a typical spot).
 *
 * @param {'side'|'front'} view
 * @param {{ x, y, w, h }} bounds  the visible pixels, as fractions of the cutout
 * @param {object} [profile]       vehicleProfile's, for the axles
 */
export function startingMarks(view, bounds, profile = null) {
    const x0 = bounds.x;
    const x1 = bounds.x + bounds.w;
    const ground = bounds.y + bounds.h;
    const roof = bounds.y;
    if (view === 'front') return { left: x0, right: x1, ground, roof };
    const share = (inches, fallback) => (profile?.length && inches != null ? inches / profile.length : fallback);
    const front = share(profile?.frontOverhang, 0.19);
    const rear = share(profile?.rearOverhang, 0.21);
    return {
        front: x0, frontAxle: x0 + front * bounds.w, rearAxle: x1 - rear * bounds.w, rear: x1, ground, roof,
    };
}

/** The marks of a photo flipped left to right. */
export function mirrorMarks(view, marks) {
    const flip = (v) => (v == null ? v : 1 - v);
    if (view === 'front') return { ...marks, left: flip(marks.right), right: flip(marks.left) };
    return {
        ...marks,
        front: flip(marks.rear), rear: flip(marks.front),
        frontAxle: flip(marks.rearAxle), rearAxle: flip(marks.frontAxle),
    };
}

/**
 * Marks carried from one cutout of an original to another (a redone cutout
 * trims differently). Both trims are fractions of the original; a mirrored
 * photo is unflipped, carried, and flipped back.
 */
export function carryMarks(view, marks, fromTrim, toTrim, mirrored = false) {
    const plain = mirrored ? mirrorMarks(view, marks) : marks;
    const out = {};
    for (const [key, v] of Object.entries(plain)) {
        if (v == null) { out[key] = v; continue; }
        out[key] = axisOf(view, key) === 'y'
            ? (fromTrim.y + v * fromTrim.h - toTrim.y) / toTrim.h
            : (fromTrim.x + v * fromTrim.w - toTrim.x) / toTrim.w;
    }
    return mirrored ? mirrorMarks(view, out) : out;
}

/**
 * Cutout px per inch, from the spec the view is scaled by, or null when the
 * spec or the marks can't give one.
 */
export function photoScale(view, photo, profile) {
    const m = photo?.marks ?? {};
    const span = view === 'front' ? m.right - m.left : m.rear - m.front;
    const spec = view === 'front' ? profile?.width : profile?.length;
    if (!(span > 0) || !(spec > 0)) return null;
    return (span * photo.width_px) / spec;
}

/**
 * What the marks say, in inches, at the spec's scale: the figures a curator
 * checks against the specs, and the front overhang when the specs have none.
 */
export function figuresFromMarks(view, photo, profile) {
    const k = photoScale(view, photo, profile);
    if (!k) return null;
    const m = photo.marks;
    const across = (a, b) => (a != null && b != null ? ((b - a) * photo.width_px) / k : null);
    const height = m.roof != null && m.ground != null ? ((m.ground - m.roof) * photo.height_px) / k : null;
    if (view === 'front') return { height };
    return {
        wheelbase: across(m.frontAxle, m.rearAxle),
        frontOverhang: across(m.front, m.frontAxle),
        rearOverhang: across(m.rearAxle, m.rear),
        height,
    };
}

/**
 * Where the photo lands in the chart's world, in inches: x from the vehicle's
 * front bumper (side) or centerline (front), y up from the ground.
 *
 * @returns {{ x: number, top: number, w: number, h: number } | null}  left edge, top edge, size
 */
export function photoPlacement(view, photo, profile) {
    const k = photoScale(view, photo, profile);
    if (!k) return null;
    const w = photo.width_px / k;
    const h = photo.height_px / k;
    const m = photo.marks;
    const originX = view === 'front' ? (m.left + m.right) / 2 : m.front;
    return { x: -originX * w, top: m.ground * h, w, h };
}
