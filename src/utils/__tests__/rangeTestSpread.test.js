import { describe, it, expect } from 'vitest';
import { spreadOf, rangeBasesFor, countedRangeTests, spreadSummary, testPointLines } from '../rangeTestSpread';

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

    it('counts the pool and leaves the excluded out (#394)', () => {
        // A viewer's runs hold the listed tests; the pool rides beside them.
        const vehicle = {
            runs: [range(1), range(2, { isExcluded: true })],
            pooledRuns: [range(3, { isHidden: true })],
        };
        expect(countedRangeTests(vehicle).map(r => r.id)).toEqual([1, 3]);
        // A contributor's runs hold the unlisted test too: counted once.
        const contributor = { runs: [...vehicle.runs, range(3, { isHidden: true })], pooledRuns: vehicle.pooledRuns };
        expect(countedRangeTests(contributor).map(r => r.id)).toEqual([1, 3]);
    });
});

describe('spreadTestsFor (Road Trip)', () => {
    it('reads the same tests as the bar charts: listed and pooled, not excluded', async () => {
        const { spreadTestsFor } = await import('../roadTripSpread');
        const vehicle = {
            runs: [range(1), range(2, { isExcluded: true })],
            pooledRuns: [range(3, { isHidden: true })],
        };
        expect(spreadTestsFor(vehicle).map(t => t.run.id)).toEqual([1, 3]);
    });
});

describe('saying the pool is in it', () => {
    it('counts the unlisted tests in the summary, and marks an unlisted dot', () => {
        const sp = spreadOf([{ value: 250, run: range(1) }, { value: 240, run: range(2, { isHidden: true }) }]);
        expect(spreadSummary(sp, 'mi')).toBe('Across 2 range tests (1 unlisted): 240–250 mi');
        expect(testPointLines(range(2, { isHidden: true }), '240 mi', 'imperial')).toContain('Unlisted test');
        expect(testPointLines(range(1), '250 mi', 'imperial')).not.toContain('Unlisted test');
    });
});

describe('rangeCoverageOk — the range spread\'s pack rule, and its override', () => {
    it('admits a narrow test only when a curator overrode it, and never one with no SoC', async () => {
        const { rangeCoverageOk } = await import('../rangeTestSpread');
        expect(rangeCoverageOk(range(1))).toBe(true);                                         // 100→0
        expect(rangeCoverageOk(range(2, { start_soc: 60, end_soc: 48 }))).toBe(false);       // narrow
        expect(rangeCoverageOk(range(3, { start_soc: 60, end_soc: 48, qualityOverride: true }))).toBe(true);
        // A sweep with no start/end SoC has no range to scale, override or not.
        expect(rangeCoverageOk(range(4, { start_soc: null, end_soc: null, quality_override: true }))).toBe(false);
    });
});

describe('spreadEfficiency — measured, else estimated from SoC', () => {
    it('estimates a test with no energy from its SoC change, and says so', async () => {
        const { spreadEfficiency, countsAside } = await import('../rangeTestSpread');
        expect(spreadEfficiency(range(1), 80)).toMatchObject({ miPerKwh: 250 / 80, estimated: false, note: null });
        const e = spreadEfficiency(range(2, { energy_kwh: null, start_soc: 60, end_soc: 50, distance_miles: 24 }), 80);
        expect(e.estimated).toBe(true);
        expect(e.miPerKwh).toBeCloseTo(24 / 8);
        expect(e.note).toMatch(/estimated/);
        // Nothing to estimate from: no SoC, or no SoC window.
        expect(spreadEfficiency(range(3, { energy_kwh: null, start_soc: null, end_soc: null }), 80)).toBeNull();
        expect(spreadEfficiency(range(4, { energy_kwh: null }), null)).toBeNull();
        expect(countsAside(5, 2)).toBe(' (5 unlisted, 2 estimated)');
        expect(countsAside()).toBe('');
    });

    it('lets Road Trip take an estimated test, flagged', async () => {
        const { spreadTestsFor } = await import('../roadTripSpread');
        const vehicle = { socWindowKwh: 80, runs: [range(1), range(2, { energy_kwh: null, start_soc: 60, end_soc: 50, distance_miles: 24 })] };
        expect(spreadTestsFor(vehicle).map(t => [t.run.id, t.estimated])).toEqual([[1, false], [2, true]]);
    });
});
