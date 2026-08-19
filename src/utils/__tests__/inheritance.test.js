import { describe, it, expect } from 'vitest';
import { linkableRuns, linkableCounts, scaleInheritedMagnitudes } from '../runUtils';

const run = (id, kind, extra = {}) => ({ id, kind, name: `${kind}-${id}`, ...extra });
const source = () => ({
    id: 1,
    runs: [
        run(10, 'charging'), run(11, 'charging'),
        run(12, 'range'), run(13, 'range'),
        run(14, 'charging', { _inherited: true }),
    ],
});

describe('which runs can be inherited', () => {
    it('offers every own run by default', () => {
        expect(linkableRuns(source()).map(r => r.id)).toEqual([10, 11, 12, 13]);
    });

    it('filters to charging only — a trim sharing the battery', () => {
        expect(linkableRuns(source(), new Set(), 'charging').map(r => r.id)).toEqual([10, 11]);
    });

    it('filters to range only — a battery variant of the same car', () => {
        expect(linkableRuns(source(), new Set(), 'range').map(r => r.id)).toEqual([12, 13]);
    });

    it('never offers an inherited run — a link to a link', () => {
        expect(linkableRuns(source()).some(r => r._inherited)).toBe(false);
    });

    it('excludes runs already linked to the target', () => {
        expect(linkableRuns(source(), new Set([10, 12])).map(r => r.id)).toEqual([11, 13]);
    });

    it('respects both the filter and the already-linked set together', () => {
        expect(linkableRuns(source(), new Set([10]), 'charging').map(r => r.id)).toEqual([11]);
    });

    it('classifies pre-046 rows by their legacy flags', () => {
        const legacy = { id: 2, runs: [
            { id: 20, has_charging: true, has_range: false },
            { id: 21, has_charging: false, has_range: true },
        ] };
        expect(linkableRuns(legacy, new Set(), 'range').map(r => r.id)).toEqual([21]);
    });

    it('tolerates a missing vehicle', () => {
        expect(linkableRuns(null)).toEqual([]);
        expect(linkableRuns({})).toEqual([]);
    });
});

describe('the two scaling knobs', () => {
    // A range test: 300 miles on 100 kWh, so 3.0 mi/kWh.
    const rangeRun = { distance_miles: 300, energy_kwh: 100 };
    const eff = (r) => r.distance_miles / r.energy_kwh;

    it('capacity alone moves range and leaves efficiency untouched', () => {
        const out = scaleInheritedMagnitudes(rangeRun, 1.2, 1);
        expect(out.distance_miles).toBe(360);
        expect(out.energy_kwh).toBe(120);
        // The whole point of the split: a bigger pack goes further at the same
        // rate. Scaling distance alone — what the single factor used to do —
        // would have reported 3.6 mi/kWh for a car that sips identically.
        expect(eff(out)).toBeCloseTo(eff(rangeRun), 10);
    });

    it('efficiency alone moves both range and efficiency', () => {
        const out = scaleInheritedMagnitudes(rangeRun, 1, 1.03);
        expect(out.distance_miles).toBe(309);
        expect(out.energy_kwh).toBe(100);
        expect(eff(out)).toBeCloseTo(eff(rangeRun) * 1.03, 10);
    });

    it('multiplies to the total range ratio when both apply', () => {
        const out = scaleInheritedMagnitudes(rangeRun, 1.2, 1.03);
        // 300 × 1.2 × 1.03 — the EPA range ratio a curator would observe.
        expect(out.distance_miles).toBeCloseTo(370.8, 6);
        expect(eff(out)).toBeCloseTo(eff(rangeRun) * 1.03, 10);
    });

    it('scales a charging test by capacity only', () => {
        const out = scaleInheritedMagnitudes({ charge_energy_kwh: 50 }, 1.2, 1.03);
        expect(out.charge_energy_kwh).toBe(60);   // efficiency does not reach it
        expect(out.distance_miles).toBeNull();
    });

    it('leaves absent fields null rather than zero', () => {
        expect(scaleInheritedMagnitudes({}, 1.5, 1.5)).toEqual({
            distance_miles: null, energy_kwh: null, charge_energy_kwh: null,
        });
    });

    it('defaults both factors to 1, so an unscaled link is a pass-through', () => {
        const out = scaleInheritedMagnitudes(rangeRun);
        expect(out.distance_miles).toBe(300);
        expect(out.energy_kwh).toBe(100);
    });

    // The bug that prompted the clamp: 62.83 × 0.94 is 59.060199999999995.
    it('rounds away float noise', () => {
        expect(scaleInheritedMagnitudes({ distance_miles: 62.83 }, 0.94, 1).distance_miles)
            .toBe(59.1);
    });
});

describe('counts for the filter', () => {
    it('counts each kind, excluding inherited and already-linked runs', () => {
        expect(linkableCounts(source())).toEqual({ all: 4, charging: 2, range: 2 });
        expect(linkableCounts(source(), new Set([10, 11]))).toEqual({ all: 2, charging: 0, range: 2 });
    });
});
