import { describe, it, expect } from 'vitest';
import { sameSource, domainOf, findSource, pickedSource, startingName, runSourceText, storedSourcePick } from '../sources';

const SOURCES = [
    { id: 1, name: 'Car and Driver', aliases: ['C&D', 'CD'], domains: ['caranddriver.com'], default_rollout_basis: 'rollout' },
    { id: 2, name: 'Out of Spec', aliases: ['OoS'], domains: [], default_rollout_basis: null },
    { id: 3, name: 'MotorTrend', aliases: [], domains: ['motortrend.com'], default_rollout_basis: 'rollout' },
];

describe('sameSource', () => {
    it('matches punctuation, case and abbreviations of the words', () => {
        expect(sameSource('Car and Driver', 'car & driver')).toBe(false); // different letters
        expect(sameSource('Car and Driver', 'CARANDDRIVER')).toBe(true);
        expect(sameSource('C&D', 'Car and Driver')).toBe(true);
        expect(sameSource('OoS', 'Out of Spec')).toBe(true);
    });

    it('does not match a single-word name by its first letter', () => {
        expect(sameSource('M', 'MotorTrend')).toBe(false);
        expect(sameSource('', 'MotorTrend')).toBe(false);
    });
});

describe('domainOf', () => {
    it('reads a host with or without a protocol, without www', () => {
        expect(domainOf('https://www.caranddriver.com/porsche/macan')).toBe('caranddriver.com');
        expect(domainOf('motortrend.com/cars')).toBe('motortrend.com');
        expect(domainOf('not a link')).toBeNull();
        expect(domainOf('')).toBeNull();
    });
});

describe('findSource', () => {
    it('recognises a name, an alias and a spelling', () => {
        expect(findSource(SOURCES, { name: 'car and driver' })).toMatchObject({ source: { id: 1 }, by: 'name' });
        expect(findSource(SOURCES, { name: 'oos' })).toMatchObject({ source: { id: 2 }, by: 'alias' });
        expect(findSource(SOURCES, { name: 'Motor Trend' })).toMatchObject({ source: { id: 3 }, by: 'spelling' });
    });

    it('recognises a link, subdomains included, when no name is given', () => {
        expect(findSource(SOURCES, { url: 'https://www.caranddriver.com/x' })).toMatchObject({ source: { id: 1 }, by: 'domain' });
        expect(findSource(SOURCES, { url: 'https://amp.motortrend.com/x' })).toMatchObject({ source: { id: 3 }, by: 'domain' });
    });

    it('lets a recognised name win over a link to another source', () => {
        expect(findSource(SOURCES, { name: 'MotorTrend', url: 'https://www.caranddriver.com/x' })).toMatchObject({ source: { id: 3 }, by: 'name' });
    });

    it('falls back to the link when the name is new', () => {
        expect(findSource(SOURCES, { name: 'Edmunds', url: 'https://www.caranddriver.com/x' })).toMatchObject({ source: { id: 1 }, by: 'domain' });
        expect(findSource(SOURCES, { name: 'Edmunds' })).toBeNull();
    });
});

describe('pickedSource', () => {
    it('takes a chosen source', () => {
        expect(pickedSource(SOURCES, { sourceId: 3 })).toEqual({ source: SOURCES[2], newName: null });
    });

    it('turns a new name that is really a listed source into that source', () => {
        expect(pickedSource(SOURCES, { newName: ' C&D ' })).toEqual({ source: SOURCES[0], newName: null });
        expect(pickedSource(SOURCES, { newName: 'Edmunds' })).toEqual({ source: null, newName: 'Edmunds' });
        expect(pickedSource(SOURCES, { newName: '   ' })).toEqual({ source: null, newName: null });
    });

    it('falls back to the link when nothing was chosen', () => {
        expect(pickedSource(SOURCES, {}, 'https://www.motortrend.com/x').source).toBe(SOURCES[2]);
        expect(pickedSource(SOURCES, {}, '')).toEqual({ source: null, newName: null });
    });
});

describe('shared hosts', () => {
    const LISTED_ON_YOUTUBE = [{ id: 9, name: 'Some Channel', aliases: [], domains: ['youtube.com'] }];

    it('ignores a video or social site, subdomains and short links included', () => {
        for (const url of ['https://www.youtube.com/watch?v=abc', 'https://m.youtube.com/watch?v=abc', 'https://youtu.be/abc']) {
            expect(findSource(LISTED_ON_YOUTUBE, { url }), url).toBeNull();
        }
    });

    it('never names a source from a shared host, even one that lists it', () => {
        expect(findSource(LISTED_ON_YOUTUBE, { url: 'https://www.youtube.com/watch?v=abc' })).toBeNull();
        expect(pickedSource(LISTED_ON_YOUTUBE, {}, 'https://youtu.be/abc').source).toBeNull();
    });

    it('still names a source from its own website', () => {
        const oos = [{ id: 2, name: 'Out of Spec', aliases: [], domains: ['outofspecstudios.com'] }];
        expect(findSource(oos, { url: 'https://outofspecstudios.com/testing' })).toMatchObject({ source: { id: 2 }, by: 'domain' });
    });
});

describe('startingName', () => {
    it('offers "<source> " for a test with no name yet', () => {
        expect(startingName('', SOURCES[1])).toBe('Out of Spec ');
        expect(startingName('   ', SOURCES[1])).toBe('Out of Spec ');
    });

    it('offers nothing once a name is started, or when there is no listed source', () => {
        expect(startingName('70mph', SOURCES[1])).toBeNull();
        expect(startingName('', null)).toBeNull();
    });
});

describe('runSourceText', () => {
    it('writes the canonical name of a chosen source', () => {
        expect(runSourceText(SOURCES, { sourceId: 2 })).toBe('Out of Spec');
    });

    it('writes the canonical name for a new name that is a listed alias', () => {
        expect(runSourceText(SOURCES, { newName: 'oos' })).toBe('Out of Spec');
        expect(runSourceText(SOURCES, { newName: ' Edmunds ' })).toBe('Edmunds');
    });

    it('keeps what a test stored until the picker is touched, canonical when it is listed', () => {
        expect(runSourceText(SOURCES, null, '', 'Oos Reviews')).toBe('Oos Reviews');
        expect(runSourceText(SOURCES, null, 'https://www.motortrend.com/x', 'Oos Reviews')).toBe('Oos Reviews');
        expect(runSourceText(SOURCES, null, '', 'oos')).toBe('Out of Spec');
        expect(runSourceText(SOURCES, { sourceId: 3 }, '', 'Oos Reviews')).toBe('MotorTrend');
    });

    it('lets a touched picker clear a stored source', () => {
        expect(runSourceText(SOURCES, { sourceId: null, newName: null }, '', 'Out of Spec')).toBe('');
    });

    it('falls back to the link, then to nothing', () => {
        expect(runSourceText(SOURCES, {}, 'https://www.motortrend.com/x')).toBe('MotorTrend');
        expect(runSourceText(SOURCES, {}, 'https://www.youtube.com/watch?v=abc')).toBe('');
        expect(runSourceText(SOURCES, {})).toBe('');
    });
});

describe('storedSourcePick', () => {
    it('finds the listed source a stored spelling names', () => {
        expect(storedSourcePick(SOURCES, 'oos')).toEqual({ sourceId: 2, newName: null });
        expect(storedSourcePick(SOURCES, ' Out of Spec ')).toEqual({ sourceId: 2, newName: null });
    });

    it('is null for blank text, a source that is not listed, or a list not loaded yet', () => {
        expect(storedSourcePick(SOURCES, '')).toBeNull();
        expect(storedSourcePick(SOURCES, 'Oos Reviews')).toBeNull();
        expect(storedSourcePick([], 'Out of Spec')).toBeNull();
    });
});
