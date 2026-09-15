import { describe, it, expect } from 'vitest';
import { sameSource, domainOf, findSource, pickedSource } from '../sources';

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
