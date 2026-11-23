/**
 * A size photo's marks: where its bumpers, axles, ground and roof are, and
 * what follows from them (docs/size-photos-plan.md).
 *
 * Marks are fractions of the cutout, x across and y down, so a resize never
 * moves them. The marks are the truth for drawing: axles land at the front
 * overhang and a wheelbase later, the roof at the height, the bumpers at the
 * ends less the baseline (front view: edges at ± half the width).
 * Perspective and lenses keep a photo's proportions from
 * matching the specs (the ends come out squeezed), so the photo is stretched
 * piece by piece to fit, and the chart's anchors line up on its marks. A side
 * photo is scaled from its wheelbase (photoScale); its length, height and tire
 * diameter are then read back to CHECK it, the length against a baseline of
 * how short even a good photo reads (constants/sizeChart.js, #616).
 *
 * Pure module.
 */

import { SIZE_PHOTO_LENGTH_BASELINE_PCT } from '../constants/sizeChart';

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
 * rear, `mirrorLeft` and `mirrorRight` are the mirrors' outer edges, and
 * `tireLeft` and `tireRight` the LEFT edge of each tire at the ground: edge to
 * matching edge is the track (center to center) with no tire width needed,
 * and an edge is easier to see than a center. Only their spacing counts: the
 * pair is taken as centered on the body (between the body edge marks), so
 * where along the tires they sit doesn't matter (a flip turns them into
 * right edges, same spacing). The front track on the front photo, the rear on
 * the rear. Left and right are as the photo shows them. The
 * axle heights and underbody are recorded for later use (#603).
 */
const END_MARKS = [
    { key: 'mirrorLeft', axis: 'x', label: 'Left mirror' },
    { key: 'left',      axis: 'x', label: 'Left body edge' },
    { key: 'right',     axis: 'x', label: 'Right body edge' },
    { key: 'mirrorRight', axis: 'x', label: 'Right mirror' },
    { key: 'tireLeft',  axis: 'x', label: 'Left tire, left edge' },
    { key: 'tireRight', axis: 'x', label: 'Right tire, left edge' },
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
        const center = (marks.left + marks.right) / 2 - 0.03 * body;   // left edges sit left of the centers
        if (out.tireLeft == null) out.tireLeft = center - half;
        if (out.tireRight == null) out.tireRight = center + half;
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
            tireLeft: flip(marks.tireRight), tireRight: flip(marks.tireLeft),
        };
    }
    return {
        ...marks,
        front: flip(marks.rear), rear: flip(marks.front),
        frontAxle: flip(marks.rearAxle), rearAxle: flip(marks.frontAxle),
        frontAxleY: marks.rearAxleY, rearAxleY: marks.frontAxleY,
    };
}

/** Marks held to the canvas, 0 to 1: what is saved (carryMarks may leave one past it). */
export function clampMarks(marks) {
    return Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v == null ? v : Math.min(1, Math.max(0, v))]));
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
        // Not clamped: a tighter trim (a higher background tolerance) can put a
        // mark past the canvas, and a looser one must bring it back to the same
        // spot on the car. The editor draws it at the edge meanwhile and clamps
        // it on save (clampMarks).
        out[key] = axisOf(view, key) === 'y'
            ? (fromTrim.y + v * fromTrim.h - toTrim.y) / toTrim.h
            : (fromTrim.x + v * fromTrim.w - toTrim.x) / toTrim.w;
    }
    return mirrored ? mirrorMarks(view, out) : out;
}

/**
 * Cutout px per inch, from the spec the view is scaled by, or null when the
 * spec or the marks can't give one. A side photo is scaled from the WHEELBASE
 * (the axles are near-plane points; the bumper tips sit on the centerline,
 * farther from the camera, so a length scale reads everything near the camera
 * long); without a wheelbase spec or both axles in order, from the length.
 */
export function photoScale(view, photo, profile) {
    const m = photo?.marks ?? {};
    if (isEndView(view)) {
        const span = m.right - m.left;
        return span > 0 && profile?.width > 0 ? (span * photo.width_px) / profile.width : null;
    }
    const axles = m.rearAxle - m.frontAxle;
    if (axles > 0 && profile?.wheelbase > 0) return (axles * photo.width_px) / profile.wheelbase;
    const span = m.rear - m.front;
    return span > 0 && profile?.length > 0 ? (span * photo.width_px) / profile.length : null;
}

/**
 * What the marks say, in inches, at the view's scale: the figures a curator
 * checks against the specs, and the front overhang when the specs have none.
 * Side: `length` is what the checks hold to the baseline; `tireDiameter` is
 * twice the axles' height above the ground, a cross-check of the scale.
 */
export function figuresFromMarks(view, photo, profile) {
    const k = photoScale(view, photo, profile);
    if (!k) return null;
    const m = photo.marks;
    const across = (a, b) => (a != null && b != null ? ((b - a) * photo.width_px) / k : null);
    const height = m.roof != null && m.ground != null ? ((m.ground - m.roof) * photo.height_px) / k : null;
    if (isEndView(view)) {
        return { height, track: across(m.tireLeft, m.tireRight) };
    }
    const radii = [m.frontAxleY, m.rearAxleY].filter(y => y != null && m.ground != null).map(y => (m.ground - y) * photo.height_px / k);
    return {
        length: across(m.front, m.rear),
        wheelbase: across(m.frontAxle, m.rearAxle),
        frontOverhang: across(m.front, m.frontAxle),
        rearOverhang: across(m.rearAxle, m.rear),
        height,
        tireDiameter: radii.length ? (2 * radii.reduce((a, b) => a + b, 0)) / radii.length : null,
    };
}

/**
 * How far a side photo's length reads from the spec, in percent, RELATIVE TO
 * THE BASELINE: 0 at the baseline's shortfall, so a flag means the photo is
 * worse than a good one. Null without both figures.
 */
export function lengthOffPct(read, profile, baselinePct = SIZE_PHOTO_LENGTH_BASELINE_PCT) {
    if (!(read?.length > 0) || !(profile?.length > 0)) return null;
    return (read.length / profile.length - 1) * 100 + baselinePct;
}

/**
 * Where the photo lands in the chart's world, in inches: x from the vehicle's
 * front bumper (side) or centerline (front), y up from the ground.
 *
 * Up, one scale: ground to roof spans the height spec (without a roof mark or
 * a height spec, up takes the across scale). Across, the side photo is three
 * pieces cut at the axles: the axle-to-axle piece on the wheelbase, and the
 * two overhang pieces hung from the axles at the photo's own scale, each
 * lengthened only as far as it falls short of its spec by MORE than the
 * baseline allows (`baselinePct` of the length: perspective shortens a bumper
 * tip a little even in a studio shot, and that is left alone), never past the
 * spec. With `align` 'front' or 'rear' (the chart lined up on a bumper) the
 * stretched photo is then slid so that bumper's tip lands on the spec's bumper
 * line; the axles move off their specs by the shortfall left after the stretch. The margin beyond a bumper goes
 * with its piece. Without both
 * axles (in order) or the figures to place them, and in the front view, it is
 * one piece, bumper to bumper (edge to edge) on the length (width).
 *
 * @returns {{ top: number, h: number, slices: Array<{ x: number, w: number, from: number, to: number }> } | null}
 *          top edge and height; each piece's left edge and width in inches,
 *          and which part of the photo it is (`from`–`to`, fractions across)
 */
export function photoPlacement(view, photo, profile, baselinePct = SIZE_PHOTO_LENGTH_BASELINE_PCT, align = null) {
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
        const half = profile.width / 2;
        return { top, h, slices: [piece(0, 1, m.left, -half, m.right, half)] };
    }
    const { length, wheelbase, frontOverhang } = profile;
    const axles = m.front < m.frontAxle && m.frontAxle < m.rearAxle && m.rearAxle < m.rear
        && wheelbase > 0 && frontOverhang > 0 && frontOverhang + wheelbase < length;
    if (!axles) return { top, h, slices: [piece(0, 1, m.front, 0, m.rear, length)] };
    const fa = frontOverhang;
    const ra = frontOverhang + wheelbase;
    // Each overhang as the photo has it (at the wheelbase scale) and as drawn:
    // lengthened to its spec less the baseline's share, never past the spec.
    // The baseline is a shortfall of the length, all of it in the overhangs.
    const rearOverhang = length - wheelbase - frontOverhang;
    const allowed = (baselinePct / 100) * length / (length - wheelbase);
    const drawn = (photoIn, specIn) => Math.min(specIn, Math.max(photoIn, specIn * (1 - allowed)));
    const front = drawn(((m.frontAxle - m.front) * photo.width_px) / k, frontOverhang);
    const rear = drawn(((m.rear - m.rearAxle) * photo.width_px) / k, rearOverhang);
    let dx = 0;
    if (align) {
        dx = align === 'front' ? front - fa : length - (ra + rear);
    }
    return {
        top, h,
        slices: [
            piece(0, m.frontAxle, m.front, fa - front, m.frontAxle, fa),
            piece(m.frontAxle, m.rearAxle, m.frontAxle, fa, m.rearAxle, ra),
            piece(m.rearAxle, 1, m.rearAxle, ra, m.rear, ra + rear),
        ].map(sl => ({ ...sl, x: sl.x + dx })),
    };
}
