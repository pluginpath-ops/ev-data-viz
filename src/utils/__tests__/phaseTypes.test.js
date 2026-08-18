/**
 * The phase-type inference, and the fallback that lets an untyped test still
 * produce a model.
 */
import { describe, it, expect } from 'vitest';
import { suggestPhaseType, resolvePhaseTypes, SS_NEIGHBOUR_MULTIPLE } from '../phaseTypes';

describe('suggestPhaseType', () => {
    it('reads the two fixed cycle distances', () => {
        expect(suggestPhaseType(10.26)).toBe('HWY');
        expect(suggestPhaseType(7.45)).toBe('UDDS');
    });

    it('tolerates the dyno rounding either side', () => {
        expect(suggestPhaseType(10.1)).toBe('HWY');
        expect(suggestPhaseType(7.6)).toBe('UDDS');
    });

    it('declines rather than guessing when nothing is close', () => {
        // Returning a type here is worse than returning none: a misfiled phase
        // moves real energy into the wrong cycle and both ranges come out
        // plausible and wrong.
        expect(suggestPhaseType(9)).toBeNull();
        expect(suggestPhaseType(0)).toBeNull();
        expect(suggestPhaseType(null)).toBeNull();
        expect(suggestPhaseType(undefined)).toBeNull();
        expect(suggestPhaseType('x')).toBeNull();
    });

    it('recognises a steady-state bag by its neighbours, not its length', () => {
        // An SS depletion run has no characteristic distance, so it is found by
        // being an order of magnitude longer than the cycles around it.
        expect(suggestPhaseType(200, [7.45, 10.26])).toBe('SS');
        expect(suggestPhaseType(7.45 * SS_NEIGHBOUR_MULTIPLE, [7.45])).toBe('SS');
    });

    it('checks SS before the fixed distances', () => {
        // Ordering matters: a long run could otherwise coincide with a cycle
        // length and be filed as that cycle.
        expect(suggestPhaseType(10.26, [1.0])).toBe('SS');
    });
});

describe('resolvePhaseTypes', () => {
    it('prefers what the curator recorded', () => {
        // An explicit choice outranks inference even when inference disagrees:
        // the curator has the record in front of them.
        const [p] = resolvePhaseTypes([{ phase_index: 1, phase_type: 'US06', distance_mi: 10.26 }]);
        expect(p.cycle).toBe('US06');
        expect(p.typeSource).toBe('curated');
    });

    it('falls back to distance when no type is recorded', () => {
        const out = resolvePhaseTypes([
            { phase_index: 1, distance_mi: 7.45 },
            { phase_index: 2, distance_mi: 10.26 },
        ]);
        expect(out.map(p => p.cycle)).toEqual(['UDDS', 'HWY']);
        expect(out.every(p => p.typeSource === 'inferred')).toBe(true);
    });

    it('marks its source so a reading can say which it was built from', () => {
        // A model derived from inferred types is not the same claim as one from
        // curated types, and the UI has to be able to tell them apart.
        const out = resolvePhaseTypes([
            { phase_index: 1, phase_type: 'UDDS', distance_mi: 7.45 },
            { phase_index: 2, distance_mi: 10.26 },
            { phase_index: 3, distance_mi: 3 },
        ]);
        expect(out.map(p => p.typeSource)).toEqual(['curated', 'inferred', null]);
    });

    it('excludes each phase from its own neighbour comparison', () => {
        // Comparing a phase against itself makes every phase its own shortest
        // neighbour, and nothing is ever 10x itself.
        const out = resolvePhaseTypes([
            { phase_index: 1, distance_mi: 7.45 },
            { phase_index: 2, distance_mi: 300 },
        ]);
        expect(out[1].cycle).toBe('SS');
    });

    it('survives empty and malformed input', () => {
        expect(resolvePhaseTypes([])).toEqual([]);
        expect(resolvePhaseTypes()).toEqual([]);
        expect(resolvePhaseTypes([{}])[0].cycle).toBeNull();
    });
});
