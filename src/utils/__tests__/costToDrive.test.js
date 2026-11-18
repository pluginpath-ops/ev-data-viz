import { describe, it, expect } from 'vitest';
import {
    simulateWeek, simulateGasWeek, gasColdLoss, gasTripLegs, plannedSlot, costToDriveVehicle, phantomDrainOf, costToDriveComparison, taperMinutes, perMonth, enoughLevel, weekTimeText,
    weekSummary, gasCarName, chargerText, chargingText, homeCostCeiling, plugHours, plugWindows,
    chargeInCheapestHours, homePricing, rateSeason, ratePlanName, windowOf, rateTiers, chargingTiers, homeTierOrder, fastIsAssumed,
} from '../costToDrive';
import { RATE_PLANS } from '../../constants/ratePlans';
import { normalizeCostToDrive } from '../costToDriveKey';
import { DEFAULT_COST_TO_DRIVE, GAS_CAR_PRESETS, GAS_CAR_FALLBACK_NAME, MIN_STOP_ADD, STRETCH_CAP_TO, PACK_WARMING_BELOW_F, HOME_LEVELS, NO_HOME_LEVEL, HOME_LEVEL_ORDER } from '../../constants/costToDrive';
import { ASSUMED_CHARGER_EFF, BATTERY_WARMING_KWH, DC_FAST_LOSS, FIXED_DRAW_W } from '../../constants/epa';

// A Model Y-ish profile with fixed numbers, so the rule is tested apart from
// how a vehicle record resolves: 75 kWh, 340 Wh/mi on a long day in winter.
// Warming's efficiency is the charging one unless a test sets it, so a test
// reads one figure.
const profile = (over = {}) => {
    const p = {
        usableKwh: 75,
        missing: null,
        whPerMi: { winter: { D: 323, L: 332 }, summer: { D: 250, L: 260 } },
        home: { kw: 11.5, eff: 0.885 },
        // Battery warming at the default guess for a 75 kWh pack.
        warmKwhPerF: 0.002 * 75,
        fast: { basis: 'maxDc', minutes: (a, b) => taperMinutes(75, 170, a, b) },
        ...over,
    };
    return { ...p, home: { warmEff: p.home.eff, ...p.home } };
};
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
        // A stop that closes the week may charge further.
        expect(Math.max(...w.stops.filter(x => !x.closesWeek).map(x => x.toSoc))).toBeLessThanOrEqual(STRETCH_CAP_TO + 1e-9);
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
        // 120 V in summer, Monday not a Long day (so the week starts at 80%):
        // Sunday night brings 70% back past it, so the planned stop is only that.
        const w = simulateWeek(profile(wallOutlet), settings({ season: 'summer', week: 'DLDLDLO' }));
        const sunday = w.stops.find(x => x.planned);
        expect(sunday.closesWeek).toBe(false);
        expect(sunday.toSoc).toBe(70);
        expect(sunday.minutes).toBeCloseTo(sunday.chargeMinutes + 5, 6);
    });

    describe('closes: Monday morning, the week ends where it started', () => {
        const mondayAfter = (w) => w.days[6].night.endSoc;
        const cases = {
            '48 A': profile(),
            '120 V': profile(wallOutlet),
            '120 V, a big pack': profile({ ...wallOutlet, usableKwh: 135, warmKwhPerF: 0.002 * 135 }),
            'no home charging': profile({ home: { kw: 0, eff: 0.885, none: true } }),
        };
        for (const [name, p] of Object.entries(cases)) {
            it(name, () => {
                for (const over of [{}, { winterF: -20 }, { season: 'summer' }]) {
                    const w = simulateWeek(p, settings(over));
                    const start = w.days[0].startSoc;
                    expect(mondayAfter(w)).toBeGreaterThanOrEqual(start - 0.5);
                    // Never with time to spare: within one smallest stop of it.
                    expect(mondayAfter(w)).toBeLessThanOrEqual(start + MIN_STOP_ADD + 1e-6);
                    expect(Math.min(...w.points.map(([, soc]) => soc))).toBeGreaterThanOrEqual(10 - 1e-6);
                }
            });
        }

        it('starts Monday at Charge to (100% before a Long Monday), or the cap with no home charging', () => {
            expect(simulateWeek(profile(), settings()).days[0].startSoc).toBe(100);
            expect(simulateWeek(profile(), settings({ week: 'DLDLDLO' })).days[0].startSoc).toBe(settings().chargeTo);
            expect(simulateWeek(profile({ home: { kw: 0, eff: 0.885, none: true } }), settings()).days[0].startSoc).toBe(settings().capTo);
        });

        it('a week that closes on its own is left alone', () => {
            const w = simulateWeek(profile(), settings({ season: 'summer' }));
            expect(w.stops.some(x => x.closesWeek)).toBe(false);
        });

        it('charges an existing stop further rather than adding one', () => {
            const s = settings({ winterF: 15 });
            const p = profile(wallOutlet);
            const w = simulateWeek(p, s);
            const closing = w.stops.filter(x => x.closesWeek);
            expect(closing.length).toBeGreaterThan(0);
            // The week's last stop, charged further: no stop added.
            expect(closing).toEqual([w.stops.at(-1)]);
            // Its charge reaches Monday: every night after it, before Sunday's, ran out.
            for (let i = closing[0].day; i < 6; i++) expect(w.days[i].night.ranOut).toBe(true);
        });

        it('with no stop to extend, adds one after a driving day, with the detour', () => {
            // 48 A with one-hour nights that never refill, and no day low enough to stop.
            const s = settings({ plugFrom: 1, plugUntil: 2, week: 'DDDDDDD', planned: 0, dailyMi: 60, season: 'summer' });
            const w = simulateWeek(profile(), s);
            const closing = w.stops.filter(x => x.closesWeek);
            expect(closing).toHaveLength(1);
            expect(closing[0].planned).toBe(false);
            expect(closing[0].minutes).toBeCloseTo(closing[0].chargeMinutes + s.detourMin + s.startMin, 6);
            expect(mondayAfter(w)).toBeGreaterThanOrEqual(w.days[0].startSoc - 0.5);
        });
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
        expect(p.cityFrom).toBe('highway');   // no city figure on this one
        expect(p.fast.basis).toBe('maxDc');
    });

    it('prices city miles from the EPA city figure, highway miles unchanged', () => {
        const withCity = { ...vehicle, epaRange: { hwyMi: 290, cityMi: 350 } };
        const p = costToDriveVehicle(withCity, settings());
        const q = costToDriveVehicle(vehicle, settings());
        expect(p.cityFrom).toBe('epa');
        expect(p.whPerMi.summer.D).toBeLessThan(q.whPerMi.summer.D);
        // All highway: the city figure plays no part.
        const allHwy = settings({ dailyCity: 0 });
        expect(costToDriveVehicle(withCity, allHwy).whPerMi.summer.D).toBeCloseTo(costToDriveVehicle(vehicle, allHwy).whPerMi.summer.D, 9);
        // All city, at the lab's own conditions: near the city label.
        const allCity = costToDriveVehicle(withCity, settings({ dailyCity: 100 })).whPerMi.summer.D;
        expect(allCity / (1000 / (350 / 75))).toBeGreaterThan(0.95);
        expect(allCity / (1000 / (350 / 75))).toBeLessThan(1.05);
    });

    it('winter costs more energy per mile than summer; summer near the label, which is not re-priced for speed', () => {
        const p = costToDriveVehicle(vehicle, settings());
        const label = 1000 / (290 / 75);
        expect(p.whPerMi.winter.L).toBeGreaterThan(p.whPerMi.summer.L * 1.1);
        expect(p.whPerMi.summer.L / label).toBeGreaterThan(0.95);
        expect(p.whPerMi.summer.L / label).toBeLessThan(1.05);
        expect(costToDriveVehicle(vehicle, settings({ longMph: 80 })).whPerMi.summer.L).toBe(p.whPerMi.summer.L);
    });

    // η(P) = η_ref − P₀(1/P − 1/P_ref), P₀ = FIXED_DRAW_W / 1000.
    const effAt = (effRef, kw, refKw) => effRef - (FIXED_DRAW_W / 1000) * (1 / kw - 1 / refKw);
    const effOf = (v, level) => costToDriveVehicle(v, settings({ level })).home.eff;

    it('lowers the charger efficiency below the car\'s full AC power, by its fixed draw', () => {
        // The default car: 11.5 kW onboard, the site-wide 88.5%, 200 W.
        expect(FIXED_DRAW_W).toBe(200);
        expect(ASSUMED_CHARGER_EFF).toBe(0.885);
        expect(effOf(vehicle, 0)).toBeCloseTo(0.7635, 4);  // 120 V · 12 A
        expect(effOf(vehicle, 1)).toBeCloseTo(0.850, 3);   // 240 V · 16 A
        expect(effOf(vehicle, 3)).toBeCloseTo(0.876, 3);   // 240 V · 32 A
        expect(effOf(vehicle, 4)).toBeCloseTo(0.885, 3);   // 48 A: 11.52 kW, capped at 11.5
        expect(effOf(vehicle, 5)).toBe(0.885);             // 80 A, capped at P_ref
        for (const level of [0, 1, 2, 3]) {
            const kw = HOME_LEVELS[level].volts * HOME_LEVELS[level].amps / 1000;
            expect(effOf(vehicle, level)).toBeCloseTo(effAt(0.885, kw, 11.5), 12);
        }
    });

    it('a car charging at its own onboard charger\'s power gets its full-power figure', () => {
        const at7 = { ...vehicle, specs: { charging: { max_ac_kw: 7.68 } } };
        expect(effOf(at7, 3)).toBeCloseTo(0.885, 12);       // 32 A = 7.68 kW
        expect(effOf(at7, 5)).toBeCloseTo(0.885, 12);       // 80 A, capped
        expect(effOf(at7, 1)).toBeCloseTo(effAt(0.885, 3.84, 7.68), 12);
    });

    it('takes 11.5 kW as the full power when max AC kW is blank', () => {
        const blank = { ...vehicle, specs: {} };
        expect(costToDriveVehicle(blank, settings({ level: 0 })).home.onboardKw).toBe(11.5);
        expect(effOf(blank, 0)).toBeCloseTo(effAt(0.885, 1.44, 11.5), 12);
        expect(effOf(blank, 5)).toBeCloseTo(0.885, 12);
    });

    it("starts from the car's own EPA figure where it has one", () => {
        const own = { ...vehicle, chargerEfficiency: { value: 0.91, basis: 'epa' } };
        const full = costToDriveVehicle(own, settings({ level: 5 })).home;
        expect(full.eff).toBe(0.91);
        expect(full.effRef).toBe(0.91);
        expect(full.effFrom).toBe('epa');
        expect(effOf(own, 0)).toBeCloseTo(effAt(0.91, 1.44, 11.5), 12);
        const site = costToDriveVehicle(vehicle, settings({ level: 5 })).home;
        expect(site.effRef).toBe(ASSUMED_CHARGER_EFF);
        expect(site.effFrom).toBe('assumed');
        const gn = costToDriveVehicle({ ...vehicle, chargerEfficiency: { value: 0.8745, basis: 'green-ncap' } }, settings({ level: 5 })).home;
        expect(gn.effRef).toBe(0.8745);
        expect(gn.effFrom).toBe('green-ncap');
    });

    it('no home charging keeps the full-power figure and buys nothing at home', () => {
        const p = costToDriveVehicle(vehicle, settings({ level: NO_HOME_LEVEL }));
        expect(p.home.eff).toBe(0.885);
        expect(simulateWeek(p, settings({ level: NO_HOME_LEVEL })).homeKwh).toBe(0);
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
    });

    it('battery warming scales with the usable pack', () => {
        expect(costToDriveVehicle(vehicle, settings()).warmKwhPerF).toBeCloseTo(BATTERY_WARMING_KWH * 75, 12);
        expect(costToDriveVehicle({ ...vehicle, socWindowKwh: 135 }, settings()).warmKwhPerF).toBeCloseTo(BATTERY_WARMING_KWH * 135, 12);
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

describe('battery warming', () => {
    // What a night bought at the wall beyond its charge, back on the pack side.
    const warmingOf = (p, s) => {
        const w = simulateWeek(p, s);
        const charged = w.days.filter(d => d.night.added > 0);
        expect(charged.length).toBeGreaterThan(0);
        return { w, perNight: charged.map(d => d.night.homeKwh * p.home.eff - d.night.added / 100 * p.usableKwh), nights: charged.length };
    };

    it('is none at or above 40°F', () => {
        expect(PACK_WARMING_BELOW_F).toBe(40);
        for (const winterF of [40, 45]) {
            for (const kwh of warmingOf(profile(), settings({ winterF })).perNight) expect(kwh).toBeCloseTo(0, 9);
        }
        for (const kwh of warmingOf(profile(), settings({ season: 'summer' })).perNight) expect(kwh).toBeCloseTo(0, 9);
    });

    it('is charged once a night the charger runs, by pack and degrees below 40°F', () => {
        for (const kwh of warmingOf(profile(), settings({ winterF: 15 })).perNight) expect(kwh).toBeCloseTo(BATTERY_WARMING_KWH * 75 * 25, 9);
        for (const kwh of warmingOf(profile(), settings({ winterF: 30 })).perNight) expect(kwh).toBeCloseTo(BATTERY_WARMING_KWH * 75 * 10, 9);
        const big = profile({ warmKwhPerF: BATTERY_WARMING_KWH * 150 });
        for (const kwh of warmingOf(big, settings({ winterF: 15 })).perNight) expect(kwh).toBeCloseTo(BATTERY_WARMING_KWH * 150 * 25, 9);
    });

    it('is bought through the charger efficiency, and is in the week\'s home energy and cost', () => {
        const s = settings({ winterF: 15 });
        const { w } = warmingOf(profile(), s);
        for (const d of w.days.filter(x => x.night.added > 0)) expect(d.night.warmKwh).toBeCloseTo(BATTERY_WARMING_KWH * 75 * 25 / 0.885, 9);
        expect(w.homeKwh).toBeCloseTo(w.days.reduce((t, d) => t + d.night.homeKwh, 0), 9);
        expect(w.homeCost).toBeCloseTo(w.homeKwh * s.homePrice, 9);
    });

    it('pays the charger\'s conversion only: the fixed draw is heat the car keeps', () => {
        const car = (level) => costToDriveVehicle({ socWindowKwh: 75, epaRange: { mi: 290 }, specs: { charging: { max_ac_kw: 11.5 } } }, settings({ level }));
        const want = ASSUMED_CHARGER_EFF + FIXED_DRAW_W / 1000 / 11.5;
        // The same at every level; charging itself loses more on 120 V.
        for (const level of [0, 1, 4]) expect(car(level).home.warmEff).toBeCloseTo(want, 12);
        expect(car(0).home.eff).toBeLessThan(car(0).home.warmEff);
        // A night buys E_warm / η_warm of warming at the wall.
        const s = settings({ winterF: 15 });
        const w = simulateWeek(profile({ home: { kw: 1.44, eff: 0.76, warmEff: 0.9 } }), s);
        for (const d of w.days.filter(x => x.night.homeKwh > 0)) expect(d.night.warmKwh).toBeCloseTo(BATTERY_WARMING_KWH * 75 * 25 / 0.9, 9);
    });

    it('comes out of the night\'s window first, at the charger\'s power: it takes time and leaves less to add', () => {
        const s = settings({ winterF: 15 });
        const h = plugHours(s);
        const cold = simulateWeek(profile(wallOutlet), s);
        const plain = simulateWeek(profile({ ...wallOutlet, warmKwhPerF: 0 }), s);
        const warmWall = BATTERY_WARMING_KWH * 75 * 25 / 0.80;
        cold.days.forEach((d, i) => {
            // The most a night adds is what the window buys less the warming.
            expect(d.night.mostAdd).toBeCloseTo((1.44 * h - warmWall) * 0.80 / 75 * 100, 9);
            expect(d.night.mostAdd).toBeLessThan(plain.days[i].night.mostAdd);
            // Never more at the wall than the charger can deliver in the window.
            expect(d.night.homeKwh).toBeLessThanOrEqual(1.44 * h + 1e-9);
            expect(d.night.hours).toBeLessThanOrEqual(h + 1e-9);
        });
        // A 120 V night that runs out buys exactly the charger's window.
        const cut = cold.days.filter(d => d.night.ranOut);
        expect(cut.length).toBeGreaterThan(0);
        for (const d of cut) expect(d.night.homeKwh).toBeCloseTo(1.44 * h, 9);
    });

    it('is bought at a fast charger too: the day\'s first stop, at the fast loss and price', () => {
        const noHome = { home: { kw: 0, eff: 0.885, none: true } };
        const s = settings({ winterF: 15 });
        const w = simulateWeek(profile(noHome), s);
        const plain = simulateWeek(profile({ ...noHome, warmKwhPerF: 0 }), s);
        const warm = BATTERY_WARMING_KWH * 75 * 25;
        // The same stops; only the first of each day buys warming.
        expect(w.stops.map(x => x.toSoc)).toEqual(plain.stops.map(x => x.toSoc));
        const days = new Set();
        for (const st of w.stops) {
            expect(st.warmKwh).toBeCloseTo(days.has(st.day) ? 0 : warm, 9);
            days.add(st.day);
        }
        expect(days.size).toBeGreaterThan(0);
        expect(w.fastKwh - plain.fastKwh).toBeCloseTo(days.size * warm / (1 - DC_FAST_LOSS), 9);
        expect(w.fastCost).toBeCloseTo(w.fastKwh * s.fastPrice, 9);
        expect(w.fastCost).toBeCloseTo(w.stops.reduce((t, x) => t + x.cost, 0), 9);
        // None in summer.
        expect(simulateWeek(profile(noHome), settings({ season: 'summer' })).stops.every(x => x.warmKwh === 0)).toBe(true);
    });

    it('can take the whole night: then the night adds nothing and buys only the window', () => {
        const s = settings({ winterF: -20 });
        // A big pack at -20°F on 120 V: 0.002 × 200 × 60 = 24 kWh, more than 1.44 × 9.
        const w = simulateWeek(profile({ ...wallOutlet, usableKwh: 200, warmKwhPerF: 0.002 * 200 }), s);
        for (const d of w.days.filter(x => x.night.homeKwh > 0)) {
            expect(d.night.added).toBe(0);
            expect(d.night.homeKwh).toBeCloseTo(1.44 * plugHours(s), 9);
        }
    });
});

describe('the most home charging could cost', () => {
    // Summer at 75°F: no battery warming, so the ceiling is the charger alone.
    it('is the charger at full power through the plug-in window every night, a month of them, at the home price', () => {
        // 48 A: 11.52 kW × 9 h (10 pm to 7 am) × 7 nights × 52 ÷ 12 × $0.17.
        const p = costToDriveVehicle({ socWindowKwh: 75, epaRange: { mi: 290 }, specs: { charging: { max_ac_kw: 19.2 } } }, settings({ level: 4, season: 'summer' }));
        expect(homeCostCeiling(p, settings({ level: 4, season: 'summer' }))).toBeCloseTo(11.52 * 9 * 7 * (52 / 12) * 0.17, 6);
    });

    it('stops at the onboard charger where the car cannot take the charger\'s power', () => {
        const car = (kw) => costToDriveVehicle({ socWindowKwh: 75, epaRange: { mi: 290 }, specs: { charging: { max_ac_kw: kw } } }, settings({ level: 5, season: 'summer' }));
        const s = settings({ level: 5, season: 'summer' });
        expect(homeCostCeiling(car(7.7), s)).toBeCloseTo(perMonth(7 * 7.7 * 9 * 0.17), 6);
        expect(homeCostCeiling(car(7.7), s)).toBeLessThan(homeCostCeiling(car(11.5), s));
    });

    it('follows the plug-in window and the home price, and counts a window that wraps past midnight', () => {
        const p = profile();
        expect(plugHours(settings({ plugFrom: 22, plugUntil: 7 }))).toBe(9);
        expect(plugHours(settings({ plugFrom: 7, plugUntil: 22 }))).toBe(15);
        expect(plugHours(settings({ plugFrom: 7, plugUntil: 7 }))).toBe(24);
        expect(homeCostCeiling(p, settings({ plugFrom: 20, plugUntil: 7, offFrom: 20, homePrice: 0.2, season: 'summer' })))
            .toBeCloseTo(perMonth(7 * 11.5 * 11 * 0.2), 6);
    });

    it('is the charger alone in the cold too: battery warming runs inside the window, not on top', () => {
        const p = profile();
        expect(homeCostCeiling(p, settings({ winterF: 15 }))).toBeCloseTo(homeCostCeiling(p, settings({ season: 'summer' })), 9);
    });

    it('is the same for every car the charger, not its onboard charger, limits', () => {
        // 120 V · 12 A in hard cold, cars of every pack size and efficiency.
        const s = settings({ level: 0, winterF: 15 });
        const cars = [[60, 0.75], [75, 0.80], [100, 0.78], [135, 0.72]].map(([usableKwh, eff]) => profile({ usableKwh, warmKwhPerF: 0.002 * usableKwh, home: { kw: 1.44, eff } }));
        const want = perMonth(7 * 1.44 * plugHours(s) * s.homePrice);
        for (const p of cars) {
            expect(homeCostCeiling(p, s)).toBeCloseTo(want, 9);
            expect(perMonth(simulateWeek(p, s).homeCost)).toBeLessThanOrEqual(want + 1e-6);
        }
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

    it('records the hours the charger ran and the most a night could add at full power', () => {
        // Summer: no battery warming, so the window is all charging.
        const s = settings({ season: 'summer' });
        for (const d of night(11.5, { season: 'summer' })) {
            expect(d.night.mostAdd).toBeCloseTo(11.5 * plugHours(s) * 0.885 / 75 * 100, 6);
            expect(d.night.hours).toBeLessThanOrEqual(plugHours(s) + 1e-9);
            // What was added is what the hours bought, never more than the most.
            expect(d.night.added).toBeCloseTo(d.night.hours / plugHours(s) * d.night.mostAdd, 6);
            expect(d.night.added).toBeLessThanOrEqual(d.night.mostAdd + 1e-9);
        }
    });

    it('a night the window cut short has used all of it, and added exactly the most', () => {
        const cut = night(1.44).filter(d => d.night.ranOut);
        expect(cut.length).toBeGreaterThan(0);
        for (const d of cut) {
            expect(d.night.hours).toBeCloseTo(plugHours(settings()), 6);
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

    it('draws each night as a span of the week, with the stretches the charger ran', () => {
        const nights = [0, 1, 2, 3, 4, 5, 6].map(d => ({ window: { from: d * 24 + 22, to: d * 24 + 31 }, spans: [[d * 24 + 22, d * 24 + 25]] }));
        const spans = plugWindows(nights);
        // Monday night is 22:00 to 7:00 Tuesday; the charger ran three hours of it.
        expect(spans[0]).toEqual({ from: 22, to: 31, spans: [[22, 25]] });
        // Sunday night runs past the week's end: cut there, the rest from Monday 0:00.
        expect(spans.slice(-2)).toEqual([
            { from: 6 * 24 + 22, to: 168, spans: [[6 * 24 + 22, 168]] },
            { from: 0, to: 7, spans: [[0, 1]] },
        ]);
    });

    it('the week returns its windows, one a night, matching the nights\' hours', () => {
        const w = simulateWeek(profile(), settings());
        // Sunday night is cut in two, so a night more than seven spans.
        expect(w.windows.length).toBe(8);
        const ran = w.windows[0].spans.reduce((t, [a, b]) => t + b - a, 0);
        expect(ran).toBeCloseTo(w.days[0].night.hours, 6);
        // At One price the charger runs from plug-in, in one stretch.
        expect(w.windows[0].spans).toHaveLength(1);
        expect(w.windows[0].spans[0][0]).toBe(22);
    });
});

describe('time-of-use rates', () => {
    const hourOfDay = (h) => ((h % 24) + 24) % 24;

    it('every plan has whole maps and a price for every tier it uses', () => {
        for (const plan of RATE_PLANS) {
            for (const season of ['summer', 'winter']) {
                const r = plan.seasons[season];
                expect(r.prices, plan.key).toHaveLength(3);
                for (const map of [r.weekday, r.weekend]) {
                    expect(map, `${plan.key} ${season}`).toMatch(/^[HML]{24}$/);
                    for (const c of new Set(map)) expect(r.tiers['HML'.indexOf(c)], `${plan.key} ${season} ${c}`).toBeTruthy();
                }
                // Dearest first.
                expect(r.prices[0]).toBeGreaterThanOrEqual(r.prices[1]);
                expect(r.prices[1]).toBeGreaterThanOrEqual(r.prices[2]);
            }
        }
    });

    it('fills the cheapest hours first, earliest first, and spills into dearer ones', () => {
        // 22:00 to 7:00; cheap from midnight to 6.
        const priceAt = (h) => (hourOfDay(h) < 6 ? 0.1 : 0.5);
        const fits = chargeInCheapestHours({ from: 22, to: 31, kw: 10, wallKwh: 35, priceAt });
        expect(fits.spans.map(x => [x.from, x.to])).toEqual([[24, 25], [25, 26], [26, 27], [27, 27.5]]);
        expect(fits.cost).toBeCloseTo(3.5, 9);
        const spills = chargeInCheapestHours({ from: 22, to: 31, kw: 10, wallKwh: 75, priceAt });
        expect(spills.kwh).toBeCloseTo(75, 9);
        expect(spills.cost).toBeCloseTo(60 * 0.1 + 15 * 0.5, 9);
        // The dearer hours taken are the earliest of them: 22:00 and half of 23:00.
        expect(spills.spans[0]).toMatchObject({ from: 22, to: 23 });
        // At one price, one stretch from the start: the night as it always ran.
        const flat = chargeInCheapestHours({ from: 22.5, to: 31, kw: 10, wallKwh: 20, priceAt: () => 0.2 });
        expect(flat.spans[0].from).toBe(22.5);
        expect(flat.spans.at(-1).to).toBeCloseTo(24.5, 9);
    });

    it('One price prices every hour the same, and names no plan', () => {
        const s = settings({ homePrice: 0.21 });
        expect(rateSeason(s)).toBeNull();
        expect(homePricing(s)(3)).toBe(0.21);
        expect(ratePlanName(s)).toBeNull();
        const w = simulateWeek(profile(), s);
        expect(w.homeCost).toBeCloseTo(w.homeKwh * 0.21, 9);
    });

    it('a plan reads the weekend map on Saturday and Sunday, by season', () => {
        const s = settings({ rate: 'dte-tod', season: 'summer' });
        const at = homePricing(s);
        expect(at(16)).toBe(0.24);           // Monday 4 pm, peak
        expect(at(5 * 24 + 16)).toBe(0.18);  // Saturday 4 pm, off-peak
        expect(homePricing(s, 'winter')(16)).toBe(0.20);
        expect(ratePlanName(s)).toBe('DTE Time of Day');
    });

    it('Georgia Power: every night charges inside 11 pm to 7 am, at its super off-peak price', () => {
        const s = settings({ rate: 'gpc-overnight', season: 'winter' });
        const w = simulateWeek(profile(), s);
        for (const d of w.days.filter(x => x.night.homeKwh > 0)) {
            for (const [a, b] of d.night.spans) {
                expect(hourOfDay(a) >= 23 || hourOfDay(a) < 7, `${d.day} ${a}`).toBe(true);
                expect(b - a).toBeLessThanOrEqual(8 + 1e-9);
            }
            expect(d.night.homeCost).toBeCloseTo(d.night.homeKwh * 0.02, 9);
        }
        expect(w.homeCost).toBeCloseTo(w.homeKwh * 0.02, 9);
    });

    it('a slow charger on SDG&E spills past the cheap six hours and pays more a kWh', () => {
        const s = settings({ rate: 'sdge-ev-tou-5', season: 'winter' });
        const fast = simulateWeek(profile(), s);
        const slow = simulateWeek(profile({ home: { kw: 3.84, eff: 0.85 } }), s);
        const avg = (w) => w.homeCost / w.homeKwh;
        expect(avg(fast)).toBeCloseTo(0.12, 6);
        expect(avg(slow)).toBeGreaterThan(avg(fast) + 0.01);
    });

    it('splits each night and the week by tier, and names the base tier for the charts', () => {
        const s = settings({ rate: 'sdge-ev-tou-5', season: 'winter' });
        const slow = simulateWeek(profile({ home: { kw: 3.84, eff: 0.85 } }), s);
        // SDG&E uses all three tiers: super off-peak is the base.
        expect(slow.rateTiers).toEqual({ names: ['On-peak', 'Off-peak', 'Super off-peak'], base: 2 });
        for (const d of slow.days.filter(x => x.night.homeKwh > 0)) {
            const n = d.night;
            expect(n.tierKwh.reduce((a, k) => a + k, 0)).toBeCloseTo(n.homeKwh, 9);
            expect(n.tierCost.reduce((a, c) => a + c, 0)).toBeCloseTo(n.homeCost, 9);
            const ran = n.tierSpans.reduce((a, x) => a + x.to - x.from, 0);
            expect(ran).toBeCloseTo(n.hours, 9);
            // Warming out, what each tier put in the pack adds up to the night's charge.
            expect(n.tierWarmKwh.reduce((a, k) => a + k, 0)).toBeCloseTo(n.warmKwh, 9);
            expect(n.tierPackKwh.reduce((a, k) => a + k, 0)).toBeCloseTo(n.added / 100 * 75, 6);
        }
        // The slow charger spills: some of the week is bought above the base.
        expect(slow.homeTierCost[1] + slow.homeTierCost[0]).toBeGreaterThan(0);
        expect(slow.homeTierCost.reduce((a, c) => a + c, 0)).toBeCloseTo(slow.homeCost, 9);
        expect(chargingTiers(slow).spans.length).toBeGreaterThan(0);
        expect(homeTierOrder(slow.rateTiers)).toEqual([2, 1, 0]);
        // A plan with no super off-peak: off-peak (its cheapest) is the base.
        const dte = simulateWeek(profile(), settings({ rate: 'dte-tod' }));
        expect(dte.rateTiers.base).toBe(2);
        expect(rateTiers(settings({ rate: 'custom', rateHours: 'MMMMMMMMMMMMMMMMHHHHHMMM' })).base).toBe(1);
        expect(homeTierOrder({ base: 1 })).toEqual([1, 0]);
        // One price: no split.
        const flat = simulateWeek(profile(), settings());
        expect(flat.rateTiers).toBeNull();
        expect(flat.homeTierCost).toBeNull();
        expect(chargingTiers(flat)).toBeNull();
        expect(homeTierOrder(null)).toEqual([null]);
    });

    it('a custom plan prices its own hours; weekends off-peak lowers the peak a tier', () => {
        const base = { rate: 'custom', rateHours: 'H'.repeat(24), rateHigh: 0.5, rateMid: 0.3, rateLow: 0.1 };
        expect(homePricing(settings({ ...base, rateWeekendOff: true }))(5 * 24 + 1)).toBe(0.3);
        expect(homePricing(settings({ ...base, rateWeekendOff: false }))(5 * 24 + 1)).toBe(0.5);
        expect(homePricing(settings(base))(1)).toBe(0.5);
    });

    it('a day marked Off charges in the days-off window', () => {
        const s = settings({ offFrom: 9, offUntil: 7 });
        expect(windowOf(s, 6)).toEqual({ from: 9, to: 31 });
        expect(windowOf(s, 0)).toEqual({ from: 22, to: 31 });
        // A cheap midday the days-off window reaches: Sunday's charge runs in daylight.
        const sunny = settings({ offFrom: 9, offUntil: 7, rate: 'custom', rateHours: 'MMMMMMMMMMLLLLLLMMMMMMMM', rateWeekendOff: false, chargeTo: 90 });
        const w = simulateWeek(profile(), sunny);
        const sunday = w.days[6].night;
        expect(sunday.window.from).toBe(6 * 24 + 9);
        if (sunday.homeKwh > 0) expect(hourOfDay(sunday.spans[0][0])).toBeGreaterThanOrEqual(10);
    });

    it('the most it could cost follows each hour\'s price', () => {
        const p = profile();
        const s = settings({ rate: 'custom', rateHours: 'L'.repeat(24), rateLow: 0.1, season: 'summer' });
        expect(homeCostCeiling(p, s)).toBeCloseTo(perMonth(7 * 11.5 * 9 * 0.1), 6);
        const g = settings({ rate: 'gpc-overnight', season: 'winter' });
        for (const lvl of [p, profile(wallOutlet)]) {
            expect(perMonth(simulateWeek(lvl, g).homeCost)).toBeLessThanOrEqual(homeCostCeiling(lvl, g) + 1e-6);
        }
    });
});

describe('phantom drain (#590)', () => {
    const phantom = (pctDay) => ({ phantom: { pctDay, source: 'setting' } });
    const idleWeek = { week: 'OOOOOOO', planned: 0 };

    it('a week with none is the week it was', () => {
        const a = simulateWeek(profile(), settings());
        const b = simulateWeek(profile(phantom(0)), settings());
        expect(b.homeKwh).toBeCloseTo(a.homeKwh, 9);
        expect(b.phantomKwh).toBe(0);
    });

    it('a car that never drives still loses about a day\'s drain a day, less what it spends charging, and buys it back', () => {
        const w = simulateWeek(profile(phantom(1)), settings(idleWeek));
        const weekMax = 7 * 0.01 * 75;
        expect(w.phantomKwh).toBeGreaterThan(weekMax * 0.5);
        expect(w.phantomKwh).toBeLessThanOrEqual(weekMax + 1e-9);
        // Bought back at the wall through the charger, so more than it lost.
        expect(w.homeKwh).toBeGreaterThan(w.phantomKwh * 0.95);
        for (const d of w.days) expect(d.phantomPct).toBeGreaterThan(0.3);
    });

    it('a day off slopes down instead of lying flat', () => {
        const range = (pts) => Math.max(...pts.map(([, v]) => v)) - Math.min(...pts.map(([, v]) => v));
        expect(range(simulateWeek(profile(), settings(idleWeek)).points)).toBeCloseTo(0, 6);
        expect(range(simulateWeek(profile(phantom(2)), settings(idleWeek)).points)).toBeGreaterThan(0.5);
    });

    it('the week still closes: Monday morning is where it began', () => {
        const w = simulateWeek(profile(phantom(3)), settings());
        expect(w.points[0][1]).toBeCloseTo(w.points.at(-1)[1], 0);
    });

    it('is the reader\'s figure, else the car\'s own (0 counts), else the site\'s', () => {
        const base = settings();
        expect(phantomDrainOf({}, base)).toEqual({ pctDay: 1, source: 'knob:PHANTOM_DRAIN_PCT_DAY' });
        expect(phantomDrainOf({ charging: { phantom_drain_pct_day: 0 } }, base).pctDay).toBe(0);
        expect(phantomDrainOf({ charging: { phantom_drain_pct_day: 2.5 } }, base)).toEqual({ pctDay: 2.5, source: 'data' });
        const mine = settings({ phantomFrom: 'mine', phantomDrain: 1.5 });
        expect(phantomDrainOf({ charging: { phantom_drain_pct_day: 2.5 } }, mine).pctDay).toBe(1.5);
    });
});

describe('fastIsAssumed: which fast-charging bases warn', () => {
    it.each([['assumed', true], ['maxDc', false], ['spec', false], ['tested', false]])('%s -> %s', (basis, warns) => {
        expect(fastIsAssumed({ fast: { basis } })).toBe(warns);
    });
    it('is false with no profile', () => {
        expect(fastIsAssumed(null)).toBe(false);
    });
});
