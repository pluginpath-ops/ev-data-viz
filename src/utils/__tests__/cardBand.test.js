import { describe, it, expect } from 'vitest';
import {
    CARD_BAND_HEIGHT,
    CARD_BAND_MAX_WIDTH,
    CARD_BAND_OVERLAP,
    CARD_BAND_BODY_FRACTION,
    DEFAULT_FOCAL_Y,
    PHOTO_ASPECT,
    bandWindow,
    bandWindowFraction,
    focalY,
    focalYFromTop,
    photoPosition,
} from '../cardBand';

describe('the band shows a window of the photo', () => {
    it('is the band’s height over the photo scaled to the band’s width', () => {
        // A 399px card: the 16:9 photo is drawn 224px tall, of which 140 show.
        expect(bandWindowFraction(CARD_BAND_MAX_WIDTH)).toBeCloseTo(0.624, 3);
        // A narrower card shows MORE of it, which is why framing for the widest
        // one is safe everywhere narrower.
        expect(bandWindowFraction(313)).toBeGreaterThan(bandWindowFraction(CARD_BAND_MAX_WIDTH));
    });

    it('never claims to show more than the whole photo', () => {
        // Nothing reaches this today; a future taller band would.
        expect(bandWindowFraction(CARD_BAND_HEIGHT * PHOTO_ASPECT / 2)).toBe(1);
    });
});

describe('the focal point', () => {
    it('is centered for null, and for anything that is not a number', () => {
        expect(focalY(null)).toBe(DEFAULT_FOCAL_Y);
        expect(focalY(undefined)).toBe(DEFAULT_FOCAL_Y);
        expect(focalY('')).toBe(DEFAULT_FOCAL_Y);
        expect(focalY(NaN)).toBe(DEFAULT_FOCAL_Y);
    });

    it('keeps 0, which is a real answer and not an absent one', () => {
        expect(focalY(0)).toBe(0);
        expect(focalY(100)).toBe(100);
        expect(focalY(-40)).toBe(0);
        expect(focalY(140)).toBe(100);
    });

    it('draws an un-repositioned photo at exactly the pixels it always did', () => {
        // `center 50%` is the same declaration as the stylesheet's `center`.
        expect(photoPosition(null)).toBe('center 50%');
        expect(photoPosition(30)).toBe('center 30%');
    });
});

describe('the window slides over what does not fit', () => {
    it('sits at the top at 0, at the foot at 100, and in the middle by default', () => {
        const height = bandWindowFraction();
        expect(bandWindow(0)).toEqual({ top: 0, height });
        expect(bandWindow(100).top).toBeCloseTo(1 - height, 10);
        expect(bandWindow(null).top).toBeCloseTo((1 - height) / 2, 10);
        // Always inside the photo, whatever the focal point.
        expect(bandWindow(100).top + height).toBeCloseTo(1, 10);
    });

    it('reads back the focal point a drag lands on', () => {
        for (const value of [0, 17, 50, 83, 100]) {
            expect(focalYFromTop(bandWindow(value).top)).toBe(value);
        }
    });

    it('stays centered when the window fills the photo and has nowhere to slide', () => {
        const width = CARD_BAND_HEIGHT * PHOTO_ASPECT / 2;   // window fraction 1
        expect(focalYFromTop(0, width)).toBe(DEFAULT_FOCAL_Y);
        expect(bandWindow(80, width)).toEqual({ top: 0, height: 1 });
    });

    it('clamps a drag that runs past either edge', () => {
        expect(focalYFromTop(-0.5)).toBe(0);
        expect(focalYFromTop(1.5)).toBe(100);
    });
});

describe('the band’s own measurements', () => {
    it('states the body overlap as a fraction of the band, for a preview at any size', () => {
        expect(CARD_BAND_BODY_FRACTION).toBeCloseTo(CARD_BAND_OVERLAP / CARD_BAND_HEIGHT, 10);
    });
});
