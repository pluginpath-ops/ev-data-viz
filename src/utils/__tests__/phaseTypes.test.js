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

    it('reads the final bag as the constant-speed run continued', () => {
        // J1634's multi-cycle test drives its constant-speed section in two
        // blocks with the dynamic cycles between them. Only the first is long
        // enough for the distance rule; the second is however far the car got
        // before the pack ran out, and at 59.7 mi it is 8x a UDDS where the
        // rule wants 10x. Mercedes' MY2027 CLA 350, phases as filed.
        const out = resolvePhaseTypes([
            { phase_index: 1, phase_type: 'UDDS', distance_mi: 7.45 },
            { phase_index: 2, phase_type: 'HWY',  distance_mi: 10.274 },
            { phase_index: 3, phase_type: 'UDDS', distance_mi: 7.45 },
            { phase_index: 4, phase_type: 'SS',   distance_mi: 281.314 },
            { phase_index: 5, phase_type: 'UDDS', distance_mi: 7.45 },
            { phase_index: 6, phase_type: 'HWY',  distance_mi: 10.262 },
            { phase_index: 7, phase_type: 'UDDS', distance_mi: 7.45 },
            { phase_index: 8, distance_mi: 59.724 },
        ]);
        expect(out[7].cycle).toBe('SS');
    });

    it('says it was read from position, not guessed from a distance', () => {
        // Its own source, because "N phases typed by distance" is a caveat the
        // curator is asked to go and check. Counting a structural reading there
        // would raise it on every multi-cycle record in the corpus.
        const out = resolvePhaseTypes([
            { phase_index: 1, phase_type: 'SS', distance_mi: 281 },
            { phase_index: 2, distance_mi: 59.7 },
        ]);
        expect(out[1].typeSource).toBe('continuation');
        expect(out.filter(p => p.typeSource === 'inferred')).toHaveLength(0);
    });

    it('reads the continuation at any length, because it ends where charge does', () => {
        // Across the corpus the last bag runs from 2.3 to 66 miles. No
        // threshold separates the short end from a part-finished cycle, which
        // is why this rule is about position instead.
        for (const d of [2.26, 9.09, 30.1, 66.05]) {
            const out = resolvePhaseTypes([
                { phase_index: 1, phase_type: 'SS', distance_mi: 281 },
                { phase_index: 2, distance_mi: d },
            ]);
            expect(out[1].cycle).toBe('SS');
        }
    });

    it('prefers position over a coincidental cycle length', () => {
        // Six records have a last bag between 9.6 and 10.9 miles — HWFET's
        // length, by coincidence of where the pack gave out. They consume 27%
        // more than the same test's real HWFET bags, so reading them as HWFET
        // puts constant-speed energy into the cycle average.
        const out = resolvePhaseTypes([
            { phase_index: 1, phase_type: 'SS', distance_mi: 223.7 },
            { phase_index: 2, distance_mi: 10.716 },
        ]);
        expect(out[1].cycle).toBe('SS');
    });

    it('leaves the last bag alone when nothing before it was constant-speed', () => {
        // "Continued" needs something to continue. A charge-depleting highway
        // test has no constant-speed section at all, and its final part-cycle
        // is a part-cycle.
        const out = resolvePhaseTypes([
            { phase_index: 1, phase_type: 'HWY', distance_mi: 10.26 },
            { phase_index: 2, distance_mi: 4.1 },
        ]);
        expect(out[1].cycle).toBeNull();
    });

    it('yields to a curator who typed the last bag themselves', () => {
        // Same precedence as everywhere else here: this is a rule about the
        // usual shape of a test, and the curator has the record in front of
        // them.
        const out = resolvePhaseTypes([
            { phase_index: 1, phase_type: 'SS',  distance_mi: 281 },
            { phase_index: 2, phase_type: 'US06', distance_mi: 59.7 },
        ]);
        expect(out[1].cycle).toBe('US06');
        expect(out[1].typeSource).toBe('curated');
    });

    it('finds the last bag by phase_index, not by the order rows arrived in', () => {
        // Nothing guarantees an embedded select comes back ordered, and reading
        // "last" off the array would type a middle bag as the continuation.
        const out = resolvePhaseTypes([
            { phase_index: 8, distance_mi: 59.7 },
            { phase_index: 4, phase_type: 'SS', distance_mi: 281 },
            { phase_index: 6, phase_type: 'HWY', distance_mi: 10.26 },
        ]);
        expect(out[0].cycle).toBe('SS');
        expect(out[0].typeSource).toBe('continuation');
    });

    it('continues the run the distance rule found, not only a curated one', () => {
        // The first block is itself usually inferred. If the continuation only
        // followed a curated SS it would miss every uncurated test.
        const out = resolvePhaseTypes([
            { phase_index: 1, distance_mi: 7.45 },
            { phase_index: 2, distance_mi: 281 },
            { phase_index: 3, distance_mi: 59.7 },
        ]);
        expect(out.map(p => p.cycle)).toEqual(['UDDS', 'SS', 'SS']);
        expect(out[2].typeSource).toBe('continuation');
    });

    it('survives empty and malformed input', () => {
        expect(resolvePhaseTypes([])).toEqual([]);
        expect(resolvePhaseTypes()).toEqual([]);
        expect(resolvePhaseTypes([{}])[0].cycle).toBeNull();
    });
});
