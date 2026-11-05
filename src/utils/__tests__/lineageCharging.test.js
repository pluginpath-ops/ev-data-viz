import { describe, it, expect } from 'vitest';
import { chargingLineage, lineageChargingTests, lineageInheritors, passesDownLineage } from '../lineageCharging';

const v = (id, over = {}) => ({ id, spec_source_vehicle_id: null, battery_revision: false, capacity_factor: 1, runs: [], ...over });
const index = (...vs) => new Map(vs.map(x => [x.id, x]));
const ids = (lineage) => lineage.map(e => [e.source.id, e.capacityFactor]);

// 2023 → 2024 → 2025, the shape a model line takes.
const origin = v(1, { runs: [{ id: 11, kind: 'charging' }, { id: 12, kind: 'range' }] });
const mid    = v(2, { spec_source_vehicle_id: 1, runs: [{ id: 21, kind: 'charging' }] });
const end    = v(3, { spec_source_vehicle_id: 2 });

describe('chargingLineage', () => {
    it('walks the whole chain, nearest first, at factor 1', () => {
        expect(ids(chargingLineage(end, index(origin, mid, end)))).toEqual([[2, 1], [1, 1]]);
    });

    it('is empty for an origin', () => {
        expect(chargingLineage(origin, index(origin))).toEqual([]);
    });

    it('is empty for a battery revision: it takes nothing from its source', () => {
        const revised = { ...mid, battery_revision: true };
        expect(chargingLineage(revised, index(origin, revised))).toEqual([]);
    });

    it('stops after a revision above: its tests come down, its source’s do not', () => {
        const revised = { ...mid, battery_revision: true };
        expect(ids(chargingLineage(end, index(origin, revised, end)))).toEqual([[2, 1]]);
    });

    it('multiplies capacity factors down the chain', () => {
        const bigger = { ...mid, capacity_factor: 1.1 };
        const biggerStill = { ...end, capacity_factor: 1.2 };
        const lineage = chargingLineage(biggerStill, index(origin, bigger, biggerStill));
        expect(lineage[0].capacityFactor).toBeCloseTo(1.2);   // mid's tests: end's edge only
        expect(lineage[1].capacityFactor).toBeCloseTo(1.32);  // origin's: both edges
    });

    it('reads a missing or invalid factor as 1', () => {
        const odd = { ...end, capacity_factor: null };
        expect(ids(chargingLineage(odd, index(origin, mid, odd)))).toEqual([[2, 1], [1, 1]]);
    });

    it('stops at a missing source and at a cycle', () => {
        expect(ids(chargingLineage(end, index(mid, end)))).toEqual([[2, 1]]);
        const a = v(10, { spec_source_vehicle_id: 11 });
        const b = v(11, { spec_source_vehicle_id: 10 });
        expect(ids(chargingLineage(a, index(a, b)))).toEqual([[11, 1]]);
    });
});

describe('lineageChargingTests', () => {
    it('takes each source’s own charging tests, not range tests or composites', () => {
        const withComposite = { ...origin, runs: [...origin.runs, { id: 13, kind: 'charging', composite: {} }] };
        const tests = lineageChargingTests(end, index(withComposite, mid, end));
        expect(tests.map(t => [t.run.id, t.source.id])).toEqual([[21, 2], [11, 1]]);
    });

    it('skips runs a source itself inherits — the walk reaches them at the right factor', () => {
        const midWithCopy = { ...mid, runs: [...mid.runs, { id: 'inherited_v2_11', kind: 'charging', _inherited: true, _realRunId: 11 }] };
        const tests = lineageChargingTests(end, index(origin, midWithCopy, end));
        expect(tests.map(t => t.run.id)).toEqual([21, 11]);
    });
});

describe('passesDownLineage', () => {
    it('is a real charging test only', () => {
        expect(passesDownLineage({ id: 1, kind: 'charging' })).toBe(true);
        expect(passesDownLineage({ id: 1, kind: 'range' })).toBe(false);
        expect(passesDownLineage({ id: 1, kind: 'charging', composite: {} })).toBe(false);
        expect(passesDownLineage({ id: 'x', kind: 'charging', _inherited: true })).toBe(false);
    });
});

describe('lineageInheritors', () => {
    it('is every variant below, up to a revision', () => {
        expect(lineageInheritors(1, [origin, mid, end])).toEqual([2, 3]);
        const revised = { ...mid, battery_revision: true };
        expect(lineageInheritors(1, [origin, revised, end])).toEqual([]);
        expect(lineageInheritors(2, [origin, revised, end])).toEqual([3]);
    });
});
