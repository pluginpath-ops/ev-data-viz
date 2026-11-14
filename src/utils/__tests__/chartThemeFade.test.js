import { describe, it, expect } from 'vitest';
import { fade } from '../chartTheme';

describe('fade', () => {
    it('rewrites rgb() with an alpha', () => {
        expect(fade('rgb(45, 127, 249)', 0.07)).toBe('rgba(45, 127, 249, 0.07)');
    });
    it('rewrites hex, which is what a token reads as in the production build', () => {
        expect(fade('#2d7ff9', 0.07)).toBe('rgba(45, 127, 249, 0.07)');
    });
    it('never returns another color format at full strength', () => {
        expect(fade('oklch(0.6 0.2 250)', 0.07)).toBe('color-mix(in srgb, oklch(0.6 0.2 250) 7%, transparent)');
    });
});
