import { describe, it, expect } from 'vitest';
import { dominantColor, NO_COLOR_REASONS } from '../imageColor';
import { hexToHsl } from '../colorUtils';

/* A 100 x 100 frame painted by `paint(x, y) -> [r, g, b]`. */
const frame = (paint) => {
    const width = 100, height = 100, data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const [r, g, b] = paint(x, y);
        data.set([r, g, b, 255], (y * width + x) * 4);
    }
    return { data, width, height };
};
const car = (x, y) => x >= 15 && x < 85 && y >= 40 && y < 85;

describe('dominantColor', () => {
    it('finds a car against a white sweep', () => {
        const { color } = dominantColor(frame((x, y) => car(x, y) ? [200, 30, 30] : [245, 245, 245]));
        const plain = hexToHsl('#c81e1e'), got = hexToHsl(color);
        expect(Math.abs(got.h - plain.h)).toBeLessThan(2);   // the same red
        expect(got.s).toBeGreaterThan(plain.s);              // a touch more vivid
        expect(got.l).toBeGreaterThan(plain.l);              // and brighter
    });

    it('finds a red car across the hue seam', () => {
        const { color } = dominantColor(frame((x, y) =>
            car(x, y) ? ((x + y) % 2 ? [200, 30, 40] : [200, 40, 30]) : [240, 240, 240]));
        const { h } = hexToHsl(color);
        expect(h < 8 || h > 352).toBe(true);   // still red, either side of the seam
    });

    it('declines a white, a black and a silver car rather than guess', () => {
        for (const body of [[240, 240, 240], [15, 15, 15], [170, 172, 176]]) {
            const out = dominantColor(frame((x, y) => car(x, y) ? body : [90, 120, 200]));
            expect(out.color).toBeNull();
            expect(out.reason).toBe(NO_COLOR_REASONS.neutral);
        }
    });

    it('does not take a background that sits outside the middle of the frame', () => {
        // Silver car, blue sky across the top 25%: the sky is outside the region.
        const out = dominantColor(frame((x, y) => y < 25 ? [60, 110, 220] : car(x, y) ? [170, 172, 176] : [200, 200, 200]));
        expect(out.color).toBeNull();
    });

    it('declines when two unrelated hues compete', () => {
        const out = dominantColor(frame((x, y) => !car(x, y) ? [240, 240, 240] : x < 50 ? [200, 30, 30] : [30, 60, 200]));
        expect(out.color).toBeNull();
        expect(out.reason).toBe(NO_COLOR_REASONS.ambiguous);
    });

    it('does not call a silver car the color of the wall behind it', () => {
        const out = dominantColor(frame((x, y) => car(x, y) ? [170, 172, 176] : [60, 110, 220]));
        expect(out.reason).toBe(NO_COLOR_REASONS.neutral);
    });

    it('ignores transparent pixels', () => {
        const img = frame(() => [200, 30, 30]);
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 0;
        expect(dominantColor(img).reason).toBe(NO_COLOR_REASONS.unreadable);
    });
});
