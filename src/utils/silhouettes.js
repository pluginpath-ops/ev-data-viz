/**
 * A vehicle's silhouette, drawn from its profile (vehicleProfile.js): SVG path
 * data for the Size chart, side view and front view.
 *
 * Coordinates are inches with y UP from the ground; the chart flips them with
 * one transform. The side view faces left: x = 0 is the front bumper. The front
 * view is centered: x = 0 is the vehicle's centerline.
 *
 * The outline is one of BODY_SHAPES (constants/sizeChart.js) stretched to the
 * vehicle's own length, height, wheelbase and overhangs, so it is a likeness,
 * not a drawing of the car: what it gets right is where the bumpers, axles,
 * roof and wheels are.
 *
 * Pure module.
 */

import { BODY_SHAPES } from '../constants/sizeChart';

const r1 = (n) => Math.round(n * 10) / 10;
const pt = ([x, y]) => `${r1(x)} ${r1(y)}`;

/** Drops a point that repeats the one before it. */
const dedupe = (points) => points.filter((p, i) => i === 0
    || Math.abs(p[0] - points[i - 1][0]) > 0.01 || Math.abs(p[1] - points[i - 1][1]) > 0.01);

/**
 * A polyline through `points` with each interior corner rounded by up to
 * `radius` (less where a segment is short). Starts with a line, not a move, so
 * it can continue a path.
 */
function roundedRun(points, radius) {
    const pts = dedupe(points);
    let d = `L ${pt(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i - 1];
        const [cx, cy] = pts[i];
        const [nx, ny] = pts[i + 1];
        const inLen = Math.hypot(cx - px, cy - py);
        const outLen = Math.hypot(nx - cx, ny - cy);
        const r = Math.min(radius, inLen / 2, outLen / 2);
        if (r <= 0) { d += ` L ${pt(pts[i])}`; continue; }
        const a = [cx - ((cx - px) / inLen) * r, cy - ((cy - py) / inLen) * r];
        const b = [cx + ((nx - cx) / outLen) * r, cy + ((ny - cy) / outLen) * r];
        d += ` L ${pt(a)} Q ${pt(pts[i])} ${pt(b)}`;
    }
    return `${d} L ${pt(pts[pts.length - 1])}`;
}

/**
 * The arch over one wheel, from its rear edge to its front edge along the
 * underside at height `y` (the side view runs front to back along the top and
 * back to front along the bottom).
 */
function wheelArch(axleX, wheelR, archR, y) {
    const dy = y - wheelR;
    if (Math.abs(dy) >= archR) return '';
    const half = Math.sqrt(archR * archR - dy * dy);
    // Over the top: counterclockwise with y up; the long way round while the
    // underside sits below the wheel's center.
    const large = y < wheelR ? 1 : 0;
    return ` L ${pt([axleX + half, y])} A ${r1(archR)} ${r1(archR)} 0 ${large} 1 ${pt([axleX - half, y])}`;
}

/**
 * The side view.
 *
 * @param {object} p  a profile with length, height and wheelbase
 * @returns {{ body: string, glass: string, wheels: Array<{ x: number, r: number, rimR: number|null }> }}
 */
export function sideSilhouette(p) {
    const s = BODY_SHAPES[p.bodyStyle];
    const { length: L, height: H, wheelbase: WB, frontOverhang: fo, groundClearance: gc } = p;
    const fa = fo;
    const ra = fo + WB;
    const ro = L - ra;
    const along = (t) => fa + t * WB;
    const wheelR = p.tireDiameter / 2;
    const archR = wheelR + Math.max(1, wheelR * 0.1);
    const bumperY = Math.min(gc + H * 0.05, H * 0.3);

    const cowl = [Math.max(along(s.cowl), L * 0.08), H * s.hoodH];
    const tailX = Math.min(ra + s.tail * ro, L);
    const roofF = [Math.max(along(s.roofF), cowl[0] + L * 0.04), H];
    const roofR = [Math.min(along(s.roofR), tailX - L * 0.03), H];
    const top = [
        [0, bumperY], [0, H * s.noseH], cowl, roofF, roofR,
        // A pickup's cab ends in a wall down to the bed rails.
        ...(s.bedH ? [[roofR[0] + 2, H * s.bedH]] : []),
        [tailX, H * s.tailH], [L, H * s.deckH], [L, bumperY],
    ];
    const body = `M ${pt(top[0])} ${roundedRun(top, H * 0.08)}`
        + ` L ${pt([L - Math.min(ro * 0.25, 6), gc])}`
        + wheelArch(ra, wheelR, archR, gc)
        + wheelArch(fa, wheelR, archR, gc)
        + ` L ${pt([Math.min(fo * 0.3, 6), gc])} Z`;

    // The side glass: inside the roof, above the belt line.
    const belt = H * (s.hoodH + 0.03);
    const inset = H * 0.06;
    const glassBack = s.bedH ? roofR[0] - 1 : roofR[0] + (tailX - roofR[0]) * 0.7;
    const glassPts = [
        [cowl[0] + (roofF[0] - cowl[0]) * 0.25, belt],
        [roofF[0] + inset * 0.6, H - inset],
        [roofR[0] - inset * 0.6, H - inset],
        [glassBack, belt],
    ];
    const glass = glassPts[2][0] > glassPts[1][0] && belt < H - inset
        ? `M ${pt(glassPts[0])} ${roundedRun([...glassPts, glassPts[0]], H * 0.04)} Z`
        : '';

    const rimR = p.rim ? p.rim / 2 : null;
    return {
        body,
        glass,
        wheels: [fa, ra].map(x => ({ x, r: wheelR, rimR: rimR && rimR < wheelR ? rimR : null })),
    };
}

/** The share of body width the roof spans, seen from the front. */
const ROOF_SHARE = { SUV: 0.78, Van: 0.8, Pickup: 0.74, Crossover: 0.7 };

/**
 * The front view.
 *
 * @param {object} p  a profile with width and height
 * @returns {{ body: string, glass: string, tires: Array<{ x: number, w: number, h: number }> }}
 *          tires by their left edge
 */
export function frontSilhouette(p) {
    const s = BODY_SHAPES[p.bodyStyle];
    const { width: W, height: H, groundClearance: gc } = p;
    const belt = H * s.hoodH;
    const roofHalf = (W * (ROOF_SHARE[p.bodyStyle] ?? 0.64)) / 2;
    const shoulder = W * 0.44;
    const outline = [
        [-W / 2, gc], [-W / 2, belt], [-shoulder, belt], [-roofHalf, H],
        [roofHalf, H], [shoulder, belt], [W / 2, belt], [W / 2, gc],
    ];
    let body = `M ${pt([0, gc])} ${roundedRun([[0, gc], ...outline.slice(1), [0, gc]], H * 0.07)} Z`;

    // Mirrors, only when the width with them is known.
    if (p.widthMirrors && p.widthMirrors > W) {
        const m = p.widthMirrors / 2;
        const y0 = belt + H * 0.02;
        for (const side of [-1, 1]) {
            body += ` M ${pt([side * shoulder, y0])} L ${pt([side * m, y0 + H * 0.02])}`
                + ` L ${pt([side * m, y0 + H * 0.09])} L ${pt([side * shoulder, y0 + H * 0.1])} Z`;
        }
    }

    const inset = H * 0.05;
    const gl = [
        [-shoulder + inset, belt + inset * 0.6], [-roofHalf + inset * 0.6, H - inset],
        [roofHalf - inset * 0.6, H - inset], [shoulder - inset, belt + inset * 0.6],
    ];
    const glass = `M ${pt(gl[0])} ${roundedRun([...gl, gl[0]], H * 0.03)} Z`;

    const track = p.trackFront;
    const tires = track && p.tireDiameter
        ? [-1, 1].map(side => ({ x: side * track / 2 - p.tireWidth / 2, w: p.tireWidth, h: p.tireDiameter }))
        : [];
    return { body, glass, tires };
}
