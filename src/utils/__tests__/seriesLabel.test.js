import { describe, it, expect } from 'vitest';
import { buildSeriesLabels } from '../seriesLabel';

const V = (year, make, model, trim, name) => ({ year, make, model, trim, name });
const shorts = (series, opts) => [...buildSeriesLabels(series, opts).values()].map(v => v.short);
const S = (key, vehicle, range, charging) => ({
    key, vehicle,
    rangeRun:    range    ? { name: range }    : null,
    chargingRun: charging ? { name: charging } : null,
});
const VEHICLE_ATOMS = ['year', 'make', 'model', 'trim'];

describe('the three cases documented in #170', () => {
    const m3 = y => V(y, 'Tesla', 'Model 3', 'LR');

    it('names three model years by year alone', () => {
        expect(shorts([S('a', m3('2024'), '70 mph'), S('b', m3('2025'), '70 mph'), S('c', m3('2026'), '70 mph')]))
            .toEqual(['2024', '2025', '2026']);
    });

    it('names four tests on one car by test alone', () => {
        expect(shorts([
            S('a', m3('2024'), '70 mph cold'), S('b', m3('2024'), '80 mph'),
            S('c', m3('2024'), '70 mph mild'), S('d', m3('2024'), '60 mph'),
        ])).toEqual(['70 mph cold', '80 mph', '70 mph mild', '60 mph']);
    });

    it('names three cars × four tests by vehicle AND test', () => {
        // Model alone leaves four-way ties, so the test joins it.
        const cars = [V('2026','Tesla','Model 3','LR'), V('2026','Tesla','Model Y','LR'), V('2026','Ford','Mach-E','GT')];
        const tests = ['70 mph', '80 mph', '60 mph', '90 mph'];
        const series = cars.flatMap((c, ci) => tests.map((t, ti) => S(`${ci}-${ti}`, c, t)));
        expect(shorts(series)).toEqual(cars.flatMap(c => tests.map(t => `${c.model} · ${t}`)));
    });
});

describe('marginal discriminating power, not variation', () => {
    it('drops the year when the model already separates every car', () => {
        // The Road Trip regression: eight models across four model years, every
        // year differing, yet the year distinguishes nothing the model has not.
        const fleet = [
            V('2025','Toyota','Rav4',''), V('2026','Chevy','Trailseeker',''), V('2026','BMW','iX3',''),
            V('2027','Rivian','R2','Performance'), V('2027','Chevy','Bolt',''),
            V('2025-2026','Rivian','R1S','Dual Max'), V('2025','Lucid','Gravity','Grand Touring'),
        ];
        expect(shorts(fleet.map((v, i) => S(`k${i}`, v, 'road trip'))))
            .toEqual(['Rav4','Trailseeker','iX3','R2','Bolt','R1S','Gravity']);
    });

    it('charges only the colliding pair for the year', () => {
        expect(shorts([
            S('a', V('2025','Toyota','Rav4',''), 't'), S('b', V('2027','Chevy','Bolt',''), 't'),
            S('c', V('2025','Rivian','R1S',''), 't'), S('d', V('2026','Rivian','R1S',''), 't'),
        ])).toEqual(['Rav4', 'Bolt', '2025 · R1S', '2026 · R1S']);
    });

    it('drops a model that has become constant within its group', () => {
        expect(shorts([
            S('a', V('2025','Rivian','R1S','Dual Max'), 't'),
            S('b', V('2026','Rivian','R1S','Quad'), 't'),
        ])).toEqual(['Dual Max', 'Quad']);
    });
});

describe('surface-supplied context', () => {
    it('needs no extra atom for series the axis already separates', () => {
        expect(shorts([
            S('a', V('2026','Tesla','Model 3','LR'), '70 mph'),
            S('b', V('2025','Ford','F-150','XLT'), '80 mph'),
        ], { supplied: VEHICLE_ATOMS })).toEqual(['70 mph', '80 mph']);
    });

    it('names the charging half only where the range test alone is ambiguous', () => {
        expect(shorts([
            S('a', V('2026','Rivian','R1S',''), 'OoS 70mph', 'Out of Spec & Forums'),
            S('b', V('2026','Rivian','R1S',''), 'Theoretical', 'A'),
            S('c', V('2026','Rivian','R1S',''), 'Theoretical', 'B'),
        ], { supplied: VEHICLE_ATOMS })).toEqual(['OoS 70mph', 'Theoretical · A', 'Theoretical · B']);
    });
});

describe('duplicate atom values', () => {
    it('says an identical range and charging name once', () => {
        // Migration 046 gave both halves of a split run the same name.
        expect(shorts([
            S('a', V('2026','Rivian','R1S',''), 'Theoretical', 'Theoretical'),
            S('b', V('2026','Rivian','R1S',''), 'Theoretical', 'Fast'),
            S('c', V('2026','Rivian','R1S',''), 'OoS', 'OoS'),
        ], { supplied: VEHICLE_ATOMS })).toEqual(['Theoretical', 'Theoretical · Fast', 'OoS']);
    });

    it('dedupes in the full tier too', () => {
        const m = buildSeriesLabels([S('a', V('2026','Rivian','R1S',''), 'Theoretical', 'Theoretical')]);
        expect(m.get('a').full).toBe('2026 · Rivian · R1S · Theoretical');
    });
});

describe('fallbacks', () => {
    it('falls back to the vehicle name for a lone series', () => {
        expect(shorts([S('a', V('2024','Tesla','Model 3','LR','My Model 3'), '70 mph')])).toEqual(['My Model 3']);
    });

    it('prefers the test name when the surface already supplies the vehicle', () => {
        expect(shorts([S('a', V('2026','Kia','EV6','','My EV6'), 'OoS 70mph')], { supplied: VEHICLE_ATOMS }))
            .toEqual(['OoS 70mph']);
    });

    it('never renders a blank label for series identical on every atom', () => {
        expect(shorts([
            S('a', V('2024','Tesla','Model 3','LR','My M3'), '70 mph'),
            S('b', V('2024','Tesla','Model 3','LR','My M3'), '70 mph'),
        ])).toEqual(['My M3', 'My M3']);
    });

    it('prefers a session name over a bare fallback', () => {
        expect(shorts([{ ...S('a', V('2024','Tesla','Model 3','LR'), '70 mph'), sessionName: 'Ottawa loop' }]))
            .toEqual(['Ottawa loop']);
    });
});

describe('domain atoms', () => {
    const SRC  = [{ key: 'source', of: s => s.sourceName }];
    const CURV = [{ key: 'mode', of: s => s.mode }, { key: 'run', of: s => s.seq }, { key: 'source', of: s => s.source }];
    const P = (key, vehicle, extra) => ({ key, vehicle, ...extra });
    const m3p = y => V(y, 'Tesla', 'Model 3', 'Performance');

    it('takes atoms from the surface rather than assuming range/charging', () => {
        expect(shorts([
            P('a', V('2025','Tesla','Model 3','Perf'), { sourceName: 'Car and Driver' }),
            P('b', V('2026','Lucid','Air','GT'), { sourceName: 'MotorTrend' }),
        ], { atoms: SRC })).toEqual(['Model 3', 'Air']);
    });

    it('includes a required atom even where it is not needed', () => {
        expect(shorts([
            P('a', V('2025','Tesla','Model 3','Perf'), { sourceName: 'Car and Driver' }),
            P('b', V('2025','Tesla','Model 3','Perf'), { sourceName: 'MotorTrend' }),
            P('c', V('2026','Lucid','Air','GT'), { sourceName: 'Edmunds' }),
        ], { atoms: SRC, required: ['source'] }))
            .toEqual(['Model 3 · Car and Driver', 'Model 3 · MotorTrend', 'Air · Edmunds']);
    });

    it('does not let a required atom excuse an ambiguous vehicle', () => {
        // Two model years must still be told apart by year, not left to the
        // reader to guess whether the difference is the car or the source.
        expect(shorts([
            P('a', m3p('2025'), { sourceName: 'Car and Driver' }),
            P('b', m3p('2026'), { sourceName: 'MotorTrend' }),
        ], { atoms: SRC, required: ['source'] }))
            .toEqual(['2025 · Car and Driver', '2026 · MotorTrend']);
    });

    it('names accel curves by drive mode, reaching for the run number only on a tie', () => {
        expect(shorts([
            P('a', m3p('2025'), { mode: 'Sport', seq: '#1' }),
            P('b', m3p('2025'), { mode: 'Sport', seq: '#2' }),
            P('c', m3p('2025'), { mode: 'Track', seq: '#1' }),
        ], { atoms: CURV })).toEqual(['Sport · #1', 'Sport · #2', 'Track']);
    });

    it('distinguishes two model years the old hand-rolled rule could not', () => {
        // That rule always dropped year and trim, so these were identical.
        expect(shorts([
            P('a', m3p('2025'), { mode: 'Sport', seq: '#1' }),
            P('b', m3p('2026'), { mode: 'Sport', seq: '#1' }),
        ], { atoms: CURV })).toEqual(['2025', '2026']);
    });
});

describe('the shelved free-text override', () => {
    const oy = (key, y, t) => ({ key, vehicle: V(y, 'Tesla', 'Model 3', 'LR'), rangeRun: { name: t } });

    it('wins over the composed label, in both tiers', () => {
        const m = buildSeriesLabels([oy('a', '2024', '70 mph')], { overrides: { a: 'winter' } });
        expect(m.get('a')).toEqual({ short: 'winter', full: 'winter' });
    });

    it('does not lengthen its neighbours, being already distinct', () => {
        expect(shorts([oy('a','2024','70 mph'), oy('b','2024','80 mph'), oy('c','2025','90 mph')],
            { overrides: { a: 'new tyres' } })).toEqual(['new tyres', '2024', '2025']);
    });

    it('ignores a blank override rather than rendering an empty label', () => {
        // Both then contest normally, and the year is what separates them.
        expect(shorts([oy('a','2024','70 mph'), oy('b','2025','70 mph')], { overrides: { a: '   ' } }))
            .toEqual(['2024', '2025']);
    });
});

describe('edges', () => {
    it('returns an empty map for no series', () => {
        expect([...buildSeriesLabels([]).values()]).toEqual([]);
    });

    it('elides blank trims without leaving a gap', () => {
        expect(shorts([
            S('a', V('2026','Kia','EV6',''), '70'),
            S('b', V('2026','Kia','EV9',null), '80'),
        ])).toEqual(['EV6', 'EV9']);   // model alone separates them; the test adds nothing
    });
});
