import { describe, it, expect } from 'vitest';
import { simulateWeek, taperMinutes } from '../costToDrive';
import { dayBars, dayParts } from '../dayBars';
import { normalizeCostToDrive } from '../costToDriveKey';
import { DEFAULT_COST_TO_DRIVE } from '../../constants/costToDrive';

const profile = (home) => ({
    usableKwh: 75,
    missing: null,
    whPerMi: { winter: { D: 323, L: 332 }, summer: { D: 250, L: 260 } },
    home,
    fast: { basis: 'maxDc', minutes: (a, b) => taperMinutes(75, 170, a, b) },
});
const settings = normalizeCostToDrive({ ...DEFAULT_COST_TO_DRIVE, week: 'LDLDLDO', planned: 0b1000000, dailyMi: 45, longMi: 120 });
const weeks = [{ kw: 11.5, eff: 0.885, warmEff: 0.9 }, { kw: 1.44, eff: 0.80, warmEff: 0.9 }].map(h => simulateWeek(profile(h), settings));

describe('the day by day as bars', () => {
    it('each day ends where the next morning starts', () => {
        for (const w of weeks) {
            for (const b of dayBars(w)) expect(b.start + b.fast + b.planned + b.home - b.used).toBeCloseTo(b.next, 6);
        }
    });

    it('splits the charge in: fast stops, the planned one, and the night at home', () => {
        const bars = dayBars(weeks[1]);
        const sunday = bars[6];
        expect(sunday.planned).toBeGreaterThan(0);
        expect(sunday.used).toBeCloseTo(0, 6);
        const w = weeks[1];
        const fastAll = w.stops.reduce((t, s) => t + s.toSoc - s.fromSoc, 0);
        expect(bars.reduce((t, b) => t + b.fast + b.planned, 0)).toBeCloseTo(fastAll, 6);
        expect(bars.reduce((t, b) => t + b.minutes, 0)).toBeCloseTo(w.fastMinutes, 6);
    });

    it('in time order: the night at home runs from where the car got home to the next morning', () => {
        for (const w of weeks) {
            for (const b of dayBars(w)) {
                expect(b.next - b.arrive).toBeCloseTo(b.home, 6);
                // The day out: the morning, less the driving, plus the stops.
                expect(b.start - b.used + b.fast + b.planned).toBeCloseTo(b.arrive, 6);
                for (const st of b.stopBands) expect(st.to).toBeGreaterThan(st.from);
            }
        }
    });

    it('carries each night\'s home ceiling: the most the window could add, never less than what it did', () => {
        for (const w of weeks) {
            for (const b of dayBars(w)) expect(b.mostAdd).toBeGreaterThanOrEqual(b.home - 1e-9);
        }
        // 120 V: a night the window cuts short added all it could.
        const cut = dayBars(weeks[1]).filter(b => b.home > 0.05 && Math.abs(b.mostAdd - b.home) < 1e-6);
        expect(cut.length).toBeGreaterThan(0);
    });

    it('lists a day\'s parts for the readout: costs that add up, ranges on the bars', () => {
        const w = weeks[1];
        for (const view of ['day', 'balance']) {
            dayBars(w).forEach((b, i) => {
                const parts = dayParts(b, view, w.rateTiers);
                const sum = (kind, key) => parts.filter(p => p.kind === kind).reduce((t, p) => t + p[key], 0);
                expect(sum('home', 'pct')).toBeCloseTo(b.home > 0.05 ? b.home : 0, 6);
                expect(sum('home', 'cost')).toBeCloseTo(b.home > 0.05 ? w.days[i].night.homeCost : 0, 6);
                expect(sum('fast', 'cost') + sum('planned', 'cost')).toBeCloseTo(b.cost, 6);
                // The battery row last; every other part sits somewhere on the bars.
                expect(parts.at(-1)).toMatchObject({ kind: 'battery' });
                expect(parts.at(-1).pct).toBeCloseTo(b.next - b.start, 6);
                for (const p of parts.slice(0, -1)) expect(p.range[1]).toBeGreaterThanOrEqual(p.range[0]);
            });
        }
        // A time-of-use plan: the night in parts, base first, costs by tier.
        const s = normalizeCostToDrive({ ...settings, rate: 'sdge-ev-tou-5', season: 'winter' });
        const tou = simulateWeek(profile({ kw: 1.44, eff: 0.80, warmEff: 0.9 }), s);
        const homes = dayBars(tou).flatMap(b => dayParts(b, 'balance', tou.rateTiers)).filter(p => p.kind === 'home');
        expect(homes.some(p => p.tier !== tou.rateTiers.base)).toBe(true);
        expect(homes.reduce((t, p) => t + p.cost, 0)).toBeCloseTo(tou.homeCost, 6);
    });

    it('a settled week balances: what goes in comes out', () => {
        for (const w of weeks) {
            const bars = dayBars(w);
            const inn = bars.reduce((t, b) => t + b.fast + b.planned + b.home, 0);
            expect(inn).toBeCloseTo(bars.reduce((t, b) => t + b.used, 0), 6);
        }
    });
});
