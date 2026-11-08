/**
 * The setup wizard's logic: answers → a plan of settings, and the plan in
 * words. It holds no content — every question, option, cut-off and default is
 * in constants/setupWizard.js, which a small edit can tailor.
 *
 * The wizard writes nothing itself. `planFromAnswers` returns a plan — which
 * vehicles, which chart, and a patch for each settings object App already owns
 * (the correction target, Cost & Time, Road Trip, the vehicle table's
 * assumptions) — and App's `applySetup` lays it over the current state through
 * the setters every other control uses. So the URL, the pop-out and a shared
 * link follow without the wizard knowing they exist.
 *
 * A skipped question (null) leaves its settings as they are: skipping means
 * "don't touch", not "reset". Answers are held in miles, mph and °F whatever
 * the reader's units; only the words convert.
 *
 * Pure module — no React, no data access.
 */
import { SETUP_WIZARD } from '../constants/setupWizard';
import { costToDriveField } from '../constants/costToDrive';
import { STANDARD_CONDITIONS } from '../constants/epa';
import { categoryForMode, labelForMode } from '../constants/chartNav';
import { specProvenance } from './specHelpers';
import { vehicleDataCategories } from './vehicleDataCategories';
import { compareCuratedOrder } from './vehicleOrder';
import { correctionFactor } from './conditionCorrection';
import { DEFAULT_READER_MODE } from './correctionSettings';
import { fmtDistance, fmtSpeed, convValue } from './unitConversions';

/** "{n} selected" with `{n}` filled in. A missing key stays as written. */
export const fill = (template, vars = {}) =>
    String(template).replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));

const byKey = (list, key) => list.find(x => x.key === key) ?? null;

// ── Answers ─────────────────────────────────────────────────────────────────

/** Every question unanswered. Which answers each step holds is STEP_ANSWERS. */
export const EMPTY_ANSWERS = Object.freeze({
    goal: null,
    cars: null,        // { how: 'keep' } | { how: 'pick', ids: [] } | { how: 'set', set: key }
    dailyMi: null,
    highway: null,
    speedMph: null,
    trips: null,
    tripMi: null,
    climate: null,
    mountains: null,   // true | false | null
    home: null,
    homePrice: null,
    gasMpg: null,
    gasPrice: null,
});

/** The answers each step asks, so Skip clears just those. */
export const STEP_ANSWERS = {
    goal: ['goal'],
    cars: ['cars'],
    driving: ['dailyMi', 'highway', 'speedMph', 'trips', 'tripMi'],
    weather: ['climate', 'mountains'],
    money: ['home', 'homePrice', 'gasMpg', 'gasPrice'],
    summary: [],
};

/**
 * Answers read back from storage, kept only where they still make sense: known
 * keys, and an option key the config still offers. Anything else is unanswered.
 */
export function sanitizeAnswers(raw, config = SETUP_WIZARD) {
    const out = { ...EMPTY_ANSWERS };
    if (!raw || typeof raw !== 'object') return out;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const keyIn = (list, v) => (list.some(o => o.key === v) ? v : null);
    out.goal = keyIn(config.goals.options, raw.goal);
    const c = raw.cars;
    if (c?.how === 'keep') out.cars = { how: 'keep' };
    if (c?.how === 'pick' && Array.isArray(c.ids)) out.cars = { how: 'pick', ids: c.ids.filter(id => typeof id === 'number' || typeof id === 'string') };
    if (c?.how === 'set') out.cars = { how: 'set', set: keyIn(config.cars.kinds, c.set) };
    out.dailyMi = num(raw.dailyMi);
    out.highway = keyIn(config.driving.highway.options, raw.highway);
    out.speedMph = config.driving.speed.mph.includes(raw.speedMph) ? raw.speedMph : null;
    out.trips = keyIn(config.driving.trips.options, raw.trips);
    out.tripMi = config.driving.tripMi.miles.includes(raw.tripMi) ? raw.tripMi : null;
    out.climate = keyIn(config.weather.climates, raw.climate);
    out.mountains = typeof raw.mountains === 'boolean' ? raw.mountains : null;
    out.home = keyIn(config.money.home.options, raw.home);
    out.homePrice = num(raw.homePrice);
    out.gasMpg = num(raw.gasMpg);
    out.gasPrice = num(raw.gasPrice);
    return out;
}

/** How many questions were left unanswered — for the site event, never the answers. */
export function skippedCount(answers) {
    return Object.keys(EMPTY_ANSWERS).filter(k => answers?.[k] == null).length;
}

// ── Starter sets ────────────────────────────────────────────────────────────

const OPS = {
    '<': (a, b) => a < b, '<=': (a, b) => a <= b,
    '>': (a, b) => a > b, '>=': (a, b) => a >= b,
};

/** Whether a vehicle meets a config rule (see constants/setupWizard.js, `match`). */
export function matchesRule(rule, vehicle, facts) {
    if (!rule || Object.keys(rule).length === 0) return true;
    if (rule.any) return rule.any.some(r => matchesRule(r, vehicle, facts));
    if (rule.all) return rule.all.every(r => matchesRule(r, vehicle, facts));
    if (rule.not) return !matchesRule(rule.not, vehicle, facts);
    if (rule.tag) return (vehicle.tags || []).some(t => rule.tag.includes(t.name));
    if (rule.field) {
        const v = facts[rule.field];
        return v != null && OPS[rule.op](v, rule.value);
    }
    return false;
}

/** What a rule's `field` can name, read from a vehicle's resolved specs. */
export const RULE_FIELDS = {
    priceUsd: (specs) => specs.pricing?.base_price_usd,
    lengthIn: (specs) => specs.dimensions?.length_in,
};
export const RULE_OPS = Object.keys(OPS);

function numberOrNull(x) {
    const n = Number(x);
    return x == null || x === '' || !Number.isFinite(n) ? null : n;
}

/**
 * Whether a vehicle has every kind of data the config asks for (by default an
 * EPA configuration, a charging test and a range test). Read through
 * vehicleDataCategories, so it counts what the card's "Tests:" pills count.
 */
export function isCompleteVehicle(v, requireData = SETUP_WIZARD.cars.requireData) {
    const c = vehicleDataCategories(v);
    return requireData.every(k => c[k] > 0);
}

/**
 * The vehicles a starter set selects, at most `cars.size`: complete vehicles
 * that match, the set's curated ids first, then the curated vehicle order
 * (Vehicles & Specs' default sort) — one per make and model there when
 * `onePerModel`, so a set is five cars, not five trims of one.
 */
export function starterSetIds(kindKey, vehicles = [], config = SETUP_WIZARD) {
    const { cars } = config;
    const kind = byKey(cars.kinds, kindKey);
    if (!kind) return [];
    const candidates = vehicles.filter(v => {
        if (!isCompleteVehicle(v, cars.requireData)) return false;
        const specs = specProvenance(v, vehicles).specs ?? {};
        const facts = Object.fromEntries(Object.entries(RULE_FIELDS).map(([k, read]) => [k, numberOrNull(read(specs))]));
        return matchesRule(kind.match, v, facts);
    });
    const byId = new Map(candidates.map(v => [String(v.id), v]));
    const modelOf = (v) => `${v.make ?? ''}|${v.model ?? v.name}`.toLowerCase();

    const out = [];
    const models = new Set();
    const take = (v) => { out.push(v.id); models.add(modelOf(v)); };
    for (const id of kind.curated ?? []) {
        const v = byId.get(String(id));
        if (v && !out.includes(v.id)) take(v);
        if (out.length === cars.size) return out;
    }
    for (const v of [...candidates].sort((a, b) => compareCuratedOrder(a, b))) {
        if (out.length === cars.size) break;
        if (!out.includes(v.id) && !(cars.onePerModel && models.has(modelOf(v)))) take(v);
    }
    return out;
}

// ── Seasons ─────────────────────────────────────────────────────────────────

/**
 * Which of a climate's seasons costs more range at `speedMph`, by the
 * correction model itself (air density and the accessory load each
 * temperature implies): the lower correction factor is the harder season.
 * Returns that season and the other, each with its temperature.
 */
export function harderSeason(climate, speedMph = STANDARD_CONDITIONS.speedMph) {
    const asTested = { ...STANDARD_CONDITIONS, windMph: 0 };
    const factorAt = (temperatureF) => correctionFactor(asTested, {
        mode: DEFAULT_READER_MODE,
        target: { speedMph, altitudeFt: STANDARD_CONDITIONS.altitudeFt, temperatureF, accessoryW: null },
    }).factor;
    const winter = { season: 'winter', tempF: climate.winterF };
    const summer = { season: 'summer', tempF: climate.summerF };
    return factorAt(climate.winterF) <= factorAt(climate.summerF)
        ? { ...winter, harder: true, other: summer }
        : { ...summer, harder: true, other: winter };
}

/**
 * The notice after Apply: "Showing winter, 15°F — your harder season." and
 * its toggle. `shown.harder` false is the other season, after the toggle.
 */
export function seasonNoteText(shown, units = 'imperial', config = SETUP_WIZARD) {
    return {
        message: fill(shown.harder ? config.seasonNote.message : config.seasonNote.messageOther, { season: shown.season, temp: tempWords(shown.tempF, units) }),
        toggle: fill(config.seasonNote.toggle, { other: `${shown.other.season}, ${tempWords(shown.other.tempF, units)}` }),
    };
}

// ── Answers → plan ──────────────────────────────────────────────────────────

function resolveCars(cars, selectedIds, liveIds, config) {
    const ids = (cars?.ids ?? []).filter(id => liveIds.has(String(id)));
    if (cars?.how === 'pick' && ids.length) return { how: 'pick', ids };
    if (cars?.how === 'set' && cars.set) return cars;
    if (selectedIds.length && (!cars || cars.how === 'keep')) return { how: 'keep' };
    return { how: 'set', set: config.cars.default };
}

/**
 * What the answers set. Each patch holds only what was answered.
 *
 *   mode         the chart mode to open
 *   vehicleIds   the new selection, or null to keep the reader's
 *   carsFrom     'pick' | 'set' | 'keep'; setKey the starter set used
 *   correction   patch for chartConfig.correctionTarget
 *   assumptions  patch for chartConfig.assumptions (the vehicle table)
 *   costToDrive  patch for Cost & Time's settings
 *   roadTrip     patch for roadTripConfig (Road Trip, Trip Optimizer)
 *   season       the harder season shown, and the other — when the climate was answered
 *   unset        answers the site has no setting for, in words
 */
export function planFromAnswers(answers = EMPTY_ANSWERS, { vehicles = [], selectedIds = [] } = {}, config = SETUP_WIZARD) {
    const a = { ...EMPTY_ANSWERS, ...answers };
    const goal = byKey(config.goals.options, a.goal) ?? byKey(config.goals.options, config.goals.default);
    const plan = {
        mode: goal.mode, goal: goal.key,
        vehicleIds: null, carsFrom: 'keep', setKey: null,
        correction: {}, assumptions: {}, costToDrive: {}, roadTrip: {}, season: null, unset: [],
    };

    // Cars. Never an empty selection: anything short of a real choice falls to
    // a starter set.
    const cars = resolveCars(a.cars, selectedIds, new Set(vehicles.map(v => String(v.id))), config);
    if (cars.how === 'pick') {
        plan.vehicleIds = [...cars.ids];
        plan.carsFrom = 'pick';
    } else if (cars.how === 'set') {
        plan.vehicleIds = starterSetIds(cars.set, vehicles, config);
        plan.carsFrom = 'set';
        plan.setKey = cars.set;
    }

    // Driving.
    const { driving } = config;
    if (a.dailyMi != null) Object.assign(plan.costToDrive, { dailyMi: a.dailyMi, week: driving.commuterWeek, planned: 0 });
    const share = byKey(driving.highway.options, a.highway);
    if (share) plan.costToDrive.dailyCity = 100 - share.highwayPct;
    if (a.speedMph != null) {
        plan.correction.speedMph = a.speedMph;
        Object.assign(plan.costToDrive, { dailyMph: a.speedMph, longMph: a.speedMph });
        plan.roadTrip.speed = a.speedMph;
    }
    const trips = byKey(driving.trips.options, a.trips);
    if (trips?.week) plan.costToDrive.week = trips.week;
    if (trips?.unset) plan.unset.push(trips.unset);
    if (a.tripMi != null) {
        plan.roadTrip.totalDistance = a.tripMi;
        plan.roadTrip.optimizerDistance = a.tripMi;
        plan.costToDrive.longMi = Math.min(costToDriveField('longMi').max, a.tripMi);
    }

    // Weather. The charts show the harder season; Cost & Time prices both.
    const climate = byKey(config.weather.climates, a.climate);
    if (climate) {
        const shown = harderSeason(climate, a.speedMph ?? undefined);
        plan.season = shown;
        plan.correction.temperatureF = shown.tempF;
        Object.assign(plan.costToDrive, {
            summerF: climate.summerF, winterF: climate.winterF,
            winterMonths: climate.winterMonths, season: shown.season,
        });
    }
    if (a.mountains != null) {
        const ft = a.mountains ? config.weather.mountains.ft : 0;
        plan.correction.altitudeFt = ft;
        plan.costToDrive.elevationFt = ft;
    }

    // Charging and money. The vehicle table and Cost & Time each hold a home
    // price; the wizard sets both so they agree.
    const home = byKey(config.money.home.options, a.home);
    if (home) plan.costToDrive.level = home.level;
    if (a.homePrice != null) {
        plan.costToDrive.homePrice = a.homePrice;
        plan.assumptions.homePrice = a.homePrice;
    }
    if (a.gasMpg != null) Object.assign(plan.costToDrive, { gasCity: a.gasMpg, gasHwy: a.gasMpg });
    if (a.gasPrice != null) plan.costToDrive.gasPrice = a.gasPrice;

    return plan;
}

// ── Plan → words ────────────────────────────────────────────────────────────

const money = (n) => `$${Number(n).toFixed(2)}`;

/** An altitude in the reader's units, rounded the way a person says it. */
export const altitudeWords = (ft, units = 'imperial') => (units === 'metric'
    ? `${(Math.round(convValue(ft, 'feet', 'metric') / 100) * 100).toLocaleString('en-US')} m`
    : `${ft.toLocaleString('en-US')} ft`);

/** A distance in the reader's units, whole. */
export const distanceWords = (mi, units = 'imperial') => fmtDistance(Math.round(mi), units).replace(/\.\d+ /, ' ');

/** A speed in the reader's units, whole. */
export const speedWords = (mph, units = 'imperial') => (units === 'metric' ? `${Math.round(convValue(mph, 'speed', 'metric'))} km/h` : fmtSpeed(mph, units));

/** A temperature in the reader's units, whole. */
export const tempWords = (f, units = 'imperial') => (units === 'metric' ? `${Math.round((f - 32) * 5 / 9)}°C` : `${f}°F`);

/**
 * The plan as the summary step says it: `[{ label, text }]`, only what will
 * change, in the reader's units. `names` maps a vehicle id to its name.
 */
export function planSummary(plan, answers = EMPTY_ANSWERS, names = {}, units = 'imperial', config = SETUP_WIZARD) {
    const a = { ...EMPTY_ANSWERS, ...answers };
    const S = config.summary;
    const lines = [{ label: S.opens, text: `${categoryForMode(plan.mode).label} › ${labelForMode(plan.mode)}` }];

    if (plan.vehicleIds) {
        const kind = byKey(config.cars.kinds, plan.setKey);
        const n = plan.vehicleIds.length;
        const which = plan.carsFrom === 'set' && kind ? fill(S.carsSuggested, { kind: kind.label, n }) : fill(S.carsPicked, { n });
        const list = plan.vehicleIds.map(id => names[id] ?? `#${id}`).join(', ');
        lines.push({ label: S.cars, text: n ? `${which}: ${list}` : S.carsNone });
    } else {
        lines.push({ label: S.cars, text: S.carsKept });
    }

    const { driving } = config;
    const drive = [];
    if (a.dailyMi != null) drive.push(fill(S.perDay, { d: distanceWords(a.dailyMi, units) }));
    const share = byKey(driving.highway.options, a.highway);
    if (share) drive.push(share.label.toLowerCase());
    if (a.speedMph != null) drive.push(fill(S.highwaySpeed, { s: speedWords(a.speedMph, units) }));
    if (a.tripMi != null) drive.push(fill(S.tripLength, { d: distanceWords(a.tripMi, units) }));
    if (byKey(driving.trips.options, a.trips)?.week) drive.push(S.longDay);
    if (drive.length) lines.push({ label: S.driving, text: drive.join(' · ') });

    const weather = [];
    if (plan.season) weather.push(fill(S.season, { season: plan.season.season, temp: tempWords(plan.season.tempF, units) }));
    if (a.mountains != null) weather.push(a.mountains ? altitudeWords(config.weather.mountains.ft, units) : config.weather.mountains.low.toLowerCase());
    if (weather.length) lines.push({ label: S.weather, text: weather.join(' · ') });

    const charging = [];
    const home = byKey(config.money.home.options, a.home);
    if (home) charging.push(home.label.toLowerCase());
    if (a.homePrice != null && home?.key !== 'none') charging.push(`${money(a.homePrice)}/kWh`);
    if (charging.length) lines.push({ label: S.charging, text: charging.join(', ') });

    const gas = [];
    if (a.gasMpg != null) gas.push(`${a.gasMpg} mpg`);
    if (a.gasPrice != null) gas.push(`${money(a.gasPrice)}/gal`);
    if (gas.length) lines.push({ label: S.gas, text: gas.join(' at ') });

    return lines;
}
