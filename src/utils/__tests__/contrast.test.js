/**
 * The colour arithmetic the contrast checks rest on.
 *
 * Worth testing directly rather than only through the sweep, because every bug
 * this module has had produced a plausible NUMBER rather than an error — and a
 * plausible wrong number is indistinguishable from a right one at a glance.
 */
import { describe, it, expect } from 'vitest';
import { parseColor, composite, compositeStack, contrastRatio, ratioOf } from '../contrast';

describe('parseColor', () => {
    it('reads hex, short hex and hex with alpha', () => {
        expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
        expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
        expect(parseColor('#ff000080').a).toBeCloseTo(0.502, 2);
    });

    it('reads both rgb() spellings', () => {
        expect(parseColor('rgb(59, 130, 246)')).toEqual({ r: 59, g: 130, b: 246, a: 1 });
        expect(parseColor('rgba(0, 0, 0, 0.5)').a).toBe(0.5);
        expect(parseColor('rgb(59 130 246 / 0.25)').a).toBe(0.25);
    });

    it('reads oklch, which is what Tailwind v4 actually emits', () => {
        // The bug this prevents: `bg-blue-500` computes to an oklch string, so
        // returning null here made the playground skip the button's background
        // entirely and measure its white text against the white PAGE — 1.05:1
        // for a control that is really at 3.68:1.
        const blue = parseColor('oklch(0.623 0.214 259.815)');
        expect(blue).not.toBeNull();
        expect(blue.r).toBeGreaterThan(0);
        expect(blue.b).toBeGreaterThan(blue.r);   // it is, at least, blue
    });

    it('round-trips sRGB through oklch exactly', () => {
        // Independent sRGB→oklch, so the inverse is checked against something
        // other than itself.
        const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const toOklch = (r, g, b) => {
            const R = toLin(r), G = toLin(g), B = toLin(b);
            const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
            const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
            const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
            const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
            const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
            const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
            let h = (Math.atan2(Bb, A) * 180) / Math.PI;
            if (h < 0) h += 360;
            return `oklch(${L.toFixed(6)} ${Math.hypot(A, Bb).toFixed(6)} ${h.toFixed(4)})`;
        };
        for (const [r, g, b] of [[59, 130, 246], [239, 68, 68], [34, 197, 94], [17, 24, 39], [248, 250, 252]]) {
            expect(parseColor(toOklch(r, g, b))).toEqual({ r, g, b, a: 1 });
        }
    });

    it('returns null rather than throwing on anything it cannot read', () => {
        // A sweep meets these constantly; a null is "skip this layer".
        for (const v of ['transparent', 'var(--nope)', 'currentColor', '', null, undefined, 'chartreuse']) {
            expect(parseColor(v)).toBeNull();
        }
    });
});

describe('compositing', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };

    it('lays a translucent colour over an opaque one', () => {
        expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, white))
            .toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    });

    it('folds a stack outermost-last, the way a browser paints', () => {
        const half = (c) => ({ ...c, a: 0.5 });
        // Black at 50% over white is grey; another black 50% over that is darker.
        const once = compositeStack(white, half(black));
        const twice = compositeStack(white, half(black), half(black));
        expect(twice.r).toBeLessThan(once.r);
    });

    it('ignores null layers so an unparseable colour is skipped, not fatal', () => {
        expect(compositeStack(white, null, undefined)).toEqual(white);
    });
});

describe('contrastRatio', () => {
    it('is 21 for black on white and 1 for a colour on itself', () => {
        expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
        expect(contrastRatio({ r: 80, g: 80, b: 80 }, { r: 80, g: 80, b: 80 })).toBeCloseTo(1, 5);
    });

    it('is symmetric — order of the pair does not change the answer', () => {
        const a = { r: 20, g: 40, b: 60 }, b = { r: 200, g: 210, b: 220 };
        expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
    });
});

describe('ratioOf', () => {
    it('composites a translucent background before measuring it', () => {
        // The whole reason this module exists. A 10% amber wash over a near-black
        // card is dark; treating the amber as opaque calls it light and inverts
        // the verdict.
        const onDarkCard = ratioOf('rgb(252, 211, 77)', 'rgba(245, 158, 11, 0.1)', 'rgb(8, 12, 28)');
        expect(onDarkCard).toBeGreaterThan(4.5);

        const naive = contrastRatio(parseColor('rgb(252, 211, 77)'), parseColor('rgb(245, 158, 11)'));
        expect(naive).toBeLessThan(2);   // what the wrong answer looks like
    });

    it('composites translucent TEXT onto its own background', () => {
        // Faint text at low alpha is barely there; measuring the declared colour
        // reports it as perfectly readable.
        const faint = ratioOf('rgba(0, 0, 0, 0.1)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)');
        expect(faint).toBeLessThan(1.5);
    });

    it('returns null when either colour cannot be read', () => {
        expect(ratioOf('transparent', 'rgb(255,255,255)')).toBeNull();
        expect(ratioOf('rgb(0,0,0)', 'var(--x)')).toBeNull();
    });
});
