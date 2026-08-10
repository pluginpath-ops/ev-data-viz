import { describe, it, expect } from 'vitest';
import { resolvePairColors } from '../colorUtils';

const r = (key, primaryId, baseColor) => ({ key, primaryId, baseColor });
const dist = (x, y) => {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [a, b] = [p(x), p(y)];
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

describe('pair colours', () => {
    it('leaves an unpaired primary exactly as it was', () => {
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 2, '#D55E00')]);
        expect(out).toEqual({ a: '#0072B2', b: '#D55E00' });
    });

    it('stops two partners of one primary from colliding', () => {
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 1, '#0072B2'), r('c', 2, '#D55E00')]);
        expect(out.a).not.toBe(out.b);
    });

    it('keeps the first partner untouched, so nothing moves until it must', () => {
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 1, '#0072B2')]);
        expect(out.a).toBe('#0072B2');
    });

    it('keeps shaded partners closer to each other than to another slot', () => {
        // The whole point: related series should read as related.
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 1, '#0072B2'), r('c', 2, '#D55E00')]);
        expect(dist(out.a, out.b)).toBeLessThan(dist(out.a, out.c));
    });

    it('leaves an unrelated primary unaffected by a neighbour being shaded', () => {
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 1, '#0072B2'), r('c', 2, '#D55E00')]);
        expect(out.c).toBe('#D55E00');
    });

    it('gives six partners of one primary distinct colours', () => {
        const out = resolvePairColors([1,2,3,4,5,6].map(i => r(`k${i}`, 9, '#009E73')));
        expect(new Set(Object.values(out)).size).toBeGreaterThanOrEqual(5);
    });

    it('still yields usable distinct colours with no base colour', () => {
        const out = resolvePairColors([r('a', 1, null), r('b', 1, undefined)]);
        expect(out.a).toMatch(/^#[0-9a-f]{6}$/i);
        expect(out.a).not.toBe(out.b);
    });

    it('tolerates empty and undefined input', () => {
        expect(resolvePairColors([])).toEqual({});
        expect(resolvePairColors()).toEqual({});
    });
});
