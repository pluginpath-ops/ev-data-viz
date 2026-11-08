/**
 * The setup wizard (PROTOTYPE): a few plain questions, turned into the site's
 * own settings. Every question → setting rule lives here, so tuning the canned
 * answers is one file.
 *
 * The wizard writes nothing itself. `planFromAnswers` returns a plan — which
 * vehicles, which chart, and a patch for each settings object App already owns
 * (the correction target, Cost & Time, Road Trip, the vehicle table's
 * assumptions) — and App's `applySetup` lays it over the current state through
 * the setters every other control uses. So the URL, the pop-out and a shared
 * link follow without the wizard knowing they exist.
 *
 * A skipped question (null) leaves its settings as they are: skipping means
 * "don't touch", not "reset".
 *
 * The wizard speaks mph, °F and miles whatever the reader's units.
 *
 * Pure module — no React, no data access.
 */
import { specProvenance } from './specHelpers';
import { vehicleDataCategories } from './vehicleDataCategories';
import { compareCuratedOrder } from './vehicleOrder';
import { categoryForMode, labelForMode } from '../constants/chartNav';
import { HOME_LEVELS } from '../constants/costToDrive';

// ── What do you want to know? ───────────────────────────────────────────────

/** Each goal lands on one chart mode (chartNav.js keys, frozen). */
export const SETUP_GOALS = [
    { key: 'cost',     label: 'What it costs to run', detail: 'Per month, against a gas car', mode: 'drivecost' },
    { key: 'range',    label: 'How far it goes',      detail: 'Real highway range',           mode: 'range' },
    { key: 'charging', label: 'How fast it charges',  detail: 'On a fast charger',            mode: 'charging' },
    { key: 'roadtrip', label: 'Road trips',           detail: 'Total time, stops and all',    mode: 'roadtrip' },
    { key: 'specs',    label: 'Specs side by side',   detail: 'Price, size, battery…',        mode: 'specstable' },
];

/** Where a reader who skips the goal lands: cost is the question most people have. */
export const DEFAULT_GOAL = 'cost';

const goalOf = (key) => SETUP_GOALS.find(g => g.key === key) ?? SETUP_GOALS.find(g => g.key === DEFAULT_GOAL);

// ── Which cars? ─────────────────────────────────────────────────────────────

/**
 * How many vehicles a starter set selects (owner: "top 4–6"). Enough to
 * compare, few enough to read.
 */
export const STARTER_SET_SIZE = 5;

/** Under this length (in) an SUV counts as small. Round figure: a Model Y is ~188, an EV6 ~184. */
const SMALL_SUV_MAX_IN = 186;
/** At or over this base price (USD) a car counts as luxury. */
const LUXURY_MIN_USD = 70000;
/** At or under this base price (USD) a car counts as affordable. */
const AFFORDABLE_MAX_USD = 45000;

const hasTag = (v, ...names) => (v.tags || []).some(t => names.includes(t.name));

/**
 * A canned set of vehicles for a reader who doesn't know which cars. Matched on
 * tags (today they are body styles) and specs. NOT every match: only the top
 * STARTER_SET_SIZE complete ones (starterSetIds).
 *
 * `curated` is an optional hand-picked id list that goes first, in its own
 * order; the curated vehicle order fills the rest. Empty until the owner picks.
 *
 * The name "starter set" is provisional — see docs/vocabulary.md, Open names.
 */
export const STARTER_SETS = [
    { key: 'small-suv',  label: 'Small SUV',    curated: [],
      match: (v, s) => hasTag(v, 'CUV', 'Crossover') || (hasTag(v, 'SUV') && s.lengthIn != null && s.lengthIn < SMALL_SUV_MAX_IN) },
    { key: 'suv',        label: 'Family SUV',   curated: [],
      match: (v, s) => hasTag(v, 'SUV') && !hasTag(v, 'CUV', 'Crossover') && !(s.lengthIn != null && s.lengthIn < SMALL_SUV_MAX_IN) },
    { key: 'sedan',      label: 'Sedan',        curated: [], match: (v) => hasTag(v, 'Sedan', '4-door') },
    { key: 'small-car',  label: 'Small car',    curated: [], match: (v) => hasTag(v, 'Hatch') },
    { key: 'pickup',     label: 'Pickup',       curated: [], match: (v) => hasTag(v, 'Truck') },
    { key: 'luxury',     label: 'Luxury',       curated: [], match: (v, s) => s.priceUsd != null && s.priceUsd >= LUXURY_MIN_USD },
    { key: 'affordable', label: 'Under $45k',   curated: [], match: (v, s) => s.priceUsd != null && s.priceUsd <= AFFORDABLE_MAX_USD },
    { key: 'popular',    label: 'Most popular', curated: [], match: () => true },
];

/** The set a reader who skips the cars, with nothing selected, gets. */
export const DEFAULT_STARTER_SET = 'popular';

/**
 * Whether a vehicle has all three kinds of data a new reader's charts need: an
 * EPA configuration, a charging test and a range test. Read through
 * vehicleDataCategories, so it counts what the card's "Tests:" pills count.
 */
export function isCompleteVehicle(v) {
    const c = vehicleDataCategories(v);
    return c.epa > 0 && c.charging > 0 && c.range > 0;
}

/**
 * The vehicles a starter set selects, at most `count`: complete vehicles that
 * match, the set's curated ids first, then the curated vehicle order
 * (Vehicles & Specs' default sort) — one per make and model there, so a set
 * is five cars, not five trims of one.
 */
export function starterSetIds(setKey, vehicles = [], { count = STARTER_SET_SIZE, sets = STARTER_SETS } = {}) {
    const set = sets.find(s => s.key === setKey);
    if (!set) return [];
    const candidates = vehicles.filter(v => {
        if (!isCompleteVehicle(v)) return false;
        const specs = specProvenance(v, vehicles).specs ?? {};
        return set.match(v, {
            priceUsd: numberOrNull(specs.pricing?.base_price_usd),
            lengthIn: numberOrNull(specs.dimensions?.length_in),
        });
    });
    const byId = new Map(candidates.map(v => [String(v.id), v]));
    const modelOf = (v) => `${v.make ?? ''}|${v.model ?? v.name}`.toLowerCase();

    const out = [];
    const models = new Set();
    const take = (v) => { out.push(v.id); models.add(modelOf(v)); };
    for (const id of set.curated ?? []) {
        const v = byId.get(String(id));
        if (v && !out.includes(v.id)) take(v);
        if (out.length === count) return out;
    }
    for (const v of [...candidates].sort((a, b) => compareCuratedOrder(a, b))) {
        if (out.length === count) break;
        if (!out.includes(v.id) && !models.has(modelOf(v))) take(v);
    }
    return out;
}

function numberOrNull(x) {
    const n = Number(x);
    return x == null || x === '' || !Number.isFinite(n) ? null : n;
}

// ── How do you drive? ───────────────────────────────────────────────────────

/** Share of a day's miles on the highway; Cost & Time stores the city share. */
export const HIGHWAY_SHARES = [
    { key: 'town',    label: 'Mostly town', highwayPct: 20 },
    { key: 'mix',     label: 'A mix',       highwayPct: 50 },
    { key: 'highway', label: 'Mostly highway', highwayPct: 80 },
];

/** Highway speeds offered, mph. On the correction's and Cost & Time's 5 mph grid. */
export const HIGHWAY_SPEEDS = [65, 70, 75, 80];

/**
 * The weather a reader drives in. `correctF` is the one temperature the charts
 * correct range to — the hard season, since that is the range a reader has to
 * live with. The rest are Cost & Time's two seasons.
 */
export const CLIMATES = [
    { key: 'mild',     label: 'Mild',          detail: 'Rarely freezes',   correctF: 70, summerF: 80,  winterF: 45, winterMonths: 2, season: 'winter' },
    { key: 'hot',      label: 'Hot summers',   detail: '95°F and up',      correctF: 95, summerF: 100, winterF: 50, winterMonths: 1, season: 'summer' },
    { key: 'cold',     label: 'Cold winters',  detail: 'Below freezing',   correctF: 30, summerF: 80,  winterF: 20, winterMonths: 4, season: 'winter' },
    { key: 'veryCold', label: 'Very cold',     detail: 'Near 0°F',         correctF: 10, summerF: 75,  winterF: 0,  winterMonths: 6, season: 'winter' },
];

/** "I live up high": the altitude both the correction and Cost & Time use, ft. */
export const MOUNTAIN_FT = 5000;

/** How often a reader takes a long trip. Only "most weeks" changes the week Cost & Time prices. */
export const TRIP_FREQUENCIES = [
    { key: 'rarely', label: 'Rarely' },
    { key: 'few',    label: 'A few a year' },
    { key: 'weekly', label: 'Most weeks' },
];

/** A typical road trip, miles. Cost & Time's long day stops at 400. */
export const TRIP_DISTANCES = [200, 400, 700];

// ── Charging and money ──────────────────────────────────────────────────────

/** Charging at home, and the Cost & Time charger level (HOME_LEVELS index) it means. */
export const HOME_CHARGING = [
    { key: 'charger', label: 'Charger at home', detail: '240 V, 32 A',  level: HOME_LEVELS.findIndex(l => l.volts === 240 && l.amps === 32) },
    { key: 'outlet',  label: 'Wall outlet',     detail: '120 V only',   level: HOME_LEVELS.findIndex(l => l.volts === 120) },
    // Cost & Time has no "no home charging" setting yet: every week assumes a
    // home plug. Kept as an answer so the gap shows (see notes).
    { key: 'none',    label: 'No home charging', detail: 'Public chargers only', level: null },
];

/** The number fields' limits — Cost & Time's own, so nothing the wizard takes is clamped later. */
export const NUMBER_LIMITS = {
    dailyMi:   { min: 5,    max: 400 },
    homePrice: { min: 0.05, max: 0.60 },
    gasMpg:    { min: 5,    max: 60 },
    gasPrice:  { min: 1,    max: 8 },
};

// ── Answers → plan ──────────────────────────────────────────────────────────

/** Every question unanswered. */
export const EMPTY_ANSWERS = Object.freeze({
    goal: null,
    cars: null,        // { how: 'keep' } | { how: 'pick', ids: [] } | { how: 'set', set: key }
    dailyMi: null,
    highway: null,
    speedMph: null,
    climate: null,
    mountains: null,   // true | false | null
    home: null,
    homePrice: null,
    gasMpg: null,
    gasPrice: null,
    trips: null,
    tripMi: null,
});

const pick = (list, key) => list.find(x => x.key === key) ?? null;

/**
 * What the answers set. Each patch holds only what was answered.
 *
 *   mode            the chart mode to open
 *   vehicleIds      the new selection, or null to keep the reader's
 *   carsFrom        'pick' | 'set' | 'keep' — for the summary
 *   setKey          the starter set used, if any
 *   correction      patch for chartConfig.correctionTarget
 *   assumptions     patch for chartConfig.assumptions (the vehicle table)
 *   costToDrive     patch for Cost & Time's settings
 *   roadTrip        patch for roadTripConfig (Road Trip, Trip Optimizer)
 *   unset           answers the site has no setting for, in words
 */
export function planFromAnswers(answers = EMPTY_ANSWERS, { vehicles = [], selectedIds = [] } = {}) {
    const a = { ...EMPTY_ANSWERS, ...answers };
    const goal = goalOf(a.goal);
    const plan = {
        mode: goal.mode,
        vehicleIds: null, carsFrom: 'keep', setKey: null,
        correction: {}, assumptions: {}, costToDrive: {}, roadTrip: {}, unset: [],
    };

    // Cars. Never an empty selection: that is the one result the wizard must
    // not produce, so anything short of a real choice falls to a starter set.
    const cars = resolveCars(a.cars, selectedIds);
    if (cars.how === 'pick') {
        plan.vehicleIds = [...cars.ids];
        plan.carsFrom = 'pick';
    } else if (cars.how === 'set') {
        plan.vehicleIds = starterSetIds(cars.set, vehicles);
        plan.carsFrom = 'set';
        plan.setKey = cars.set;
    }

    // Driving. Daily miles mean a weekday commuter's week; a weekly road trip
    // turns Saturday into a long day.
    if (a.dailyMi != null) {
        Object.assign(plan.costToDrive, { dailyMi: a.dailyMi, week: 'DDDDDOO', planned: 0 });
    }
    const share = pick(HIGHWAY_SHARES, a.highway);
    if (share) plan.costToDrive.dailyCity = 100 - share.highwayPct;
    if (a.speedMph != null) {
        plan.correction.speedMph = a.speedMph;
        Object.assign(plan.costToDrive, { dailyMph: a.speedMph, longMph: a.speedMph });
        plan.roadTrip.speed = a.speedMph;
    }
    if (a.trips === 'weekly') {
        plan.costToDrive.week = `${(plan.costToDrive.week ?? 'DDDDDOO').slice(0, 5)}LO`;
    }
    if (a.tripMi != null) {
        plan.roadTrip.totalDistance = a.tripMi;
        plan.roadTrip.optimizerDistance = a.tripMi;
        plan.costToDrive.longMi = Math.min(400, a.tripMi);
    }

    // Weather.
    const climate = pick(CLIMATES, a.climate);
    if (climate) {
        plan.correction.temperatureF = climate.correctF;
        Object.assign(plan.costToDrive, {
            summerF: climate.summerF, winterF: climate.winterF,
            winterMonths: climate.winterMonths, season: climate.season,
        });
    }
    if (a.mountains != null) {
        const ft = a.mountains ? MOUNTAIN_FT : 0;
        plan.correction.altitudeFt = ft;
        plan.costToDrive.elevationFt = ft;
    }

    // Charging and money. The vehicle table and Cost & Time each hold a home
    // price; the wizard sets both so they agree.
    const home = pick(HOME_CHARGING, a.home);
    if (home?.level != null) plan.costToDrive.level = home.level;
    if (home && home.level == null) plan.unset.push('No home charging — Cost & Time always assumes a home plug');
    if (a.homePrice != null) {
        plan.costToDrive.homePrice = a.homePrice;
        plan.assumptions.homePrice = a.homePrice;
    }
    if (a.gasMpg != null) Object.assign(plan.costToDrive, { gasCity: a.gasMpg, gasHwy: a.gasMpg });
    if (a.gasPrice != null) plan.costToDrive.gasPrice = a.gasPrice;
    if (a.trips === 'few' || a.trips === 'rarely') {
        plan.unset.push('How often you take road trips — Cost & Time prices one typical week');
    }

    return plan;
}

function resolveCars(cars, selectedIds) {
    if (cars?.how === 'pick' && cars.ids?.length) return cars;
    if (cars?.how === 'set' && cars.set) return cars;
    if (selectedIds.length && (!cars || cars.how === 'keep')) return { how: 'keep' };
    return { how: 'set', set: DEFAULT_STARTER_SET };
}

// ── Plan → words ────────────────────────────────────────────────────────────

const money = (n, digits = 2) => `$${Number(n).toFixed(digits)}`;

/**
 * The plan as the summary step says it: `[{ label, text }]`, only what will
 * change. `names` maps a vehicle id to its display name.
 */
export function planSummary(plan, answers = EMPTY_ANSWERS, names = {}) {
    const a = { ...EMPTY_ANSWERS, ...answers };
    const lines = [];
    lines.push({ label: 'Opens', text: `${categoryForMode(plan.mode).label} › ${labelForMode(plan.mode)}` });

    if (plan.vehicleIds) {
        const set = STARTER_SETS.find(s => s.key === plan.setKey);
        const which = plan.carsFrom === 'set' && set ? `${set.label}, ${plan.vehicleIds.length} suggested` : `${plan.vehicleIds.length} you picked`;
        const list = plan.vehicleIds.map(id => names[id] ?? `#${id}`).join(', ');
        lines.push({ label: 'Cars', text: plan.vehicleIds.length ? `${which}: ${list}` : 'none match — pick some yourself' });
    } else {
        lines.push({ label: 'Cars', text: 'the ones you have selected' });
    }

    const driving = [];
    if (a.dailyMi != null) driving.push(`${a.dailyMi} mi a day`);
    const share = pick(HIGHWAY_SHARES, a.highway);
    if (share) driving.push(share.label.toLowerCase());
    if (a.speedMph != null) driving.push(`${a.speedMph} mph on the highway`);
    if (a.tripMi != null) driving.push(`road trips of ~${a.tripMi} mi`);
    if (a.trips === 'weekly') driving.push('one long day a week');
    if (driving.length) lines.push({ label: 'Driving', text: driving.join(' · ') });

    const weather = [];
    const climate = pick(CLIMATES, a.climate);
    if (climate) weather.push(`range at ${climate.correctF}°F`);
    if (a.mountains != null) weather.push(a.mountains ? `${MOUNTAIN_FT.toLocaleString('en-US')} ft` : 'near sea level');
    if (weather.length) lines.push({ label: 'Weather', text: weather.join(' · ') });

    const charging = [];
    const home = pick(HOME_CHARGING, a.home);
    if (home && home.level != null) charging.push(home.label.toLowerCase());
    if (a.homePrice != null) charging.push(`${money(a.homePrice)}/kWh`);
    if (charging.length) lines.push({ label: 'Charging', text: charging.join(', ') });

    const gas = [];
    if (a.gasMpg != null) gas.push(`${a.gasMpg} mpg`);
    if (a.gasPrice != null) gas.push(`${money(a.gasPrice)}/gal`);
    if (gas.length) lines.push({ label: 'Gas car', text: gas.join(' at ') });

    return lines;
}
