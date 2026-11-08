import { describe, it, expect } from 'vitest';
import {
    planFromAnswers, planSummary, starterSetIds, isCompleteVehicle, matchesRule, harderSeason,
    sanitizeAnswers, skippedCount, seasonNoteText, fill, EMPTY_ANSWERS, STEP_ANSWERS, RULE_FIELDS, RULE_OPS,
} from '../setupWizard';
import { compareCuratedOrder } from '../vehicleOrder';
import { SETUP_WIZARD } from '../../constants/setupWizard';
import { ALL_CHART_MODES } from '../../constants/chartNav';
import { HOME_LEVELS, NO_HOME_LEVEL } from '../../constants/costToDrive';
import { DATA_CATEGORIES } from '../vehicleDataCategories';

/** The config with one kind swapped in, for rules the real config may not hold. */
const withKinds = (kinds, cars = {}) => ({ ...SETUP_WIZARD, cars: { ...SETUP_WIZARD.cars, ...cars, kinds } });

/** A vehicle with all three kinds of data unless told otherwise. */
const car = (id, { tag = 'SUV', order = id, make = `Make${id}`, model = `Model${id}`, epa = true, charging = true, range = true, price, length } = {}) => ({
    id, name: `Car ${id}`, make, model, sort_order: order, created_at: '2026-01-01',
    tags: [{ id: tag, name: tag }],
    epa_mappings: epa ? [{ id: 1 }] : [],
    runs: [...(charging ? [{ id: `c${id}`, kind: 'charging' }] : []), ...(range ? [{ id: `r${id}`, kind: 'range' }] : [])],
    specs: {
        ...(price != null ? { pricing: { base_price_usd: price } } : {}),
        ...(length != null ? { dimensions: { length_in: length } } : {}),
    },
});

// ── The config: a bad edit fails here, saying what is wrong ─────────────────

describe('the setup wizard config (constants/setupWizard.js)', () => {
    const C = SETUP_WIZARD;
    const unique = (list, what) => {
        const keys = list.map(x => x.key);
        expect(new Set(keys).size, `${what}: a key is repeated (${keys.join(', ')})`).toBe(keys.length);
    };

    it('steps are known screens, each with a title, summary last', () => {
        for (const s of C.steps) {
            expect(Object.keys(STEP_ANSWERS), `steps: "${s.key}" is not a screen`).toContain(s.key);
            expect(s.title, `steps: "${s.key}" needs a title`).toBeTruthy();
        }
        unique(C.steps, 'steps');
        expect(C.steps.at(-1).key, 'steps: summary must be last').toBe('summary');
    });

    it('every goal opens a real chart mode, and the default is a goal', () => {
        for (const g of C.goals.options) {
            expect(ALL_CHART_MODES, `goals: "${g.key}" opens unknown mode "${g.mode}" (see constants/chartNav.js)`).toContain(g.mode);
            expect(g.label, `goals: "${g.key}" needs a label`).toBeTruthy();
        }
        unique(C.goals.options, 'goals');
        expect(C.goals.options.map(g => g.key), `goals.default "${C.goals.default}" is not a goal`).toContain(C.goals.default);
    });

    it('car kinds: valid rules, numeric curated ids, a known default, a size of 4–6', () => {
        const checkRule = (rule, where) => {
            const keys = Object.keys(rule);
            if (keys.length === 0) return;
            if (rule.any || rule.all) { (rule.any ?? rule.all).forEach(r => checkRule(r, where)); return; }
            if (rule.not) { checkRule(rule.not, where); return; }
            if (rule.tag) { expect(Array.isArray(rule.tag), `${where}: tag must be a list`).toBe(true); return; }
            expect(Object.keys(RULE_FIELDS), `${where}: unknown field "${rule.field}"`).toContain(rule.field);
            expect(RULE_OPS, `${where}: unknown op "${rule.op}"`).toContain(rule.op);
            expect(typeof rule.value, `${where}: value must be a number`).toBe('number');
        };
        for (const k of C.cars.kinds) {
            expect(k.label, `cars.kinds: "${k.key}" needs a label`).toBeTruthy();
            checkRule(k.match, `cars.kinds "${k.key}"`);
            expect(Array.isArray(k.curated), `cars.kinds "${k.key}": curated must be a list`).toBe(true);
            for (const id of k.curated) expect(Number.isInteger(id), `cars.kinds "${k.key}": curated id ${JSON.stringify(id)} must be a number`).toBe(true);
        }
        unique(C.cars.kinds, 'cars.kinds');
        expect(C.cars.kinds.map(k => k.key), `cars.default "${C.cars.default}" is not a kind`).toContain(C.cars.default);
        expect(C.cars.size).toBeGreaterThanOrEqual(4);
        expect(C.cars.size).toBeLessThanOrEqual(6);
        const categories = DATA_CATEGORIES.map(c => c.key);
        for (const d of C.cars.requireData) expect(categories, `cars.requireData: unknown "${d}"`).toContain(d);
    });

    it('driving: speeds on the 5 mph grid, weeks of seven D/L/O, positive distances', () => {
        for (const s of C.driving.speed.mph) expect(s % 5, `driving.speed: ${s} is not on the 5 mph grid`).toBe(0);
        const isWeek = (w) => /^[DLO]{7}$/.test(w);
        expect(isWeek(C.driving.commuterWeek), 'driving.commuterWeek must be 7 of D/L/O').toBe(true);
        for (const t of C.driving.trips.options) if (t.week) expect(isWeek(t.week), `driving.trips "${t.key}": week must be 7 of D/L/O`).toBe(true);
        for (const d of C.driving.tripMi.miles) expect(d).toBeGreaterThan(0);
        unique(C.driving.highway.options, 'driving.highway');
        unique(C.driving.trips.options, 'driving.trips');
    });

    it('climates: winter colder than summer, months 0–12; home levels are real', () => {
        for (const c of C.weather.climates) {
            expect(c.winterF, `weather "${c.key}": winter must be colder than summer`).toBeLessThan(c.summerF);
            expect(c.winterMonths).toBeGreaterThanOrEqual(0);
            expect(c.winterMonths).toBeLessThanOrEqual(12);
            expect(c.region, `weather "${c.key}" needs a region`).toBeTruthy();
        }
        unique(C.weather.climates, 'weather.climates');
        for (const h of C.money.home.options) {
            expect(HOME_LEVELS[h.level], `money.home "${h.key}": level ${h.level} is not in HOME_LEVELS`).toBeTruthy();
        }
        expect(C.money.home.options.find(h => h.key === 'none')?.level).toBe(NO_HOME_LEVEL);
    });

    it('holds data only: no functions anywhere', () => {
        const walk = (v, path) => {
            expect(typeof v, `${path} is a function; the config is data only`).not.toBe('function');
            if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
        };
        walk(C, 'SETUP_WIZARD');
    });
});

// ── Starter sets ────────────────────────────────────────────────────────────

describe('starter sets', () => {
    const fleet = Array.from({ length: 10 }, (_, i) => car(i + 1, { order: 10 - i }));
    const all = withKinds([{ key: 'k', label: 'K', curated: [], match: {} }]);

    it('a vehicle needs EPA data, a charging test and a range test; a composite is not a test', () => {
        expect(isCompleteVehicle(car(1))).toBe(true);
        expect(isCompleteVehicle(car(1, { epa: false }))).toBe(false);
        expect(isCompleteVehicle(car(1, { charging: false }))).toBe(false);
        expect(isCompleteVehicle(car(1, { range: false }))).toBe(false);
        const composite = { ...car(1, { charging: false }), runs: [{ id: 'x', kind: 'charging', composite: true }, { id: 'r', kind: 'range' }] };
        expect(isCompleteVehicle(composite)).toBe(false);
    });

    it('caps the set at the config size, never every match', () => {
        expect(starterSetIds('k', fleet, all)).toHaveLength(SETUP_WIZARD.cars.size);
    });

    it('follows the curated vehicle order (Vehicles & Specs default sort)', () => {
        const expected = [...fleet].sort(compareCuratedOrder).slice(0, SETUP_WIZARD.cars.size).map(v => v.id);
        expect(starterSetIds('k', fleet, all)).toEqual(expected);
        expect(expected[0]).toBe(10);
    });

    it('leaves out vehicles missing any of the three', () => {
        const mixed = [car(1, { epa: false }), car(2, { charging: false }), car(3, { range: false }), car(4)];
        expect(starterSetIds('k', mixed, all)).toEqual([4]);
    });

    it('takes one trim per make and model from the order', () => {
        const trims = [car(1, { make: 'Kia', model: 'EV6' }), car(2, { make: 'Kia', model: 'EV6' }), car(3)];
        expect(starterSetIds('k', trims, all)).toEqual([1, 3]);
    });

    it('puts a curated list first, in its own order, then fills from the order', () => {
        const cfg = withKinds([{ key: 'k', label: 'K', curated: [7, 3, 99], match: {} }]);
        const ids = starterSetIds('k', fleet, cfg);
        expect(ids.slice(0, 3)).toEqual([7, 3, 10]);   // 99 is not in the fleet
        expect(ids).toHaveLength(SETUP_WIZARD.cars.size);
    });

    it('drops a curated vehicle that is not complete', () => {
        const cfg = withKinds([{ key: 'k', label: 'K', curated: [1], match: {} }]);
        expect(starterSetIds('k', [car(1, { range: false }), car(2)], cfg)).toEqual([2]);
    });

    it('the real kinds: tags, length and price', () => {
        const v = [
            car(1, { tag: 'Truck' }), car(2, { tag: 'Sedan', price: 40000 }), car(3, { tag: 'SUV', length: 180, price: 90000 }),
            car(4, { tag: 'SUV', length: 195 }), car(5, { tag: 'CUV' }), car(6, { tag: 'SUV' }),
        ];
        expect(starterSetIds('pickup', v)).toEqual([1]);
        expect(starterSetIds('sedan', v)).toEqual([2]);
        expect(starterSetIds('small-suv', v)).toEqual([3, 5]);
        expect(starterSetIds('suv', v)).toEqual([4, 6]);   // unknown length counts as family size
        expect(starterSetIds('affordable', v)).toEqual([2]);
        expect(starterSetIds('luxury', v)).toEqual([3]);
    });

    it('rules: any / all / not, and a blank field never matches', () => {
        const v = car(1, { tag: 'SUV' });
        expect(matchesRule({}, v, {})).toBe(true);
        expect(matchesRule({ field: 'priceUsd', op: '<=', value: 1 }, v, { priceUsd: null })).toBe(false);
        expect(matchesRule({ not: { tag: ['Truck'] } }, v, {})).toBe(true);
        expect(matchesRule({ all: [{ tag: ['SUV'] }, { field: 'lengthIn', op: '<', value: 186 }] }, v, { lengthIn: 180 })).toBe(true);
    });
});

// ── Seasons ─────────────────────────────────────────────────────────────────

describe('the harder season', () => {
    it('is winter in every configured climate, by the correction model', () => {
        for (const c of SETUP_WIZARD.weather.climates) {
            expect(harderSeason(c, 70).season, c.key).toBe('winter');
        }
    });

    it('is summer where summer is the bigger load', () => {
        expect(harderSeason({ winterF: 70, summerF: 105 }, 70).season).toBe('summer');
    });

    it('after the toggle, does not call the easier season the harder one', () => {
        const shown = harderSeason({ winterF: 15, summerF: 95 }, 70);
        const flipped = { ...shown.other, harder: false, other: { season: shown.season, tempF: shown.tempF } };
        expect(seasonNoteText(flipped).message).toBe('Showing summer, 95°F.');
        expect(seasonNoteText(flipped).toggle).toMatch(/winter, 15°F/);
    });

    it('the note names the season and offers the other, in the reader units', () => {
        const shown = harderSeason({ winterF: 15, summerF: 95 }, 70);
        expect(seasonNoteText(shown).message).toMatch(/winter, 15°F/);
        expect(seasonNoteText(shown).toggle).toMatch(/summer, 95°F/);
        expect(seasonNoteText(shown, 'metric').message).toMatch(/°C/);
    });
});

// ── Answers → plan ──────────────────────────────────────────────────────────

describe('planFromAnswers', () => {
    const fleet = [car(1), car(2), car(3)];

    it('opens the default goal and the default set when everything is skipped', () => {
        const plan = planFromAnswers(EMPTY_ANSWERS, { vehicles: fleet, selectedIds: [] });
        expect(plan.mode).toBe('drivecost');
        expect(plan.setKey).toBe(SETUP_WIZARD.cars.default);
        expect(plan.vehicleIds).toEqual([1, 2, 3]);
        expect(plan.correction).toEqual({});
        expect(plan.costToDrive).toEqual({});
        expect(plan.season).toBeNull();
    });

    it('keeps the selection when cars are skipped and something is selected', () => {
        const plan = planFromAnswers({ goal: 'charging' }, { vehicles: fleet, selectedIds: [2] });
        expect(plan.vehicleIds).toBeNull();
        expect(plan.mode).toBe('charging');
    });

    it('uses picked cars, dropping any no longer listed', () => {
        expect(planFromAnswers({ cars: { how: 'pick', ids: [3, 99, 1] } }, { vehicles: fleet }).vehicleIds).toEqual([3, 1]);
    });

    it('writes driving, weather and money through to each setting', () => {
        const plan = planFromAnswers({
            dailyMi: 40, highway: 'highway', speedMph: 75, climate: 'extreme', mountains: true,
            home: 'charger', homePrice: 0.15, gasMpg: 28, gasPrice: 3.5, trips: 'weekly', tripMi: 700,
        }, { vehicles: fleet, selectedIds: [1] });
        expect(plan.correction).toEqual({ speedMph: 75, temperatureF: 15, altitudeFt: 5000 });
        expect(plan.costToDrive).toMatchObject({
            dailyMi: 40, dailyCity: 20, dailyMph: 75, longMph: 75, week: 'DDDDDLO',
            winterF: 15, summerF: 95, winterMonths: 4, season: 'winter', elevationFt: 5000, level: 3,
            homePrice: 0.15, gasCity: 28, gasHwy: 28, gasPrice: 3.5, longMi: 400,
        });
        expect(plan.assumptions).toEqual({ homePrice: 0.15 });
        expect(plan.roadTrip).toEqual({ speed: 75, totalDistance: 700, optimizerDistance: 700 });
        expect(plan.season).toMatchObject({ season: 'winter', tempF: 15, other: { season: 'summer', tempF: 95 } });
    });

    it('no home charging is a real setting now, not a gap', () => {
        const plan = planFromAnswers({ home: 'none' }, { vehicles: fleet });
        expect(plan.costToDrive.level).toBe(NO_HOME_LEVEL);
        expect(plan.unset).toEqual([]);
    });

    it('says what a road-trip frequency cannot set', () => {
        expect(planFromAnswers({ trips: 'few' }, { vehicles: fleet }).unset.join(' ')).toMatch(/road trips/);
    });
});

describe('remembered answers', () => {
    it('keeps known answers and drops what the config no longer offers', () => {
        const a = sanitizeAnswers({ goal: 'range', climate: 'gone', speedMph: 72, dailyMi: 40, cars: { how: 'set', set: 'pickup' }, junk: 1 });
        expect(a).toMatchObject({ goal: 'range', climate: null, speedMph: null, dailyMi: 40, cars: { how: 'set', set: 'pickup' } });
        expect(a.junk).toBeUndefined();
        expect(sanitizeAnswers('nonsense')).toEqual(EMPTY_ANSWERS);
    });

    it('counts the skipped questions, never their values', () => {
        expect(skippedCount(EMPTY_ANSWERS)).toBe(Object.keys(EMPTY_ANSWERS).length);
        expect(skippedCount({ ...EMPTY_ANSWERS, goal: 'cost' })).toBe(Object.keys(EMPTY_ANSWERS).length - 1);
    });
});

describe('planSummary', () => {
    it('names the chart, the cars and only what was answered', () => {
        const answers = { goal: 'range', speedMph: 70 };
        const plan = planFromAnswers(answers, { vehicles: [car(1)], selectedIds: [] });
        const lines = planSummary(plan, answers, { 1: 'Ioniq 5' });
        expect(lines.map(l => l.label)).toEqual(['Opens', 'Cars', 'Driving']);
        expect(lines[0].text).toBe('Charging & Range › Range & Efficiency');
        expect(lines[1].text).toMatch(/Ioniq 5/);
    });

    it('speaks metric when the reader does', () => {
        const answers = { dailyMi: 40, speedMph: 70, climate: 'cold' };
        const plan = planFromAnswers(answers, { vehicles: [car(1)], selectedIds: [1] });
        const text = planSummary(plan, answers, {}, 'metric').map(l => l.text).join(' ');
        expect(text).toMatch(/64 km a day/);
        expect(text).toMatch(/113 km\/h/);
        expect(text).toMatch(/-18°C/);
    });

    it('fills templates and leaves an unknown placeholder visible', () => {
        expect(fill('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    });
});
