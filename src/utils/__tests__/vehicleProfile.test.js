import { describe, it, expect } from 'vitest';
import { parseTireSize } from '../tireSize';
import { profileFromSpecs, anchorX } from '../vehicleProfile';
import { sideSilhouette, frontSilhouette } from '../silhouettes';
import { BODY_SHAPES, FALLBACK_BODY_STYLE } from '../../constants/sizeChart';

describe('parseTireSize', () => {
    it('reads a metric size', () => {
        const t = parseTireSize('255/45R19');
        expect(t.rimIn).toBe(19);
        expect(t.diameterIn).toBeCloseTo(19 + 2 * 255 * 0.45 / 25.4, 5);
        expect(t.widthIn).toBeCloseTo(255 / 25.4, 5);
    });

    it('reads P, LT, ZR and spaced forms', () => {
        expect(parseTireSize('P265/70R17').rimIn).toBe(17);
        expect(parseTireSize('LT275/65R20').rimIn).toBe(20);
        expect(parseTireSize('275/40ZR21').rimIn).toBe(21);
        expect(parseTireSize('245/45 R 19').rimIn).toBe(19);
    });

    it('reads the first size of a staggered setup', () => {
        expect(parseTireSize('245/35R21 / 265/35R21').widthIn).toBeCloseTo(245 / 25.4, 5);
    });

    it('reads a flotation size', () => {
        expect(parseTireSize('35x12.50R17')).toEqual({ diameterIn: 35, widthIn: 12.5, rimIn: 17 });
    });

    it('returns null for anything else', () => {
        expect(parseTireSize('')).toBeNull();
        expect(parseTireSize(null)).toBeNull();
        expect(parseTireSize('19-inch wheels')).toBeNull();
    });
});

const model3 = {
    dimensions: {
        body_style: 'Sedan', length_in: 184.8, height_in: 56.7, wheelbase_in: 113.2,
        front_overhang_in: 35, width_in: 72.8, width_mirrors_in: 82.2, ground_clearance_in: 5.4,
        track_front_in: 62.2, track_rear_in: 62.2,
    },
    wheels: { tire_size: '235/45R18', wheel_size_in: 18 },
};

describe('profileFromSpecs', () => {
    it('takes every recorded figure as it stands', () => {
        const p = profileFromSpecs(model3);
        expect(p.length).toBe(184.8);
        expect(p.frontOverhang).toBe(35);
        expect(p.rearOverhang).toBeCloseTo(184.8 - 113.2 - 35, 5);
        expect(p.bodyStyle).toBe('Sedan');
        expect([...p.estimated]).toEqual([]);
        expect(p.missing).toEqual({ side: [], front: [], rear: [] });
    });

    it('splits the overhangs by body style when the front one is missing, and says so', () => {
        const specs = { dimensions: { ...model3.dimensions, front_overhang_in: null } };
        const p = profileFromSpecs(specs);
        expect(p.frontOverhang).toBeCloseTo((184.8 - 113.2) * BODY_SHAPES.Sedan.frontShare, 5);
        expect(p.estimated.has('frontOverhang')).toBe(true);
    });

    it('reads a front overhang that leaves no rear overhang as missing', () => {
        const specs = { dimensions: { ...model3.dimensions, front_overhang_in: 80 } };
        const p = profileFromSpecs(specs);
        expect(p.frontOverhang).toBeLessThan(80);
        expect(p.estimated.has('frontOverhang')).toBe(true);
    });

    it('stands in for body style, clearance and wheels', () => {
        const p = profileFromSpecs({ dimensions: { length_in: 180, height_in: 60, wheelbase_in: 110 }, wheels: { wheel_size_in: 20 } });
        expect(p.bodyStyle).toBe(FALLBACK_BODY_STYLE);
        expect(p.tireDiameter).toBeGreaterThan(20);
        for (const k of ['bodyStyle', 'groundClearance', 'tireDiameter', 'frontOverhang']) expect(p.estimated.has(k)).toBe(true);
    });

    it('takes the body width from the mirror width only as an estimate', () => {
        const p = profileFromSpecs({ dimensions: { height_in: 60, width_mirrors_in: 84 } });
        expect(p.width).toBeLessThan(84);
        expect(p.estimated.has('width')).toBe(true);
        expect(p.missing.front).toEqual([]);
    });

    it('lists what each view lacks', () => {
        const p = profileFromSpecs({ dimensions: { length_in: 180 } });
        expect(p.missing.side).toEqual(['height', 'wheelbase']);
        expect(p.missing.front).toEqual(['width', 'height']);
        expect(profileFromSpecs(null).missing.side).toEqual(['length', 'height', 'wheelbase']);
    });
});

describe('anchorX', () => {
    const p = profileFromSpecs(model3);
    it('places each anchor from the front bumper', () => {
        expect(anchorX(p, 'front')).toBe(0);
        expect(anchorX(p, 'frontAxle')).toBe(35);
        expect(anchorX(p, 'wheelbaseCenter')).toBeCloseTo(35 + 56.6, 5);
        expect(anchorX(p, 'lengthCenter')).toBeCloseTo(92.4, 5);
        expect(anchorX(p, 'rearAxle')).toBeCloseTo(148.2, 5);
        expect(anchorX(p, 'rear')).toBe(184.8);
    });
});

const finitePath = (d) => !/NaN|Infinity|undefined/.test(d) && d.length > 0;

describe('silhouettes', () => {
    it('draws every body style without a bad number', () => {
        for (const style of Object.keys(BODY_SHAPES)) {
            const p = profileFromSpecs({ ...model3, dimensions: { ...model3.dimensions, body_style: style } });
            const side = sideSilhouette(p);
            expect(finitePath(side.body)).toBe(true);
            expect(side.wheels.map(w => w.x)).toEqual([35, 35 + 113.2]);
            const front = frontSilhouette(p);
            expect(finitePath(front.body)).toBe(true);
            expect(front.tires).toHaveLength(2);
        }
    });

    it('gives the front view mirrors only when their width is known', () => {
        const withMirrors = frontSilhouette(profileFromSpecs(model3));
        const without = frontSilhouette(profileFromSpecs({ ...model3, dimensions: { ...model3.dimensions, width_mirrors_in: null } }));
        expect(withMirrors.body.match(/M /g).length).toBe(3);
        expect(without.body.match(/M /g).length).toBe(1);
    });
});
