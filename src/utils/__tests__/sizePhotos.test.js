import { describe, it, expect } from 'vitest';
import { hasTransparency, removePlainBackground, visibleBounds, trimBox } from '../cutout';
import {
    startingMarks, mirrorMarks, carryMarks, photoScale, figuresFromMarks, photoPlacement, fillMarks,
} from '../sizePhotoMarks';
import { endAnchorX } from '../sizeChartLayout';
import { profileFromSpecs } from '../vehicleProfile';

/** A w×h image of `bg`, with a `fg` box from (x0,y0) to (x1,y1) exclusive. */
function image(w, h, bg, fg, [x0, y0, x1, y1]) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = x >= x0 && x < x1 && y >= y0 && y < y1 ? fg : bg;
            data.set(c, (y * w + x) * 4);
        }
    }
    return { data, width: w, height: h };
}
const WHITE = [255, 255, 255, 255];
const RED = [200, 30, 30, 255];
const CLEAR = [0, 0, 0, 0];

describe('cutout', () => {
    it('tells a cutout from an opaque photo', () => {
        expect(hasTransparency(image(20, 10, CLEAR, RED, [5, 2, 15, 8]))).toBe(true);
        expect(hasTransparency(image(20, 10, WHITE, RED, [5, 2, 15, 8]))).toBe(false);
    });

    it('clears a plain background and keeps the car', () => {
        const res = removePlainBackground(image(40, 20, WHITE, RED, [10, 5, 30, 15]), 24);
        expect(res.ok).toBe(true);
        expect(res.removed).toBeCloseTo(1 - (20 * 10) / (40 * 20), 5);
        expect(visibleBounds(res.image)).toEqual({ x: 10, y: 5, w: 20, h: 10 });
    });

    it('refuses a busy background', () => {
        const busy = image(40, 20, WHITE, RED, [0, 0, 20, 20]);
        expect(removePlainBackground(busy, 24)).toEqual({ ok: false, reason: 'busy' });
    });

    it('trims to the visible pixels plus a margin, inside the image', () => {
        const box = trimBox({ x: 10, y: 5, w: 20, h: 10 }, 40, 20, 0.05);
        expect(box).toEqual({ x: 9 / 40, y: 4 / 20, w: 22 / 40, h: 12 / 20 });
        expect(trimBox({ x: 0, y: 0, w: 40, h: 20 }, 40, 20)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
        expect(visibleBounds(image(4, 4, CLEAR, CLEAR, [0, 0, 0, 0]))).toBeNull();
    });
});

const photo = (marks, w = 1000, h = 400) => ({ marks, width_px: w, height_px: h });

describe('size photo marks', () => {
    it('starts the bumpers and ground at the cutout edges and the axles where the specs put them', () => {
        const bounds = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 };
        const m = startingMarks('side', bounds, { length: 200, frontOverhang: 40, rearOverhang: 50 });
        expect(m.front).toBeCloseTo(0.1);
        expect(m.rear).toBeCloseTo(0.9);
        expect(m.ground).toBeCloseTo(0.8);
        expect(m.roof).toBeCloseTo(0.2);
        expect(m.frontAxle).toBeCloseTo(0.1 + 0.2 * 0.8);
        expect(m.rearAxle).toBeCloseTo(0.9 - 0.25 * 0.8);
        expect(startingMarks('front', bounds)).toMatchObject({ left: 0.1, right: 0.9, ground: expect.closeTo(0.8), roof: 0.2 });
    });

    it('fills the later marks from the specs: underbody, mirrors, axle heights', () => {
        const side = fillMarks('side', { front: 0, frontAxle: 0.2, rearAxle: 0.8, rear: 1, ground: 1, roof: 0 },
            { height: 60, groundClearance: 6, tireDiameter: 30 });
        expect(side.underbody).toBeCloseTo(0.9);
        expect(side.frontAxleY).toBeCloseTo(0.75);
        expect(side.rearAxleY).toBeCloseTo(0.75);
        const rear = fillMarks('rear', { left: 0.1, right: 0.9, ground: 1, roof: 0 }, { width: 80, widthMirrors: 88 });
        expect(rear.mirrorLeft).toBeCloseTo(0.06);
        expect(rear.mirrorRight).toBeCloseTo(0.94);
        // A mark already placed is kept.
        expect(fillMarks('front', { left: 0.1, right: 0.9, ground: 1, roof: 0, underbody: 0.5 }).underbody).toBe(0.5);
    });

    it('mirrors the axle heights and the mirrors with their sides', () => {
        const side = mirrorMarks('side', { front: 0, frontAxle: 0.2, rearAxle: 0.8, rear: 1, frontAxleY: 0.7, rearAxleY: 0.72 });
        expect(side.frontAxleY).toBe(0.72);
        expect(side.rearAxleY).toBe(0.7);
        const end = mirrorMarks('rear', { left: 0.1, right: 0.9, mirrorLeft: 0.02, mirrorRight: 0.97 });
        expect(end.mirrorLeft).toBeCloseTo(0.03);
        expect(end.mirrorRight).toBeCloseTo(0.98);
    });

    it('lines end views up on the photo\'s own marks, else the specs', () => {
        const profile = { width: 80, widthMirrors: 88, height: 70, tireWidth: 10, trackRear: 66, estimated: new Set() };
        const p = photo({ mirrorLeft: 0.12, left: 0.15, right: 0.85, ground: 0.9, roof: 0.1 }, 500, 500);
        const item = { profile, photo: { ...p, placement: photoPlacement('rear', p, profile) } };
        // Mirror mark 0.03 of the photo outside the body edge, at 80 in / 0.7 per photo width.
        expect(endAnchorX(item, 'rear', 'leftMirror')).toBeCloseTo(40 + 0.03 * 80 / 0.7);
        expect(endAnchorX(item, 'rear', 'leftBody')).toBeCloseTo(40);
        expect(endAnchorX(item, 'rear', 'leftTire')).toBeCloseTo(38); // no tire mark: (66 + 10) / 2
        expect(endAnchorX({ profile }, 'rear', 'leftMirror')).toBeCloseTo(44);
        expect(endAnchorX(item, 'rear', 'centerline')).toBe(0);
    });

    it('reads a rear photo like a front one, from the width spec', () => {
        const p = photo({ left: 0.2, right: 0.8, ground: 0.9, roof: 0.3 }, 500, 500);
        expect(photoScale('rear', p, { width: 75 })).toBeCloseTo(4);
        expect(figuresFromMarks('rear', p, { width: 75 }).height).toBeCloseTo(75);
    });

    it('mirrors marks, swapping front for rear', () => {
        const m = { front: 0.1, frontAxle: 0.3, rearAxle: 0.7, rear: 0.95, ground: 0.9 };
        const flipped = mirrorMarks('side', m);
        expect(flipped.front).toBeCloseTo(0.05);
        expect(flipped.frontAxle).toBeCloseTo(0.3);
        expect(flipped.rear).toBeCloseTo(0.9);
        expect(flipped.ground).toBe(0.9);
        expect(mirrorMarks('side', flipped)).toEqual({ ...m, front: expect.closeTo(0.1), rear: expect.closeTo(0.95), frontAxle: expect.closeTo(0.3), rearAxle: expect.closeTo(0.7) });
    });

    it('carries marks to a new trim of the same original, mirrored or not', () => {
        const from = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        const to = { x: 0, y: 0, w: 1, h: 1 };
        const m = { front: 0, rear: 1, ground: 1, frontAxle: 0.25, rearAxle: 0.75 };
        const out = carryMarks('side', m, from, to);
        expect(out.front).toBeCloseTo(0.1);
        expect(out.rear).toBeCloseTo(0.9);
        expect(out.ground).toBeCloseTo(0.9);
        const back = carryMarks('side', out, to, from, true);
        for (const k of Object.keys(m)) expect(back[k]).toBeCloseTo(m[k]);
    });

    it('scales from the length spec and reads the other figures back', () => {
        const p = photo({ front: 0.1, frontAxle: 0.3, rearAxle: 0.8, rear: 0.9, ground: 0.9, roof: 0.2 });
        const profile = { length: 200 };
        expect(photoScale('side', p, profile)).toBeCloseTo(800 / 200);
        const f = figuresFromMarks('side', p, profile);
        expect(f.wheelbase).toBeCloseTo(125);
        expect(f.frontOverhang).toBeCloseTo(50);
        expect(f.rearOverhang).toBeCloseTo(25);
        expect(f.height).toBeCloseTo(0.7 * 400 / 4);
        expect(photoScale('side', p, {})).toBeNull();
    });

    it('places the photo with its front bumper at 0 and its ground on the ground', () => {
        // No axle figures: one piece, bumper to bumper on the length.
        const p = photo({ front: 0.1, frontAxle: 0.3, rearAxle: 0.8, rear: 0.9, ground: 0.9 });
        const one = photoPlacement('side', p, { length: 200 });
        expect(one.slices).toEqual([{ x: expect.closeTo(-25), w: expect.closeTo(250), from: 0, to: 1 }]);
        expect([one.top, one.h]).toEqual([expect.closeTo(90), expect.closeTo(100)]);
        const fp = photo({ left: 0.2, right: 0.8, ground: 0.95 }, 500, 500);
        const front = photoPlacement('front', fp, { width: 75 });
        expect(front.slices).toEqual([{ x: expect.closeTo(-62.5), w: expect.closeTo(125), from: 0, to: 1 }]);
        expect([front.top, front.h]).toEqual([expect.closeTo(118.75), expect.closeTo(125)]);
    });

    it('lands every mark on its spec: bumpers, axles, ground and roof', () => {
        // The photo's ends are squeezed: its overhangs read short, its wheelbase long.
        const p = photo({ front: 0.1, frontAxle: 0.2, rearAxle: 0.8, rear: 0.9, ground: 0.9, roof: 0.3 });
        const spec = { length: 200, wheelbase: 120, frontOverhang: 35, height: 50 };
        const { slices, top, h } = photoPlacement('side', p, spec);
        // Where a photo fraction lands, through the piece that holds it.
        const at = (f) => {
            const s = slices.find(x => f >= x.from && f <= x.to);
            return s.x + ((f - s.from) / (s.to - s.from)) * s.w;
        };
        expect(at(0.1)).toBeCloseTo(0);
        expect(at(0.2)).toBeCloseTo(35);
        expect(at(0.8)).toBeCloseTo(155);
        expect(at(0.9)).toBeCloseTo(200);
        // The pieces meet edge to edge, and cover the whole photo.
        expect(slices[0].from).toBe(0);
        expect(slices[2].to).toBe(1);
        expect(slices[0].x + slices[0].w).toBeCloseTo(slices[1].x);
        expect(slices[1].x + slices[1].w).toBeCloseTo(slices[2].x);
        // Up: ground at 0, roof at the height spec.
        expect(top - 0.9 * h).toBeCloseTo(0);
        expect(top - 0.3 * h).toBeCloseTo(50);
    });

    it('falls back to one piece when the axles are out of order', () => {
        const p = photo({ front: 0.1, frontAxle: 0.85, rearAxle: 0.8, rear: 0.9, ground: 0.9 });
        expect(photoPlacement('side', p, { length: 200, wheelbase: 120, frontOverhang: 35 }).slices).toHaveLength(1);
    });

    it('draws ground to roof at the height spec; no height spec, one scale both ways', () => {
        const p = photo({ front: 0.1, rear: 0.9, ground: 0.9, roof: 0.3 });
        const low = photoPlacement('side', p, { length: 200, height: 50 });
        expect(low.slices[0].w).toBeCloseTo(250);
        expect((0.9 - 0.3) * low.h).toBeCloseTo(50);
        expect(photoPlacement('side', p, { length: 200 }).h).toBeCloseTo(100);
    });

    it('fills a missing front overhang from the side photo, and never overrides a spec', () => {
        const dims = { length_in: 200, height_in: 60, wheelbase_in: 125 };
        const side = photo({ front: 0.1, frontAxle: 0.3, rearAxle: 0.8, rear: 0.9, ground: 0.9 });
        const p = profileFromSpecs({ dimensions: dims }, { side });
        expect(p.frontOverhang).toBeCloseTo(50);
        expect(p.fromPhoto.has('frontOverhang')).toBe(true);
        expect(p.estimated.has('frontOverhang')).toBe(false);
        // A photo whose wheelbase reads long still splits only the specs' 75 in.
        const off = photo({ front: 0.1, frontAxle: 0.25, rearAxle: 0.85, rear: 0.9, ground: 0.9 });
        const split = profileFromSpecs({ dimensions: dims }, { side: off });
        expect(split.frontOverhang + split.rearOverhang).toBeCloseTo(75);
        expect(split.frontOverhang).toBeCloseTo(75 * (0.15 / 0.2));
        const spec = profileFromSpecs({ dimensions: { ...dims, front_overhang_in: 40 } }, { side });
        expect(spec.frontOverhang).toBe(40);
        expect(spec.fromPhoto.size).toBe(0);
    });
});
