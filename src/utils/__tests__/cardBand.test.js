import { describe, it, expect } from 'vitest';
import {
    CARD_BAND_HEIGHT,
    CARD_BAND_MAX_WIDTH,
    CARD_BAND_OVERLAP,
    CARD_BAND_BODY_FRACTION,
    CARD_BAND_HOLD,
    DEFAULT_FOCAL_Y,
    PHOTO_ASPECT,
    bandWindow,
    bandWindowFraction,
    focalStyle,
    focalY,
} from '../cardBand';

describe('the band shows a window of the photo', () => {
    it('is the band’s height over the photo scaled to the band’s width', () => {
        // A 399px card: the 16:9 photo is drawn 224px tall, of which 140 show.
        expect(bandWindowFraction(CARD_BAND_MAX_WIDTH)).toBeCloseTo(0.624, 3);
        // A narrower card shows MORE of it, which is why framing for the widest
        // one is safe everywhere narrower.
        expect(bandWindowFraction(313)).toBeGreaterThan(bandWindowFraction(CARD_BAND_MAX_WIDTH));
    });

    it('works from the photo’s real shape, which is not always 16:9', () => {
        // The Gravity Grand Touring's stored photo is 400×267. At 3:2 a desktop
        // card shows about 53% of it, not the 62% a 16:9 photo would give —
        // and assuming 16:9 is what put the preview's window over sky the
        // card never shows.
        expect(bandWindowFraction(CARD_BAND_MAX_WIDTH, 400 / 267)).toBeCloseTo(0.526, 3);
        expect(bandWindow(100, CARD_BAND_MAX_WIDTH, 1.5).top + bandWindowFraction(CARD_BAND_MAX_WIDTH, 1.5))
            .toBeCloseTo(1, 10);
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

    it('leaves an un-repositioned photo to the stylesheet’s plain center', () => {
        // No properties at all, so the has-focal rule has nothing to compute
        // from and the photo is drawn at exactly the pixels it always was.
        expect(focalStyle(null)).toEqual({});
        expect(focalStyle(30, 1.5)).toEqual({ '--focal': 0.3, '--photo-aspect': 1.5, '--band-hold': CARD_BAND_HOLD });
    });
});

describe('the window holds the focal point', () => {
    const h = bandWindowFraction();

    it('keeps the point at the middle of the band’s visible part', () => {
        // 52px down a 140px band: the middle of what the card body leaves.
        expect(CARD_BAND_HOLD * CARD_BAND_HEIGHT).toBeCloseTo(52, 10);
        const w = bandWindow(45);
        expect(w.top + w.height * CARD_BAND_HOLD).toBeCloseTo(0.45, 10);
    });

    it('clamps at the photo’s edges rather than leaving a gap', () => {
        expect(bandWindow(0).top).toBe(0);
        expect(bandWindow(100).top).toBeCloseTo(1 - h, 10);
    });

    it('centers a photo with no focal point, as the card does', () => {
        expect(bandWindow(null).top).toBeCloseTo((1 - h) / 2, 10);
    });

    it('holds the SAME point as the band widens — the bug the old rule had', () => {
        // background-position: center 89% kept the 89% LINE fixed, so a wider
        // card lost the roof and gained road. A held point stays put.
        for (const width of [313, CARD_BAND_MAX_WIDTH, 588]) {
            const w = bandWindow(45, width);   // fits unclamped at all three
            expect(w.top + w.height * CARD_BAND_HOLD).toBeCloseTo(0.45, 10);
        }
    });

    it('has nowhere to go when the window fills the photo', () => {
        const width = CARD_BAND_HEIGHT * PHOTO_ASPECT / 2;   // window fraction 1
        expect(bandWindow(80, width)).toEqual({ top: 0, height: 1 });
    });
});

describe('the band’s own measurements', () => {
    it('states the body overlap as a fraction of the band, for a preview at any size', () => {
        expect(CARD_BAND_BODY_FRACTION).toBeCloseTo(CARD_BAND_OVERLAP / CARD_BAND_HEIGHT, 10);
    });
});
