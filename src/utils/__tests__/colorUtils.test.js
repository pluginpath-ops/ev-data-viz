import { describe, it, expect } from 'vitest';
import {
    resolvePairColors, seriesColorNote, DEFAULT_RUN_COLOR, OKABE_ITO_SET,
    hexToHsl, hslToHex, rotatePaletteFrom, paletteSlotOf, rampFrom, seedPreview,
    seriesRowsOf, expandPalette, OKABE_ITO, SERIES_NEUTRAL, resolveChartColors, seedPlot,
    SERIES_PALETTES, HOUSE_PALETTE,
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

    it('CANNOT recover a hue from white or black, which is why HSL is the model', () => {
        // Every hue is white at L=100 and black at L=0, so this direction is
        // lossy at the ends and no cleverness will fix it. The picker holds HSL
        // as state and treats the hex as a projection precisely because of
        // this: re-deriving the sliders from the hex each render threw the hue
        // away the moment lightness reached either end, and the hue thumb
        // snapped to red and stayed there.
        for (const hex of ['#FFFFFF', '#000000']) {
            expect(hexToHsl(hex)).toEqual({ h: 0, s: 0, l: hexToHsl(hex).l });
        }
        // Held separately, a hue survives the round trip to white and back.
        const blue = hexToHsl('#0072B2');
        const white = { ...blue, l: 100 };
        expect(hslToHex(white)).toBe('#ffffff');
        expect(hslToHex({ ...white, l: blue.l }).toLowerCase()).toBe('#0072b2');
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
            { id: 'a', vehicleId: 1, stored: '#FF0000', auto: true },
            { id: 'b', vehicleId: 1, stored: null, auto: true },
            { id: 'd', vehicleId: 2, stored: '#0072B2', auto: true },
        ]);
    });

    it('marks a row not-auto when it is showing a hand-picked colour', () => {
        // "Auto" is about an override being in force, not about what is stored:
        // a run with a saved red is still on auto until someone recolours it in
        // this session, and a run with nothing saved stops being on auto the
        // moment they do.
        const rows = seriesRowsOf([run('a'), run('d')], vehicles, id => id === 'a');
        expect(rows.map(r => r.auto)).toEqual([false, true]);
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

describe('extending the palette past its length', () => {
    it('never repeats a colour, however many series are asked for', () => {
        // The bug this exists for: the picker's rotation wrapped with a modulo,
        // so a twelve-car chart got eight colours and four exact duplicates —
        // precisely what a reader assumes the tool is preventing.
        for (const n of [8, 12, 20, 30, 48]) {
            const set = expandPalette(OKABE_ITO_SET, n);
            expect(set).toHaveLength(n);
            expect(new Set(set.map(c => c.toLowerCase())).size).toBe(n);
        }
    });

    it('leaves the palette itself untouched on the first pass', () => {
        expect(expandPalette(OKABE_ITO_SET, OKABE_ITO_SET.length)).toEqual(OKABE_ITO_SET);
    });

    it('varies saturation as well as lightness', () => {
        // Lightness alone was what this did before, and a second pass that is
        // only "the same colour, lighter" reads as a faded first pass rather
        // than as its own series.
        const set = expandPalette(OKABE_ITO, 14);
        const base = hexToHsl(OKABE_ITO[0]);
        const second = hexToHsl(set[OKABE_ITO.length]);
        expect(second.l).not.toBeCloseTo(base.l, 0);
        expect(second.s).not.toBeCloseTo(base.s, 0);
    });

    it('does not breed the neutral slot', () => {
        // Varying a colour with no hue only makes more colours with no hue, and
        // they collide with every other pale variant. Measured: the worst pair
        // in a 16-series set used to be two pale variants of the grey.
        const set = expandPalette(OKABE_ITO_SET, 30);
        const greys = set.filter(c => hexToHsl(c).s < 20);
        expect(greys).toEqual([SERIES_NEUTRAL]);
    });

    it('keeps every colour clear of pure white and black', () => {
        for (const c of expandPalette(OKABE_ITO_SET, 40)) {
            const { l } = hexToHsl(c);
            expect(l).toBeGreaterThan(10);
            expect(l).toBeLessThan(92);
        }
    });

    it('rotation extends when given a count, and only rotates without one', () => {
        expect(rotatePaletteFrom(OKABE_ITO_SET[0], OKABE_ITO_SET)).toHaveLength(OKABE_ITO_SET.length);
        const twelve = rotatePaletteFrom(OKABE_ITO_SET[2], OKABE_ITO_SET, 12);
        expect(twelve).toHaveLength(12);
        expect(new Set(twelve.map(c => c.toLowerCase())).size).toBe(12);
        expect(twelve[0]).toBe(OKABE_ITO_SET[2]);
    });

    it('gives resolveChartColors a distinct colour per run well past the palette', () => {
        const runs = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, color: null, created_at: `2026-01-${i + 1}` }));
        const assigned = Object.values(resolveChartColors(runs, {}, 'auto'));
        expect(new Set(assigned).size).toBe(20);
    });
});

describe('two runs saved with the same colour', () => {
    const at = (id, color, day) => ({ id, color, created_at: `2026-01-${String(day).padStart(2, '0')}` });

    it('keeps the first and nudges the second, in manual mode', () => {
        const out = resolveChartColors([at(1, '#009E73', 1), at(2, '#009E73', 2)], {}, 'manual');
        expect(out[1]).toBe('#009E73');
        expect(out[2]).not.toBe('#009E73');
    });

    it('nudges within the hue family rather than across the wheel', () => {
        // A clashing green should become another green. Jumping to blue would
        // discard the one thing the curator did express.
        const out = resolveChartColors([at(1, '#009E73', 1), at(2, '#009E73', 2)], {}, 'manual');
        const { h } = hexToHsl(out[2]);
        const green = hexToHsl('#009E73').h;
        expect(Math.abs(h - green)).toBeLessThan(60);
    });

    it('still honours a colour nobody else is using', () => {
        const out = resolveChartColors([at(1, '#009E73', 1), at(2, '#CC79A7', 2)], {}, 'manual');
        expect(out[1]).toBe('#009E73');
        expect(out[2]).toBe('#CC79A7');
    });

    it('is decided by the stable order, not by which run was passed first', () => {
        const rows = [at(2, '#009E73', 2), at(1, '#009E73', 1)];
        expect(resolveChartColors(rows, {}, 'manual')[1]).toBe('#009E73');
        expect(resolveChartColors([...rows].reverse(), {}, 'manual')[1]).toBe('#009E73');
    });

    it('gives thirteen runs sharing three colours thirteen distinct ones', () => {
        // The shape measured on the live chart before this.
        const rows = ['#F0E442', '#F0E442', '#009E73', '#009E73', '#009E73', '#CC79A7', '#CC79A7',
                      '#E69F00', '#56B4E9', '#0072B2', '#D55E00', '#ef4444', '#9ca3af']
            .map((c, i) => at(i + 1, c, i + 1));
        expect(new Set(Object.values(resolveChartColors(rows, {}, 'manual'))).size).toBe(13);
    });
});

describe('seedPlot', () => {
    // Two vehicles, three tests and two tests.
    const rows = [
        { id: 'a1', vehicleId: 'v1' }, { id: 'a2', vehicleId: 'v1' }, { id: 'a3', vehicleId: 'v1' },
        { id: 'b1', vehicleId: 'v2' }, { id: 'b2', vehicleId: 'v2' },
    ];
    const P = OKABE_ITO_SET;
    const hue = h => Math.round(hexToHsl(h).h);

    it('both: one colour per vehicle, one step per test', () => {
        const out = seedPlot(P[0], rows, { rotate: true, shade: true }, P);
        // Same hue within a vehicle...
        expect(hue(out.a1)).toBe(hue(out.a2));
        expect(hue(out.a2)).toBe(hue(out.a3));
        expect(hue(out.b1)).toBe(hue(out.b2));
        // ...different hue between them, and all five still distinct.
        expect(hue(out.a1)).not.toBe(hue(out.b1));
        expect(new Set(Object.values(out)).size).toBe(5);
    });

    it('both: the vehicle you opened from keeps the base exactly', () => {
        const out = seedPlot(P[0], rows, { rotate: true, shade: true }, P);
        expect(out.a1).toBe(P[0]);
    });

    it('rotate only: every series its own colour, ignoring which car it is', () => {
        const out = seedPlot(P[0], rows, { rotate: true, shade: false }, P);
        expect(new Set(Object.values(out)).size).toBe(5);
        // Two tests of ONE vehicle are no longer related — that is the point.
        expect(hue(out.a1)).not.toBe(hue(out.a2));
    });

    it('shade only: one hue across the whole plot', () => {
        const out = seedPlot(P[0], rows, { rotate: false, shade: true }, P);
        expect(new Set(Object.values(out).map(hue)).size).toBe(1);
        expect(new Set(Object.values(out)).size).toBe(5);
    });

    it('a one-test vehicle keeps its rotated colour rather than being shaded off it', () => {
        const solo = [{ id: 'a1', vehicleId: 'v1' }, { id: 'b1', vehicleId: 'v2' }];
        const out = seedPlot(P[0], solo, { rotate: true, shade: true }, P);
        expect(out.a1).toBe(P[0]);
        expect(out.b1).toBe(P[1]);
    });

    it('never repeats, even with more vehicles than the palette holds', () => {
        const many = Array.from({ length: 24 }, (_, i) => ({ id: `r${i}`, vehicleId: `v${i}` }));
        const out = seedPlot(P[0], many, { rotate: true, shade: true }, P);
        expect(new Set(Object.values(out)).size).toBe(24);
    });

    it('falls back to rotation when asked for neither', () => {
        const out = seedPlot(P[0], rows, { rotate: false, shade: false }, P);
        expect(new Set(Object.values(out)).size).toBe(5);
        expect(hue(out.a1)).not.toBe(hue(out.a2));
    });

    it('survives an empty plot', () => {
        expect(seedPlot(P[0], [], { rotate: true, shade: true }, P)).toEqual({});
    });
});

describe('the palettes on offer', () => {
    it('every palette has a unique id, a label and at least five slots', () => {
        const ids = SERIES_PALETTES.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const p of SERIES_PALETTES) {
            expect(p.label, p.id).toBeTruthy();
            expect(p.colors.length, p.id).toBeGreaterThanOrEqual(5);
        }
    });

    it('no palette repeats a colour within itself', () => {
        for (const p of SERIES_PALETTES) {
            const seen = p.colors.map(c => c.toLowerCase());
            expect(new Set(seen).size, p.id).toBe(seen.length);
        }
    });

    it('every palette can grow to twenty without repeating', () => {
        // Including the monochromes, which have no hue to nudge — expandPalette
        // has to vary the greys when varying them is all there is.
        for (const p of SERIES_PALETTES) {
            const set = expandPalette(p.colors, 20);
            expect(set.length, p.id).toBe(20);
            expect(new Set(set.map(c => c.toLowerCase())).size, p.id).toBe(20);
        }
    });

    it('a monochrome palette really is one hue, ordered light to dark', () => {
        for (const p of SERIES_PALETTES.filter(x => x.id.startsWith('mono'))) {
            const hsl = p.colors.map(hexToHsl);
            // A tolerance, not equality: eight bits per channel cannot hold one
            // exact hue at every lightness. Hue lives in the DIFFERENCES between
            // channels, so the less saturated the colour the fewer units carry
            // it and the coarser the rounding — mono-orange spans 1 degree at
            // s=88, mono-ice spans 3 at s=37. Five is still nowhere near a
            // different colour: the palette's own neighbours sit 40 apart.
            const hues = hsl.map(c => c.h);
            expect(Math.max(...hues) - Math.min(...hues), p.id).toBeLessThan(5);
            for (let i = 1; i < hsl.length; i++) {
                expect(hsl[i].l, p.id).toBeLessThan(hsl[i - 1].l);
            }
        }
    });

    it('keeps every slot clear of pure white and black', () => {
        for (const p of SERIES_PALETTES) {
            for (const c of p.colors) {
                const { l } = hexToHsl(c);
                expect(l, `${p.id} ${c}`).toBeGreaterThan(8);
                expect(l, `${p.id} ${c}`).toBeLessThan(97);
            }
        }
    });

    it('draws the house palette from the theme rather than new colours', () => {
        // The dark theme's own --color-accent-* values, plus --color-text-primary
        // standing in for white. A house palette that invented its own blue
        // would be the drift the token system exists to stop.
        for (const token of ['#2d7ff9', '#f28b3c', '#23b47e', '#9b8cf0', '#6b7a8f', '#f2f5f9']) {
            expect(HOUSE_PALETTE.map(c => c.toLowerCase())).toContain(token);
        }
    });
});

describe('a colour pinned to a run that sorts later', () => {
    const at = (id, color, day) => ({ id, color, created_at: `2026-01-${String(day).padStart(2, '0')}` });

    it('is not handed to an earlier run that had none', () => {
        // The bug this exists for. `placed` only knew about runs already
        // visited, so a free run early in the order could take a colour a LATER
        // run was pinned to, and nothing ever compared them. It needed the
        // pinned run to sort AFTER the free one — which is what happens when
        // runs are ticked in a different order from their creation dates.
        const runs = [at(1, null, 1), at(2, null, 2)];
        const out = resolveChartColors(runs, { 2: '#E69F00' }, 'auto');
        expect(out[2]).toBe('#E69F00');
        expect(out[1]).not.toBe('#E69F00');
    });

    it('holds across a whole plot of pinned and free runs', () => {
        const runs = Array.from({ length: 12 }, (_, i) => at(i + 1, null, i + 1));
        // Pin the LAST four, which every earlier run is resolved before.
        const pinned = { 9: '#E69F00', 10: '#56B4E9', 11: '#009E73', 12: '#F0E442' };
        const out = resolveChartColors(runs, pinned, 'auto');
        expect(new Set(Object.values(out)).size).toBe(12);
        for (const [id, hex] of Object.entries(pinned)) expect(out[id]).toBe(hex);
    });

    it('still returns the pinned colour itself, unchanged and uncounted', () => {
        // Pre-seeding `placed` must not make a pinned colour look twice-used and
        // push everything else away from it more than it deserves.
        const runs = [at(1, null, 1), at(2, null, 2), at(3, null, 3)];
        const out = resolveChartColors(runs, { 1: '#E69F00' }, 'auto');
        expect(out[1]).toBe('#E69F00');
        expect(new Set(Object.values(out)).size).toBe(3);
    });
});
