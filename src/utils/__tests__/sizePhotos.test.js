import { describe, it, expect } from 'vitest';
import { hasTransparency, removePlainBackground, visibleBounds, trimBox } from '../cutout';
import {
    startingMarks, mirrorMarks, carryMarks, photoScale, figuresFromMarks, photoPlacement,
} from '../sizePhotoMarks';
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
        expect(startingMarks('front', bounds)).toEqual({ left: 0.1, right: 0.9, ground: expect.closeTo(0.8), roof: 0.2 });
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
        const p = photo({ front: 0.1, frontAxle: 0.3, rearAxle: 0.8, rear: 0.9, ground: 0.9 });
        expect(photoPlacement('side', p, { length: 200 })).toEqual({ x: expect.closeTo(-25), top: expect.closeTo(90), w: expect.closeTo(250), h: expect.closeTo(100) });
        const fp = photo({ left: 0.2, right: 0.8, ground: 0.95 }, 500, 500);
        expect(photoPlacement('front', fp, { width: 75 })).toEqual({ x: expect.closeTo(-62.5), top: expect.closeTo(118.75), w: expect.closeTo(125), h: expect.closeTo(125) });
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
