import { describe, it, expect } from 'vitest';
import {
    normalizeHeader, headerSimilarity, resolveColumns, suggestColumns, SUGGESTION_MIN_SIMILARITY,
} from '../feGuideColumns';

describe('normalizeHeader', () => {
    it('ignores case, spacing and punctuation — the drift EPA has actually made', () => {
        // Both pairs are real: MY22-24 vs MY25-27.
        expect(normalizeHeader('City CO2 Rounded Adjusted - Fuel 2'))
            .toBe(normalizeHeader('City CO2 Rounded Adjusted - Fuel2'));
        expect(normalizeHeader('Charge Depleting Calc Appr Code (PHEVs only)'))
            .not.toBe(normalizeHeader('Charge Depleting Calc Appr Code (PHEV only)'));   // a letter, not punctuation
    });
});

describe('resolveColumns', () => {
    const wanted = ['Division', 'Carline', 'Comb Range (miles)'];

    it('takes exact names first', () => {
        const r = resolveColumns(['Division', 'Carline', 'Comb Range (miles)'], wanted);
        expect(r.missing).toEqual([]);
        expect(r.renamed).toEqual([]);
    });

    it('finds a column under the same name apart from case, spacing and punctuation', () => {
        const r = resolveColumns(['division', 'Car line', 'Comb Range  (miles)'], wanted);
        expect(r.missing).toEqual([]);
        expect(r.renamed.map(x => x.how)).toEqual(['normalised', 'normalised', 'normalised']);
        expect(r.found.Carline).toBe('Car line');
    });

    it('uses a listed alias for a name EPA has already changed', () => {
        const r = resolveColumns(['Division', 'Carline', 'Combined Range'], wanted,
            { 'Comb Range (miles)': ['Combined Range'] });
        expect(r.missing).toEqual([]);
        expect(r.renamed).toEqual([{ column: 'Comb Range (miles)', header: 'Combined Range', how: 'alias' }]);
    });

    it('reports what it cannot find', () => {
        expect(resolveColumns(['Division'], wanted).missing).toEqual(['Carline', 'Comb Range (miles)']);
    });
});

describe('suggestColumns', () => {
    const headers = ['Comb Range as shown on the FE Label (miles)', 'Division', 'Fuel Usage'];

    it('names the closest header for a column that moved a word', () => {
        // The case from the issue: obvious to a person, invisible to includes().
        const s = suggestColumns(['Comb Range as shown on FE Label (miles)'], headers);
        expect(s).toHaveLength(1);
        expect(s[0].closest).toBe('Comb Range as shown on the FE Label (miles)');
        expect(s[0].similarity).toBeGreaterThanOrEqual(SUGGESTION_MIN_SIMILARITY);
    });

    it('stays quiet when nothing is close, rather than guessing', () => {
        expect(suggestColumns(['Total Voltage for Battery Pack(s)'], headers)).toEqual([]);
    });

    it('does not suggest a header another column already claimed', () => {
        expect(suggestColumns(['Comb Range as shown on FE Label (miles)'], headers,
            ['Comb Range as shown on the FE Label (miles)'])).toEqual([]);
    });
});

describe('headerSimilarity', () => {
    it('is 1 for the same name once normalised and falls as they diverge', () => {
        expect(headerSimilarity('Fuel 2', 'Fuel2')).toBe(1);
        expect(headerSimilarity('Division', 'Carline')).toBeLessThan(0.5);
    });
});
