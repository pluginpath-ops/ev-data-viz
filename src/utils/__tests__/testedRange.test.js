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
import { testedRangeSummary, socWindow, FULL_WINDOW_MIN_PCT } from '../testedRange';

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

describe('testedRangeSummary', () => {
    it('reports a near-full window as a range', () => {
        const s = testedRangeSummary(vehicle([rangeRun()]));
        expect(s.distanceMi).toBe(291);
        expect(s.isFullWindow).toBe(true);
        expect(s.speedMph).toBe(70);
        expect(s.temperatureF).toBe(72);
    });

    it('does NOT call a partial window a range', () => {
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 90, end_soc: 30, distance_miles: 180 })]));
        expect(s.distanceMi).toBe(180);
        expect(s.isFullWindow).toBe(false);
        expect(s.windowPct).toBe(60);
        // The window is carried so the display can qualify the figure.
        expect(s.startSoc).toBe(90);
        expect(s.endSoc).toBe(30);
    });

    it('treats an UNSTATED window as unknown, never as full', () => {
        // The failure this prevents: an import that drops start/end SoC would
        // otherwise silently promote every distance to a range.
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: null, end_soc: null })]));
        expect(s.isFullWindow).toBe(false);
        expect(s.windowPct).toBeNull();
    });

    it('accepts a real full-pack test that stops short of zero', () => {
        // 97→2 is 95 exactly: a car driven to shutdown reports 3% as often as 0,
        // and discarding those would throw away the best tests in the corpus.
        const s = testedRangeSummary(vehicle([rangeRun({ start_soc: 97, end_soc: 2 })]));
        expect(s.windowPct).toBe(FULL_WINDOW_MIN_PCT);
        expect(s.isFullWindow).toBe(true);
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
        expect(s.isFullWindow).toBe(true);
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
        expect(s.isFullWindow).toBe(false);
    });

    it('is null when there is nothing measured to report', () => {
        expect(testedRangeSummary(vehicle([]))).toBeNull();
        expect(testedRangeSummary(vehicle([rangeRun({ distance_miles: null })]))).toBeNull();
        expect(testedRangeSummary(vehicle([rangeRun({ distance_miles: 0 })]))).toBeNull();
        expect(testedRangeSummary(undefined)).toBeNull();
    });
});
