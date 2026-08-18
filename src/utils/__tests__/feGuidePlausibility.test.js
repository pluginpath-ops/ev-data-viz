/**
 * The gate exists for one real row, so that row is the first test: if this
 * suite ever passes while the LYRIQ goes unflagged, the gate has stopped doing
 * the only job it was built for.
 */
import { describe, it, expect } from 'vitest';
import {
    rangePlausibility, PLAUSIBILITY_MESSAGES,
    HWY_CITY_RATIO_MIN, HWY_CITY_RATIO_MAX,
} from '../feGuidePlausibility';

describe('rangePlausibility', () => {
    it('flags the row it was built for', () => {
        // Cadillac LYRIQ AWD 2025, exactly as EPA publishes it.
        expect(rangePlausibility({ cityMi: 530, hwyMi: 26, combMi: 303 }))
            .toContain('hwy-city-ratio');
    });

    it('does not flag the widest genuine rows in six guide years', () => {
        // The real extremes, measured across MY22-MY27. A gate that fires on
        // these is worse than no gate: it trains the curator to ignore it.
        const realExtremes = [
            { cityMi: 347, hwyMi: 249, combMi: 303 },   // Ioniq 5 LR RWD, ratio 0.718
            { cityMi: 317, hwyMi: 390, combMi: 350 },   // Polestar 3, ratio 1.230
            { cityMi: 338, hwyMi: 276, combMi: 307 },   // R2 20in AT
            { cityMi: 530, hwyMi: 442, combMi: 493 },   // Silverado EV Max
        ];
        for (const row of realExtremes) {
            expect(rangePlausibility(row), JSON.stringify(row)).toEqual([]);
        }
    });

    it('catches a bad combined against two good cycles', () => {
        // The check that fires on nothing in today's file. It is here for the
        // corruption that has not happened yet.
        expect(rangePlausibility({ cityMi: 300, hwyMi: 250, combMi: 30 }))
            .toContain('combined-outside-cycles');
        expect(rangePlausibility({ cityMi: 300, hwyMi: 250, combMi: 400 }))
            .toContain('combined-outside-cycles');
    });

    it('allows combined to equal a cycle, within rounding', () => {
        // Legitimate when the two cycles are close; a strict inequality would
        // flag real rows.
        expect(rangePlausibility({ cityMi: 300, hwyMi: 300, combMi: 300 })).toEqual([]);
        expect(rangePlausibility({ cityMi: 301, hwyMi: 299, combMi: 300 })).toEqual([]);
    });

    it('says nothing when a figure is missing', () => {
        // Most guide years populate city and highway on only some rows. Absence
        // is not corruption, and flagging it would bury the real signal.
        expect(rangePlausibility({ cityMi: null, hwyMi: null, combMi: 300 })).toEqual([]);
        expect(rangePlausibility({ cityMi: 300, hwyMi: null, combMi: 300 })).toEqual([]);
        expect(rangePlausibility({})).toEqual([]);
        expect(rangePlausibility()).toEqual([]);
    });

    it('treats zero and non-numeric as missing, not as a ratio of zero', () => {
        // Number('') is 0 and 0 is finite; a bare 0 would otherwise divide into
        // a ratio of 0 and flag every incomplete row.
        expect(rangePlausibility({ cityMi: 0, hwyMi: 0, combMi: 300 })).toEqual([]);
        expect(rangePlausibility({ cityMi: '', hwyMi: '', combMi: 300 })).toEqual([]);
        expect(rangePlausibility({ cityMi: 'n/a', hwyMi: 250, combMi: 300 })).toEqual([]);
    });

    it('reads string figures, since the columns come back as text from PostgREST', () => {
        expect(rangePlausibility({ cityMi: '530', hwyMi: '26', combMi: '303' }))
            .toContain('hwy-city-ratio');
    });

    it('has a message for every flag it can emit', () => {
        // A flag with no wording renders as a raw code to a curator.
        const emitted = new Set([
            ...rangePlausibility({ cityMi: 530, hwyMi: 26, combMi: 303 }),
            ...rangePlausibility({ cityMi: 300, hwyMi: 250, combMi: 30 }),
        ]);
        for (const flag of emitted) {
            expect(PLAUSIBILITY_MESSAGES[flag], flag).toBeTruthy();
        }
    });

    it('keeps the bounds outside the observed real spread', () => {
        expect(HWY_CITY_RATIO_MIN).toBeLessThan(0.718);
        expect(HWY_CITY_RATIO_MAX).toBeGreaterThan(1.230);
    });
});
