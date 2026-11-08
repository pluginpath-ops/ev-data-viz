import { describe, it, expect } from 'vitest';
import {
    simulateWeek, simulateGasWeek, plannedSlot, costToDriveVehicle, costToDriveComparison, taperMinutes, perMonth, enoughLevel, weekTimeText,
} from '../costToDrive';
import { normalizeCostToDrive } from '../costToDriveKey';
import { DEFAULT_COST_TO_DRIVE, MIN_STOP_ADD, STRETCH_CAP_TO, HOME_LEVELS, NO_HOME_LEVEL } from '../../constants/costToDrive';

// A Model Y-ish profile with fixed numbers, so the rule is tested apart from
// how a vehicle record resolves: 75 kWh, 340 Wh/mi on a long day in winter.
const profile = (over = {}) => ({
    usableKwh: 75,
    missing: null,
    whPerMi: { winter: { D: 323, L: 332 }, summer: { D: 250, L: 260 } },
    home: { kw: 11.5, eff: 0.885 },
    fast: { basis: 'maxDc', minutes: (a, b) => taperMinutes(75, 170, a, b) },
    ...over,
});
const settings = (over = {}) => normalizeCostToDrive({ ...DEFAULT_COST_TO_DRIVE, ...over });
const wallOutlet = { home: { kw: 1.44, eff: 0.80 } };

describe('the week', () => {
    it('48 A in winter: one stop on each long day, none on the short ones, and the planned Sunday stop skipped above the cap', () => {
        const w = simulateWeek(profile(), settings());
        const byDay = w.days.map(d => d.stops.length);
        expect(byDay).toEqual([1, 0, 1, 0, 1, 0, 0]);
        expect(w.days[6].plannedSkipped).toBe(true);
    });

    it('a stop is made on the route at "stop to charge by", not at the end of the day', () => {
        const w = simulateWeek(profile(), settings());
        for (const st of w.stops.filter(x => !x.planned)) expect(st.fromSoc).toBeCloseTo(30, 5);
    });

    it('never adds less than the minimum, so there are no 30→37% top-ups', () => {
        for (const p of [profile(), profile(wallOutlet)]) {
            for (const st of simulateWeek(p, settings()).stops) {
                expect(st.toSoc - st.fromSoc).toBeGreaterThanOrEqual(MIN_STOP_ADD - 1e-9);
            }
        }
    });

    it('120 V: a day that starts below "stop to charge by" waits until it is needed, never mile 0', () => {
        const w = simulateWeek(profile(wallOutlet), settings());
        const lateStarts = w.days.filter(d => d.startSoc < 30 && d.stops.some(x => !x.planned));
        expect(lateStarts.length).toBeGreaterThan(0);
        for (const d of lateStarts) expect(d.stops[0].mile).toBeGreaterThan(0);
    });

    it('120 V: never more than two stops a day — the cap stretches to 80% instead of a tiny third', () => {
        const w = simulateWeek(profile(wallOutlet), settings());
        expect(Math.max(...w.days.map(d => d.stops.length))).toBeLessThanOrEqual(2);
        expect(Math.max(...w.stops.map(x => x.toSoc))).toBeLessThanOrEqual(STRETCH_CAP_TO + 1e-9);
        expect(w.stopCount).toBeGreaterThan(simulateWeek(profile(), settings()).stopCount);
    });

    it('keeps the battery above the floor all week', () => {
        for (const p of [profile(), profile(wallOutlet)]) {
            const w = simulateWeek(p, settings());
            expect(Math.min(...w.points.map(([, soc]) => soc))).toBeGreaterThanOrEqual(10 - 1e-6);
        }
    });

    it('summer needs no stops at 48 A', () => {
        expect(simulateWeek(profile(), settings(), { season: 'summer' }).stopCount).toBe(0);
    });

    it('a planned stop below the cap tops up to it, with no detour', () => {
        const w = simulateWeek(profile(wallOutlet), settings());
        const sunday = w.stops.find(x => x.planned);
        expect(sunday.toSoc).toBe(70);
        expect(sunday.minutes).toBeCloseTo(sunday.chargeMinutes + 5, 6);
    });

    it('charges to 100% the night before a long day, and says when a night runs out', () => {
        const w = simulateWeek(profile(), settings());
        expect(w.days[6].night.endSoc).toBe(100); // Sunday night, before Monday's long day
        const slow = simulateWeek(profile(wallOutlet), settings());
        expect(slow.days.some(d => d.night.ranOut)).toBe(true);
    });

    it('prices fast energy with the DC loss and home energy with the charger efficiency', () => {
        const w = simulateWeek(profile(), settings());
        expect(w.fastCost).toBeCloseTo(w.fastKwh * 0.48, 6);
        expect(w.homeCost).toBeCloseTo(w.homeKwh * 0.17, 6);
        expect(w.fastShare).toBeGreaterThan(0);
        expect(w.fastShare).toBeLessThan(0.25);
    });
});

describe('when a planned fast charge happens', () => {
    const at = (week, d) => simulateWeek(profile(wallOutlet), settings({ week, planned: 1 << d })).stops.find(x => x.planned);

    it('at 5 pm on a day off by default, and at the hour set', () => {
        expect(at('LDLDLDO', 6).hour).toBe(6 * 24 + 17);
        expect(simulateWeek(profile(wallOutlet), settings({ plannedHour: 10 })).stops.find(x => x.planned).hour).toBe(6 * 24 + 10);
    });

    it('on a driving day, in the gap between drives nearest the hour', () => {
        // A Daily drives 7–8 and 17–18: 5 pm is the gap before the drive home.
        expect(plannedSlot([{ from: 7, to: 8 }, { from: 17, to: 18 }], 17)).toEqual({ gap: 1, hour: 17 });
        expect(plannedSlot([{ from: 7, to: 8 }, { from: 17, to: 18 }], 12)).toEqual({ gap: 1, hour: 12 });
        // A Long day drives 7–12 and 12–18: 5 pm is nearest the end of it.
        expect(plannedSlot([{ from: 7, to: 12 }, { from: 12, to: 18 }], 17)).toEqual({ gap: 2, hour: 18 });
        expect(plannedSlot([{ from: 7, to: 12 }, { from: 12, to: 18 }], 6)).toEqual({ gap: 0, hour: 6 });
        expect(plannedSlot([], 17)).toEqual({ gap: 0, hour: 17 });
    });

    it('keeps the line running forward wherever the stop lands', () => {
        for (const plannedHour of [0, 6, 12, 17, 23]) {
            for (const p of [profile(), profile(wallOutlet)]) {
                const { points } = simulateWeek(p, settings({ planned: 0b1111111, plannedHour }));
                for (let i = 1; i < points.length; i++) expect(points[i][0]).toBeGreaterThanOrEqual(points[i - 1][0]);
            }
        }
    });
});

describe('the week as a line', () => {
    // A big pack on a modest charger: Sunday night's charge to 100% for
    // Monday's long day runs past midnight, into the next week.
    const bigPack = profile({ usableKwh: 135, home: { kw: 3.84, eff: 0.885 } });

    it('runs forward in time, inside the week, even when Sunday night runs past midnight', () => {
        for (const p of [profile(), bigPack, profile(wallOutlet)]) {
            const { points } = simulateWeek(p, settings());
            for (let i = 1; i < points.length; i++) expect(points[i][0]).toBeGreaterThanOrEqual(points[i - 1][0]);
            expect(points[0][0]).toBe(0);
            expect(points.at(-1)[0]).toBe(7 * 24);
        }
    });

    it('wraps: Monday 0:00 is where Sunday midnight left the battery, mid-charge', () => {
        const { points, days } = simulateWeek(bigPack, settings());
        expect(points[0][1]).toBeCloseTo(points.at(-1)[1], 6);
        expect(points[0][1]).toBeLessThan(days[6].night.endSoc);
    });
});

describe('the gas car', () => {
    it('averages fill-ups a week from the gallons, since one sample week is lumpy', () => {
        const g = simulateGasWeek(settings());
        expect(g.gallons).toBeGreaterThan(30);
        expect(g.fillsPerWeek).toBeCloseTo(g.gallons / (26 * 0.85), 6);
        expect(g.minutesPerWeek).toBeCloseTo(g.fillsPerWeek * 8, 6);
        expect(g.cost).toBeCloseTo(g.gallons * 3.2, 6);
    });
});

describe('a vehicle record', () => {
    const vehicle = {
        socWindowKwh: 75,
        epaRange: { hwyMi: 290 },
        runs: [],
        specs: { charging: { max_ac_kw: 11.5, max_dc_kw: 170 } },
    };

    it('prices from EPA when it has no range test, and says so', () => {
        const p = costToDriveVehicle(vehicle, settings());
        expect(p.missing).toBeNull();
        expect(p.highwayFrom).toBe('epa');
        expect(p.cityFrom).toBe('epa');
        expect(p.fast.basis).toBe('maxDc');
    });

    it('winter costs more energy per mile than summer; summer near the label, which is not re-priced for speed', () => {
        const p = costToDriveVehicle(vehicle, settings());
        const label = 1000 / (290 / 75);
        expect(p.whPerMi.winter.L).toBeGreaterThan(p.whPerMi.summer.L * 1.1);
        expect(p.whPerMi.summer.L / label).toBeGreaterThan(0.95);
        expect(p.whPerMi.summer.L / label).toBeLessThan(1.05);
        expect(costToDriveVehicle(vehicle, settings({ longMph: 80 })).whPerMi.summer.L).toBe(p.whPerMi.summer.L);
    });

    it('takes the lesser of the charger and the onboard charger, and an assumed one when the spec is blank', () => {
        const at80 = costToDriveVehicle(vehicle, settings({ level: 5 }));
        expect(at80.home.kw).toBe(11.5);
        expect(at80.home.capped).toBe(true);
        // 48 A is 11.52 kW at the wall: the same as an 11.5 kW onboard charger, not capped by it.
        expect(costToDriveVehicle(vehicle, settings({ level: 4 })).home.capped).toBe(false);
        const blank = costToDriveVehicle({ ...vehicle, specs: {} }, settings({ level: 0 }));
        expect(blank.home.onboardAssumed).toBe(true);
        expect(blank.home.kw).toBeCloseTo(1.44, 6);
        expect(blank.home.eff).toBe(0.80);
    });

    it('cannot be priced without a usable capacity or any efficiency figure', () => {
        expect(costToDriveVehicle({ ...vehicle, socWindowKwh: null }, settings()).missing).toMatch(/capacity/);
        expect(costToDriveVehicle({ ...vehicle, epaRange: null }, settings()).missing).toMatch(/EPA/);
    });

    it('calibrates the fallback curve to the spec 10→80% time', () => {
        const p = costToDriveVehicle({ ...vehicle, specs: { charging: { charge_time_10_to_80_pct_min: 30 } } }, settings());
        expect(p.fast.basis).toBe('spec');
        expect(p.fast.minutes(10, 80)).toBeCloseTo(30, 6);
    });
});

describe('against the gas car', () => {
    it('a month is a week × 52 ÷ 12, and a year blends the winter months', () => {
        const c = costToDriveComparison(profile(), settings());
        const evWeek = c.winter.fastCost + c.winter.homeCost;
        expect(c.monthly.ev).toBeCloseTo(perMonth(evWeek), 6);
        expect(c.monthly.saved).toBeCloseTo(c.monthly.gas - c.monthly.ev, 6);
        const summerWeek = c.summer.fastCost + c.summer.homeCost;
        expect(c.yearly.ev).toBeCloseTo(perMonth(evWeek) * 4 + perMonth(summerWeek) * 8, 6);
        expect(c.extraMinutesPerWeek).toBeCloseTo(c.week.fastMinutes - c.gas.minutesPerWeek, 6);
    });
});

describe('Home Charger: where a bigger charger stops helping', () => {
    it('is the first level within a few minutes a week of the best', () => {
        // 120 V needs four hours of fast charging, 240 V · 16 A one, the rest about none.
        expect(enoughLevel([242, 68, 4, 2, 0, 0])).toBe(2);
        expect(enoughLevel([242, 68, 9, 4, 0, 0]), "9 minutes is still a stop worth noticing").toBe(3);
        expect(enoughLevel([0, 0, 0, 0, 0, 0])).toBe(0);
    });

    it('skips what could not be priced, and has no answer with nothing priced', () => {
        expect(enoughLevel([null, 30, 3, 0])).toBe(2);
        expect(enoughLevel([null, null])).toBeNull();
    });
});

describe('a time in the week', () => {
    it('is a weekday and a clock time', () => {
        expect(weekTimeText(0)).toBe('Mon 12:00 am');
        expect(weekTimeText(24 + 13 + 40 / 60)).toBe('Tue 1:40 pm');
        expect(weekTimeText(6 * 24 + 12)).toBe('Sun 12:00 pm');
    });
});

describe('no home charging', () => {
    const noHome = { home: { kw: 0, eff: 0.885, none: true } };

    it('is a level of its own, after the six chargers, with no power at home', () => {
        expect(NO_HOME_LEVEL).toBe(HOME_LEVELS.length - 1);
        const p = costToDriveVehicle({ socWindowKwh: 75, epaRange: { mi: 290 }, specs: {} }, settings({ level: NO_HOME_LEVEL }));
        expect(p.home.kw).toBe(0);
        expect(p.home.none).toBe(true);
    });

    it('buys no energy at home: every kWh is a fast charge, at the fast price', () => {
        const w = simulateWeek(profile(noHome), settings());
        expect(w.homeKwh).toBe(0);
        expect(w.homeCost).toBe(0);
        expect(w.fastKwh).toBeGreaterThan(0);
        expect(w.fastCost).toBeCloseTo(w.fastKwh * settings().fastPrice, 6);
        for (const d of w.days) expect(d.night.added).toBe(0);
    });

    it('costs more and takes more time than any home charger, the floor still kept', () => {
        const none = simulateWeek(profile(noHome), settings());
        const outlet = simulateWeek(profile(wallOutlet), settings());
        expect(none.fastMinutes).toBeGreaterThan(outlet.fastMinutes);
        expect(none.stopCount).toBeGreaterThanOrEqual(outlet.stopCount);
        expect(none.fastCost).toBeGreaterThan(outlet.fastCost + outlet.homeCost);
        expect(Math.min(...none.points.map(([, soc]) => soc))).toBeGreaterThanOrEqual(10 - 1e-6);
    });

    it('settles: the pack energy bought over the week covers the energy used', () => {
        const w = simulateWeek(profile(noHome), settings());
        expect(w.fastShare).toBeGreaterThan(0.9);
    });
});
