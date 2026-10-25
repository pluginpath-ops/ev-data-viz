import { describe, it, expect } from 'vitest';
import { sameSource, domainOf, findSource, pickedSource, startingName, runSourceText, storedSourcePick, attributionFor, sourceLineText } from '../sources';

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

describe('attributionFor (the source line)', () => {
    const SRC = [
        { id: 1, name: 'Out of Spec', aliases: ['OoS'], domains: ['outofspecstudios.com'] },
        { id: 2, name: 'State of Charge', aliases: [], domains: [] },
    ];
    const run = (id, source, extra = {}) => ({ id, source, ...extra });

    it('merges spellings into the canonical name and orders by runs supplied', () => {
        const out = attributionFor({
            sources: SRC,
            runs: [run(1, 'State of Charge'), run(2, 'OoS'), run(3, 'Out of Spec'), run(4, 'Out of Spec')],
        });
        expect(out.entries.map(e => e.name)).toEqual(['Out of Spec', 'State of Charge']);
    });

    it('links a source to its first listed domain, and leaves an unlisted one plain', () => {
        const { entries } = attributionFor({ sources: SRC, runs: [run(1, 'Out of Spec'), run(2, 'Some Channel')] });
        expect(entries.find(e => e.name === 'Out of Spec').url).toBe('https://outofspecstudios.com');
        expect(entries.find(e => e.name === 'Some Channel').url).toBeNull();
    });

    it('counts a run with no source as unattributed, not as a credit', () => {
        const out = attributionFor({ sources: SRC, runs: [run(1, ''), run(2, null), run(3, 'Out of Spec')] });
        expect(out.unattributed).toBe(2);
        expect(out.entries).toHaveLength(1);
    });

    it('credits a composite to the sources of the tests it was built from', () => {
        const tests = { 10: run(10, 'Out of Spec'), 11: run(11, 'State of Charge') };
        const composite = run(99, null, { composite: { tests: [{ runId: 10 }, { runId: 11 }, { runId: 12 }] } });
        const out = attributionFor({ sources: SRC, runs: [composite], runById: id => tests[id] });
        expect(out.entries.map(e => e.name).sort()).toEqual(['Out of Spec', 'State of Charge']);
        expect(out.unattributed).toBe(0);
    });

    it('does not count a run twice, even when a composite and the test are both plotted', () => {
        const test = run(10, 'Out of Spec');
        const composite = run(99, null, { composite: { tests: [{ runId: 10 }] } });
        const out = attributionFor({ sources: SRC, runs: [test, composite], runById: () => test });
        expect(out.entries).toHaveLength(1);
    });

    it('names fueleconomy.gov for a label figure and EPA for test data, after the test sources', () => {
        const out = attributionFor({ sources: SRC, runs: [run(1, 'Out of Spec')], epa: { label: true, tests: true } });
        expect(out.entries.map(e => e.name)).toEqual(['Out of Spec', 'fueleconomy.gov', 'EPA']);
        expect(out.entries[1].url).toBe('https://www.fueleconomy.gov');
    });
});

describe('sourceLineText', () => {
    const line = { entries: [{ name: 'Out of Spec' }, { name: 'EPA' }], unattributed: 2 };

    it('joins the names, and says nothing when there are none', () => {
        expect(sourceLineText(line)).toBe('Data: Out of Spec · EPA');
        expect(sourceLineText({ entries: [], unattributed: 3 })).toBe('');
    });

    it('adds the gap only for a curator', () => {
        expect(sourceLineText(line, true)).toBe('Data: Out of Spec · EPA · ⚠ 2 unattributed');
    });
});
