/**
 * Cost to Drive — the reader's settings, their sliders, and the fixed figures
 * the week is simulated with. Single source of truth for all three; the plan is
 * docs/cost-to-drive-plan.md.
 *
 * Leaf module: imports nothing from the app, so the key codec (which the short
 * link reaches before the constants are seeded) can read it.
 */

/**
 * The home charger levels a reader picks from. 40 A and 64 A were dropped on
 * purpose (owner, 2026-11-07): six steps cover the question, and two more made
 * the picker a wall.
 */
export const HOME_LEVELS = [
    { volts: 120, amps: 12 },
    { volts: 240, amps: 16 },
    { volts: 240, amps: 24 },
    { volts: 240, amps: 32 },
    { volts: 240, amps: 48 },
    { volts: 240, amps: 80 },
    // No home charging (owner, 2026-11-08): every kWh is bought on the road,
    // at the fast-charging price, through the same fast-stop rule. Last, so the
    // level indexes every shared key already holds keep their meaning — the
    // key stores the index. No public Level 2 price exists to use instead.
    { volts: 0, amps: 0, none: true },
];

/** The level index for no home charging. */
export const NO_HOME_LEVEL = HOME_LEVELS.findIndex(l => l.none);

/** A level's power at the wall, kW. 0 for no home charging. */
export const levelKw = (level) => (level.volts * level.amps) / 1000;

/**
 * What reaches the pack from a 120 V wall outlet, for a car at the site-wide
 * 240 V figure (ASSUMED_CHARGER_EFF). Lower: the car's own electronics draw a
 * fixed few hundred watts whatever the rate, and at 1.4 kW that is a large
 * share. A round figure, not a measurement; the page says it is assumed.
 *
 * A car with its own EPA 240 V figure gets this scaled by it — its figure ×
 * this ÷ the site-wide one (owner, 2026-11-08): the same charger and battery
 * do the work on either outlet, so a car that does well on one does well on
 * the other. Ratio or a fixed gap differ by under half a point across the
 * real range.
 */
export const WALL_OUTLET_CHARGER_EFF = 0.80;

/**
 * Below this, parked outside, a car warms its battery before it charges and
 * before it drives — energy not priced here. Above it, or in a garage, the
 * battery warms itself as it charges and the cost is small. The owner's own
 * experience (2026-11-08), not a measurement; it only decides when the page
 * warns.
 */
export const PACK_WARMING_BELOW_F = 40;

/** The onboard charger assumed when a car's `max_ac_kw` is blank, kW; said so where used. */
export const ASSUMED_ONBOARD_AC_KW = 11.5;

/**
 * A detour's minutes become miles at this speed, off the route and back. A
 * guess the owner flagged as one (2026-11-07): it is the one place the
 * charger's location enters the model, kept to a single number so it is easy
 * to revisit.
 */
export const DETOUR_MPH = 40;

/**
 * The fast-stop rule (docs/cost-to-drive-plan.md). A stop adds at least
 * MIN_STOP_ADD %, so a stop is never a 30→37% top-up; it may go past the
 * reader's cap up to STRETCH_CAP_TO % when that saves a second stop; and a day
 * that starts below "stop to charge by" waits until the floor plus the detour's
 * energy plus LATE_STOP_MARGIN % rather than stopping at mile 0.
 */
export const MIN_STOP_ADD = 10;
export const STRETCH_CAP_TO = 80;
export const LATE_STOP_MARGIN = 2;

/**
 * When a day drives, as hours of the day and the share of its miles in each
 * span. Two spans so a stop has a time and a mile, and a planned stop has a
 * gap to sit in. A Long day drives out in the morning and back in the
 * afternoon; a Daily is a commute each way.
 */
export const DAY_SPANS = {
    L: [{ from: 7, to: 12, share: 0.45 }, { from: 12, to: 18, share: 0.55 }],
    D: [{ from: 7, to: 8, share: 0.5 }, { from: 17, to: 18, share: 0.5 }],
    O: [],
};


/**
 * Home Charger's "enough from here": the first level whose fast-charging time a
 * week is within this many minutes of the best any level manages. Past it, a
 * bigger charger buys nothing the reader would notice.
 */
export const ENOUGH_MARGIN_MIN = 5;

/** The weeks simulated before the one reported, so Monday starts from a settled state. */
export const SETTLE_WEEKS = 2;

/** The DC rate assumed for a car with no charging test, no 10→80% time and no max DC spec, kW. */
export const FALLBACK_DC_KW = 50;

/**
 * The temperature EPA's two-cycle tests are driven at, °F — the lab's, so a
 * label figure is re-priced FROM it to the reader's season.
 */
export const EPA_LAB_TEMP_F = 75;

/**
 * The gas car's cold loss: the share of its EPA mpg lost at GAS_COLD_AT_F,
 * against EPA_LAB_TEMP_F, by kind of driving. Taken as a straight line between
 * the two, so half the loss at about 47°F, more below 20°F, and none at or
 * above the lab's temperature (summer A/C is not priced).
 *
 * City: fueleconomy.gov's cold-weather page, from Oak Ridge's comparison of
 * EPA city tests at 20°F and 77°F — about 15% for a conventional gas car
 * (10–20%; short trips 15–33%). Highway: no study gives one; 7% is denser air
 * on drag plus thicker oil and tires, about half the city loss. Owner asked
 * for "a small hit" (2026-11-08).
 */
export const GAS_COLD_AT_F = 20;
export const GAS_COLD_LOSS = Object.freeze({ city: 0.15, hwy: 0.07 });

/** Days of the week, Monday first, as the week setting stores them. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A day's type: Daily, Long day or Off. */
export const DAY_TYPES = ['D', 'L', 'O'];

/**
 * Every setting, its slider and its default. The order is the key's field
 * order (costToDriveKey.js) — APPEND ONLY: a field moved or removed changes
 * what every key already shared says.
 *
 * kinds: 'num' (min, max, step), 'bool', 'enum' (values), 'week' (7 day
 * types), 'mask' (7 days, Monday the low bit).
 *
 * `step` is what a value is stored to; `spin`, where given, is what the
 * field's spinner moves by. The two miles fields take any whole mile but spin
 * in fives (owner, 2026-11-07: "allow any value"); they were stored in fives
 * until key version 2, so a version-1 key reads them in fives
 * (costToDriveKey.js).
 */
export const COST_TO_DRIVE_FIELDS = [
    { key: 'level',          kind: 'num',  min: 0,    max: HOME_LEVELS.length - 1, step: 1, def: 4 },
    { key: 'plugFrom',       kind: 'num',  min: 0,    max: 23,   step: 1,    def: 22 },
    { key: 'plugUntil',      kind: 'num',  min: 0,    max: 23,   step: 1,    def: 7 },
    { key: 'chargeTo',       kind: 'num',  min: 50,   max: 100,  step: 5,    def: 80 },
    { key: 'fullBeforeLong', kind: 'bool', def: true },
    { key: 'homePrice',      kind: 'num',  min: 0.05, max: 0.60, step: 0.01, def: 0.17 },
    { key: 'week',           kind: 'week', def: 'LDLDLDO' },
    { key: 'planned',        kind: 'mask', def: 0b1000000 },
    { key: 'dailyMi',        kind: 'num',  min: 5,    max: 400,  step: 1,    def: 45, spin: 5 },
    { key: 'dailyMph',       kind: 'num',  min: 45,   max: 85,   step: 5,    def: 70 },
    { key: 'dailyCity',      kind: 'num',  min: 0,    max: 100,  step: 5,    def: 40 },
    { key: 'longMi',         kind: 'num',  min: 5,    max: 400,  step: 1,    def: 220, spin: 5 },
    { key: 'longMph',        kind: 'num',  min: 45,   max: 85,   step: 5,    def: 70 },
    { key: 'longCity',       kind: 'num',  min: 0,    max: 100,  step: 5,    def: 15 },
    { key: 'detourMin',      kind: 'num',  min: 5,    max: 30,   step: 1,    def: 10 },
    { key: 'stopBy',         kind: 'num',  min: 10,   max: 50,   step: 5,    def: 30 },
    { key: 'capTo',          kind: 'num',  min: 50,   max: 90,   step: 5,    def: 70 },
    { key: 'keepAbove',      kind: 'num',  min: 5,    max: 30,   step: 1,    def: 10 },
    { key: 'startMin',       kind: 'num',  min: 0,    max: 15,   step: 1,    def: 5 },
    { key: 'fastPrice',      kind: 'num',  min: 0.15, max: 1.00, step: 0.01, def: 0.48 },
    { key: 'season',         kind: 'enum', values: ['winter', 'summer'], def: 'winter' },
    { key: 'summerF',        kind: 'num',  min: 40,   max: 110,  step: 5,    def: 75 },
    { key: 'winterF',        kind: 'num',  min: -20,  max: 50,   step: 5,    def: 15 },
    { key: 'winterMonths',   kind: 'num',  min: 0,    max: 12,   step: 1,    def: 4 },
    { key: 'elevationFt',    kind: 'num',  min: 0,    max: 8000, step: 100,  def: 800 },
    { key: 'gasCity',        kind: 'num',  min: 5,    max: 60,   step: 1,    def: 18 },
    { key: 'gasHwy',         kind: 'num',  min: 5,    max: 60,   step: 1,    def: 24 },
    // $4 (owner, 2026-11-08): nearer the national average than $3.20 was
    // (AAA, about $4.17 on 2026-11-01). A round figure, not a live feed.
    { key: 'gasPrice',       kind: 'num',  min: 1.00, max: 8.00, step: 0.01, def: 4.00 },
    { key: 'gasTank',        kind: 'num',  min: 5,    max: 40,   step: 1,    def: 26 },
    { key: 'gasFillAt',      kind: 'num',  min: 5,    max: 50,   step: 5,    def: 15 },
    // 5 min (owner, 2026-11-08): about a minute to get out and start the pump,
    // 2–3 to fill, half a minute to two to pay. Was 8 with a detour in it.
    { key: 'gasFillMin',     kind: 'num',  min: 2,    max: 30,   step: 1,    def: 5 },
    { key: 'efficiencyFrom', kind: 'enum', values: ['tested', 'epa'], def: 'tested' },
    // When a planned fast charge happens: at this hour on a day off; on a
    // driving day, in the gap between drives nearest it (owner, 2026-11-07:
    // "~5pm, or perhaps configurable").
    { key: 'plannedHour',    kind: 'num',  min: 0,    max: 23,   step: 1,    def: 17 },
];

/** The settings an untouched page shows. */
export const DEFAULT_COST_TO_DRIVE = Object.freeze(
    Object.fromEntries(COST_TO_DRIVE_FIELDS.map(f => [f.key, f.def])));

/** The field for a setting key, or null. */
export const costToDriveField = (key) => COST_TO_DRIVE_FIELDS.find(f => f.key === key) ?? null;

/**
 * Your Driving's "Start from" buttons: a week laid over the current settings,
 * which keep their charger, prices and season. Reset is the defaults whole.
 */
export const COST_TO_DRIVE_PRESETS = [
    { key: 'commuter', label: 'Commuter, 40 mi', settings: { week: 'DDDDDOO', dailyMi: 40, dailyCity: 40, planned: 0 } },
    { key: 'roadWarrior', label: 'Road warrior, 220 mi days', settings: { week: 'LLDLLDO', longMi: 220, longCity: 15, dailyMi: 45, planned: 0b1000000 } },
];

/**
 * Your gas car's one-click cars: EPA city and highway mpg (2025 models) and the
 * tank, rounded to the gallon the field takes. A starting point, not a
 * comparison of these cars; each says which version it is.
 */
export const GAS_CAR_PRESETS = [
    { key: 'f150',  label: 'F-150', title: 'Ford F-150 2.7 L EcoBoost 4WD', settings: { gasCity: 18, gasHwy: 23, gasTank: 23 } },
    { key: 'civic', label: 'Civic', title: 'Honda Civic sedan 2.0 L', settings: { gasCity: 32, gasHwy: 41, gasTank: 12 } },
    { key: 'rav4',  label: 'RAV4',  title: 'Toyota RAV4 2.5 L AWD', settings: { gasCity: 27, gasHwy: 33, gasTank: 15 } },
    { key: 'x3',    label: 'X3',    title: 'BMW X3 30 xDrive', settings: { gasCity: 27, gasHwy: 33, gasTank: 17 } },
    { key: 'pilot', label: 'Pilot', title: 'Honda Pilot 3.5 L AWD', settings: { gasCity: 19, gasHwy: 25, gasTank: 19 } },
];
