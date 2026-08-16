import { describe, it, expect } from 'vitest';
import { fuelEconomySearchUrl, baseModelFor, parseSearchYear } from '../fuelEconomyLink';

/**
 * The anchor is a URL confirmed working against the live site: it returns both
 * 2027 R2 configurations with their range and MPGe, and the 20" AT row reads
 * 307 mi / 99 MPGe combined — the figures our fixture carries.
 *
 * Pinning it exactly is the point. This endpoint is somebody else's
 * undocumented internal search, so if a future edit reorders or renames a
 * parameter, that should surface here rather than as a curator staring at an
 * empty result page.
 */
const KNOWN_GOOD =
    'https://www.fueleconomy.gov/feg/PowerSearch.do?action=noform&path=1' +
    '&year1=2027&year2=2027&make=Rivian&baseModel=R2&srchtyp=ymm&pageno=1&rowLimit=50';

describe('fuelEconomySearchUrl', () => {
    it('reproduces the verified R2 URL exactly', () => {
        expect(fuelEconomySearchUrl({ year: 2027, make: 'Rivian', model: 'R2' }))
            .toBe(KNOWN_GOOD);
    });

    it('accepts a year as either a number or a string', () => {
        expect(fuelEconomySearchUrl({ year: '2027', make: 'Rivian', model: 'R2' }))
            .toBe(KNOWN_GOOD);
    });

    it('omits baseModel rather than guessing, widening the search', () => {
        // The deliberate failure mode: a broad list costs a click, whereas a
        // baseModel that does not match exactly returns nothing and reads as
        // "this vehicle is not in the EPA database".
        const url = fuelEconomySearchUrl({ year: 2027, make: 'Rivian' });
        expect(url).not.toContain('baseModel');
        expect(url).toContain('make=Rivian');
        expect(url).toContain('year1=2027&year2=2027');
    });

    it('encodes makes and models containing spaces or punctuation', () => {
        const url = fuelEconomySearchUrl({ year: 2026, make: 'Mercedes-Benz', model: 'EQS SUV' });
        expect(url).toContain('make=Mercedes-Benz');
        expect(url).toContain('baseModel=EQS%20SUV');
        expect(url).not.toMatch(/baseModel=EQS SUV/);
    });

    it('returns null when it cannot build a usable search', () => {
        expect(fuelEconomySearchUrl({ make: 'Rivian' })).toBeNull();
        expect(fuelEconomySearchUrl({ year: 2027 })).toBeNull();
        expect(fuelEconomySearchUrl({ year: 'soon', make: 'Rivian' })).toBeNull();
        expect(fuelEconomySearchUrl({ year: 2027, make: '   ' })).toBeNull();
        expect(fuelEconomySearchUrl()).toBeNull();
    });
});

describe('baseModelFor', () => {
    it('uses the curated model field', () => {
        expect(baseModelFor({ model: 'Ioniq 6' })).toBe('Ioniq 6');
        expect(baseModelFor({ model: '  R2  ' })).toBe('R2');
    });

    it('declines to guess when there is no model', () => {
        // Slicing a base model out of an EPA carline — "Ioniq 6 Long range RWD
        // (18'' Wheels)" — is guesswork that fails silently, so it is not done.
        expect(baseModelFor({ epa_carline_name: "Ioniq 6 Long range RWD (18'' Wheels)" })).toBeNull();
        expect(baseModelFor({})).toBeNull();
        expect(baseModelFor(null)).toBeNull();
    });
});

describe('parseSearchYear', () => {
    // vehicles.year is free text and often a span, because a vehicle record here
    // is a trim that carried over. Before this, the link silently failed to
    // render for every one of them — which on the live database is most.
    it('takes the first year from a span', () => {
        expect(parseSearchYear('2025-2026')).toBe('2025');
        expect(parseSearchYear('2025–2026')).toBe('2025');   // en dash
    });

    it('accepts a plain year as a number or a string', () => {
        expect(parseSearchYear(2027)).toBe('2027');
        expect(parseSearchYear('2027')).toBe('2027');
    });

    it('returns null when there is no year to find', () => {
        expect(parseSearchYear('')).toBeNull();
        expect(parseSearchYear(null)).toBeNull();
        expect(parseSearchYear('coming soon')).toBeNull();
        expect(parseSearchYear(199)).toBeNull();
    });

    it('lets a span reach the search URL', () => {
        const url = fuelEconomySearchUrl({ year: '2025-2026', make: 'Rivian', model: 'R1S' });
        expect(url).toContain('year1=2025&year2=2025');
    });
});
