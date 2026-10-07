import { describe, it, expect } from 'vitest';
import { spreadOf, rangeBasesFor, visibleRangeTests } from '../rangeTestSpread';

const range = (id, over = {}) => ({
    id, kind: 'range', name: `t${id}`, date: '2026-01-01',
    distance_miles: 250, start_soc: 100, end_soc: 0, energy_kwh: 80, speed_mph: 70, ...over,
});

describe('spreadOf', () => {
    it('has no spread below two figures — one test cannot claim agreement', () => {
        expect(spreadOf([])).toBeNull();
        expect(spreadOf([250])).toBeNull();
        expect(spreadOf([250, null, NaN])).toBeNull();
    });

    it('spans lowest to highest and keeps every figure', () => {
        const sp = spreadOf([260, null, 240, 255]);
        expect(sp).toMatchObject({ lo: 240, hi: 260, n: 3, values: [260, 240, 255] });
    });

    it('carries each figure\'s test through for the hover', () => {
        const sp = spreadOf([{ value: 250, run: { id: 1 } }, { value: 240, run: { id: 2 } }, { value: null, run: { id: 3 } }]);
        expect(sp.points.map(p => p.run.id)).toEqual([1, 2]);
    });
});

describe('rangeBasesFor', () => {
    const charging = { id: 'c1', kind: 'charging' };

    it('prices each test as itself, never as a fallback', () => {
        // t3 has no SoC window and no energy: the resolver would fall back to
        // another test, and that test would then be drawn twice.
        const vehicle = { runs: [range(1), range(2, { distance_miles: 200 }), range(3, { start_soc: null, end_soc: null, energy_kwh: null }), charging], socWindowKwh: 80 };
        const bases = rangeBasesFor(charging, vehicle);
        expect(bases.map(b => b.run.id)).toEqual([1, 2]);
        expect(bases.map(b => b.miPerSoc)).toEqual([2.5, 2]);
    });

    it('applies the correction the bars use', () => {
        const vehicle = { runs: [range(1, { speed_mph: 80 })], socWindowKwh: 80 };
        const [none] = rangeBasesFor(charging, vehicle, { correctionMode: 'none' });
        const [aero] = rangeBasesFor(charging, vehicle, { correctionMode: 'aero' });
        // An 80 mph test was harder than standard, so it corrects upward.
        expect(aero.miPerSoc).toBeGreaterThan(none.miPerSoc);
    });

    it('leaves hidden tests out', () => {
        const vehicle = { runs: [range(1), range(2, { isHidden: true })] };
        expect(visibleRangeTests(vehicle).map(r => r.id)).toEqual([1]);
    });
});

describe('spreadTestsFor (Road Trip)', () => {
    it('leaves hidden tests out, as the bar charts do', async () => {
        const { spreadTestsFor } = await import('../roadTripSpread');
        const vehicle = { runs: [range(1), range(2, { isHidden: true }), range(3, { is_hidden: true })] };
        expect(spreadTestsFor(vehicle).map(t => t.run.id)).toEqual([1]);
    });
});
