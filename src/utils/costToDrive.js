/**
 * Cost to Drive — a reader's week of driving, priced for one vehicle and for
 * their gas car (docs/cost-to-drive-plan.md).
 *
 * Two steps. `costToDriveVehicle` resolves what the week needs from a vehicle
 * record — usable kWh, energy per mile for each kind of day in each season, the
 * home charging rate, and minutes for a fast charge between two SoCs — once,
 * and says where each came from. `simulateWeek` then drives the week hour by
 * hour on those numbers alone, so the rule is testable without a vehicle.
 *
 * Pure module — no React.
 */
import {
    HOME_LEVELS, levelKw, ASSUMED_ONBOARD_AC_KW, PACK_WARMING_BELOW_F, DETOUR_MPH,
    MIN_STOP_ADD, MIN_STOP_MINUTES, MONTHLY_STOP_BELOW, STRETCH_CAP_TO, LATE_STOP_MARGIN, DAY_SPANS, PLANNED_HOUR,
    SETTLE_WEEKS, FALLBACK_DC_KW, EPA_LAB_TEMP_F, GAS_COLD_AT_F, GAS_COLD_LOSS, WEEKDAYS, ENOUGH_MARGIN_MIN,
    GAS_CAR_PRESETS, GAS_CAR_FALLBACK_NAME,
} from '../constants/costToDrive';
import { ratePlan, CUSTOM_TIER_NAMES, TIER_LETTERS } from '../constants/ratePlans';
import {
    ASSUMED_CHARGER_EFF, FIXED_DRAW_W, PHANTOM_DRAIN_PCT_DAY, BATTERY_WARMING_KWH, DC_FAST_LOSS, HWFET_AVG_MPH, UDDS_AVG_MPH, STANDARD_CONDITIONS,
} from '../constants/epa';
import { correctionFactor } from './conditionCorrection';
import { compositeRange } from './compositeRange';
import { chargeTimeSession } from './chargeWindows';
import { val } from './calcTrace';
import { CHARGER_EFF_BASIS } from './vehicleFigures';

const WEEKS_PER_MONTH = 52 / 12;
const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;

/** Hours between two hours of the day: 10 pm to 7 am is 9; the same hour twice is all 24. */
const hoursBetween = (from, until) => ((until - from + 24) % 24) || 24;

/** Hours the car is plugged in on a driving day's night: 10 pm to 7 am is 9. */
export const plugHours = (s) => hoursBetween(s.plugFrom, s.plugUntil);

/** Hours the car is plugged in on a day off's: its own window. */
export const offHours = (s) => hoursBetween(s.offFrom, s.offUntil);

/**
 * Day d's plug-in window, in hours of that day (it may run past 24): a day
 * marked Off uses the days-off window (owner, 2026-11-17), any other day the
 * driving days'.
 */
export function windowOf(s, d) {
    const off = s.week[d] === 'O';
    const from = off ? s.offFrom : s.plugFrom;
    return { from, to: from + hoursBetween(from, off ? s.offUntil : s.plugUntil) };
}

/**
 * Each night's plug-in window as a span of the week's hours (Monday 0:00 = 0):
 * `{ from, to, spans }`, `spans` the stretches the charger ran (`[from, to]`
 * pairs) — with a time-of-use plan, not always one stretch from the start. The
 * rest of the window is the spare plug-in time. A window that runs past Sunday
 * midnight is cut at the week's end and its rest starts the week, as the
 * week's line does.
 *
 * @param {Array<{ window: { from, to }, spans: Array<[number, number]> }>} nights  Monday's first, in hours of the week
 */
export function plugWindows(nights) {
    const WEEK = 7 * 24;
    const clip = (spans, lo, hi, shift) => spans
        .map(([a, b]) => [Math.max(a, lo) - shift, Math.min(b, hi) - shift])
        .filter(([a, b]) => b > a + 1e-9);
    return nights.flatMap(({ window: { from, to }, spans }) => {
        if (to <= WEEK) return [{ from, to, spans: clip(spans, from, to, 0) }];
        return [
            { from, to: WEEK, spans: clip(spans, from, WEEK, 0) },
            { from: 0, to: to - WEEK, spans: clip(spans, WEEK, to, WEEK) },
        ];
    });
}

// ── Electricity rates ────────────────────────────────────────────────────────

/**
 * The home rate for a season: `{ tiers, prices, weekday, weekend }` (see
 * constants/ratePlans.js), or null for One price. A custom plan's weekend
 * prices its peak hours as the tier below when "Weekends are off-peak".
 */
export function rateSeason(s, season = s.season) {
    if (s.rate === 'flat') return null;
    const plan = ratePlan(s.rate);
    if (plan) return plan.seasons[season];
    return {
        tiers: CUSTOM_TIER_NAMES,
        prices: [s.rateHigh, s.rateMid, s.rateLow],
        weekday: s.rateHours,
        weekend: s.rateWeekendOff ? s.rateHours.replaceAll('H', 'M') : s.rateHours,
    };
}

/** An hour of the week's tier index (0 dearest) in a rate season; Saturday and Sunday read the weekend map. */
export function tierAt(rate, weekHour) {
    const h = ((Math.floor(weekHour) % 168) + 168) % 168;
    const map = h >= 5 * 24 ? rate.weekend : rate.weekday;
    return TIER_LETTERS.indexOf(map[h % 24]);
}

/** A function from an hour of the week to the home price there, $/kWh. */
export function homePricing(s, season = s.season) {
    const rate = rateSeason(s, season);
    if (!rate) return () => s.homePrice;
    return (weekHour) => rate.prices[tierAt(rate, weekHour)];
}

/**
 * A plan as custom fields: its season's hours, prices and weekend rule, so an
 * edit to a picked plan starts from what the reader sees (the gas car's rule:
 * editing makes it the reader's own). Empty for One price or a custom plan.
 */
export function customFromPlan(s, season = s.season) {
    const plan = ratePlan(s.rate);
    if (!plan) return {};
    const r = plan.seasons[season];
    return {
        rateHours: r.weekday,
        rateHigh: r.prices[0], rateMid: r.prices[1], rateLow: r.prices[2],
        rateWeekendOff: r.weekend !== r.weekday,
    };
}

/** A function from an hour of the week to its tier (0 dearest); null at One price. */
export function homeTiering(s, season = s.season) {
    const rate = rateSeason(s, season);
    return rate ? (weekHour) => tierAt(rate, weekHour) : null;
}

/**
 * The season's tiers for the charts: their names, and the **base** — the
 * cheapest tier its hours use (Super off-peak, or Off-peak where a plan has no
 * cheaper one), drawn in the car's plain color; dearer ones are striped
 * (owner, 2026-11-17). Null at One price.
 */
export function rateTiers(s, season = s.season) {
    const rate = rateSeason(s, season);
    if (!rate) return null;
    const used = [...rate.weekday, ...rate.weekend].map(c => TIER_LETTERS.indexOf(c));
    return { names: rate.tiers.map((n, t) => n ?? CUSTOM_TIER_NAMES[t]), base: Math.max(...used) };
}

/** The rate plan's name for a subtitle or a note: the plan's, "your time-of-use plan", or null for One price. */
export function ratePlanName(s) {
    if (s.rate === 'flat') return null;
    return ratePlan(s.rate)?.label ?? 'your time-of-use plan';
}

/**
 * Charge a night in its cheapest hours (owner, 2026-11-17): the window cut
 * into hour slots on the clock, filled cheapest first, ties earliest — so at
 * One price the night runs from plug-in, as it always has — and into dearer
 * hours where the cheap ones cannot hold it. At most `wallKwh`.
 *
 * @returns {{ spans: Array<{ from, to, kwh, price }>, kwh: number, cost: number }}  spans in time order
 */
export function chargeInCheapestHours({ from, to, kw, wallKwh, priceAt, tierOf = null }) {
    const slots = [];
    for (let a = from; a < to - 1e-9;) {
        const b = Math.min(to, Math.floor(a + 1e-9) + 1);
        slots.push({ from: a, to: b, price: priceAt(a), tier: tierOf ? tierOf(a) : null });
        a = b;
    }
    const order = slots.map((_, i) => i).sort((i, j) => slots[i].price - slots[j].price || i - j);
    let left = wallKwh;
    const spans = [];
    for (const i of order) {
        if (left <= 1e-9 || kw <= 0) break;
        const { from: a, to: b, price, tier } = slots[i];
        const kwh = Math.min(left, (b - a) * kw);
        spans.push({ from: a, to: a + kwh / kw, kwh, price, tier });
        left -= kwh;
    }
    spans.sort((x, y) => x.from - y.from);
    const kwh = wallKwh - Math.max(0, left);
    return { spans, kwh, cost: spans.reduce((t, x) => t + x.kwh * x.price, 0) };
}

/**
 * The home charge's parts as the bars stack them, bottom up: `[null]` (the
 * whole of it) at One price; on a plan the base tier, then each dearer one.
 */
export const homeTierOrder = (tiers) => (tiers ? [tiers.base, ...[1, 0].filter(t => t < tiers.base)] : [null]);

/** A tier's name as a chart label says it: "off-peak", "peak". */
export const tierWord = (tiers, t) => tiers.names[t].toLowerCase();

/** A week's charging by tier for the week's line: `{ spans, base }`, or null at One price. */
export function chargingTiers(week) {
    if (!week.rateTiers) return null;
    return { spans: week.days.flatMap(d => d.night.tierSpans ?? []), base: week.rateTiers.base };
}

/**
 * A night's wall kWh and cost by tier, `[dearest, middle, cheapest]`, split
 * into what went toward the pack (`packKwh`) and to warming it (`warm`):
 * warming comes out of the first stretches the charger runs, as the week's
 * line draws it.
 */
const byTier = (spans, warmKwh = 0) => {
    const kwh = [0, 0, 0], cost = [0, 0, 0], packKwh = [0, 0, 0], warm = [0, 0, 0];
    let warmLeft = warmKwh;
    for (const x of spans) {
        const warmHere = Math.min(warmLeft, x.kwh);
        warmLeft -= warmHere;
        kwh[x.tier] += x.kwh;
        cost[x.tier] += x.kwh * x.price;
        packKwh[x.tier] += x.kwh - warmHere;
        warm[x.tier] += warmHere;
    }
    return { kwh, cost, packKwh, warm };
};

/** Charging stretches as `{ from, to, tier }`, touching ones of one tier joined. */
const mergeTierSpans = (spans) => spans.reduce((acc, x) => {
    const last = acc.at(-1);
    if (last && last.tier === x.tier && x.from <= last.to + 1e-9) last.to = Math.max(last.to, x.to);
    else acc.push({ from: x.from, to: x.to, tier: x.tier });
    return acc;
}, []);

/** Charging stretches as `[from, to]` pairs, touching ones joined. */
const mergeSpans = (spans) => spans.reduce((acc, x) => {
    const last = acc.at(-1);
    if (last && x.from <= last[1] + 1e-9) last[1] = Math.max(last[1], x.to);
    else acc.push([x.from, x.to]);
    return acc;
}, []);

// ── Charging speed ───────────────────────────────────────────────────────────

/**
 * A DC charging curve's shape where the car has none of its own: full power to
 * 40%, falling to 45% of it by 80%, and to a fifth by 100%. Scaled by `peakKw`.
 * Used only to stand in — calibrated to the spec's 10→80% time when there is
 * one — never in place of a tested curve where that curve reaches.
 */
export function taperKw(peakKw, soc) {
    if (soc <= 40) return peakKw;
    if (soc <= 80) return peakKw * (1 - 0.55 * (soc - 40) / 40);
    return peakKw * (0.45 - 0.25 * (soc - 80) / 20);
}

/** Minutes for the taper to take a pack of `usableKwh` from `from`% to `to`%. */
export function taperMinutes(usableKwh, peakKw, from, to) {
    let min = 0;
    for (let s = from; s < to - 1e-9; s += 1) {
        const step = Math.min(1, to - s);
        min += (usableKwh * step / 100) / taperKw(peakKw, s + step / 2) * 60;
    }
    return min;
}

/** Minutes along a summary's per-percent clock, between fractional SoCs; null where it does not reach. */
function curveMinutes(summary, from, to) {
    const clock = summary?.socMin;
    if (!Array.isArray(clock)) return null;
    const at = (soc) => {
        const lo = Math.floor(soc), hi = Math.ceil(soc);
        const a = clock[lo], b = clock[hi];
        if (a == null || b == null) return null;
        return a + (b - a) * (soc - lo);
    };
    const a = at(from), b = at(to);
    return a != null && b != null && b >= a ? b - a : null;
}

/**
 * True when a profile's fast-charging minutes rest on FALLBACK_DC_KW alone: no
 * test, no 10→80% time and no max DC kW. 'maxDc' does not count: a maker's
 * peak is data, and only the taper's shape is the model's.
 */
export const fastIsAssumed = (profile) => profile?.fast?.basis === 'assumed';

/**
 * How long a fast charge takes for this vehicle, from where, and a function for
 * any window. The car's own curve (the same pick as every chart's default,
 * `chargeTimeSession`) where it reaches; outside it, the taper calibrated to
 * that curve, else to the spec's 10→80% time, else at `max_dc_kw`, else at
 * FALLBACK_DC_KW.
 */
function fastChargeOf(vehicle, specs, usableKwh, trace = null) {
    const maxDcKw = finite(specs?.charging?.max_dc_kw) ? Number(specs.charging.max_dc_kw) : null;
    const tested = chargeTimeSession(vehicle?.runs ?? [], { from: 20, to: 70, maxDcKw });
    const ref = (peak) => taperMinutes(usableKwh, peak, 20, 70);
    let basis, peak, summary = null;
    if (tested.run) {
        basis = 'tested';
        summary = tested.run.charge_summary;
        peak = ref(1) / tested.minutes;
    } else if (finite(specs?.charging?.charge_time_10_to_80_pct_min)) {
        basis = 'spec';
        peak = taperMinutes(usableKwh, 1, 10, 80) / Number(specs.charging.charge_time_10_to_80_pct_min);
    } else if (maxDcKw) {
        basis = 'maxDc';
        peak = maxDcKw;
    } else {
        basis = 'assumed';
        peak = FALLBACK_DC_KW;
    }
    if (trace) {
        const basisNote = {
            tested: `the car's own curve where it reaches (${tested.run?.name ?? 'its default charging test'}); outside it, the taper scaled to match its 20→70% time of ${tested.minutes?.toFixed(1)} min`,
            spec: 'the stand-in taper, scaled to the spec\'s 10→80% time',
            maxDc: 'the stand-in taper at the spec\'s max DC kW',
            assumed: 'no test, no 10→80% time and no max DC: an assumed peak',
        }[basis];
        const [from, to, tMin] = basis === 'tested' ? [20, 70, tested.minutes]
            : basis === 'spec' ? [10, 80, Number(specs.charging.charge_time_10_to_80_pct_min)] : [];
        trace.step('Peak of the stand-in taper', {
            formula: tMin ? 'P_peak = t_1kW / t_ref' : 'P_peak = P_dc',
            values: tMin
                ? { t_1kW: val(taperMinutes(usableKwh, 1, from, to), 'min'), t_ref: val(tMin, 'min', 'data') }
                : { P_dc: val(peak, 'kW', basis === 'assumed' ? 'code:FALLBACK_DC_KW' : 'data') },
            result: peak, unit: 'kW', assumed: basis !== 'tested',
            note: `${basisNote}${tMin ? `. t_1kW is the taper's ${from}→${to}% time at a 1 kW peak; the taper's time goes as 1/peak` : ''}`,
        });
    }
    const minutes = (from, to) => {
        if (!(to > from)) return 0;
        const own = summary ? curveMinutes(summary, from, to) : null;
        return own ?? taperMinutes(usableKwh, peak, from, to);
    };
    return { basis, run: tested.run ?? null, minutes };
}

// ── Efficiency ───────────────────────────────────────────────────────────────

/** The conditions a correction targets for one kind of day's miles. */
const target = (speedMph, temperatureF, altitudeFt) => ({ speedMph, temperatureF, altitudeFt, accessoryW: null });

/** The EPA label's two figures, each at its own cycle's average speed. */
const EPA_CYCLES = {
    city:    { field: 'cityMi', name: 'city', mph: UDDS_AVG_MPH },
    highway: { field: 'hwyMi', name: 'highway', mph: HWFET_AVG_MPH },
};

/**
 * One EPA label figure (city or highway range) as mi/kWh of the usable pack,
 * re-priced from the lab's 75°F to the reader's temperature and elevation,
 * cabin heating or cooling included. City miles use the city figure: EPA's
 * city cycle is a fair stand-in for what people call city driving.
 *
 * NOT re-priced for speed. The label is already adjusted toward real driving,
 * and re-pricing the cycle's 48 mph to 70 as if held double-counts it: a Model
 * Y came out near 400 Wh/mi at 70 mph in summer, a third over what it does. The
 * mixed-cycle basis says so to the correction, which then leaves speed alone.
 * Re-pricing for speed properly wants Modeled Efficiency's curve (an EPA test
 * record per car); see the plan's open items.
 */
function epaMiPerKwh(vehicle, usableKwh, cycle, { temperatureF, altitudeFt }, trace = null) {
    const { field, name, mph } = EPA_CYCLES[cycle];
    const rangeMi = Number(vehicle?.epaRange?.[field]);
    if (!(rangeMi > 0) || !(usableKwh > 0)) {
        trace?.note(`No EPA ${name} range: no EPA ${name} figure`);
        return null;
    }
    const base = rangeMi / usableKwh;
    trace?.step(`EPA ${name} efficiency`, {
        formula: 'e_EPA = R / E_usable', values: { R: val(rangeMi, 'mi', 'data'), E_usable: val(usableKwh, 'kWh', 'data') },
        result: base, unit: 'mi/kWh', note: `the label's ${name} range over the usable pack`,
    });
    const lab = {
        speedMph: mph,
        speedBasis: 'mixed',
        temperatureF: EPA_LAB_TEMP_F,
        altitudeFt: STANDARD_CONDITIONS.altitudeFt,
        whPerMile: 1000 / base,
    };
    const { factor } = correctionFactor(lab, {
        mode: 'aero', target: target(mph, temperatureF, altitudeFt),
        trace: trace?.group(`Re-priced from the lab's ${EPA_LAB_TEMP_F}°F to ${temperatureF}°F and ${altitudeFt} ft (speed left alone: the label is a mixed cycle)`),
    });
    trace?.step(`EPA ${name} efficiency, re-priced`, { formula: 'e = e_EPA × k', values: { e_EPA: val(base, 'mi/kWh'), k: factor }, result: base * factor, unit: 'mi/kWh' });
    return base * factor;
}

/**
 * Wh per mile for a day: its city share at the EPA city figure, the rest at
 * the tested composite (or EPA highway, per `efficiencyFrom`), all corrected to
 * the season and elevation. A car with no city figure prices city miles like
 * its highway ones.
 */
function dayWhPerMi(vehicle, usableKwh, { mph, cityShare, temperatureF, altitudeFt, efficiencyFrom, sessionOf }, trace = null) {
    const conditions = { temperatureF, altitudeFt };
    const tested = efficiencyFrom === 'tested'
        ? compositeRange(vehicle, { target: target(mph, temperatureF, altitudeFt), sessionOf, trace: trace?.group(`Tested: composite efficiency at ${mph} mph, ${temperatureF}°F, ${altitudeFt} ft`) })?.miPerKwh ?? null
        : null;
    if (efficiencyFrom !== 'tested') trace?.note('Efficiency from: EPA (your setting), so no tested composite');
    const epaCity = epaMiPerKwh(vehicle, usableKwh, 'city', conditions, trace?.group('EPA: the label\'s city figure'));
    const epaHwy = tested ? null : epaMiPerKwh(vehicle, usableKwh, 'highway', conditions, trace?.group('EPA: the label\'s highway figure'));
    const highway = tested ?? epaHwy;
    const city = epaCity ?? highway;
    if (!(highway > 0) || !(city > 0)) return { whPerMi: null, highwayFrom: null, cityFrom: null };
    const share = cityShare / 100;
    trace?.step('Energy per mile', {
        formula: 'Wh/mi = c × 1000 / e_city + (1 − c) × 1000 / e_hwy',
        values: {
            c: val(share, null, 'setting'),
            e_city: val(city, 'mi/kWh', epaCity ? null : 'assumed'),
            e_hwy: val(highway, 'mi/kWh'),
        },
        result: share * 1000 / city + (1 - share) * 1000 / highway, unit: 'Wh/mi',
        note: `highway miles at the ${tested ? 'tested composite' : 'EPA highway figure'}; city miles at the EPA city figure${epaCity ? '' : ' (none, so the highway one)'}`,
    });
    return {
        whPerMi: share * 1000 / city + (1 - share) * 1000 / highway,
        highwayFrom: tested ? 'tested' : 'epa',
        cityFrom: epaCity ? 'epa' : 'highway',
    };
}

/**
 * Everything the week needs from one vehicle, and where each piece came from.
 *
 * @param {Object} vehicle   with `runs`, `socWindowKwh`, `epaRange`
 * @param {Object} settings  normalized Cost to Drive settings
 * @param {Object} [opts]
 * @param {Object}   [opts.specs]      the vehicle's specs, platform fallback applied (default `vehicle.specs`)
 * @param {Function} [opts.sessionOf]  run → its test session
 * @returns {{
 *   usableKwh: number|null, missing: string|null,
 *   whPerMi: { summer: {D, L}, winter: {D, L} },
 *   highwayFrom: 'tested'|'epa'|null, cityFrom: 'epa'|'highway'|null,
 *   home: { kw: number, chargerKw: number, onboardKw: number, onboardAssumed: boolean, capped: boolean,
 *           eff: number, warmEff: number, effRef: number, effFrom: 'epa'|'green-ncap'|'assumed' },
 *   warmKwhPerF: number|null,
 *   fast: { basis: string, run: Object|null, minutes: Function },
 * }}  `missing` says why the vehicle cannot be priced, when it cannot. `home.eff`
 *   is what reaches the pack at this level (chargerEffAt); `effRef` the car's
 *   figure at its full AC power, from its EPA certification (measured or
 *   pinned) or the site-wide one. `warmEff` is what reaches the battery as
 *   warming (warmEffOf). `warmKwhPerF` is the battery warming a home
 *   charge buys, pack side, per °F below PACK_WARMING_BELOW_F.
 */
export function costToDriveVehicle(vehicle, settings, { specs = vehicle?.specs, sessionOf = () => null, trace = null } = {}) {
    const usableKwh = finite(vehicle?.socWindowKwh) ? Number(vehicle.socWindowKwh) : null;
    trace?.step('Usable battery', {
        values: { E_usable: val(usableKwh, 'kWh', 'data') }, result: usableKwh, unit: 'kWh',
        note: 'the vehicle\'s SoC window: EPA tested, else Usable, else Gross',
    });
    const level = HOME_LEVELS[settings.level] ?? HOME_LEVELS[4];
    const onboardAssumed = !finite(specs?.charging?.max_ac_kw);
    const onboardKw = onboardAssumed ? ASSUMED_ONBOARD_AC_KW : Number(specs.charging.max_ac_kw);
    const chargerKw = levelKw(level);
    // The EPA's, else Green NCAP's (vehicleFigures.resolveChargerEfficiency).
    const measured = vehicle?.chargerEfficiency;
    const measuredEff = finite(measured?.value) ? Number(measured.value) : null;
    const effRef = measuredEff ?? ASSUMED_CHARGER_EFF;
    const effSource = measuredEff != null ? 'data' : 'knob:ASSUMED_CHARGER_EFF';
    const kw = Math.min(chargerKw, onboardKw);
    const home = {
        kw,
        chargerKw, onboardKw, onboardAssumed,
        // A 48 A circuit is 11.52 kW at the wall against an 11.5 kW onboard
        // charger: equal for any reader, so not "capped".
        capped: onboardKw < chargerKw - CAPPED_TOLERANCE_KW,
        // No home charging has no charger and buys nothing at home; it takes
        // the full-power efficiency only so nothing divides by zero.
        eff: level.none ? effRef : chargerEffAt(effRef, kw, onboardKw),
        // Battery warming pays the charger's conversion only: the car's fixed
        // draw ends up as heat in the car, which is what warming wants
        // (owner, 2026-11-16). So η_ref with its full-power share of the fixed
        // draw taken back out, the same at every level.
        warmEff: warmEffOf(effRef, onboardKw),
        effRef,
        effFrom: measuredEff != null ? measured.basis : 'assumed',
        none: !!level.none,
    };
    const h = trace?.group('Home charging');
    if (h) {
        h.step('Charger at the wall', { formula: 'P_wall = V × A / 1000', values: { V: val(level.volts, 'V', 'setting'), A: val(level.amps, 'A', 'setting') }, result: chargerKw, unit: 'kW' });
        h.step('Home charging power', {
            formula: 'P_home = min(P_wall, P_onboard)',
            values: { P_wall: val(chargerKw, 'kW'), P_onboard: val(onboardKw, 'kW', onboardAssumed ? 'code:ASSUMED_ONBOARD_AC_KW' : 'data') },
            result: home.kw, unit: 'kW', assumed: onboardAssumed,
            note: onboardAssumed ? 'no max AC kW in the specs: the onboard charger is assumed' : null,
        });
        h.step('Wall-to-pack efficiency', level.none
            ? { formula: 'η_home = η_ref', values: { η_ref: val(effRef, null, effSource) }, result: home.eff, note: 'no home charging: nothing is bought at home' }
            : {
                formula: 'η_home = η_ref − P₀ × (1 / P − 1 / P_ref)',
                values: {
                    η_ref: val(effRef, null, effSource),
                    'P₀': val(FIXED_DRAW_W / 1000, 'kW', 'knob:FIXED_DRAW_W'),
                    P: val(kw, 'kW'),
                    P_ref: val(onboardKw, 'kW', onboardAssumed ? 'code:ASSUMED_ONBOARD_AC_KW' : 'data'),
                },
                result: home.eff, assumed: measuredEff == null,
                note: `η_ref is ${measuredEff != null ? `the car's ${CHARGER_EFF_BASIS[measured.basis]?.label ?? 'measured'} figure` : 'the site-wide figure (none measured)'}, at the car's full AC power; below it the car's fixed draw is a larger share, so less reaches the pack`,
            });
        if (!level.none) {
            h.step('Wall-to-pack efficiency for battery warming', {
                formula: 'η_warm = η_ref + P₀ / P_ref',
                values: {
                    η_ref: val(effRef, null, effSource),
                    'P₀': val(FIXED_DRAW_W / 1000, 'kW', 'knob:FIXED_DRAW_W'),
                    P_ref: val(onboardKw, 'kW', onboardAssumed ? 'code:ASSUMED_ONBOARD_AC_KW' : 'data'),
                },
                result: home.warmEff, assumed: true,
                note: 'the charger\'s conversion loss only, at any level: the fixed draw ends up as heat in the car, which is what warming wants',
            });
        }
    }
    const phantom = phantomDrainOf(specs, settings);
    trace?.step('Phantom drain', {
        values: { drain: val(phantom.pctDay, '%/day', phantom.source) }, result: phantom.pctDay, unit: '%/day',
        assumed: phantom.source !== 'data',
        note: 'the share of the battery a parked car loses in a day; none while it drives or charges, whose efficiency figures already carry it',
    });
    if (!usableKwh) {
        return { usableKwh: null, missing: 'no usable battery capacity', whPerMi: null, highwayFrom: null, cityFrom: null, home, warmKwhPerF: null, fast: null, phantom };
    }
    // Battery warming a home charge buys, pack side, per °F below PACK_WARMING_BELOW_F.
    const warmKwhPerF = BATTERY_WARMING_KWH * BATTERY_WARMING_CAR_FACTOR * usableKwh;
    if (h && !level.none) {
        const temperatureF = settings.season === 'summer' ? settings.summerF : settings.winterF;
        h.step('Battery warming per charge', {
            formula: 'E_warm = k × f_car × E_usable × max(0, T_warm − T)',
            values: {
                k: val(BATTERY_WARMING_KWH, 'kWh/kWh/°F', 'knob:BATTERY_WARMING_KWH'),
                f_car: val(BATTERY_WARMING_CAR_FACTOR, null, 'code:BATTERY_WARMING_CAR_FACTOR'),
                E_usable: val(usableKwh, 'kWh', 'data'), T_warm: val(PACK_WARMING_BELOW_F, '°F', 'code:PACK_WARMING_BELOW_F'),
                T: val(temperatureF, '°F', 'setting'),
            },
            result: batteryWarmingKwh(warmKwhPerF, temperatureF), unit: 'kWh', assumed: true,
            note: `a guess, parked outside (less in a garage); the ${settings.season}. Bought through η_warm at the start of each night the charger runs, out of the night's window`,
        });
    }
    const whPerMi = { summer: {}, winter: {} };
    let highwayFrom = null, cityFrom = null;
    for (const season of ['summer', 'winter']) {
        const temperatureF = season === 'summer' ? settings.summerF : settings.winterF;
        for (const [type, mph, city] of [['D', settings.dailyMph, settings.dailyCity], ['L', settings.longMph, settings.longCity]]) {
            // One season is traced, the one the page shows; the other runs the
            // same steps with its own temperature.
            const dayTrace = season === settings.season
                ? trace?.group(`Energy per mile: ${type === 'L' ? 'Long day' : 'Daily'}, ${season} (${temperatureF}°F, ${mph} mph, ${city}% city)`)
                : null;
            const day = dayWhPerMi(vehicle, usableKwh, {
                mph, cityShare: city, temperatureF, altitudeFt: settings.elevationFt,
                efficiencyFrom: settings.efficiencyFrom, sessionOf,
            }, dayTrace);
            whPerMi[season][type] = day.whPerMi;
            highwayFrom ??= day.highwayFrom;
            cityFrom ??= day.cityFrom;
        }
    }
    if (!(whPerMi.winter.L > 0)) {
        return { usableKwh, missing: 'no range test and no EPA highway figure', whPerMi: null, highwayFrom: null, cityFrom: null, home, warmKwhPerF, fast: null, phantom };
    }
    return { usableKwh, missing: null, phantom, whPerMi, highwayFrom, cityFrom, home, warmKwhPerF, fast: fastChargeOf(vehicle, specs, usableKwh, trace?.group('Fast charging')) };
}

/**
 * A parked car's battery loss, % of the pack a day, and where the figure
 * came from (#590): the reader's own for every car when they set one, else
 * the car's own (spec `phantom_drain_pct_day`, 0 counts), else the site's
 * PHANTOM_DRAIN_PCT_DAY. `source` is a calcTrace source.
 */
export function phantomDrainOf(specs, settings) {
    if (settings.phantomFrom === 'mine') return { pctDay: settings.phantomDrain, source: 'setting' };
    const own = specs?.charging?.phantom_drain_pct_day;
    if (own != null && own !== '' && Number.isFinite(Number(own)) && Number(own) >= 0) return { pctDay: Number(own), source: 'data' };
    return { pctDay: PHANTOM_DRAIN_PCT_DAY, source: 'knob:PHANTOM_DRAIN_PCT_DAY' };
}

/** How far below the wall's kW an onboard charger must be before it is said to cap it. */
const CAPPED_TOLERANCE_KW = 0.25;

/** The most rounds closing a week takes; most close in one or two. */
const CLOSE_ROUNDS = 8;

/** How close, in %, Sunday night must come to a lower Monday for the week to repeat. */
const STEADY_TOLERANCE = 0.1;

/**
 * What reaches the pack at `kw`, for a car whose charger efficiency is `effRef`
 * at its onboard charger's full power `refKw`: η = η_ref − P₀(1/P − 1/P_ref).
 * The car's fixed draw (FIXED_DRAW_W: standby, electronics, pumps) is the same
 * at any rate, so it is a larger share of a slower charge. At full power it is
 * η_ref; a level the onboard charger caps runs at full power.
 */
const chargerEffAt = (effRef, kw, refKw) => effRef - (FIXED_DRAW_W / 1000) * (1 / kw - 1 / refKw);

/**
 * What reaches the battery as warming: η_ref less nothing for the fixed draw,
 * η_ref + P₀ / P_ref, at most 1. What is left of η_ref's loss (the charger's
 * conversion, and the battery's own, which cannot be split out) still applies.
 */
const warmEffOf = (effRef, refKw) => Math.min(1, effRef + (FIXED_DRAW_W / 1000) / refKw);

/**
 * The per-car share of BATTERY_WARMING_KWH, f_car. 1 for every car: a slot
 * held open with a dummy value until real per-car figures exist (heater type,
 * pack, insulation all differ). No spec field or UI yet. Revisit 2027-03-01.
 */
const BATTERY_WARMING_CAR_FACTOR = 1;

/**
 * Where the week aims to start Monday morning: Sunday night's limit (Charge
 * to, 100% before a Long Monday), or with no home charging, Charge no higher
 * than. simulateWeek starts lower where the week repeats from there.
 */
const weekStartSoc = (profile, s) => {
    if (profile.home.none) return s.capTo;
    return s.fullBeforeLong && s.week[0] === 'L' ? 100 : s.chargeTo;
};

/** Battery warming one home charge buys at `temperatureF`, pack side, kWh: none at or above PACK_WARMING_BELOW_F. */
const batteryWarmingKwh = (warmKwhPerF, temperatureF) => warmKwhPerF * Math.max(0, PACK_WARMING_BELOW_F - temperatureF);

/**
 * One night at home, as the charger can run it: `wallKwh` the most it can buy
 * (P_home × the plug-in hours), `warmWallKwh` the battery warming's share,
 * taken first and never more than the night, and what is left as `addPct`, the
 * most the night can add (% of the pack), in `chargeHours`. All zero with no
 * home charging.
 */
function nightBudget(profile, s, season = s.season) {
    const hours = plugHours(s);
    const { kw, eff, warmEff } = profile.home;
    const wallKwh = profile.home.none ? 0 : kw * hours;
    const warmPackKwh = batteryWarmingKwh(profile.warmKwhPerF ?? 0, season === 'summer' ? s.summerF : s.winterF);
    const warmWallKwh = Math.min(wallKwh, warmPackKwh / warmEff);
    const chargeKwh = wallKwh - warmWallKwh;
    return {
        hours, wallKwh, warmPackKwh, warmWallKwh,
        warmHours: kw > 0 ? warmWallKwh / kw : 0,
        chargeHours: kw > 0 ? chargeKwh / kw : 0,
        addPct: profile.usableKwh > 0 ? chargeKwh * eff / profile.usableKwh * 100 : 0,
    };
}

// ── The week ─────────────────────────────────────────────────────────────────

/** Miles in a day of a type. */
const dayMiles = (type, s) => (type === 'L' ? s.longMi : type === 'D' ? s.dailyMi : 0);

/**
 * Where a planned fast charge sits in a day: the gap between drives nearest
 * `hour` — before the first, between two, or after the last — and the hour in
 * it. A day off is one gap, the whole day.
 * @returns {{ gap: number, hour: number }}  gap i is before span i; spans.length is after the last
 */
export function plannedSlot(spans, hour) {
    const gaps = spans.length
        ? spans.map((sp, i) => [i === 0 ? 0 : spans[i - 1].to, sp.from]).concat([[spans.at(-1).to, 24]])
        : [[0, 24]];
    let best = null;
    gaps.forEach(([lo, hi], gap) => {
        const at = Math.min(hi, Math.max(lo, hour));
        if (!best || Math.abs(at - hour) < Math.abs(best.hour - hour)) best = { gap, hour: at };
    });
    return best;
}

/**
 * Drive a week that closes: it starts Monday morning at `weekStartSoc` and
 * Sunday night must bring it back there (owner, 2026-11-16: "the Monday
 * morning requirement" — nobody lives a week hovering at 20%, and a week that
 * ends lower hides the fast charging it will need).
 * Where Sunday night comes back short, Monday first tries starting where it
 * ended (owner, 2026-11-18, the steady state): spare time on the nights before
 * the shortfall makes it up, so the week repeats from there. It counts only
 * when it buys no more fast charging than the week at `weekStartSoc` did, so
 * a week that loses ground every week still pays for it.
 * What it still loses a week, under MONTHLY_STOP_BELOW, is carried: the
 * week is drawn from Monday at `weekStartSoc` and a fast stop a month, off the
 * chart (`monthly`), makes it up, 12/52 of it in each week's totals. A month
 * of carried shortfall can leave the car lower than the week shows; that is
 * not modeled.
 * Else the week's last fast stop charges further, else a stop of its own on
 * the latest driving day whose charge reaches Monday (owner: "add the DCFC to
 * an existing one, or earlier in the week"). That may be time the week did
 * not otherwise need: realistic.
 * The week is driven twice and the second reported, so Monday's morning
 * starts after Sunday night's charging, as the week's line wraps it.
 *
 * The fast-stop rule (docs/cost-to-drive-plan.md): when the rest of the day
 * would end below `keepAbove`, the car stops when it reaches `stopBy` — later,
 * at keepAbove + the detour + LATE_STOP_MARGIN, if the day started below it —
 * and charges enough to finish the day above `keepAbove`, at least MIN_STOP_ADD
 * or MIN_STOP_MINUTES of charging, whichever is less, under `capTo`, stretching to STRETCH_CAP_TO when that saves a second stop.
 * A planned day tops up to `capTo` unless already above it, at PLANNED_HOUR
 * on a day off and in the gap between drives nearest it on a driving day.
 *
 * @param {Object} profile   costToDriveVehicle's answer (missing must be null)
 * @param {Object} settings  normalized settings
 * @param {Object} [opts]
 * @param {'summer'|'winter'} [opts.season]  default settings.season
 * @returns {{
 *   points: Array<[number, number]>,   [hour of the week, SoC %], Monday 0:00 = 0
 *   stops: Array<{ day, hour, endHour, planned: boolean, closesWeek: boolean, fromSoc, toSoc, mile, minutes, chargeMinutes, kwh, warmKwh, cost }>,   `kwh` billed, the day's first stop's battery warming (`warmKwh`, pack side) in
 *   days: Array<{ day, type, miles, kwhUsed, startSoc, homeSoc, plannedSkipped: boolean,
 *                 night: { added: number, endSoc: number, fullAt: number|null, ranOut: boolean,
 *                          hours: number, mostAdd: number } }>,
 *   windows: Array<{ from, to, spareFrom }>,   the plug-in window of each night, in hours of the week (plugWindows)
 *   monthly: { shortPct, fromSoc, toSoc, minutes, chargeMinutes, kwh, cost }|null,   the stop a month a carried shortfall needs
 *   stopCount, fastMinutes, fastKwh, homeKwh, fastCost, homeCost, usedKwh, fastShare, miles
 * }}  `stopCount` and the fast totals hold 12/52 of `monthly`; `fastKwh`/`homeKwh` are what was bought (losses in); `fastShare` the share of
 *     the pack energy used that came from fast chargers
 */
export function simulateWeek(profile, settings, { season = settings.season, trace = null } = {}) {
    const s = settings;
    const usable = profile.usableKwh;
    const whPerMi = profile.whPerMi[season];
    const pct = (kwh) => kwh / usable * 100;
    const detourMi = s.detourMin / 60 * DETOUR_MPH;
    const phantomPctHour = (profile.phantom?.pctDay ?? 0) / 24;
    // The least a stop charges to from `from`: MIN_STOP_ADD % more, or as far
    // as MIN_STOP_MINUTES of charging gets, whichever is less.
    const leastStopTo = (from) => {
        const most = Math.min(100, from + MIN_STOP_ADD);
        if (profile.fast.minutes(from, most) <= MIN_STOP_MINUTES) return most;
        let lo = from, hi = most;
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (profile.fast.minutes(from, mid) <= MIN_STOP_MINUTES) lo = mid; else hi = mid;
        }
        return lo;
    };
    trace?.step('A detour, in miles', {
        formula: 'd_detour = t_detour / 60 × v_detour',
        values: { t_detour: val(s.detourMin, 'min', 'setting'), v_detour: val(DETOUR_MPH, 'mph', 'code:DETOUR_MPH') },
        result: detourMi, unit: 'mi', assumed: true,
    });
    const planned = (d) => (s.planned & (1 << d)) !== 0;
    // A night is the charger's power for the plug-in window, at the wall: the
    // most it can buy. Battery warming, once a night the charger runs, comes
    // out of that first, at the same power; what is left charges the pack. So
    // a slow charger in the cold buys the same and adds less, and nothing
    // bought at home ever passes the charger's own ceiling.
    const night = nightBudget(profile, s, season);
    const warmKwh = night.warmPackKwh;
    const priceAt = homePricing(s, season);
    const tierOf = homeTiering(s, season);
    if (trace && !profile.home.none) {
        const t = trace.group('A night at home');
        t.step('Most a night can buy, at the wall', {
            formula: 'E_night = P_home × h', values: { P_home: val(profile.home.kw, 'kW'), h: val(night.hours, 'h', 'setting') },
            result: night.wallKwh, unit: 'kWh', note: `plugged in ${s.plugFrom}:00 to ${s.plugUntil}:00; the same for every car the charger, not its onboard charger, limits`,
        });
        t.step('Battery warming, at the wall', {
            formula: 'E_warm_wall = min(E_night, E_warm / η_warm)', values: { E_night: val(night.wallKwh, 'kWh'), E_warm: val(warmKwh, 'kWh'), η_warm: val(profile.home.warmEff) },
            result: night.warmWallKwh, unit: 'kWh', assumed: warmKwh > 0,
            note: warmKwh > 0 ? `first, at the charger's power: ${(night.warmHours * 60).toFixed(0)} min of the window` : 'none: not below the warming temperature',
        });
        t.step('Most a night can add', {
            formula: 'ΔSoC_night = (E_night − E_warm_wall) × η_home / E_usable × 100',
            values: { E_night: val(night.wallKwh, 'kWh'), E_warm_wall: val(night.warmWallKwh, 'kWh'), η_home: val(profile.home.eff), E_usable: val(usable, 'kWh') },
            result: night.addPct, unit: '%', note: `to ${s.chargeTo}% (100% before a Long day: ${s.fullBeforeLong ? 'yes' : 'no'})`,
        });
    }
    const aimSoc = weekStartSoc(profile, s);

    /**
     * The week, driven from Monday morning at `startSoc`. `close` is what
     * closing it adds: `close.boost['d:n']` % more on day d's n-th fast stop,
     * and `close.added[d]` % on a stop of its own after day d's driving. `tr`
     * traces the run.
     */
    const drive = (close, tr, startSoc) => {
    // The first stop of the reported week is written out as the example.
    let exampleStop = tr;

    let soc = startSoc;
    // Hours into today the last night's charging ran: the day starts no earlier.
    let morning = 0;
    // When the last plug-in window that charged ended, in hours of the week: the next starts no earlier.
    let prevEnd = -Infinity;
    const out = { points: [], stops: [], days: [], miles: 0, usedKwh: 0, phantomKwh: 0, fastPackKwh: 0, homePackKwh: 0, homeWallKwh: 0, homeCost: 0, homeTierCost: [0, 0, 0], warmWallKwh: 0, fastWarmPackKwh: 0, homeCharges: 0, fastMinutes: 0 };

    // Twice: the first only sets Monday's morning (when Sunday night ends).
    for (let w = 0; w < 2; w++) {
        const rec = w === 1;
        soc = startSoc;
        prevEnd -= 7 * 24;
        for (let d = 0; d < 7; d++) {
            const type = s.week[d];
            const base = d * 24;
            const miles = dayMiles(type, s);
            const wh = type === 'O' ? 0 : whPerMi[type];
            const usePct = pct(miles * wh / 1000);
            const detPct = pct(detourMi * (wh || whPerMi.D) / 1000);
            const day = { day: WEEKDAYS[d], type, miles, kwhUsed: miles * wh / 1000, startSoc: soc, plannedSkipped: false, stops: [], phantomPct: 0 };
            // The car parked for `hours`, neither driving nor charging: it
            // loses its phantom drain, which the line draws as a slope
            // between the two events either side. While the home charger
            // runs, and on a stop, nothing is taken (those figures carry it).
            const park = (hours) => {
                if (!(hours > 0) || !(phantomPctHour > 0)) return;
                const lost = Math.min(soc, hours * phantomPctHour);
                soc -= lost;
                if (rec) { day.phantomPct += lost; out.phantomKwh += lost / 100 * usable; }
            };
            if (rec) {
                if (d === 0) out.points.push([0, soc]);
                out.miles += miles;
                out.usedKwh += day.kwhUsed;
            }
            let driven = 0;
            // The day's first fast stop warms the battery, as a night at home
            // does; a later one finds it warm from the first.
            let warmedToday = false;
            let stopNo = 0;

            const stopAt = (hour, target, isPlanned, closesWeek = false) => {
                const fromSoc = soc;
                // A stop charges further where the week needs it to close.
                const boost = close.boost[`${d}:${stopNo}`] ?? 0;
                stopNo += 1;
                const toSoc = boost > 0 ? Math.min(100, target + boost) : target;
                closesWeek = closesWeek || boost > 0;
                const chargeMinutes = profile.fast.minutes(fromSoc, toSoc);
                const minutes = chargeMinutes + (isPlanned ? 0 : s.detourMin) + s.startMin;
                const packKwh = (toSoc - fromSoc) / 100 * usable;
                const detourPct = isPlanned ? 0 : detPct;
                const warmPack = warmedToday ? 0 : warmKwh;
                warmedToday = true;
                const billed = (packKwh + warmPack) / (1 - DC_FAST_LOSS);
                if (rec && exampleStop) {
                    const t = exampleStop.group(`Example fast stop: ${WEEKDAYS[d]}, ${isPlanned ? 'planned' : 'on the road'}, ${fromSoc.toFixed(1)}% → ${toSoc.toFixed(1)}%`);
                    exampleStop = null;
                    t.step('Charging time', {
                        values: { t_charge: val(chargeMinutes, 'min') }, result: chargeMinutes, unit: 'min',
                        note: `from the fast-charging speed above (${profile.fast.basis})`,
                    });
                    t.step('Time for the stop', {
                        formula: isPlanned ? 't_stop = t_charge + t_start' : 't_stop = t_charge + t_detour + t_start',
                        values: { t_charge: val(chargeMinutes, 'min'), t_detour: val(s.detourMin, 'min', 'setting'), t_start: val(s.startMin, 'min', 'setting') },
                        result: minutes, unit: 'min',
                    });
                    t.step('Energy into the pack', {
                        formula: 'E_pack = (SoC_to − SoC_from) / 100 × E_usable',
                        values: { SoC_to: val(toSoc, '%'), SoC_from: val(fromSoc, '%'), E_usable: val(usable, 'kWh') },
                        result: packKwh, unit: 'kWh',
                    });
                    t.step('Energy billed', {
                        formula: 'E_billed = (E_pack + E_warm) / (1 − loss)',
                        values: { E_pack: val(packKwh, 'kWh'), E_warm: val(warmPack, 'kWh'), loss: val(DC_FAST_LOSS, null, 'knob:DC_FAST_LOSS') },
                        result: billed, unit: 'kWh', assumed: true,
                        note: warmPack > 0
                            ? 'E_warm is the battery warming a night at home buys, the day\'s first stop only; it is energy and cost, not minutes (the car warms on the way in, at far less than the charger\'s power)'
                            : warmKwh > 0 ? 'no battery warming: the day\'s first stop already warmed it' : null,
                    });
                    t.step('Cost of the stop', {
                        formula: 'cost = E_billed × price', values: { E_billed: val(billed, 'kWh'), price: val(s.fastPrice, '$/kWh', 'setting') },
                        result: billed * s.fastPrice, unit: '$',
                    });
                }
                if (rec) {
                    const stop = {
                        day: d, hour: base + hour, endHour: base + hour + minutes / 60, planned: isPlanned,
                        fromSoc, toSoc, mile: Math.round(driven / (usePct || 1) * miles),
                        minutes, chargeMinutes, kwh: billed, warmKwh: warmPack, cost: billed * s.fastPrice, closesWeek,
                    };
                    out.fastWarmPackKwh += warmPack;
                    out.stops.push(stop);
                    day.stops.push(stop);
                    out.points.push([base + hour, fromSoc], [stop.endHour, toSoc - detourPct]);
                    out.fastPackKwh += packKwh;
                    out.fastMinutes += minutes;
                    out.usedKwh += detourPct / 100 * usable;
                }
                soc = toSoc - detourPct;
                return hour + minutes / 60;
            };
            // The planned stop, at its slot or when the car is next free. Where the
            // battery is already above the cap the car does not go: the day runs
            // as it would without one, and the clock is where it was.
            const plannedStop = (clock) => {
                if (soc >= s.capTo - 0.5) {
                    if (rec) day.plannedSkipped = true;
                    return clock;
                }
                const at = Math.max(plan.hour, clock);
                park(at - clock);
                return stopAt(at, s.capTo, true);
            };

            const spans = DAY_SPANS[type];
            const plan = planned(d) ? plannedSlot(spans, PLANNED_HOUR) : null;
            // The day's clock: a stop that runs past a span's end pushes the
            // next span later, rather than the line stepping back in time.
            let clock = morning;
            if (plan?.gap === 0) clock = plannedStop(clock);
            let threshold = soc < s.stopBy ? s.keepAbove + detPct + LATE_STOP_MARGIN : s.stopBy;
            spans.forEach((span, i) => {
                if (i > 0 && plan?.gap === i) clock = plannedStop(clock);
                let hour = Math.max(span.from, clock);
                park(hour - clock);
                if (rec) out.points.push([base + hour, soc]);
                let left = usePct * span.share;
                const rate = left / (span.to - span.from);
                const later = spans.slice(i + 1).reduce((a, x) => a + usePct * x.share, 0);
                for (let guard = 0; left > 1e-6 && guard < 12; guard++) {
                    if (soc - (left + later) >= s.keepAbove - 1e-9 || soc - left >= threshold - 1e-9) {
                        hour += left / rate; soc -= left; driven += left; left = 0;
                        if (rec) out.points.push([base + hour, soc]);
                        continue;
                    }
                    if (soc > threshold) {
                        const run = soc - threshold;
                        hour += run / rate; soc -= run; driven += run; left -= run;
                        if (rec) out.points.push([base + hour, soc]);
                    }
                    const need = left + later + detPct + s.keepAbove;
                    // Enough for the day when that fits under the stretch;
                    // else the cap, and the day stops again.
                    const ceiling = Math.max(STRETCH_CAP_TO, s.capTo);
                    const least = leastStopTo(soc);
                    const to = Math.min(ceiling, Math.max(need <= ceiling ? need : s.capTo, least));
                    if (rec && exampleStop) {
                        exampleStop.step('How far the first road stop charges', {
                            formula: need <= ceiling ? 'SoC_to = min(ceiling, max(need, SoC + add_min))' : 'SoC_to = min(ceiling, max(cap, SoC + add_min))',
                            values: {
                                need: val(need, '%'), cap: val(s.capTo, '%', 'setting'), SoC: val(soc, '%'),
                                add_min: val(least - soc, '%'), ceiling: val(ceiling, '%', 'code:STRETCH_CAP_TO'),
                            },
                            result: to, unit: '%',
                            note: `need = the rest of the day + the detour + Keep battery above; add_min = ${MIN_STOP_ADD}% or what ${MIN_STOP_MINUTES} min of charging adds, whichever is less; past the ceiling it charges to the cap and stops again later`,
                        });
                    }
                    hour = stopAt(hour, to, false);
                    threshold = s.stopBy;
                }
                clock = hour;
            });
            if (spans.length && plan?.gap === spans.length) clock = plannedStop(clock);
            // A stop of its own to close the week, after the day's driving
            // (a trip out, so with the detour), where no stop could carry it.
            if (close.added[d] > 0) {
                const at = spans.length ? clock : Math.max(clock, PLANNED_HOUR);
                park(at - clock);
                const to = Math.min(100, Math.max(soc + close.added[d], leastStopTo(soc)) + detPct);
                clock = stopAt(at, to, false, true);
            }

            // The night: in its plug-in window — a day off has its own — from
            // when the car is home (tomorrow's window when today's has closed),
            // never before the last window ended, in the cheapest hours the
            // rate plan offers, to the limit.
            const homeSoc = soc;
            const limit = s.fullBeforeLong && s.week[(d + 1) % 7] === 'L' ? 100 : s.chargeTo;
            const win = windowOf(s, d);
            let w0 = base + win.from, w1 = base + win.to;
            if (w1 <= base + clock) { w0 += 24; w1 += 24; }
            const from = Math.max(w0, base + clock, prevEnd);
            const to = Math.max(from, w1);
            // Parked from arrival until the window opens. Once the charger
            // runs nothing is taken; waiting inside the window for the cheap
            // hours is left out (a plugged-in car tops itself up), so a night
            // is sized from here.
            park(Math.min(from, base + 24) - (base + clock));
            // What the window from arrival could buy at the wall; battery
            // warming, once a night the charger runs, comes out of it first.
            // `mostAdd` the rest as % of the pack (the home ceiling).
            const wallMax = profile.home.none ? 0 : profile.home.kw * (to - from);
            const warmWall = Math.min(wallMax, warmKwh / profile.home.warmEff);
            const mostAdd = usable > 0 ? (wallMax - warmWall) * profile.home.eff / usable * 100 : 0;
            // `hours` the charger ran, warming in; `homeKwh` what the night bought at the wall, warming in,
            // `warmKwh` the warming's share; `homeCost` at each hour's price; `spans` when it ran.
            // On a time-of-use plan, `tierKwh`/`tierCost` split the night by tier (at the
            // wall), `tierPackKwh` what each added to the pack (warming out), and
            // `tierSpans` say which tier each stretch ran in; null at One price.
            const tonight = {
                added: 0, endSoc: soc, fullAt: null, ranOut: false, hours: 0, mostAdd, homeKwh: 0, warmKwh: 0, homeCost: 0,
                window: { from: w0, to: w1 }, spans: [], tierKwh: null, tierCost: null, tierPackKwh: null, tierWarmKwh: null, tierSpans: null,
            };
            if (rec) out.points.push([from, soc]);
            // No home charging: nothing is added overnight, so every kWh comes
            // from the fast-stop rule above, at the fast price.
            if (wallMax > 0 && soc < limit - 1e-9) {
                const kw = profile.home.kw;
                const add = Math.min(limit - soc, mostAdd);
                const need = warmWall + add / 100 * usable / profile.home.eff;
                const run = chargeInCheapestHours({ from, to, kw, wallKwh: need, priceAt, tierOf });
                const end = run.spans.at(-1)?.to ?? from;
                tonight.added = add;
                tonight.ranOut = add < limit - soc - 1e-9;
                tonight.hours = run.spans.reduce((t, x) => t + x.to - x.from, 0);
                tonight.fullAt = tonight.ranOut ? null : end % 24;
                tonight.warmKwh = warmWall;
                tonight.homeKwh = need;
                tonight.homeCost = run.cost;
                tonight.spans = mergeSpans(run.spans);
                if (tierOf) {
                    const split = byTier(run.spans, warmWall);
                    tonight.tierKwh = split.kwh;
                    tonight.tierCost = split.cost;
                    tonight.tierPackKwh = split.packKwh.map(k => k * profile.home.eff);
                    tonight.tierWarmKwh = split.warm;
                    tonight.tierSpans = mergeTierSpans(run.spans);
                }
                if (rec) {
                    // Warming first: the line holds flat, then climbs, stretch by stretch.
                    let warmLeft = warmWall, level = soc;
                    for (const x of run.spans) {
                        const warmHere = Math.min(warmLeft, x.kwh);
                        warmLeft -= warmHere;
                        out.points.push([x.from, level]);
                        if (warmHere > 0) out.points.push([x.from + warmHere / kw, level]);
                        level += (x.kwh - warmHere) * profile.home.eff / usable * 100;
                        out.points.push([x.to, level]);
                    }
                    out.homePackKwh += add / 100 * usable;
                    out.homeWallKwh += need;
                    out.warmWallKwh += warmWall;
                    out.homeCost += run.cost;
                    if (tonight.tierCost) tonight.tierCost.forEach((c, t) => { out.homeTierCost[t] += c; });
                    out.homeCharges += 1;
                }
                soc += add;
                prevEnd = to;
            }
            tonight.endSoc = soc;
            // Parked again from where the charger stopped (or from the window,
            // when it never ran) to midnight; a night that runs past it hands
            // the rest to tomorrow's morning.
            const chargedUntil = tonight.spans.at(-1)?.[1] ?? from;
            if (chargedUntil < base + 24) {
                park(base + 24 - chargedUntil);
                if (rec && phantomPctHour > 0) out.points.push([base + 24, soc]);
            }
            morning = Math.max(0, (tonight.spans.at(-1)?.[1] ?? from) - (base + 24));
            if (rec) out.days.push({ ...day, homeSoc, night: tonight });
        }
    }
    return { out, endSoc: soc };
    };

    const CLOSE_TOLERANCE = 0.5;
    const close = { boost: {}, added: Array(7).fill(0) };
    const atAim = drive(close, null, aimSoc);
    let startSoc = aimSoc, run = atAim;

    // The steady state. Sunday night came back short: start Monday where it
    // ended and drive again, until the week repeats. Most repeat on the first
    // try, since the first night with spare time absorbs the shortfall and
    // every day after it runs as before. Starting lower may not buy fast
    // charging the week at aimSoc did not, or it is the week that loses
    // ground, and closing below pays for it.
    // Where it does not repeat, `shortPct` is what each week still loses once
    // the spare time has made up what it can: the last round's shortfall.
    let shortPct = 0;
    if (aimSoc - atAim.endSoc > CLOSE_TOLERANCE) {
        shortPct = aimSoc - atAim.endSoc;
        const fastOf = (o) => [o.stops.length, o.fastPackKwh];
        const [aimStops, aimKwh] = fastOf(atAim.out);
        for (let x = atAim.endSoc, round = 0; round < CLOSE_ROUNDS; round++) {
            const r = drive(close, null, x);
            const [stops, kwh] = fastOf(r.out);
            if (stops > aimStops || kwh > aimKwh + 1e-6) break;
            if (r.endSoc >= x - STEADY_TOLERANCE) { startSoc = x; run = r; shortPct = 0; break; }
            shortPct = x - r.endSoc;
            x = r.endSoc;
        }
    }
    // Under MONTHLY_STOP_BELOW, the week carries it: Monday starts at aimSoc,
    // Sunday ends that much short, and a stop a month makes it up (below).
    const carriedPct = shortPct > CLOSE_TOLERANCE && shortPct < MONTHLY_STOP_BELOW ? shortPct : 0;
    trace?.step('Monday morning', {
        values: { SoC_aim: val(aimSoc, '%', 'setting') }, result: startSoc, unit: '%',
        note: `${profile.home.none ? 'no home charging: Charge no higher than' : `Charge to${s.fullBeforeLong && s.week[0] === 'L' ? ' (100% before a Long day)' : ''}`}. ${startSoc < aimSoc
            ? `Sunday night comes back short of it; the week repeats from ${startSoc.toFixed(1)}%, the spare plug-in time before the shortfall making it up, so it starts there`
            : carriedPct ? `Sunday night comes back ${carriedPct.toFixed(1)}% short of it each week, under ${MONTHLY_STOP_BELOW}%: a fast stop a month makes it up`
                : 'The week must end here too'}`,
    });

    // Close the week. While Monday morning comes back short, charge the
    // week's last fast stop further, if every night after it ran out of
    // window (a night that tops off, or a later stop charging to its own
    // target, would absorb the extra), up to 100%; else add a stop of its own
    // after the latest driving day whose charge reaches Monday, else Sunday.
    // Rarely more than two rounds. A carried shortfall skips it.
    for (let round = 0; round < CLOSE_ROUNDS && !carriedPct; round++) {
        const { out: o, endSoc } = run;
        let left = startSoc - endSoc;
        if (left <= CLOSE_TOLERANCE) break;
        // Days whose charge reaches Monday: every night from there on ran out (or there is none).
        const reaches = Array(7).fill(false);
        for (let d = 6, all = true; d >= 0; d--) {
            all = all && (profile.home.none || o.days[d].night.ranOut);
            reaches[d] = all;
        }
        const last = o.stops.at(-1);
        if (last && reaches[last.day] && last.toSoc < 100 - 1e-9) {
            const key = `${last.day}:${o.days[last.day].stops.length - 1}`;
            const take = Math.min(left, 100 - last.toSoc);
            close.boost[key] = (close.boost[key] ?? 0) + take;
            left -= take;
        }
        if (left > 1e-9) {
            const after = last ? last.day : -1;
            const d = [6, 5, 4, 3, 2, 1, 0].find(i => i >= after && reaches[i] && s.week[i] !== 'O') ?? 6;
            close.added[d] += left;
        }
        run = drive(close, null, startSoc);
    }
    const { out, endSoc: soc } = drive(close, trace, startSoc);
    const closed = out.stops.filter(x => x.closesWeek);
    if (trace && closed.length) {
        trace.step('Closing the week', {
            values: Object.fromEntries(closed.map((x, i) => [`stop_${i + 1}`, val(x.toSoc, '%')])),
            result: soc, unit: '%',
            note: `the nights alone left Monday morning short of ${startSoc}%, so ${closed.map(x => `${WEEKDAYS[x.day]}'s ${x.planned ? 'planned stop' : 'stop'} from ${x.fromSoc.toFixed(0)}%`).join(', ')} charged further, to the figures here: the week's last fast stop, where every night after it ran out, else a stop of its own after the latest such driving day; Monday morning ends at the result`,
        });
    }
    // The week wraps. A Sunday night that runs past midnight is, on the line,
    // Monday morning: cut it at the week's end and carry the rest to Monday
    // 0:00, which (the week being closed) starts where this one ends. A
    // carried shortfall is the month's stop's to make up, not the week's: the
    // line steps over it at the week's edge, where Monday starts.
    const WEEK = 7 * 24;
    const lift = carriedPct ? startSoc - soc : 0;
    const past = out.points.findIndex(([h]) => h > WEEK);
    if (past > 0) {
        const [h0, s0] = out.points[past - 1], [h1, s1] = out.points[past];
        const atMidnight = s0 + (s1 - s0) * (WEEK - h0) / (h1 - h0);
        const carried = out.points.slice(past).map(([h, v]) => [h - WEEK, v + lift]);
        out.points.length = past;
        out.points.push([WEEK, atMidnight]);
        out.points.splice(0, 1, [0, atMidnight + lift], ...carried);
    } else {
        out.points.push([WEEK, soc]);
    }

    // The month's stop, for a carried shortfall: from where a month of it
    // leaves Monday morning, back up, plus its detour; a twelfth of a year's
    // worth, so 12/52 of it a week.
    let monthly = null;
    if (carriedPct) {
        const addPct = perMonth(carriedPct);
        const detourPct = pct(detourMi * whPerMi.D / 1000);
        const fromSoc = Math.max(s.keepAbove, startSoc - addPct);
        const toSoc = Math.min(100, fromSoc + addPct + detourPct);
        const chargeMinutes = profile.fast.minutes(fromSoc, toSoc);
        const minutes = chargeMinutes + s.detourMin + s.startMin;
        const packKwh = (toSoc - fromSoc) / 100 * usable;
        const kwh = (packKwh + warmKwh) / (1 - DC_FAST_LOSS);
        monthly = { shortPct: carriedPct, fromSoc, toSoc, minutes, chargeMinutes, kwh, cost: kwh * s.fastPrice };
        const share = 1 / WEEKS_PER_MONTH;
        out.fastPackKwh += packKwh * share;
        out.fastWarmPackKwh += warmKwh * share;
        out.fastMinutes += minutes * share;
        out.usedKwh += detourPct / 100 * usable * share;
        trace?.step('A fast stop a month', {
            formula: 'ΔSoC_month = short × 52 / 12; t_month = t_charge + t_detour + t_start',
            values: {
                short: val(carriedPct, '%/wk'), t_charge: val(chargeMinutes, 'min'),
                t_detour: val(s.detourMin, 'min', 'setting'), t_start: val(s.startMin, 'min', 'setting'),
            },
            result: minutes, unit: 'min',
            note: `Sunday night ends ${carriedPct.toFixed(1)}% short each week, under ${MONTHLY_STOP_BELOW}%: one stop a month, ${fromSoc.toFixed(0)} → ${toSoc.toFixed(0)}% with its detour, off the chart; 12/52 of its time, energy and cost count in each week's`,
        });
    }

    const fastKwh = (out.fastPackKwh + out.fastWarmPackKwh) / (1 - DC_FAST_LOSS);
    const homeKwh = out.homeWallKwh;
    if (trace) {
        const days = trace.group('The reported week, day by day');
        for (const day of out.days) {
            days.step(`${day.day} (${day.type === 'L' ? 'Long day' : day.type === 'D' ? 'Daily' : 'Off'})`, {
                formula: day.miles ? 'E_day = miles × e / 1000' : null,
                values: day.miles ? { miles: val(day.miles, 'mi', 'setting'), e: val(day.kwhUsed * 1000 / day.miles, 'Wh/mi') } : {},
                result: day.kwhUsed, unit: 'kWh',
                note: `starts ${day.startSoc.toFixed(1)}%, ${day.stops.length} fast stop${day.stops.length === 1 ? '' : 's'}, home at ${day.homeSoc.toFixed(1)}%, night adds ${day.night.added.toFixed(1)}%${day.night.ranOut ? ' (ran out of night)' : ''}`,
            });
        }
        trace.step('Phantom drain a week', {
            formula: 'E_phantom = Σ parked hours × drain / 24 × E_usable / 100',
            values: { drain: val(profile.phantom?.pctDay ?? 0, '%/day', profile.phantom?.source) },
            result: out.phantomKwh, unit: 'kWh', assumed: profile.phantom?.source !== 'data',
            note: 'lost while parked, not driving or charging; the nights and fast stops buy it back',
        });
        trace.step('Fast charging bought', {
            formula: 'E_fast = (E_pack_all + E_warm_fast) / (1 − loss)',
            values: { E_pack_all: val(out.fastPackKwh, 'kWh'), E_warm_fast: val(out.fastWarmPackKwh, 'kWh'), loss: val(DC_FAST_LOSS, null, 'knob:DC_FAST_LOSS') },
            result: fastKwh, unit: 'kWh',
            note: out.fastWarmPackKwh > 0 ? 'E_warm_fast: battery warming, once for each day with a fast stop' : null,
        });
        trace.step('Battery warming bought', {
            formula: 'E_warm_all = n × E_warm_wall',
            values: { n: val(out.homeCharges, 'nights'), E_warm_wall: val(night.warmWallKwh, 'kWh') },
            result: out.warmWallKwh, unit: 'kWh', assumed: true,
            note: `a guess: once each night the charger runs, parked outside; none at or above ${PACK_WARMING_BELOW_F}°F`,
        });
        trace.step('Home charging bought', {
            formula: 'E_home = E_pack_all / η_home + E_warm_all',
            values: { E_pack_all: val(out.homePackKwh, 'kWh'), η_home: val(profile.home.eff), E_warm_all: val(out.warmWallKwh, 'kWh') },
            result: homeKwh, unit: 'kWh',
        });
        trace.step('Fast cost a week', { formula: 'cost_fast = E_fast × price_fast', values: { E_fast: val(fastKwh, 'kWh'), price_fast: val(s.fastPrice, '$/kWh', 'setting') }, result: fastKwh * s.fastPrice, unit: '$' });
        if (s.rate === 'flat') {
            trace.step('Home cost a week', { formula: 'cost_home = E_home × price_home', values: { E_home: val(homeKwh, 'kWh'), price_home: val(s.homePrice, '$/kWh', 'setting') }, result: out.homeCost, unit: '$' });
        } else {
            trace.step('Home cost a week', {
                formula: 'cost_home = Σ E_hour × price_hour',
                values: { E_home: val(homeKwh, 'kWh'), price_avg: val(homeKwh > 0 ? out.homeCost / homeKwh : 0, '$/kWh') },
                result: out.homeCost, unit: '$',
                note: `${ratePlanName(s)}: each night charges in its cheapest hours first, and in dearer ones only where the cheap hours cannot hold it`,
            });
        }
        trace.step('Fast-charging time a week', { formula: 'the sum of every t_stop', result: out.fastMinutes, unit: 'min', note: `${out.stops.length} stop${out.stops.length === 1 ? '' : 's'}${monthly ? ', and 12/52 of the stop a month' : ''}` });
    }
    return {
        points: out.points, stops: out.stops, days: out.days, miles: out.miles,
        // The month's stop counts as 12/52 of one.
        stopCount: out.stops.length + (monthly ? 1 / WEEKS_PER_MONTH : 0),
        // A carried shortfall's stop a month, off the chart: { shortPct (a week),
        // fromSoc, toSoc, minutes, chargeMinutes, kwh, cost }, or null.
        monthly,
        fastMinutes: out.fastMinutes,
        fastKwh, homeKwh,
        fastCost: fastKwh * s.fastPrice,
        homeCost: out.homeCost,
        // On a time-of-use plan: the home cost by tier, [dearest, middle, cheapest],
        // and the season's tier names and base (rateTiers). Null at One price.
        homeTierCost: rateTiers(s, season) ? out.homeTierCost : null,
        rateTiers: profile.home.none ? null : rateTiers(s, season),
        usedKwh: out.usedKwh,
        // The battery a parked car lost over the week (phantom drain), kWh; the
        // days carry their own share as `phantomPct`.
        phantomKwh: out.phantomKwh,
        fastShare: out.usedKwh > 0 ? out.fastPackKwh / out.usedKwh : 0,
        // No charger, no window to have margin in.
        windows: profile.home.none ? [] : plugWindows(out.days.map(d => d.night)),
    };
}

// ── The gas car ──────────────────────────────────────────────────────────────

/**
 * The share of the gas car's EPA city and highway mpg lost at a temperature:
 * GAS_COLD_LOSS at GAS_COLD_AT_F, a straight line to none at the lab's.
 */
export function gasColdLoss(temperatureF) {
    const t = Math.max(0, (EPA_LAB_TEMP_F - temperatureF) / (EPA_LAB_TEMP_F - GAS_COLD_AT_F));
    return { city: GAS_COLD_LOSS.city * t, hwy: GAS_COLD_LOSS.hwy * t };
}

/**
 * The same week in the reader's gas car: the same miles and city share, the
 * gallons and fill-ups they take, its mpg cut for the season's temperature
 * (gasColdLoss). Fill-ups are reported both for the sample week (what the
 * chart draws) and as the average a week, since one week is lumpy — 1 one
 * week, 2 the next.
 *
 * @param {Object} settings
 * @param {Object} [opts]
 * @param {'summer'|'winter'} [opts.season]  default settings.season
 *
 * @returns {{ points: Array<[number, number]>, fills: Array<{ day, hour, gallons, cost }>,
 *             gallons, cost, fillsPerWeek, minutesPerWeek, rangeMi, cityMpg, hwyMpg }}
 *   `cityMpg`/`hwyMpg` — the EPA figures after the cold loss
 */
export function simulateGasWeek(settings, { season = settings.season, trace = null } = {}) {
    const s = settings;
    const loss = gasColdLoss(season === 'summer' ? s.summerF : s.winterF);
    const cityMpg = s.gasCity * (1 - loss.city), hwyMpg = s.gasHwy * (1 - loss.hwy);
    const mpgOf = (type) => {
        const city = (type === 'L' ? s.longCity : s.dailyCity) / 100;
        return 1 / (city / cityMpg + (1 - city) / hwyMpg);
    };
    if (trace) {
        const tempF = season === 'summer' ? s.summerF : s.winterF;
        const t = Math.max(0, (EPA_LAB_TEMP_F - tempF) / (EPA_LAB_TEMP_F - GAS_COLD_AT_F));
        trace.step('Cold loss', {
            formula: 't = max(0, (T_lab − T) / (T_lab − T_cold))',
            values: { T_lab: val(EPA_LAB_TEMP_F, '°F', 'code:EPA_LAB_TEMP_F'), T: val(tempF, '°F', 'setting'), T_cold: val(GAS_COLD_AT_F, '°F', 'code:GAS_COLD_AT_F') },
            result: t, note: `the ${season}; at T_cold the loss is the full GAS_COLD_LOSS, at the lab's none`,
        });
        trace.step('City mpg after the cold', {
            formula: 'mpg_city′ = mpg_city × (1 − loss_city × t)',
            values: { mpg_city: val(s.gasCity, 'mpg', 'setting'), loss_city: val(GAS_COLD_LOSS.city, null, 'code:GAS_COLD_LOSS'), t: val(t) },
            result: cityMpg, unit: 'mpg',
        });
        trace.step('Highway mpg after the cold', {
            formula: 'mpg_hwy′ = mpg_hwy × (1 − loss_hwy × t)',
            values: { mpg_hwy: val(s.gasHwy, 'mpg', 'setting'), loss_hwy: val(GAS_COLD_LOSS.hwy, null, 'code:GAS_COLD_LOSS'), t: val(t) },
            result: hwyMpg, unit: 'mpg',
        });
        for (const type of ['D', 'L']) {
            const c = (type === 'L' ? s.longCity : s.dailyCity) / 100;
            trace.step(`mpg on a ${type === 'L' ? 'Long day' : 'Daily'}`, {
                formula: "mpg = 1 / (c / mpg_city′ + (1 − c) / mpg_hwy′)",
                values: { c: val(c, null, 'setting'), "mpg_city′": val(cityMpg, 'mpg'), "mpg_hwy′": val(hwyMpg, 'mpg') },
                result: mpgOf(type), unit: 'mpg', note: 'gallons add, so the two blend as a harmonic mean',
            });
        }
    }
    const floor = s.gasTank * s.gasFillAt / 100;
    let gal = s.gasTank;
    let gallons = 0, miles = 0;
    const points = [], fills = [];
    for (let w = 0; w <= SETTLE_WEEKS; w++) {
        const rec = w === SETTLE_WEEKS;
        for (let d = 0; d < 7; d++) {
            const type = s.week[d];
            const base = d * 24;
            const dayGal = type === 'O' ? 0 : dayMiles(type, s) / mpgOf(type);
            if (rec) {
                if (d === 0) points.push([0, gal]);
                points.push([base + 7, gal]);
                gallons += dayGal;
                miles += dayMiles(type, s);
            }
            for (const span of DAY_SPANS[type]) {
                let left = dayGal * span.share;
                const rate = left / (span.to - span.from);
                let hour = span.from;
                while (left > 1e-9) {
                    if (gal - left >= floor) { hour += left / rate; gal -= left; if (rec) points.push([base + hour, gal]); break; }
                    const run = gal - floor;
                    hour += run / rate; gal -= run; left -= run;
                    if (rec) {
                        points.push([base + hour, gal]);
                        fills.push({ day: d, hour: base + hour, gallons: s.gasTank - gal, cost: (s.gasTank - gal) * s.gasPrice });
                    }
                    hour += s.gasFillMin / 60;
                    gal = s.gasTank;
                    if (rec) points.push([base + hour, gal]);
                }
            }
        }
    }
    points.push([7 * 24, gal]);
    const perFill = s.gasTank - floor;
    const fillsPerWeek = perFill > 0 ? gallons / perFill : 0;
    if (trace) {
        trace.step('Gallons a week', { formula: 'the sum of each day\'s miles / mpg', result: gallons, unit: 'gal' });
        trace.step('Gas cost a week', { formula: 'cost_gas = gal × price', values: { gal: val(gallons, 'gal'), price: val(s.gasPrice, '$/gal', 'setting') }, result: gallons * s.gasPrice, unit: '$' });
        trace.step('Fill-ups a week', {
            formula: 'fills = gal / (tank × (1 − fill_at))',
            values: { gal: val(gallons, 'gal'), tank: val(s.gasTank, 'gal', 'setting'), fill_at: val(s.gasFillAt / 100, null, 'setting') },
            result: fillsPerWeek, note: 'an average, since one week is lumpy',
        });
        trace.step('Fill-up time a week', { formula: 't = fills × t_fill', values: { fills: fillsPerWeek, t_fill: val(s.gasFillMin, 'min', 'setting') }, result: fillsPerWeek * s.gasFillMin, unit: 'min' });
    }
    return {
        points, fills, gallons, cost: gallons * s.gasPrice,
        fillsPerWeek, minutesPerWeek: fillsPerWeek * s.gasFillMin,
        rangeMi: miles > 0 ? s.gasTank * miles / gallons : 0,
        cityMpg, hwyMpg,
    };
}

/**
 * The gas car on a road trip: where it stops for fuel, and how long the trip
 * takes it (#555). It stops when its TANK runs down to the fill-up level
 * (`gasFillAt`, 15% left by default), not on a timer, and each stop is the
 * fill-up's own minutes (`gasFillMin`, 5), not the EVs' stop overhead — the
 * same car, rule and defaults as Cost & Time's week (simulateGasWeek), read
 * from the one set of settings both tabs share.
 *
 * Range between stops is the usable fuel × the EPA HIGHWAY mpg. Cost & Time's
 * highway miles use that figure whatever the speed, so this does too: speed
 * sets how long a leg takes, not how far it goes. (Real mpg falls above about
 * 60 mph; neither tab models that, and a car priced differently in the two
 * would be the larger fault.)
 *
 * The cold loss (gasColdLoss, the highway share) applies only when the caller
 * names a temperature. Cost & Time always has one (the season shown); Road
 * Trip has one only while its correction is on, the temperature the EVs are
 * corrected to, so that a trip corrected to 20°F cuts the gas car's range as
 * it cuts the EVs'. With no correction the EVs run as tested, at whatever
 * temperature each test was, so there is no one temperature to cut the gas
 * car by and `temperatureF` is left null: no loss.
 *
 * The car starts full, and the trip ends when its miles are done: a stop is
 * made only where more driving follows, so a trip exactly one range long makes
 * none.
 *
 * @param {Object} settings   the shared settings (gasHwy, gasTank, gasFillAt, gasFillMin)
 * @param {Object} trip
 * @param {number} trip.distanceMi
 * @param {number} trip.speedMph
 * @param {number|null} [trip.temperatureF]  null: no cold loss
 *
 * @returns {{ legs: Array<{ fromMi, driveMi, driveMin, fuelLeft }>, stops: number, stopMi: number[],
 *             stopMin: number, driveMin: number, totalMin: number, rangeMi: number, hwyMpg: number }}
 *   `fuelLeft` — the share of the tank left at the end of a leg (the fill-up level on every leg but the last)
 */
export function gasTripLegs(settings, { distanceMi, speedMph, temperatureF = null }) {
    const s = settings;
    const loss = temperatureF == null ? 0 : gasColdLoss(temperatureF).hwy;
    const hwyMpg = s.gasHwy * (1 - loss);
    const rangeMi = s.gasTank * (1 - s.gasFillAt / 100) * hwyMpg;
    const legs = [];
    let at = 0;
    // An unreadable range (never from the sliders) is one leg, not a loop.
    while (distanceMi - at > 0.01) {
        const driveMi = Number.isFinite(rangeMi) && rangeMi > 0 ? Math.min(rangeMi, distanceMi - at) : distanceMi - at;
        legs.push({
            fromMi: at, driveMi,
            driveMin: speedMph > 0 ? (driveMi / speedMph) * 60 : 0,
            fuelLeft: (s.gasTank - driveMi / hwyMpg) / s.gasTank,
        });
        at += driveMi;
    }
    const stops = Math.max(0, legs.length - 1);
    const driveMin = legs.reduce((sum, leg) => sum + leg.driveMin, 0);
    return {
        legs, stops, stopMi: legs.slice(1).map(leg => leg.fromMi),
        stopMin: s.gasFillMin, driveMin, totalMin: driveMin + stops * s.gasFillMin,
        rangeMi, hwyMpg,
    };
}

// ── As a reader reads them ───────────────────────────────────────────────────

/** A share as a percent to a tenth: 0.885 → "88.5%". */
export const percentText = (x) => `${Math.round(x * 1000) / 10}%`;

/** Whole dollars: "$231". */
export const dollars = (n) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

/** Minutes, as hours and minutes past an hour: "53 min", "3 h 28 min". */
export function minutesText(min) {
    const m = Math.round(Math.abs(min));
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** What an EV saves a month against the gas car: "$231/mo less", "$40/mo more". */
export const savedText = (saved) => `${dollars(saved)}/mo ${saved >= 0 ? 'less' : 'more'}`;

/** Extra time a week against the gas car: "+41 min/wk", "−12 min/wk". */
export const extraTimeText = (extra) => `${extra >= 0 ? '+' : '−'}${minutesText(extra)}/wk`;

/** An hour of the week as a weekday and a clock time: "Tue 1:40 pm". */
export function weekTimeText(weekHour) {
    const day = WEEKDAYS[Math.floor(weekHour / 24) % 7];
    const total = Math.round((weekHour % 24) * 60);
    const h = Math.floor(total / 60) % 24, m = total % 60;
    return `${day} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * The week in one line, in numerals with each kind of day's miles: "255 mi
 * per week · 5 days 35 mi, 1 day 80 mi, 1 day off". The commonest first; two
 * kinds at the same miles are one. "Daily" and "Long day" are the settings'
 * names, not the reader's (owner, 2026-11-10: "the long / daily means nothing").
 * Each phrase is held together with no-break spaces (NBSP), so a narrow card
 * wraps between them, never "1 / day off".
 */
const NBSP = '\u00a0';
export function weekSummary(settings) {
    const count = (t) => [...settings.week].filter(c => c === t).length;
    const days = (n) => `${n}${NBSP}day${n === 1 ? '' : 's'}`;
    const driving = [];
    for (const [type, mi] of [['D', settings.dailyMi], ['L', settings.longMi]]) {
        const n = count(type);
        if (n === 0) continue;
        const same = driving.find(d => d.mi === mi);
        if (same) same.n += n; else driving.push({ n, mi });
    }
    driving.sort((a, b) => b.n - a.n);
    const parts = driving.map(d => `${days(d.n)}${NBSP}${d.mi}${NBSP}mi`);
    if (count('O') > 0) parts.push(`${days(count('O'))}${NBSP}off`);
    const miles = driving.reduce((sum, d) => sum + d.n * d.mi, 0);
    return `${miles.toLocaleString('en-US')}${NBSP}mi${NBSP}per${NBSP}week · ${parts.join(', ')}`;
}

/**
 * The gas car's name: the picked car's, else the reader's own, else "Your gas
 * car" (owner, 2026-11-10; the fallback was "Custom" until #555, 2026-11-12).
 * The one label every chart gives it, in Cost & Time and Road Trip alike.
 */
export function gasCarName(settings) {
    const picked = GAS_CAR_PRESETS.find(p => p.key === settings.gasCar);
    return picked ? picked.label : ((settings.gasName ?? '').trim() || GAS_CAR_FALLBACK_NAME);
}

/**
 * A home charger as the charts name it: "L2 11.5 kW", a wall outlet "L1 1.4
 * kW" (owner, 2026-11-10); "no home charging" for the level that is none.
 * The settings keep "240 V · 48 A", what a reader buys and wires.
 */
export const chargerText = (level) => (level.none
    ? `no${NBSP}home${NBSP}charging`
    : `L${level.volts < 200 ? 1 : 2}${NBSP}${levelKw(level).toFixed(1)}${NBSP}kW`);

/**
 * What a chart assumed charging costs, for its subtitle: "L2 11.5 kW at
 * $0.17/kWh · fast charging at $0.48/kWh". Without a level (Charging Speeds
 * compares them all), "home at $0.17/kWh · …"; with no home charging, no
 * home price. Each phrase is held together, as the week's are, so a subtitle
 * wraps at a "·".
 */
export function chargingText(settings, level = null) {
    const held = (t) => t.replace(/ /g, NBSP);
    const plan = ratePlanName(settings);
    const home = level?.none
        ? chargerText(level)
        : held(`${level ? chargerText(level) : 'home'} ${plan ? `on ${plan}` : `at $${settings.homePrice.toFixed(2)}/kWh`}`);
    return `${home} · ${held(`fast charging at $${settings.fastPrice.toFixed(2)}/kWh`)}`;
}

// ── Charging Speeds ────────────────────────────────────────────────────────────

/**
 * Where a bigger home charger stops helping: the index of the first level whose
 * fast minutes a week are within ENOUGH_MARGIN_MIN of the least any level
 * manages. Null when nothing could be priced.
 *
 * @param {Array<number|null>} fastMinutes  per level, in HOME_LEVELS order; null where unpriced
 */
export function enoughLevel(fastMinutes) {
    const priced = fastMinutes.filter(m => m != null);
    if (!priced.length) return null;
    const best = Math.min(...priced);
    return fastMinutes.findIndex(m => m != null && m <= best + ENOUGH_MARGIN_MIN);
}

// ── Against the gas car ──────────────────────────────────────────────────────

/** A week's cost and time as a month: × 52 ÷ 12. */
export const perMonth = (weekly) => weekly * WEEKS_PER_MONTH;

/**
 * The most a car's home charging could cost in a month at its level: the lesser
 * of the charger and the car's onboard charger, at full power for the whole
 * plug-in window, every night (the day off too), at the home price. Energy
 * bought at the wall, losses and battery warming in — warming runs inside the
 * window (nightBudget), so it never adds to it. Where the charger, not the
 * car, limits, every car's ceiling is the same. The `homeCost` the week is
 * priced at never exceeds it. Null with no home charging.
 *
 * @param {Object} profile   costToDriveVehicle's answer (`home`)
 * @param {Object} settings  normalized settings
 */
export function homeCostCeiling(profile, settings, trace = null) {
    if (profile.home.none) return null;
    const kw = profile.home.kw;
    // One price and one window every night: the plain form, as it always read.
    if (settings.rate === 'flat' && [...settings.week].every((_, d) => windowOf(settings, d).to - windowOf(settings, d).from === plugHours(settings))) {
        const ceiling = perMonth(7 * kw * plugHours(settings) * settings.homePrice);
        trace?.step('Most it could cost at home', {
            formula: 'cost_max = P_home × h × 7 × price_home × 52 / 12',
            values: { P_home: val(kw, 'kW'), h: val(plugHours(settings), 'h', 'setting'), price_home: val(settings.homePrice, '$/kWh', 'setting') },
            result: ceiling, unit: '$/mo',
            note: 'every night at full power for the whole window; battery warming runs inside it, so it adds nothing here',
        });
        return ceiling;
    }
    // Each night's window, hour by hour at that hour's price.
    const priceAt = homePricing(settings);
    let week = 0, hours = 0;
    for (let d = 0; d < 7; d++) {
        const { from, to } = windowOf(settings, d);
        for (let a = from; a < to - 1e-9;) {
            const b = Math.min(to, Math.floor(a + 1e-9) + 1);
            week += kw * (b - a) * priceAt(d * 24 + a);
            hours += b - a;
            a = b;
        }
    }
    const ceiling = perMonth(week);
    trace?.step('Most it could cost at home', {
        formula: 'cost_max = Σ P_home × price_hour, every hour of every plug-in window, × 52 / 12',
        values: { P_home: val(kw, 'kW'), h_week: val(hours, 'h', 'setting'), price_avg: val(hours > 0 ? week / (kw * hours) : 0, '$/kWh') },
        result: ceiling, unit: '$/mo',
        note: 'every night at full power for the whole window, each hour at its own price; battery warming runs inside it, so it adds nothing here',
    });
    return ceiling;
}

/**
 * One vehicle against the gas car, for the season shown and across a year
 * (winter months at winter figures, the rest at summer ones).
 *
 * @returns {{ week, summer, winter, gas, monthly: { ev, gas, saved }, yearly: { ev, gas, saved },
 *             extraMinutesPerWeek: number }}  `extraMinutesPerWeek` — fast-charging time
 *   less fill-up time; negative when the EV costs less time
 */
export function costToDriveComparison(profile, settings, { trace = null } = {}) {
    // The season on the page is traced; the other runs the same steps.
    const summer = simulateWeek(profile, settings, { season: 'summer', trace: settings.season === 'summer' ? trace?.group('The summer week, simulated') : null });
    const winter = simulateWeek(profile, settings, { season: 'winter', trace: settings.season === 'winter' ? trace?.group('The winter week, simulated') : null });
    const week = settings.season === 'summer' ? summer : winter;
    // The season on screen is the one the trace works through; the other runs untraced.
    const shownSeason = settings.season === 'summer' ? 'summer' : 'winter';
    const gasOf = (season) => simulateGasWeek(settings, { season, trace: season === shownSeason ? trace?.group(`Your gas car, the same week (${season})`) : null });
    const gasSummer = gasOf('summer');
    const gasWinter = gasOf('winter');
    const gas = shownSeason === 'summer' ? gasSummer : gasWinter;
    const evWeek = (w) => w.fastCost + w.homeCost;
    const months = settings.winterMonths;
    const evYear = perMonth(evWeek(winter)) * months + perMonth(evWeek(summer)) * (12 - months);
    const gasYear = perMonth(gasWinter.cost) * months + perMonth(gasSummer.cost) * (12 - months);
    if (trace) {
        const m = trace.group('As a month, against the gas car');
        m.step('EV cost a month', { formula: 'ev_mo = (cost_fast + cost_home) × 52 / 12', values: { cost_fast: val(week.fastCost, '$'), cost_home: val(week.homeCost, '$') }, result: perMonth(evWeek(week)), unit: '$/mo' });
        m.step('Gas cost a month', { formula: 'gas_mo = cost_gas × 52 / 12', values: { cost_gas: val(gas.cost, '$') }, result: perMonth(gas.cost), unit: '$/mo' });
        m.step('Saved a month', { formula: 'saved = gas_mo − ev_mo', values: { gas_mo: val(perMonth(gas.cost), '$/mo'), ev_mo: val(perMonth(evWeek(week)), '$/mo') }, result: perMonth(gas.cost - evWeek(week)), unit: '$/mo' });
        m.step('Extra time a month', {
            formula: 'Δt = (t_fast − t_fill) × 52 / 12', values: { t_fast: val(week.fastMinutes, 'min/wk'), t_fill: val(gas.minutesPerWeek, 'min/wk') },
            result: perMonth(week.fastMinutes - gas.minutesPerWeek), unit: 'min/mo',
        });
        m.step('Saved a year', {
            formula: 'saved_yr = (gas_w − ev_w) × n_w + (gas_s − ev_s) × (12 − n_w)',
            values: {
                gas_w: val(perMonth(gasWinter.cost), '$/mo'), ev_w: val(perMonth(evWeek(winter)), '$/mo'),
                gas_s: val(perMonth(gasSummer.cost), '$/mo'), ev_s: val(perMonth(evWeek(summer)), '$/mo'),
                n_w: val(months, 'months', 'setting'),
            },
            result: gasYear - evYear, unit: '$/yr', note: 'the other season runs the same steps with its own temperature',
        });
    }
    return {
        week, summer, winter, gas,
        monthly: { ev: perMonth(evWeek(week)), gas: perMonth(gas.cost), saved: perMonth(gas.cost - evWeek(week)) },
        yearly: { ev: evYear, gas: gasYear, saved: gasYear - evYear },
        extraMinutesPerWeek: week.fastMinutes - gas.minutesPerWeek,
    };
}
