import { describe, it, expect } from 'vitest';
import { simulateWeek, taperMinutes } from '../costToDrive';
import { dayBars } from '../dayBars';
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
const weeks = [{ kw: 11.5, eff: 0.885 }, { kw: 1.44, eff: 0.80 }].map(h => simulateWeek(profile(h), settings));

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

    it('a settled week balances: what goes in comes out', () => {
        for (const w of weeks) {
            const bars = dayBars(w);
            const inn = bars.reduce((t, b) => t + b.fast + b.planned + b.home, 0);
            expect(inn).toBeCloseTo(bars.reduce((t, b) => t + b.used, 0), 6);
        }
    });
});
