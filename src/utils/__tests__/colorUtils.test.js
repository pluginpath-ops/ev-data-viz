import { describe, it, expect } from 'vitest';
import {
    resolvePairColors, seriesColorNote, DEFAULT_RUN_COLOR, OKABE_ITO_SET,
    hexToHsl, hslToHex, rotatePaletteFrom, paletteSlotOf, rampFrom, seedPreview,
    seriesRowsOf,
} from '../colorUtils';

const r = (key, primaryId, baseColor) => ({ key, primaryId, baseColor });
const dist = (x, y) => {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [a, b] = [p(x), p(y)];
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

describe('pair colours', () => {
    it('leaves an unpaired primary exactly as it was', () => {
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 2, '#D55E00')]);
        expect(out).toEqual({ a: '#0072B2', b: '#D55E00' });
    });

    it('stops two partners of one primary from colliding', () => {
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 1, '#0072B2'), r('c', 2, '#D55E00')]);
        expect(out.a).not.toBe(out.b);
    });

    it('keeps the first partner untouched, so nothing moves until it must', () => {
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 1, '#0072B2')]);
        expect(out.a).toBe('#0072B2');
    });

    it('keeps shaded partners closer to each other than to another slot', () => {
        // The whole point: related series should read as related.
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 1, '#0072B2'), r('c', 2, '#D55E00')]);
        expect(dist(out.a, out.b)).toBeLessThan(dist(out.a, out.c));
    });

    it('leaves an unrelated primary unaffected by a neighbour being shaded', () => {
        const out = resolvePairColors([r('a', 1, '#0072B2'), r('b', 1, '#0072B2'), r('c', 2, '#D55E00')]);
        expect(out.c).toBe('#D55E00');
    });

    it('gives six partners of one primary distinct colours', () => {
        const out = resolvePairColors([1,2,3,4,5,6].map(i => r(`k${i}`, 9, '#009E73')));
        expect(new Set(Object.values(out)).size).toBeGreaterThanOrEqual(5);
    });

    it('still yields usable distinct colours with no base colour', () => {
        const out = resolvePairColors([r('a', 1, null), r('b', 1, undefined)]);
        expect(out.a).toMatch(/^#[0-9a-f]{6}$/i);
        expect(out.a).not.toBe(out.b);
    });

    it('tolerates empty and undefined input', () => {
        expect(resolvePairColors([])).toEqual({});
        expect(resolvePairColors()).toEqual({});
    });
});

describe('seriesColorNote', () => {
    it('reads an unset colour as auto, whichever way it is unset', () => {
        for (const unset of [null, undefined, '', DEFAULT_RUN_COLOR]) {
            expect(seriesColorNote(unset, '#E69F00').kind).toBe('auto');
        }
    });

    it('says nothing when the stored colour is the one being drawn', () => {
        expect(seriesColorNote('#E69F00', '#E69F00').kind).toBe('saved');
    });

    it('ignores hex case when comparing', () => {
        // `<input type="color">` returns lowercase; the palette is written
        // uppercase. A control that called those different would report every
        // palette pick as diverged the moment it was saved.
        expect(seriesColorNote('#e69f00', '#E69F00').kind).toBe('saved');
    });

    it('reports both colours when they differ', () => {
        expect(seriesColorNote('#0072B2', '#E69F00'))
            .toEqual({ kind: 'diverged', stored: '#0072B2', plotted: '#E69F00' });
    });

    it('calls the sentinel unset even against a plotted colour equal to it', () => {
        // Auto Color off, nothing stored: the resolver hands back the sentinel
        // itself. That is still "the palette is choosing", not a saved blue.
        expect(seriesColorNote(DEFAULT_RUN_COLOR, DEFAULT_RUN_COLOR).kind).toBe('auto');
    });
});

describe('HSL round trip', () => {
    it('returns every palette colour unchanged', () => {
        // The sliders read HSL and write hex back on every drag, so a lossy
        // round trip would walk a colour away from its slot one nudge at a time.
        for (const hex of OKABE_ITO_SET) {
            expect(hslToHex(hexToHsl(hex)).toLowerCase()).toBe(hex.toLowerCase());
        }
    });

    it('keeps a grey at zero saturation rather than inventing a hue', () => {
        expect(hexToHsl('#9ca3af').s).toBeLessThan(20);
        expect(hexToHsl('#808080').s).toBe(0);
    });
});

describe('a base seeds the set', () => {
    it('rotates the palette so the base leads it', () => {
        const set = rotatePaletteFrom(OKABE_ITO_SET[2], OKABE_ITO_SET);
        expect(set[0]).toBe(OKABE_ITO_SET[2]);
        expect(set).toHaveLength(OKABE_ITO_SET.length);
        // Rotation, not re-sorting: the palette's own spacing survives.
        expect(new Set(set)).toEqual(new Set(OKABE_ITO_SET));
        expect(set[1]).toBe(OKABE_ITO_SET[3]);
    });

    it('lets an off-palette base lead without displacing a slot', () => {
        const set = rotatePaletteFrom('#123456', OKABE_ITO_SET);
        expect(set[0]).toBe('#123456');
        expect(set).toHaveLength(OKABE_ITO_SET.length + 1);
    });

    it('numbers a slot from one, and reports null off-palette', () => {
        expect(paletteSlotOf(OKABE_ITO_SET[2], OKABE_ITO_SET)).toBe(3);
        expect(paletteSlotOf('#123456', OKABE_ITO_SET)).toBe(null);
        expect(paletteSlotOf('#e69f00', OKABE_ITO_SET)).toBe(1); // case-blind
    });

    it('runs the ramp AWAY from a light base, not through it', () => {
        // #F0E442 is the pale yellow — the case that made this rule necessary.
        const ramp = rampFrom('#F0E442', 4);
        const light = ramp.map(c => hexToHsl(c).l);
        expect(ramp[0]).toBe('#F0E442');
        // Every derived colour is darker than the base, and monotonically so.
        for (let i = 1; i < light.length; i++) expect(light[i]).toBeLessThan(light[i - 1]);
    });

    it('runs the ramp away from a dark base too — the other direction', () => {
        const ramp = rampFrom('#0072B2', 4);
        const light = ramp.map(c => hexToHsl(c).l);
        for (let i = 1; i < light.length; i++) expect(light[i]).toBeGreaterThan(light[i - 1]);
    });

    it('gives a single series just the base', () => {
        expect(rampFrom('#E69F00', 1)).toEqual(['#E69F00']);
        expect(seedPreview('#E69F00', 1, 'rotation', OKABE_ITO_SET)).toEqual(['#E69F00']);
    });

    it('holds the base at slot one in both derivations', () => {
        for (const mode of ['rotation', 'ramp']) {
            expect(seedPreview('#56B4E9', 4, mode, OKABE_ITO_SET)[0]).toBe('#56B4E9');
        }
    });
});

describe('seriesRowsOf', () => {
    const vehicles = [
        { id: 1, runs: [{ id: 'a', color: '#FF0000' }, { id: 'b' }] },
        { id: 2, runs: [{ id: 'd', color: '#0072B2' }] },
    ];
    const run = id => vehicles.flatMap(v => v.runs).find(r => r.id === id);

    it('carries the vehicle through, which is what "this vehicle" scopes on', () => {
        expect(seriesRowsOf([run('a'), run('b'), run('d')], vehicles)).toEqual([
            { id: 'a', vehicleId: 1, stored: '#FF0000' },
            { id: 'b', vehicleId: 1, stored: null },
            { id: 'd', vehicleId: 2, stored: '#0072B2' },
        ]);
    });

    it('counts a run once however many partners it is plotted against', () => {
        // Pair mode plots one range run per charging partner: three rows on the
        // chart, one colour. Counting three would make "Overwrite N" lie.
        expect(seriesRowsOf([run('a'), run('a'), run('a'), run('d')], vehicles).map(r => r.id))
            .toEqual(['a', 'd']);
    });

    it('drops synthetic rows — there is no run behind them to colour', () => {
        expect(seriesRowsOf([run('a'), { id: 'epa', _synthetic: true }], vehicles).map(r => r.id))
            .toEqual(['a']);
    });

    it('matches ids across the string/number divide the URL introduces', () => {
        expect(seriesRowsOf([{ id: '7' }], [{ id: 9, runs: [{ id: 7 }] }])[0].vehicleId).toBe(9);
    });

    it('leaves the vehicle null rather than guessing when there is no owner', () => {
        expect(seriesRowsOf([{ id: 'orphan' }], vehicles)[0].vehicleId).toBe(null);
    });

    it('survives empty and missing input', () => {
        expect(seriesRowsOf(null, null)).toEqual([]);
        expect(seriesRowsOf([], vehicles)).toEqual([]);
    });
});
