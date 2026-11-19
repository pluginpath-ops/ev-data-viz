/**
 * A size photo's marks: where its bumpers, axles, ground and roof are, and
 * what follows from them (docs/size-photos-plan.md).
 *
 * Marks are fractions of the cutout, x across and y down, so a resize never
 * moves them. The marks are the truth for drawing: each lands exactly where
 * the specs put that point — bumpers at 0 and the length, axles at the front
 * overhang and a wheelbase later (front view: edges at ± half the width), the
 * roof at the height. Perspective and lenses keep a photo's proportions from
 * matching the specs (the ends come out squeezed), so the photo is stretched
 * piece by piece to fit, and the chart's anchors line up on its marks. To CHECK a photo, its
 * figures are read at the length scale alone (photoScale, figuresFromMarks):
 * how far they stray is how far the drawing had to bend it.
 *
 * Pure module.
 */

/**
 * The photos a vehicle can carry. Side and front are drawn on the Size chart;
 * the rear is kept, marked, for later.
 */
export const SIZE_PHOTO_VIEWS = [
    { key: 'side',  label: 'Side' },
    { key: 'front', label: 'Front' },
    { key: 'rear',  label: 'Rear' },
];

/** Front and rear photos are marked alike: body edges, not bumpers and axles. */
export const isEndView = (view) => view !== 'side';

/*
 * Each view's marks, and which way each runs. The axles are points: `frontAxle`
 * and `rearAxle` are their x, `frontAxleY` and `rearAxleY` their y (the wheel
 * centers), dragged together as one dot (`point` names the x it goes with).
 * `underbody` is the lowest point of the body, for ground clearance; front and
 * rear, `mirrorLeft` and `mirrorRight` are the mirrors' outer edges (they
 * stretch the photo to the width with mirrors, see photoPlacement), and
 * `trackLeft` and `trackRight` the centers of the tires where they meet the
 * ground (the track: front track on the front photo, rear on the rear). The
 * axle heights and underbody are recorded for later use (#603).
 */
const END_MARKS = [
    { key: 'mirrorLeft', axis: 'x', label: 'Left mirror' },
    { key: 'left',      axis: 'x', label: 'Left body edge' },
    { key: 'right',     axis: 'x', label: 'Right body edge' },
    { key: 'mirrorRight', axis: 'x', label: 'Right mirror' },
    { key: 'trackLeft',  axis: 'x', label: 'Left tire center' },
    { key: 'trackRight', axis: 'x', label: 'Right tire center' },
    { key: 'ground',    axis: 'y', label: 'Ground' },
    { key: 'underbody', axis: 'y', label: 'Underbody' },
    { key: 'roof',      axis: 'y', label: 'Roof' },
];
export const MARKS = {
    side: [
        { key: 'front',      axis: 'x', label: 'Front bumper' },
        { key: 'frontAxle',  axis: 'x', label: 'Front axle' },
        { key: 'rearAxle',   axis: 'x', label: 'Rear axle' },
        { key: 'rear',       axis: 'x', label: 'Rear bumper' },
        { key: 'ground',     axis: 'y', label: 'Ground' },
        { key: 'underbody',  axis: 'y', label: 'Underbody' },
        { key: 'roof',       axis: 'y', label: 'Roof' },
        { key: 'frontAxleY', axis: 'y', label: 'Front axle', point: 'frontAxle' },
        { key: 'rearAxleY',  axis: 'y', label: 'Rear axle',  point: 'rearAxle' },
    ],
    front: END_MARKS,
    rear: END_MARKS,
};

const axisOf = (view, key) => MARKS[view].find(m => m.key === key)?.axis;

/** The track an end view shows: the front photo the front track, the rear the rear. */
export const trackKeyOf = (view) => (view === 'rear' ? 'trackRear' : 'trackFront');

/**
 * The marks added after photos were first saved — the axle heights, the
 * underbody and the mirrors — filled in where a photo lacks them: the axles
 * half a tire up from the ground, the underbody at the clearance (each a share
 * of ground to roof), the mirrors out from the body edges by the width with
 * mirrors (a share of edge to edge); from the specs, else a typical share.
 * Marks already there stay.
 */
export function fillMarks(view, marks, profile = null) {
    if (!marks || marks.ground == null || marks.roof == null) return marks;
    const span = marks.ground - marks.roof;
    const up = (inches, share) => marks.ground - span * (profile?.height > 0 && inches > 0 ? inches / profile.height : share);
    const out = { ...marks };
    if (out.underbody == null) out.underbody = up(profile?.groundClearance, 0.1);
    if (isEndView(view) && marks.left != null && marks.right != null) {
        const body = marks.right - marks.left;
        const extra = profile?.widthMirrors > profile?.width ? (profile.widthMirrors - profile.width) / 2 / profile.width : 0.05;
        if (out.mirrorLeft == null) out.mirrorLeft = Math.max(0, marks.left - body * extra);
        if (out.mirrorRight == null) out.mirrorRight = Math.min(1, marks.right + body * extra);
        const track = profile?.[trackKeyOf(view)];
        const half = (profile?.width > 0 && track > 0 ? track / profile.width : 0.86) * body / 2;
        const center = (marks.left + marks.right) / 2;
        if (out.trackLeft == null) out.trackLeft = center - half;
        if (out.trackRight == null) out.trackRight = center + half;
    } else if (!isEndView(view)) {
        const axleY = up(profile?.tireDiameter / 2, 0.2);
        if (out.frontAxleY == null) out.frontAxleY = axleY;
        if (out.rearAxleY == null) out.rearAxleY = axleY;
    }
    return out;
}

/**
 * Where the marks start on a fresh cutout: the bumpers (or body edges) at the
 * car's visible edges, the ground at its lowest pixel, the roof at its highest,
 * and the axles where the specs put them (else a typical spot).
 *
 * @param {'side'|'front'|'rear'} view
 * @param {{ x, y, w, h }} bounds  the visible pixels, as fractions of the cutout
 * @param {object} [profile]       vehicleProfile's, for the axles
 */
export function startingMarks(view, bounds, profile = null) {
    const x0 = bounds.x;
    const x1 = bounds.x + bounds.w;
    const ground = bounds.y + bounds.h;
    const roof = bounds.y;
    if (isEndView(view)) return fillMarks(view, { left: x0, right: x1, ground, roof }, profile);
    const share = (inches, fallback) => (profile?.length && inches != null ? inches / profile.length : fallback);
    const front = share(profile?.frontOverhang, 0.19);
    const rear = share(profile?.rearOverhang, 0.21);
    return fillMarks(view, {
        front: x0, frontAxle: x0 + front * bounds.w, rearAxle: x1 - rear * bounds.w, rear: x1, ground, roof,
    }, profile);
}

/** The marks of a photo flipped left to right. */
export function mirrorMarks(view, marks) {
    const flip = (v) => (v == null ? v : 1 - v);
    if (isEndView(view)) {
        return {
            ...marks, left: flip(marks.right), right: flip(marks.left),
            mirrorLeft: flip(marks.mirrorRight), mirrorRight: flip(marks.mirrorLeft),
            trackLeft: flip(marks.trackRight), trackRight: flip(marks.trackLeft),
        };
    }
    return {
        ...marks,
        front: flip(marks.rear), rear: flip(marks.front),
        frontAxle: flip(marks.rearAxle), rearAxle: flip(marks.frontAxle),
        frontAxleY: marks.rearAxleY, rearAxleY: marks.frontAxleY,
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
    const span = isEndView(view) ? m.right - m.left : m.rear - m.front;
    const spec = isEndView(view) ? profile?.width : profile?.length;
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
    if (isEndView(view)) return { height, track: across(m.trackLeft, m.trackRight) };
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
 * Up, one scale: ground to roof spans the height spec (without a roof mark or
 * a height spec, up takes the bumper-to-bumper scale). Across, the side photo
 * is three pieces cut at the axles, each stretched so its marks land on the
 * specs: front bumper → front axle on the front overhang, axle to axle on the
 * wheelbase, rear axle → rear bumper on the rear overhang; the margin beyond a
 * bumper goes with its piece. Without both axles (in order) or the figures to
 * place them, and in the front view, it is one piece, bumper to bumper (edge
 * to edge) on the length (width).
 *
 * @returns {{ top: number, h: number, slices: Array<{ x: number, w: number, from: number, to: number }> } | null}
 *          top edge and height; each piece's left edge and width in inches,
 *          and which part of the photo it is (`from`–`to`, fractions across)
 */
export function photoPlacement(view, photo, profile) {
    const k = photoScale(view, photo, profile);
    if (!k) return null;
    const m = photo.marks;
    const rise = m.roof != null && m.ground != null ? (m.ground - m.roof) * photo.height_px : 0;
    const kUp = rise > 0 && profile?.height > 0 ? rise / profile.height : k;
    const h = photo.height_px / kUp;
    const top = m.ground * h;

    // A piece: photo fractions [from, to], placed so mark a lands at inches A and b at B.
    const piece = (from, to, a, A, b, B) => {
        const perFrac = (B - A) / (b - a);
        return { x: A + (from - a) * perFrac, w: (to - from) * perFrac, from, to };
    };

    if (isEndView(view)) {
        // Across in three pieces when both widths are specs and the mirrors are
        // marked outside the body: the body edges land on the width and the
        // mirror tips on the width with mirrors. Mirrors sit further from the
        // camera than the body, so one scale would draw them too narrow (or the
        // body too wide). With the width only a stand-in, the mirrors alone.
        const half = profile.width / 2;
        const mh = profile.widthMirrors / 2;
        const mirrors = mh > half && m.mirrorLeft < m.left && m.right < m.mirrorRight;
        if (mirrors && profile.estimated?.has('width')) {
            return { top, h, slices: [piece(0, 1, m.mirrorLeft, -mh, m.mirrorRight, mh)] };
        }
        if (!mirrors) return { top, h, slices: [piece(0, 1, m.left, -half, m.right, half)] };
        return {
            top, h,
            slices: [
                piece(0, m.left, m.mirrorLeft, -mh, m.left, -half),
                piece(m.left, m.right, m.left, -half, m.right, half),
                piece(m.right, 1, m.right, half, m.mirrorRight, mh),
            ],
        };
    }
    const { length, wheelbase, frontOverhang } = profile;
    const axles = m.front < m.frontAxle && m.frontAxle < m.rearAxle && m.rearAxle < m.rear
        && wheelbase > 0 && frontOverhang > 0 && frontOverhang + wheelbase < length;
    if (!axles) return { top, h, slices: [piece(0, 1, m.front, 0, m.rear, length)] };
    const fa = frontOverhang;
    const ra = frontOverhang + wheelbase;
    return {
        top, h,
        slices: [
            piece(0, m.frontAxle, m.front, 0, m.frontAxle, fa),
            piece(m.frontAxle, m.rearAxle, m.frontAxle, fa, m.rearAxle, ra),
            piece(m.rearAxle, 1, m.rearAxle, ra, m.rear, length),
        ],
    };
}
