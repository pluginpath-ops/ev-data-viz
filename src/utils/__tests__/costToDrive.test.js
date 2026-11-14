import { describe, it, expect } from 'vitest';
import {
    simulateWeek, simulateGasWeek, gasColdLoss, gasTripLegs, plannedSlot, costToDriveVehicle, costToDriveComparison, taperMinutes, perMonth, enoughLevel, weekTimeText,
    weekSummary, gasCarName, chargerText, chargingText, homeCostCeiling, plugHours, plugWindows, nightWindow,
} from '../costToDrive';
import { normalizeCostToDrive } from '../costToDriveKey';
import { DEFAULT_COST_TO_DRIVE, GAS_CAR_PRESETS, GAS_CAR_FALLBACK_NAME, MIN_STOP_ADD, STRETCH_CAP_TO, WALL_OUTLET_CHARGER_EFF, HOME_LEVELS, NO_HOME_LEVEL, HOME_LEVEL_ORDER } from '../../constants/costToDrive';
import { ASSUMED_CHARGER_EFF } from '../../constants/epa';

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
// The week these tests were written on: long days between short ones and a
// planned Sunday stop — the default until 2026-11-10, kept because it
// exercises every rule. Today's default (Commuter) rarely fast charges.
const TEST_WEEK = { week: 'LDLDLDO', planned: 0b1000000, dailyMi: 45, dailyCity: 40, longMi: 220, longCity: 15 };
const settings = (over = {}) => normalizeCostToDrive({ ...DEFAULT_COST_TO_DRIVE, ...TEST_WEEK, ...over });
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
        for (const st of w.stops.filter(x => !x.planned)) expect(st.fromSoc).toBeCloseTo(25, 5);
    });

    it('never adds less than the minimum, so there are no 25→32% top-ups', () => {
        for (const p of [profile(), profile(wallOutlet)]) {
            for (const st of simulateWeek(p, settings()).stops) {
                expect(st.toSoc - st.fromSoc).toBeGreaterThanOrEqual(MIN_STOP_ADD - 1e-9);
            }
        }
    });

    it('120 V: a day that starts below "stop to charge by" waits until it is needed, never mile 0', () => {
        const w = simulateWeek(profile(wallOutlet), settings());
        const lateStarts = w.days.filter(d => d.startSoc < 25 && d.stops.some(x => !x.planned));
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
        expect(w.fastCost).toBeCloseTo(w.fastKwh * 0.42, 6);
        expect(w.homeCost).toBeCloseTo(w.homeKwh * 0.17, 6);
        expect(w.fastShare).toBeGreaterThan(0);
        expect(w.fastShare).toBeLessThan(0.25);
    });
});

describe('when a planned fast charge happens', () => {
    const at = (week, d) => simulateWeek(profile(wallOutlet), settings({ week, planned: 1 << d })).stops.find(x => x.planned);

    it('at 5 pm on a day off', () => {
        expect(at('LDLDLDO', 6).hour).toBe(6 * 24 + 17);
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
        for (const week of ['LDLDLDO', 'DDDDDLO', 'LLLLLLL', 'OOOOOOO']) {
            for (const p of [profile(), profile(wallOutlet)]) {
                const { points } = simulateWeek(p, settings({ week, planned: 0b1111111 }));
                // Forward to within float rounding: hours summed from minutes can land 1e-14 apart.
                for (let i = 1; i < points.length; i++) expect(points[i][0]).toBeGreaterThanOrEqual(points[i - 1][0] - 1e-9);
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
        expect(g.minutesPerWeek).toBeCloseTo(g.fillsPerWeek * 5, 6);
        expect(g.cost).toBeCloseTo(g.gallons * 4, 6);
    });

    it('loses mpg in the cold, none from the lab temperature up', () => {
        expect(gasColdLoss(20)).toEqual({ city: 0.15, hwy: 0.07 });
        expect(gasColdLoss(75)).toEqual({ city: 0, hwy: 0 });
        expect(gasColdLoss(95)).toEqual({ city: 0, hwy: 0 });
        expect(gasColdLoss(47.5).city).toBeCloseTo(0.075, 9);
        const summer = simulateGasWeek(settings(), { season: 'summer' });
        const winter = simulateGasWeek(settings(), { season: 'winter' });
        expect(summer.cityMpg).toBe(18);
        expect(winter.cityMpg).toBeLessThan(18 * 0.85);
        expect(winter.gallons).toBeGreaterThan(summer.gallons);
    });
});

describe('the gas car on a road trip (#555)', () => {
    // The default car: 26 gal at 24 mpg highway, fill at 15% left, 5 min a fill-up.
    const car = (over = {}) => normalizeCostToDrive({ ...DEFAULT_COST_TO_DRIVE, ...over });
    const preset = (key) => ({ ...GAS_CAR_PRESETS.find(p => p.key === key).settings, gasCar: key });
    const trip = (settingsOver, distanceMi, speedMph = 70, temperatureF = null) =>
        gasTripLegs(car(settingsOver), { distanceMi, speedMph, temperatureF });

    it('runs from full down to the fill-up level: usable fuel times highway mpg', () => {
        // 26 gal x 85% usable x 24 mpg
        expect(trip({}, 1).rangeMi).toBeCloseTo(530.4, 6);
        // The F-150: 23 gal x 85% x 23 mpg is the "about 450 mi" the issue quotes
        expect(trip(preset('f150'), 1).rangeMi).toBeCloseTo(449.65, 6);
        expect(trip(preset('civic'), 1).rangeMi).toBeCloseTo(12 * 0.85 * 41, 6);
    });

    it('puts each stop at the right mile, one per tankful, none at the finish', () => {
        const t = trip(preset('f150'), 1000);
        expect(t.stops).toBe(2);
        expect(t.stopMi[0]).toBeCloseTo(449.65, 6);
        expect(t.stopMi[1]).toBeCloseTo(899.3, 6);
        expect(t.legs.map(l => l.driveMi).reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 9);
        expect(t.legs.at(-1).driveMi).toBeCloseTo(1000 - 899.3, 6);
        // Exactly one range long: the trip is over where the stop would be.
        expect(trip(preset('f150'), 449.65).stops).toBe(0);
        expect(trip(preset('f150'), 449.65 + 5).stops).toBe(1);
    });

    it('times a trip as driving plus each stop at the fill-up\'s own minutes, never the EV overhead', () => {
        const t = trip({}, 700, 70);
        expect(t.stops).toBe(1);
        expect(t.stopMin).toBe(5);
        expect(t.driveMin).toBeCloseTo(600, 9);
        expect(t.totalMin).toBeCloseTo(605, 9);
        // The fill-up's own setting moves it; nothing else is read for a stop.
        expect(trip({ gasFillMin: 12 }, 700, 70).totalMin).toBeCloseTo(612, 9);
        // (settings, trip): there is no overhead argument to pass
        expect(gasTripLegs.length).toBe(2);
    });

    it('speed sets how long a leg takes, not where the stops fall', () => {
        const slow = trip(preset('civic'), 1200, 55), fast = trip(preset('civic'), 1200, 80);
        expect(slow.stopMi).toEqual(fast.stopMi);
        expect(slow.stops).toBe(2);
        expect(slow.totalMin).toBeGreaterThan(fast.totalMin);
        expect(fast.totalMin).toBeCloseTo(1200 / 80 * 60 + 2 * 5, 9);
    });

    it('a car with a huge tank makes no stop, and a short trip makes none either', () => {
        // The sliders' biggest tank at their best mpg: 40 gal x 85% x 60 mpg = 2,040 mi
        const huge = { gasTank: 40, gasHwy: 60 };
        expect(trip(huge, 2000).stops).toBe(0);
        expect(trip(huge, 2000).totalMin).toBeCloseTo(2000 / 70 * 60, 9);
        expect(trip({}, 500).stops).toBe(0);
        expect(trip({}, 0).legs).toEqual([]);
        expect(trip({}, 0).totalMin).toBe(0);
    });

    it('is full after a stop, at the fill-up level before the next, and what is left at the finish', () => {
        const t = trip(preset('f150'), 600);
        expect(t.legs).toHaveLength(2);
        expect(t.legs[0].fuelLeft).toBeCloseTo(0.15, 9);
        // 150.35 mi left to drive from a full 23 gal tank at 23 mpg
        expect(t.legs[1].fuelLeft).toBeCloseTo((23 - 150.35 / 23) / 23, 9);
    });

    it('takes no cold loss unless it is given a temperature, then the highway share of Cost & Time\'s', () => {
        const none = trip({}, 1000), lab = trip({}, 1000, 70, 75), cold = trip({}, 1000, 70, 20);
        expect(none.hwyMpg).toBe(24);
        expect(lab.hwyMpg).toBe(24);
        expect(cold.hwyMpg).toBeCloseTo(24 * (1 - gasColdLoss(20).hwy), 9);
        expect(cold.rangeMi).toBeCloseTo(none.rangeMi * 0.93, 6);
        expect(cold.stops).toBeGreaterThan(none.stops);
        // 70°F, the standard conditions a corrected chart defaults to: a sliver
        expect(trip({}, 1000, 70, 70).hwyMpg).toBeCloseTo(24 * (1 - 0.07 * 5 / 55), 9);
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

    it("uses the car's own EPA 240 V figure, and scales 120 V by it", () => {
        const own = { ...vehicle, epaRange: { ...vehicle.epaRange, chargerEfficiency: 0.91 } };
        const at240 = costToDriveVehicle(own, settings({ level: 4 })).home;
        expect(at240.eff).toBe(0.91);
        expect(at240.effFrom).toBe('epa');
        expect(costToDriveVehicle(own, settings({ level: 0 })).home.eff).toBeCloseTo(0.91 * WALL_OUTLET_CHARGER_EFF / ASSUMED_CHARGER_EFF, 9);
        const site = costToDriveVehicle(vehicle, settings({ level: 4 })).home;
        expect(site.eff).toBe(ASSUMED_CHARGER_EFF);
        expect(site.effFrom).toBe('assumed');
        expect(costToDriveVehicle(vehicle, settings({ level: 0 })).home.eff).toBeCloseTo(WALL_OUTLET_CHARGER_EFF, 9);
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

describe('the week and the gas car in words', () => {
    const plain = (over) => normalizeCostToDrive({ ...DEFAULT_COST_TO_DRIVE, ...over });
    // Read with plain spaces; the phrases are held together with no-break ones.
    const summary = (s) => weekSummary(s).replace(/\u00a0/g, ' ');

    it('counts days in numerals, with each kind\'s miles, the commonest first', () => {
        expect(summary(plain())).toBe('255 mi per week · 5 days 35 mi, 1 day 80 mi, 1 day off');
        expect(summary(plain({ week: 'LLDLLDO', dailyMi: 45, longMi: 220 }))).toBe('970 mi per week · 4 days 220 mi, 2 days 45 mi, 1 day off');
        // Two kinds at the same miles read as one.
        expect(summary(plain({ week: 'DDDDDLL', dailyMi: 50, longMi: 50 }))).toBe('350 mi per week · 7 days 50 mi');
        expect(summary(plain({ week: 'OOOOOOO' }))).toBe('0 mi per week · 7 days off');
    });

    it('names the gas car: the picked one, else the reader\'s, else Your gas car', () => {
        expect(weekSummary(plain())).not.toMatch(/\d day/);
        expect(gasCarName(plain())).toBe('Your gas car');
        expect(GAS_CAR_FALLBACK_NAME).toBe('Your gas car');
        expect(gasCarName(plain({ gasCar: 'civic' }))).toBe('Civic');
        expect(gasCarName(plain({ gasName: 'My Accord' }))).toBe('My Accord');
        expect(gasCarName(plain({ gasName: '   ' }))).toBe('Your gas car');
        // A picked car wins over a name typed earlier.
        expect(gasCarName(plain({ gasCar: 'pilot', gasName: 'My Accord' }))).toBe('Pilot');
    });

    it('names a charger by level and power, and says what charging was priced at', () => {
        const words = (t) => t.replace(/\u00a0/g, ' ');
        expect(words(chargerText(HOME_LEVELS[0]))).toBe('L1 1.4 kW');
        expect(words(chargerText(HOME_LEVELS[4]))).toBe('L2 11.5 kW');
        expect(words(chargingText(plain(), HOME_LEVELS[4]))).toBe('L2 11.5 kW at $0.17/kWh · fast charging at $0.42/kWh');
        expect(words(chargingText(plain({ homePrice: 0.31 })))).toBe('home at $0.31/kWh · fast charging at $0.42/kWh');
        expect(words(chargingText(plain(), HOME_LEVELS[NO_HOME_LEVEL]))).toBe('no home charging · fast charging at $0.42/kWh');
        // Wraps only between phrases.
        expect(chargingText(plain()).split(' ')).toHaveLength(3);
    });
});

describe('no home charging', () => {
    const noHome = { home: { kw: 0, eff: 0.885, none: true } };

    it('is shown first, then the chargers smallest to largest, each level once', () => {
        expect(HOME_LEVEL_ORDER[0]).toBe(NO_HOME_LEVEL);
        expect([...HOME_LEVEL_ORDER].sort((a, b) => a - b)).toEqual(HOME_LEVELS.map((_, i) => i));
        const kw = HOME_LEVEL_ORDER.slice(1).map(i => HOME_LEVELS[i].volts * HOME_LEVELS[i].amps);
        expect(kw).toEqual([...kw].sort((a, b) => a - b));
    });

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

describe('the most home charging could cost', () => {
    it('is the charger at full power through the plug-in window every night, a month of them, at the home price', () => {
        // 48 A: 11.52 kW × 9 h (10 pm to 7 am) × 7 nights × 52 ÷ 12 × $0.17.
        const p = costToDriveVehicle({ socWindowKwh: 75, epaRange: { mi: 290 }, specs: { charging: { max_ac_kw: 19.2 } } }, settings({ level: 4 }));
        expect(homeCostCeiling(p, settings({ level: 4 }))).toBeCloseTo(11.52 * 9 * 7 * (52 / 12) * 0.17, 6);
    });

    it('stops at the onboard charger where the car cannot take the charger\'s power', () => {
        const car = (kw) => costToDriveVehicle({ socWindowKwh: 75, epaRange: { mi: 290 }, specs: { charging: { max_ac_kw: kw } } }, settings({ level: 5 }));
        const s = settings({ level: 5 });
        expect(homeCostCeiling(car(7.7), s)).toBeCloseTo(perMonth(7 * 7.7 * 9 * 0.17), 6);
        expect(homeCostCeiling(car(7.7), s)).toBeLessThan(homeCostCeiling(car(11.5), s));
    });

    it('follows the plug-in window and the home price, and counts a window that wraps past midnight', () => {
        const p = profile();
        expect(plugHours(settings({ plugFrom: 22, plugUntil: 7 }))).toBe(9);
        expect(plugHours(settings({ plugFrom: 7, plugUntil: 22 }))).toBe(15);
        expect(plugHours(settings({ plugFrom: 7, plugUntil: 7 }))).toBe(24);
        expect(homeCostCeiling(p, settings({ plugFrom: 20, plugUntil: 7, homePrice: 0.2 })))
            .toBeCloseTo(perMonth(7 * 11.5 * 11 * 0.2), 6);
    });

    it('is none with no home charging', () => {
        expect(homeCostCeiling({ home: { kw: 0, eff: 0.885, none: true } }, settings())).toBeNull();
    });

    it('is never less than the home cost the week is priced at, at any level', () => {
        // The bars carry the home part and the line the ceiling over it: a bar through its line would be a bug in one of them.
        for (const [level, { volts, amps, none }] of HOME_LEVELS.entries()) {
            const s = settings({ level });
            const p = profile({ home: { kw: Math.min(volts * amps / 1000, 11.5), eff: 0.885, none: !!none } });
            const ceiling = homeCostCeiling(p, s);
            if (none) { expect(ceiling).toBeNull(); continue; }
            expect(perMonth(simulateWeek(p, s).homeCost)).toBeLessThanOrEqual(ceiling + 1e-6);
        }
    });
});

describe('the margin a night has', () => {
    const night = (kw, over = {}) => simulateWeek(profile({ home: { kw, eff: 0.885 } }), settings(over)).days;

    it('records the hours the charger ran and the most the night\'s window could add at full power', () => {
        for (const d of night(11.5)) {
            expect(d.night.mostAdd).toBeCloseTo(11.5 * d.night.window * 0.885 / 75 * 100, 6);
            expect(d.night.hours).toBeLessThanOrEqual(d.night.window + 1e-9);
            // What was added is what the hours bought, never more than the most.
            expect(d.night.added).toBeCloseTo(d.night.hours / d.night.window * d.night.mostAdd, 6);
            expect(d.night.added).toBeLessThanOrEqual(d.night.mostAdd + 1e-9);
        }
    });

    it('a night the window cut short has used all of it, and added exactly the most', () => {
        const cut = night(1.44).filter(d => d.night.ranOut);
        expect(cut.length).toBeGreaterThan(0);
        for (const d of cut) {
            expect(d.night.hours).toBeCloseTo(d.night.window, 6);
            expect(d.night.added).toBeCloseTo(d.night.mostAdd, 6);
        }
    });

    it('a bigger charger has more margin: the same night finishes sooner', () => {
        const small = night(3.84), big = night(11.5);
        small.forEach((d, i) => {
            if (d.night.added >= 0.5 && !d.night.ranOut) expect(big[i].night.hours).toBeLessThan(d.night.hours + 1e-9);
        });
    });

    it('has no window to have margin in without a home charger', () => {
        const w = simulateWeek(profile({ home: { kw: 0, eff: 0.885, none: true } }), settings());
        expect(w.windows).toEqual([]);
        expect(w.days.every(d => d.night.mostAdd === 0 && d.night.hours === 0)).toBe(true);
    });

    it('draws each night as a span of the week, the charger\'s hours first and the spare time after', () => {
        const spans = plugWindows([0, 1, 2, 3, 4, 5, 6].map(() => ({ from: 22, window: 9, hours: 3 })));
        // Monday night is 22:00 to 7:00 Tuesday; the charger ran three hours of it.
        expect(spans[0]).toEqual({ from: 22, to: 31, spareFrom: 25 });
        // Sunday night runs past the week's end: cut there, the rest from Monday 0:00.
        expect(spans.slice(-2)).toEqual([
            { from: 6 * 24 + 22, to: 168, spareFrom: 168 },
            { from: 0, to: 7, spareFrom: 1 },
        ]);
        // A charger that used the whole window leaves none spare.
        expect(plugWindows([{ from: 22, window: 9, hours: 9 }])[0].spareFrom).toBe(31);
    });

    it('draws a night where the car could charge: from when it was home, and from tomorrow\'s window when today\'s had closed', () => {
        // Home at 18:00 into a window that opened at 15:00 and ends at 7:00.
        expect(plugWindows([{ from: 18, window: 13, hours: 3.5 }])).toEqual([{ from: 18, to: 31, spareFrom: 21.5 }]);
        // Tomorrow's window, 1 to 7 am the morning after: on Sunday that is all of Monday morning.
        const nights = [0, 1, 2, 3, 4, 5, 6].map(() => ({ from: 25, window: 6, hours: 2 }));
        expect(plugWindows(nights)[0]).toEqual({ from: 25, to: 31, spareFrom: 27 });
        expect(plugWindows(nights).at(-1)).toEqual({ from: 1, to: 7, spareFrom: 3 });
    });

    it('the week returns its windows, one a night, matching the nights\' hours', () => {
        const w = simulateWeek(profile(), settings());
        // Sunday night is cut in two, so a night more than seven spans.
        expect(w.windows.length).toBe(8);
        expect(w.windows[0].spareFrom - w.windows[0].from).toBeCloseTo(w.days[0].night.hours, 6);
    });
});

describe('which plug-in window a night charges in', () => {
    const win = (plugFrom, plugUntil, arrive, minK) => nightWindow(settings({ plugFrom, plugUntil }), arrive, minK);

    it('a window that opens after the car is home: it waits, and charges from plugFrom', () => {
        expect(win(22, 7, 18)).toEqual({ k: 0, from: 22, hours: 9 });
    });

    it('a car home inside the window charges from then, to the window\'s end', () => {
        expect(win(15, 7, 18)).toEqual({ k: 0, from: 18, hours: 13 });
        // Late: a stop kept it out until 11 pm.
        expect(win(22, 7, 23)).toEqual({ k: 0, from: 23, hours: 8 });
        // The minute the window opens is the whole of it.
        expect(win(22, 7, 22)).toEqual({ k: 0, from: 22, hours: 9 });
    });

    it('a window that closed before the car got home is tomorrow\'s: 1 to 7 am, home at 6 pm, charges from 1 am the morning after', () => {
        expect(win(1, 7, 18)).toEqual({ k: 1, from: 25, hours: 6 });
        // Home as it closes is too late for it.
        expect(win(1, 7, 7)).toEqual({ k: 1, from: 25, hours: 6 });
    });

    it('a window that opens after a day off begins is that day\'s own', () => {
        expect(win(1, 7, 0)).toEqual({ k: 0, from: 1, hours: 6 });
    });

    it('never gives a window to two nights: the one after a night in tomorrow\'s window starts there too', () => {
        // Friday used Saturday's 1 to 7 am; Saturday, a day off, is home from the 3 am the charge ended.
        expect(win(1, 7, 3)).toEqual({ k: 0, from: 3, hours: 4 });
        expect(win(1, 7, 3, 1)).toEqual({ k: 1, from: 25, hours: 6 });
    });

    it('the same hour twice is open all day: from when the car is home, to that hour', () => {
        expect(win(7, 7, 18)).toEqual({ k: 0, from: 18, hours: 13 });
    });
});

describe('a night starts when the car is home, not when the window opens', () => {
    // 240 V · 16 A (3.84 kW) into 75 kWh: 4.5312% an hour.
    const kw = 3.84, perHour = kw * 0.885 / 75 * 100;
    const slow = profile({ home: { kw, eff: 0.885 } });
    // Home at 18:00 every driving day (the last drive ends then), no stops.
    const commuter = (over = {}) => settings({ week: 'DDDDDLO', planned: 0, dailyMi: 35, dailyCity: 50, ...over });

    it('plugged in from 3 pm, home at 6 pm: the charge runs 6 pm to ready, and ready is counted from 6 pm', () => {
        const w = simulateWeek(slow, commuter({ plugFrom: 15, plugUntil: 7 }));
        const mon = w.days[0];
        expect(mon.night.from).toBe(18);
        expect(mon.night.window).toBe(13);
        // 35 mi at 323 Wh/mi out of 75 kWh, put back.
        expect(mon.night.added).toBeCloseTo(35 * 323 / 1000 / 75 * 100, 6);
        expect(mon.night.hours).toBeCloseTo(mon.night.added / perHour, 6);
        expect(mon.night.fullAt).toBeCloseTo(18 + mon.night.hours, 6);
        expect(mon.night.fullAt).toBeGreaterThan(21.3);
        expect(mon.night.fullAt).toBeLessThan(21.4);
        // The line charges over those hours, from the moment it is home.
        expect(w.points).toContainEqual([18, mon.homeSoc]);
        expect(w.points.some(([x]) => Math.abs(x - (18 + mon.night.hours)) < 1e-9)).toBe(true);
    });

    it('every night has only its own window to add in, and the table\'s spare time and the window drawn on the line agree', () => {
        const w = simulateWeek(slow, commuter({ plugFrom: 15, plugUntil: 7 }));
        w.days.slice(0, 5).forEach((d, i) => {
            expect(d.night.mostAdd).toBeCloseTo(13 * perHour, 6);
            expect(w.windows[i].from).toBe(i * 24 + 18);
            expect(w.windows[i].spareFrom - w.windows[i].from).toBeCloseTo(d.night.hours, 6);
            expect(w.windows[i].to - w.windows[i].from).toBeCloseTo(d.night.window, 6);
        });
    });

    it('a night the shorter window cannot finish runs out, though the whole window could have', () => {
        // One 50 mi drive a week: 21.5% out, and 120 V puts back 1.536% an hour.
        // Home at 6 pm into a window that ends at 7 am it has 13 h, 19.97%; the 16 h from 3 pm would have been 24.6%.
        const p = profile(wallOutlet);
        const w = simulateWeek(p, settings({ week: 'DOOOOOO', planned: 0, dailyMi: 50, plugFrom: 15, plugUntil: 7 }));
        const mon = w.days[0];
        expect(mon.night.ranOut).toBe(true);
        expect(mon.night.fullAt).toBeNull();
        expect(mon.night.hours).toBeCloseTo(13, 6);
        expect(mon.night.added).toBeCloseTo(13 * 1.44 * 0.80 / 75 * 100, 6);
        expect(mon.night.added).toBeLessThan(50 * 323 / 1000 / 75 * 100);
        // Tuesday has the whole 3 pm to 7 am: it makes up the rest.
        expect(w.days[1].night.ranOut).toBe(false);
        expect(w.days[1].night.window).toBe(16);
    });

    it('a car kept out past plugFrom loses those hours: two long road stops put it home after 10 pm, and 22 → 7 has less than 9 h', () => {
        // Long days, each with two road stops of two hours' charge, 10 min detour and 5 min to start.
        const p = profile({ home: { kw, eff: 0.885 }, fast: { basis: 'test', minutes: () => 120 } });
        const w = simulateWeek(p, settings({ week: 'LLLLLLL', planned: 0, plugFrom: 22, plugUntil: 7 }));
        for (const d of w.days) {
            expect(d.stops.length).toBe(2);
            expect(d.night.from).toBeGreaterThan(22);
            // The window still ends at 7 am: what is lost is the hours before the car was home.
            expect(d.night.from + d.night.window).toBeCloseTo(31, 6);
            expect(d.night.mostAdd).toBeCloseTo(d.night.window * perHour, 6);
            expect(d.night.mostAdd).toBeLessThan(9 * perHour);
            expect(d.night.hours).toBeLessThanOrEqual(d.night.window + 1e-9);
        }
    });

    it('Ready at counts from when the car was plugged in, not from when the window opened', () => {
        // Home at 6 pm into a window open from 3 pm: ready is 6 pm plus the charging hours, whatever time the window opened.
        const w = simulateWeek(slow, commuter({ plugFrom: 15, plugUntil: 7 }));
        for (const d of w.days.slice(0, 5)) expect(d.night.fullAt).toBeCloseTo((18 + d.night.hours) % 24, 6);
    });

    it('a window that opens after the car is home is unchanged: 10 pm, the whole 9 hours', () => {
        const w = simulateWeek(slow, commuter({ plugFrom: 22, plugUntil: 7 }));
        w.days.slice(0, 5).forEach(d => {
            expect(d.night.from).toBe(22);
            expect(d.night.window).toBe(9);
            expect(d.night.mostAdd).toBeCloseTo(plugHours(settings({ plugFrom: 22, plugUntil: 7 })) * perHour, 6);
        });
    });
});

describe('a window that closed before the car got home', () => {
    const p = profile();
    // Drives 7–8 and 17–18, then charges 1 to 7 am the morning after.
    const s = settings({ week: 'DDDDDOO', planned: 0, plugFrom: 1, plugUntil: 7 });

    it('charges in tomorrow\'s window: 1 am the morning after, never the hours it spent at home before', () => {
        const w = simulateWeek(p, s);
        for (const d of w.days) {
            expect(d.night.from).toBe(25);
            expect(d.night.window).toBe(6);
        }
        // Monday night is Tuesday 1 to 7 am; Sunday night is the start of Monday's week.
        expect(w.windows[0].from).toBe(25);
        expect(w.windows[0].to).toBe(31);
        expect(w.windows.at(-1).from).toBe(1);
        expect(w.windows.at(-1).to).toBe(7);
        // Ready between 1 and 7 am, and the day after starts no earlier than that.
        const mon = w.days[0].night;
        expect(mon.fullAt).toBeGreaterThan(1);
        expect(mon.fullAt).toBeLessThan(7);
    });

    it('no window serves two nights, a day off included', () => {
        const w = simulateWeek(p, s);
        const spans = [...w.windows].sort((a, b) => a.from - b.from);
        for (let i = 1; i < spans.length; i++) expect(spans[i].from).toBeGreaterThanOrEqual(spans[i - 1].to - 1e-9);
        // Seven nights, seven windows (Sunday's lands wholly in Monday morning, so none is cut in two).
        expect(w.windows.length).toBe(7);
    });

    it('the night before a long day still charges to 100% in the window before it', () => {
        // Friday is a day off, Saturday long; fullBeforeLong asks Friday night for 100%.
        const week = simulateWeek(p, settings({ week: 'DDDDOLO', planned: 0, plugFrom: 1, plugUntil: 7 }));
        expect(week.days[4].night.endSoc).toBe(100);
        // The window it used is Saturday's 1 to 7 am, the one just before the long day.
        expect(week.days[4].night.from).toBe(25);
    });
});

describe('the week as a line, whatever the plug-in window', () => {
    // The shapes a window takes: wraps midnight, opens before the car is home,
    // already closed when it is, short, daytime, and all day.
    const windows = [[22, 7], [15, 7], [1, 7], [0, 6], [19, 23], [23, 5], [7, 22], [7, 7]];
    const weeks = ['LDLDLDO', 'DDDDDLO', 'OOOOOOO', 'LLLLLLL'];
    const cars = [profile(), profile(wallOutlet), profile({ usableKwh: 135, home: { kw: 3.84, eff: 0.885 } })];

    it('runs forward in time and ends at the week\'s end', () => {
        for (const [plugFrom, plugUntil] of windows) for (const week of weeks) for (const p of cars) {
            const { points } = simulateWeek(p, settings({ week, plugFrom, plugUntil }));
            for (let i = 1; i < points.length; i++) expect(points[i][0]).toBeGreaterThanOrEqual(points[i - 1][0] - 1e-9);
            expect(points[0][0]).toBe(0);
            expect(points.at(-1)[0]).toBe(7 * 24);
            expect(points[0][1]).toBeCloseTo(points.at(-1)[1], 6);
        }
    });

    it('every night\'s window ends at plugUntil, holds its charging hours, and stays inside the week', () => {
        for (const [plugFrom, plugUntil] of windows) for (const week of weeks) for (const p of cars) {
            const w = simulateWeek(p, settings({ week, plugFrom, plugUntil }));
            for (const d of w.days) {
                const end = d.night.from + d.night.window;
                expect(((end - plugUntil) % 24 + 24) % 24).toBeLessThan(1e-9);
                expect(d.night.hours).toBeLessThanOrEqual(d.night.window + 1e-9);
                expect(d.night.from).toBeGreaterThanOrEqual(plugFrom - 1e-9);
            }
            for (const x of w.windows) {
                expect(x.from).toBeGreaterThanOrEqual(0);
                expect(x.to).toBeLessThanOrEqual(7 * 24);
                expect(x.from).toBeLessThanOrEqual(x.spareFrom + 1e-9);
                expect(x.spareFrom).toBeLessThanOrEqual(x.to + 1e-9);
            }
        }
    });
});
