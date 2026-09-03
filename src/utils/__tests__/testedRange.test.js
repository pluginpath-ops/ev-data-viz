/**
 * The rule this pins: a distance over a partial state-of-charge window is not a
 * range, and must never be reported as one.
 *
 * The temptation is to extrapolate — a 90→30 test covering 180 mi implies 300
 * mi over a full pack, and the arithmetic is trivial. It is also an invention:
 * an EV's consumption is not flat across the pack, and the tail below 20% is
 * exactly where it stops being flat. So the window travels with the number.
 */
import { describe, it, expect } from 'vitest';
import {
    testedRangeSummary, socWindow, coversPracticalPack,
    FULL_WINDOW_MIN_PCT, WINDOW_START_MIN_PCT, WINDOW_END_MAX_PCT, WIDE_SPAN_MIN_PCT,
} from '../testedRange';

const rangeRun = (over = {}) => ({
    id: 1, kind: 'range', distance_miles: 291, energy_kwh: 84,
    start_soc: 100, end_soc: 2, speed_mph: 70, temperature_f: 72,
    date: '2025-03-14', ...over,
});
const vehicle = (runs, over = {}) => ({ battery: 84, range: 318, runs, ...over });

describe('socWindow', () => {
    it('is the span the run covered, whichever direction it ran', () => {
        expect(socWindow({ start_soc: 100, end_soc: 2 })).toBe(98);
        expect(socWindow({ start_soc: 10, end_soc: 80 })).toBe(70);
    });

    it('is null when the run does not say, and when it says nothing moved', () => {
        expect(socWindow({ start_soc: null, end_soc: 20 })).toBeNull();
        expect(socWindow({ start_soc: 50, end_soc: 50 })).toBeNull();
        expect(socWindow(undefined)).toBeNull();
    });
});

describe('coversPracticalPack — anchored at both ends, not a bare span', () => {
    const w = (start_soc, end_soc) => coversPracticalPack({ start_soc, end_soc });

    it('accepts the practical driving band', () => {
        expect(w(80, 10)).toBe(true);   // exactly the bounds
        expect(w(100, 0)).toBe(true);
        expect(w(97, 2)).toBe(true);
        expect(w(85, 5)).toBe(true);
    });

    it('rejects a window that missed the top of the pack', () => {
        // The "10% challenge" shape: driven down to 10 from wherever the car
        // happened to be. Ends in the right place, started nowhere near it.
        expect(w(56, 10)).toBe(false);
        expect(w(79, 5)).toBe(false);
    });

    it('accepts a wide window even when it stopped short of the bottom', () => {
        // 100→15 is real corpus data: 85 points, including the entire top of
        // the pack, which is where most driving happens. Anchoring alone
        // rejected it while accepting 80→10 at 70 points — the wrong way round.
        expect(w(100, 15)).toBe(true);
        expect(w(100, 11)).toBe(true);
    });

    it('rejects a window that is neither anchored nor wide', () => {
        expect(w(90, 20)).toBe(false);   // 70 points, anchored at neither end
        expect(w(75, 12)).toBe(false);   // 63 points, missed the top
    });

    it('rejects a 70-point window anchored at NEITHER end', () => {
        // 90→20 spans exactly as much as 80→10 and is a materially worse test,
        // which is why a span threshold alone will not do either.
        expect(w(90, 20)).toBe(false);
    });

    it('is direction-agnostic', () => {
        // Nothing stops a row storing its window the other way round, and a
        // rule that silently inverted would be worse than one that errs.
        expect(w(10, 80)).toBe(true);
    });

    it('treats an unstated window as inadequate, never as adequate', () => {
        expect(w(null, 10)).toBe(false);
        expect(w(80, null)).toBe(false);
        expect(coversPracticalPack(undefined)).toBe(false);
    });

    it('uses the documented bounds', () => {
        expect(WINDOW_START_MIN_PCT).toBe(80);
        expect(WINDOW_END_MAX_PCT).toBe(10);
        expect(WIDE_SPAN_MIN_PCT).toBe(85);
    });

    it('sorts the four real shapes the way the corpus needs', () => {
        expect(w(80, 10)).toBe(true);    // anchored, 70 points
        expect(w(100, 15)).toBe(true);   // wide, 85 points
        expect(w(90, 20)).toBe(false);   // neither
        expect(w(56, 10)).toBe(false);   // no top of pack
    });
});

describe('testedRangeSummary', () => {
    it('reports a near-full window as a range', () => {
        const s = testedRangeSummary(vehicle([rangeRun()]));
        expect(s.distanceMi).toBe(291);
        expect(s.isFullPack).toBe(true);
        expect(s.speedMph).toBe(70);
        expect(s.temperatureF).toBe(72);
    });

    it('does NOT call a partial window a range', () => {
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 90, end_soc: 30, distance_miles: 180 })]));
        expect(s.distanceMi).toBe(180);
        expect(s.isFullPack).toBe(false);
        expect(s.windowPct).toBe(60);
        // The window is carried so the display can qualify the figure.
        expect(s.startSoc).toBe(90);
        expect(s.endSoc).toBe(30);
    });

    it('treats an UNSTATED window as unknown, never as full', () => {
        // The failure this prevents: an import that drops start/end SoC would
        // otherwise silently promote every distance to a range.
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: null, end_soc: null })]));
        expect(s.isFullPack).toBe(false);
        expect(s.windowPct).toBeNull();
    });

    it('accepts a real full-pack test that stops short of zero', () => {
        // 97→2 is 95 exactly: a car driven to shutdown reports 3% as often as 0,
        // and discarding those would throw away the best tests in the corpus.
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 97, end_soc: 2 })]));
        expect(s.windowPct).toBe(FULL_WINDOW_MIN_PCT);
        expect(s.isFullPack).toBe(true);
    });

    it('carries the mixed-cycle marker, so a speed is never shown bare', () => {
        const held = testedRangeSummary(vehicle([rangeRun()]));
        expect(held.speedNote).toBeNull();
        const mixed = testedRangeSummary(vehicle([rangeRun({ speed_basis: 'mixed' })]));
        expect(mixed.speedNote).toBe('mixed cycle');
    });

    it('prefers a full-pack test over a NEWER partial one', () => {
        // The case from the real corpus: a Model Y whose latest test covered
        // 56→10%. Reporting 99 mi beside a 327 mi EPA figure reads as a
        // catastrophic result at a glance, however carefully the window is
        // printed next to it.
        const s = testedRangeSummary(vehicle([
            rangeRun({ id: 1, distance_miles: 327, start_soc: 100, end_soc: 1, date: '2024-01-01' }),
            rangeRun({ id: 2, distance_miles: 99, start_soc: 56, end_soc: 10, date: '2025-06-01' }),
        ]));
        expect(s.distanceMi).toBe(327);
        expect(s.isFullPack).toBe(true);
    });

    it('takes the newest among full-pack tests', () => {
        const s = testedRangeSummary(vehicle([
            rangeRun({ id: 1, distance_miles: 300, start_soc: 100, end_soc: 2, date: '2023-01-01' }),
            rangeRun({ id: 2, distance_miles: 291, start_soc: 100, end_soc: 2, date: '2025-03-14' }),
        ]));
        expect(s.distanceMi).toBe(291);
    });

    it('falls back to a partial window when that is all there is', () => {
        // Some evidence, correctly qualified, beats none.
        const s = testedRangeSummary(vehicle([
            rangeRun({ distance_miles: 99, start_soc: 56, end_soc: 10 }),
        ]));
        expect(s.distanceMi).toBe(99);
        expect(s.isFullPack).toBe(false);
    });

});

describe('scaling to a full pack', () => {
    it('scales an adequate partial window, so the figure is comparable to EPA', () => {
        // 220 mi over 70% of a pack is not a range; the EPA number beside it on
        // the card is. 220 / 0.70 = 314.3.
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 80, end_soc: 10, distance_miles: 220 })]));
        expect(s.distanceMi).toBe(220);
        expect(s.fullPackMi).toBeCloseTo(314.3, 1);
        expect(s.isScaled).toBe(true);
    });

    it('scales the real Bolt record', () => {
        // 170 mi over 100→15%: 85 points, adequate by the wide clause.
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 100, end_soc: 15, distance_miles: 170 })]));
        expect(s.fullPackMi).toBeCloseTo(200, 1);
        expect(s.isScaled).toBe(true);
    });

    it('does NOT scale a window too narrow to characterise the pack', () => {
        // 99.2 / 0.46 = 215.7 — not a measurement with a caveat, a guess with a
        // decimal point. Reported as measured instead.
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 56, end_soc: 10, distance_miles: 99.2 })]));
        expect(s.fullPackMi).toBeNull();
        expect(s.isScaled).toBe(false);
        expect(s.distanceMi).toBe(99.2);
    });

    it('does not scale, or annotate, a window that is already the whole pack', () => {
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 100, end_soc: 0, distance_miles: 291 })]));
        expect(s.fullPackMi).toBe(291);
        expect(s.isScaled).toBe(false);
    });

    it('does not annotate a rounding-sized adjustment', () => {
        // 97→2 scales 300 to 315.8 — worth doing and worth saying. But a window
        // of 99.9 must not litter every card with a note about 0.1 of a mile.
        const tiny = testedRangeSummary(vehicle([rangeRun({ start_soc: 100, end_soc: 0.1, distance_miles: 291 })]));
        expect(tiny.isScaled).toBe(false);
        const real = testedRangeSummary(vehicle([rangeRun({ start_soc: 97, end_soc: 2, distance_miles: 300 })]));
        expect(real.isScaled).toBe(true);
    });

    it('cannot scale a window it does not know', () => {
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: null, end_soc: null })]));
        expect(s.fullPackMi).toBeNull();
        expect(s.isScaled).toBe(false);
    });
});

describe('testedRangeSummary extras', () => {
    it('separates "worth reporting" from "is a full-pack range"', () => {
        // 80→10 is an adequate characterisation whose distance is still not the
        // whole pack. Conflating the two is what the single old threshold did.
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 80, end_soc: 10, distance_miles: 220 })]));
        expect(s.isRepresentative).toBe(true);
        expect(s.isFullPack).toBe(false);
    });

    it('prefers a full-pack test, then an adequate one, then whatever exists', () => {
        const partial = rangeRun({ id: 3, distance_miles: 99, start_soc: 56, end_soc: 10, date: '2025-06-01' });
        const adequate = rangeRun({ id: 2, distance_miles: 220, start_soc: 80, end_soc: 10, date: '2024-06-01' });
        const fullPack = rangeRun({ id: 1, distance_miles: 291, start_soc: 100, end_soc: 2, date: '2023-01-01' });

        expect(testedRangeSummary(vehicle([partial, adequate, fullPack])).distanceMi).toBe(291);
        expect(testedRangeSummary(vehicle([partial, adequate])).distanceMi).toBe(220);
        expect(testedRangeSummary(vehicle([partial])).distanceMi).toBe(99);
    });

    it('is null when there is nothing measured to report', () => {
        expect(testedRangeSummary(vehicle([]))).toBeNull();
        expect(testedRangeSummary(vehicle([rangeRun({ distance_miles: null })]))).toBeNull();
        expect(testedRangeSummary(vehicle([rangeRun({ distance_miles: 0 })]))).toBeNull();
        expect(testedRangeSummary(undefined)).toBeNull();
    });
});
