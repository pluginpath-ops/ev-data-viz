// The Weekly Charging Plan against a real truck's weeks: one owner's 2022
// R1T Quad Large over ten months, trip weeks dropped (fixtures/realWeekR1T.json,
// built in LocalDev/curation/r1t-routine). Two questions, kept apart:
//
//  1. The week's mechanics. Given the truck's own measured Wh/mi, does the
//     simulated week drive, charge and start each morning as the truck did?
//  2. EVBench's own profile for the truck. How close is the Wh/mi the page
//     would use, in each season?
//
// Two known misses are pinned as ratchets: each test fails when the model gets
// better as well as worse, so a fix shows up here and the bound gets tightened.
import { describe, it, expect } from 'vitest';
import { simulateWeek, costToDriveVehicle } from '../costToDrive';
import { normalizeCostToDrive, decodeCostToDriveKey } from '../costToDriveKey';
import { DEFAULT_COST_TO_DRIVE, HOME_LEVELS } from '../../constants/costToDrive';
import real from './fixtures/realWeekR1T.json';

const SEASONS = ['summer', 'winter'];
const WEEKDAYS = [0, 1, 2, 3, 4];

// The owner's setup: 60% every night on a 32 A charger, DTE Time of Day, the
// truck plugged in from the evening to the morning commute. Speed and city
// share come from the fixture: the owner's (75 mph, 20% city), since the
// export records no split.
const settingsFor = (season) => normalizeCostToDrive({
    ...DEFAULT_COST_TO_DRIVE,
    ...real[season].settings,
    season,
    summerF: real.summer.tempF,
    winterF: real.winter.tempF,
    level: HOME_LEVELS.findIndex(l => l.volts === 240 && l.amps === 32),
    chargeTo: real.charger.chargeTo,
    fullBeforeLong: false,
    rate: 'dte-tod',
    plugFrom: 18, plugUntil: 8, offFrom: 18, offUntil: 8,
});

// The truck as measured: its own Wh/mi each season, every kind of day alike.
const measured = () => ({
    usableKwh: real.usableKwh,
    missing: null,
    whPerMi: Object.fromEntries(SEASONS.map(s => [s, { D: real[s].whPerMi, L: real[s].whPerMi }])),
    home: { kw: real.charger.kw, eff: 0.9, warmEff: 0.9 },
    warmKwhPerF: 0,
    fast: { basis: 'assumed', minutes: () => 30 },
});

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const addedPct = (w) => w.days.reduce((s, d) => s + d.night.added, 0);

describe('a real R1T week: the mechanics, at the truck\'s own efficiency', () => {
    for (const season of SEASONS) {
        const w = simulateWeek(measured(), settingsFor(season), { season });
        const r = real[season].real;

        it(`${season}: no fast stops, and every weekday starts where the truck did`, () => {
            expect(w.stopCount).toBe(0);
            for (const d of WEEKDAYS) expect(Math.abs(w.days[d].startSoc - r.morningSoc[d])).toBeLessThan(1.5);
        });

        it(`${season}: driving uses the share of the battery the truck used`, () => {
            expect(w.miles).toBeCloseTo(r.weekMi, -1);
            expect(Math.abs(w.usedKwh / real.usableKwh * 100 - r.drivePct)).toBeLessThan(2);
        });

        it(`${season}: weekday evenings land within 3 points of the truck's`, () => {
            const model = avg(WEEKDAYS.map(d => w.days[d].homeSoc));
            expect(Math.abs(model - avg(WEEKDAYS.map(d => r.eveningSoc[d])))).toBeLessThan(3);
        });

        // RATCHET (#590, revisit 2027-02): the week has no phantom drain, so
        // home charging puts back only what driving used. The truck put back
        // 3–8 points a week more (drain, and preconditioning on the plug).
        // When #590 lands, this gap should close: tighten it to under 2.
        it(`${season}: home charging falls short of the truck's by the drain the week leaves out (#590)`, () => {
            const gap = r.homePct - addedPct(w);
            expect(gap).toBeGreaterThan(2);
            expect(gap).toBeLessThan(10);
        });
    }
});

describe('a real R1T week: EVBench\'s own profile for the truck', () => {
    // The record as EVBench held it when the fixture was made: two steady-speed
    // range tests (64 mph at 59 °F, 75 mph at 35 °F) for highway miles, the
    // EPA city figure for city miles.
    const vehicle = {
        socWindowKwh: real.evbench.usableKwh,
        epaRange: { cityMi: real.evbench.epaCityMi, hwyMi: real.evbench.epaHwyMi },
        runs: real.evbench.rangeTests,
    };
    const specs = { charging: { max_ac_kw: real.evbench.maxAcKw } };
    const profileFor = (season) => costToDriveVehicle(vehicle, settingsFor(season), { specs });
    const ratio = (season) => profileFor(season).whPerMi[season].D / real[season].whPerMi;

    it('highway miles come from the range tests, not the label', () => {
        expect(profileFor('summer').highwayFrom).toBe('tested');
    });

    // RATCHET (revisit 2027-02): the page runs warm-weather miles about 10%
    // over the truck (480 Wh/mi at 76 °F against 437), and cold ones about 10%
    // under. The two cross near 50 °F: the level is close, the slope with
    // temperature is not. Tighten both when it closes.
    it('summer: about 10% over the truck (known miss)', () => {
        expect(ratio('summer')).toBeGreaterThan(1.05);
        expect(ratio('summer')).toBeLessThan(1.15);
    });

    // In the cold the truck uses far more than its tests re-priced for
    // temperature — 584 Wh/mi at 40 °F against the page's 521. The
    // correction prices denser air and a steady heater, not warming
    // a cold cabin and pack at the start of each short trip (this truck's are
    // ~17 mi), cold tires or the regen a cold pack refuses
    // (conditionCorrection.js, "What this does NOT do"; the plan's "Winter is
    // a floor"). Battery warming is priced at home instead, and only below
    // 40 °F. When winter gets closer, this fails: tighten it.
    it('winter: about 10% under the truck (known miss)', () => {
        expect(ratio('winter')).toBeGreaterThan(0.85);
        expect(ratio('winter')).toBeLessThan(0.93);
    });

    // The whole week on the page, two ways: the week fitted to the 35 real
    // weeks, and the owner's own guess. Each is the battery energy a week of
    // driving uses, over the truck's. RATCHET (revisit 2027-02): pinned where
    // they are, so a model change that moves them shows here.
    //   fitted   summer 1.09 (480 Wh/mi against 437), winter 0.89
    //   guessed  summer 1.44 (160 mi at 80 mph against 138 mostly slower),
    //            winter 0.92 (80 mph's extra drag stands in for the cold)
    const selfSettings = (season) => normalizeCostToDrive({
        ...DEFAULT_COST_TO_DRIVE,
        ...real.selfAssessed.settings,
        season, summerF: real.summer.tempF, winterF: real.winter.tempF,
    });
    const weekRatio = (settings, season) => {
        const p = costToDriveVehicle(vehicle, settings, { specs });
        const realKwh = real[season].real.drivePct / 100 * real.usableKwh;
        return simulateWeek(p, settings, { season }).usedKwh / realKwh;
    };

    it('the guessed week\'s link still means what the fixture says', () => {
        const { settings, error } = decodeCostToDriveKey(real.selfAssessed.key);
        expect(error).toBeNull();
        for (const [key, value] of Object.entries(real.selfAssessed.settings)) expect(settings[key]).toBe(value);
    });

    const WEEKS = [
        ['fitted', 'summer', settingsFor, 1.09],
        ['fitted', 'winter', settingsFor, 0.89],
        ['guessed', 'summer', selfSettings, 1.44],
        ['guessed', 'winter', selfSettings, 0.92],
    ];
    for (const [name, season, settingsOf, expected] of WEEKS) {
        it(`${name} week, ${season}: ${expected} × the truck's battery use (known)`, () => {
            expect(weekRatio(settingsOf(season), season)).toBeCloseTo(expected, 1);
        });
    }
});
