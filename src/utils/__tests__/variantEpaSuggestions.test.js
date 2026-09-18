import { describe, it, expect } from 'vitest';
import { suggestionSource, candidateQuery, rankSuggestions } from '../variantEpaSuggestions';

let nextId = 1;
const group = (over = {}) => ({
    test_group_id: `G${nextId++}`, model_year: 2024, make: 'ACURA', epa_carline_name: 'ZDX AWD',
    drive: 'All Wheel Drive', label_range_published: null, epa_tests: [], ...over,
});
const vehicle = (over = {}) => ({ id: nextId++, name: 'V', model: null, trim: null, year: '2024', epa_mappings: [], ...over });
const linkTo = (...groups) => groups.map(g => ({ id: nextId++, isPrimary: false, epaGroup: g }));

// The live case #341 was measured on.
const aSpecGroup = group({ test_group_id: 'FRMV5544', epa_carline_name: 'ZDX AWD', label_range_published: 304 });
const aSpec = vehicle({ name: 'ZDX A-Spec', model: 'ZDX', trim: 'A-Spec', epa_mappings: linkTo(aSpecGroup) });
const typeS = vehicle({ name: 'ZDX Type S', model: 'ZDX', spec_source_vehicle_id: aSpec.id });
const candidates = [
    aSpecGroup,
    group({ test_group_id: 'FRMV5537', epa_carline_name: 'ZDX RWD', label_range_published: 313 }),
    group({ test_group_id: 'FRMV5538', epa_carline_name: 'ZDX AWD TYPE S', label_range_published: 278 }),
    group({ test_group_id: 'OTHER', epa_carline_name: 'INTEGRA', label_range_published: null }),
];

describe('suggestionSource', () => {
    it('is the nearest source with links, through a chain', () => {
        const mid = vehicle({ spec_source_vehicle_id: aSpec.id });
        const leaf = vehicle({ spec_source_vehicle_id: mid.id });
        expect(suggestionSource(leaf, [aSpec, mid, leaf])).toBe(aSpec);
    });

    it("stays once the variant links one of its own — the list is where the next is found", () => {
        const linked = vehicle({ spec_source_vehicle_id: aSpec.id, epa_mappings: linkTo(group()) });
        expect(suggestionSource(linked, [aSpec, linked])).toBe(aSpec);
        expect(suggestionSource(vehicle(), [])).toBeNull();
    });

    it('stops at a cycle and at a missing source', () => {
        const a = vehicle();
        const b = vehicle({ spec_source_vehicle_id: a.id });
        a.spec_source_vehicle_id = b.id;
        expect(suggestionSource(a, [a, b])).toBeNull();
        expect(suggestionSource(vehicle({ spec_source_vehicle_id: 99999 }), [])).toBeNull();
    });
});

describe('candidateQuery', () => {
    it("asks for the source configurations' makes and years, plus the variant's year", () => {
        const next = vehicle({ year: '2025-2026' });
        expect(candidateQuery(next, aSpec)).toEqual({ makes: ['ACURA'], years: [2024, 2025, 2026] });
    });
});

describe('rankSuggestions', () => {
    it("puts the configuration naming what sets the variant apart first", () => {
        const ranked = rankSuggestions(typeS, aSpec, candidates);
        expect(ranked[0]).toMatchObject({ fromSource: false, matched: ['type', 's'] });
        expect(ranked[0].group.test_group_id).toBe('FRMV5538');
        expect(ranked[0].figures.labelRangeMi).toBe(278);
    });

    it("lists the source's own configurations last, and only once", () => {
        const ranked = rankSuggestions(typeS, aSpec, candidates);
        expect(ranked.at(-1)).toMatchObject({ fromSource: true, group: aSpecGroup });
        expect(ranked.filter(s => s.group.test_group_id === 'FRMV5544')).toHaveLength(1);
    });

    it('marks what the variant already links, in place', () => {
        const typeSGroup = candidates[2];
        const linked = { ...typeS, epa_mappings: linkTo(typeSGroup) };
        const ranked = rankSuggestions(linked, aSpec, candidates);
        expect(ranked[0]).toMatchObject({ group: typeSGroup, linked: true });
        expect(ranked.filter(s => s.linked)).toHaveLength(1);
    });

    it('keeps to the same model and make', () => {
        const ids = rankSuggestions(typeS, aSpec, [...candidates, group({ test_group_id: 'CHEVY', make: 'CHEVROLET', epa_carline_name: 'ZDX' })])
            .map(s => s.group.test_group_id);
        expect(ids).not.toContain('OTHER');
        expect(ids).not.toContain('CHEVY');
    });

    it('matches a drive the variant names — Blazer RS AWD beside the LT FWD', () => {
        const lt = group({ make: 'CHEVROLET', model_year: 2026, epa_carline_name: 'BLAZER EV', drive: null });
        const source = vehicle({ name: 'Blazer LT', model: 'Blazer', trim: 'LT FWD', epa_mappings: linkTo(lt) });
        const rs = vehicle({ name: 'Blazer RS', model: 'Blazer', trim: 'RS AWD', spec_source_vehicle_id: source.id });
        const awd = group({ make: 'CHEVROLET', model_year: 2026, epa_carline_name: 'BLAZER EV AWD', drive: null });
        const van = group({ make: 'CHEVROLET', model_year: 2026, epa_carline_name: 'BRIGHTDROP', drive: 'FWD' });
        const ranked = rankSuggestions(rs, source, [lt, awd, van]);
        expect(ranked.map(s => s.group)).toEqual([awd, lt]);
        expect(ranked[0].matched).toEqual(['awd']);
    });

    it("ranks by the vehicle's own make and model when there is no source to go on", () => {
        // The Leaf S+: not a variant, nothing linked anywhere in its family.
        const leaf = vehicle({ name: 'Leaf', make: 'Nissan', model: 'Leaf', trim: 'S+', year: '2026' });
        const big = group({ make: 'NISSAN', model_year: 2026, epa_carline_name: 'LEAF 75kWh (19 inch wheels)', drive: null });
        const small = group({ make: 'NISSAN', model_year: 2026, epa_carline_name: 'NISSAN LEAF 53kWh (18 inch steel', drive: null });
        const ariya = group({ make: 'NISSAN', model_year: 2026, epa_carline_name: 'ARIYA', drive: null });
        const other = group({ make: 'KIA', model_year: 2026, epa_carline_name: 'LEAF', drive: null });
        expect(candidateQuery(leaf)).toEqual({ makes: ['Nissan'], years: [2026] });
        const ranked = rankSuggestions(leaf, null, [big, small, ariya, other]);
        expect(ranked.map(s => s.group)).toEqual([big, small]);
        expect(ranked.every(s => !s.fromSource)).toBe(true);
    });

    it("searches the years of the vehicle's own links, and marks them linked", () => {
        const g2024 = group({ make: 'HYUNDAI', model_year: 2024, epa_carline_name: 'Ioniq 5', drive: null });
        const sib = group({ make: 'HYUNDAI', model_year: 2024, epa_carline_name: 'Ioniq 5 N', drive: null });
        const ioniq = vehicle({ name: 'IONIQ5', make: 'Hyundai', model: 'Ioniq 5', year: '2025', epa_mappings: linkTo(g2024) });
        expect(candidateQuery(ioniq).years).toEqual([2024, 2025]);
        const ranked = rankSuggestions(ioniq, null, [g2024, sib]);
        expect(ranked.find(s => s.group === g2024).linked).toBe(true);
        expect(ranked.find(s => s.group === sib).linked).toBe(false);
    });
});
