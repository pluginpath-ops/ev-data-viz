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
    MIN_STOP_ADD, STRETCH_CAP_TO, LATE_STOP_MARGIN, DAY_SPANS, PLANNED_HOUR,
    SETTLE_WEEKS, FALLBACK_DC_KW, EPA_LAB_TEMP_F, GAS_COLD_AT_F, GAS_COLD_LOSS, WEEKDAYS, ENOUGH_MARGIN_MIN,
    GAS_CAR_PRESETS, GAS_CAR_FALLBACK_NAME,
} from '../constants/costToDrive';
import {
    ASSUMED_CHARGER_EFF, FIXED_DRAW_W, BATTERY_WARMING_KWH, DC_FAST_LOSS, HWFET_AVG_MPH, UDDS_AVG_MPH, STANDARD_CONDITIONS,
} from '../constants/epa';
import { correctionFactor } from './conditionCorrection';
import { compositeRange } from './compositeRange';
import { chargeTimeSession } from './chargeWindows';
import { val } from './calcTrace';
import { CHARGER_EFF_BASIS } from './vehicleFigures';

const WEEKS_PER_MONTH = 52 / 12;
const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;

/** Hours the car is plugged in a night: 10 pm to 7 am is 9; the same hour twice is all 24. */
export const plugHours = (s) => ((s.plugUntil - s.plugFrom + 24) % 24) || 24;

/**
 * Each night's plug-in window as a span of the week's hours (Monday 0:00 = 0):
 * `{ from, to, spareFrom }`. The charger ran from `from` to `spareFrom`; from
 * there to `to` the battery had what it wanted and the charger had time to
 * spare. A window that runs past Sunday midnight is cut at the week's end and
 * its rest starts the week, as the week's line does.
 *
 * @param {Object} s  normalized settings
 * @param {Array<{ hours: number }>} nights  each night's charging hours, Monday's first
 */
export function plugWindows(s, nights) {
    const WEEK = 7 * 24;
    const len = plugHours(s);
    return nights.flatMap((n, d) => {
        const from = d * 24 + s.plugFrom, to = from + len;
        const spareFrom = Math.min(to, from + n.hours);
        if (to <= WEEK) return [{ from, to, spareFrom }];
        return [
            { from, to: WEEK, spareFrom: Math.min(spareFrom, WEEK) },
            { from: 0, to: to - WEEK, spareFrom: Math.max(0, spareFrom - WEEK) },
        ];
    });
}

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
    if (!usableKwh) {
        return { usableKwh: null, missing: 'no usable battery capacity', whPerMi: null, highwayFrom: null, cityFrom: null, home, warmKwhPerF: null, fast: null };
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
        return { usableKwh, missing: 'no range test and no EPA highway figure', whPerMi: null, highwayFrom: null, cityFrom: null, home, warmKwhPerF, fast: null };
    }
    return { usableKwh, missing: null, whPerMi, highwayFrom, cityFrom, home, warmKwhPerF, fast: fastChargeOf(vehicle, specs, usableKwh, trace?.group('Fast charging')) };
}

/** How far below the wall's kW an onboard charger must be before it is said to cap it. */
const CAPPED_TOLERANCE_KW = 0.25;

/** The most rounds closing a week takes; most close in one or two. */
const CLOSE_ROUNDS = 8;

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

/** Battery warming one home charge buys at `temperatureF`, pack side, kWh: none at or above PACK_WARMING_BELOW_F. */
/**
 * Where the week starts Monday morning, and must end: Sunday night's limit
 * (Charge to, 100% before a Long Monday), or with no home charging, Charge no
 * higher than.
 */
const weekStartSoc = (profile, s) => {
    if (profile.home.none) return s.capTo;
    return s.fullBeforeLong && s.week[0] === 'L' ? 100 : s.chargeTo;
};

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
 * ends lower hides the fast charging it will need). Where the nights cannot,
 * the week's last fast stop charges further, else a stop of its own on the
 * latest driving day whose charge reaches Monday (owner: "add the DCFC to an
 * existing one, or earlier in the week"). That may be time the week did not
 * otherwise need: realistic.
 * The week is driven twice and the second reported, so Monday's morning
 * starts after Sunday night's charging, as the week's line wraps it.
 *
 * The fast-stop rule (docs/cost-to-drive-plan.md): when the rest of the day
 * would end below `keepAbove`, the car stops when it reaches `stopBy` — later,
 * at keepAbove + the detour + LATE_STOP_MARGIN, if the day started below it —
 * and charges enough to finish the day above `keepAbove`, at least MIN_STOP_ADD,
 * under `capTo`, stretching to STRETCH_CAP_TO when that saves a second stop.
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
 *   stopCount, fastMinutes, fastKwh, homeKwh, fastCost, homeCost, usedKwh, fastShare, miles
 * }}  `fastKwh`/`homeKwh` are what was bought (losses in); `fastShare` the share of
 *     the pack energy used that came from fast chargers
 */
export function simulateWeek(profile, settings, { season = settings.season, trace = null } = {}) {
    const s = settings;
    const usable = profile.usableKwh;
    const whPerMi = profile.whPerMi[season];
    const pct = (kwh) => kwh / usable * 100;
    const detourMi = s.detourMin / 60 * DETOUR_MPH;
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
    const startSoc = weekStartSoc(profile, s);
    trace?.step('Monday morning', {
        values: { SoC_start: val(startSoc, '%', 'setting') }, result: startSoc, unit: '%',
        note: `${profile.home.none ? 'no home charging: Charge no higher than' : `Charge to${s.fullBeforeLong && s.week[0] === 'L' ? ' (100% before a Long day)' : ''}`}. The week must end here too`,
    });

    /**
     * The week, driven from Monday morning. `close` is what closing it adds:
     * `close.boost['d:n']` % more on day d's n-th fast stop, and
     * `close.added[d]` % on a stop of its own after day d's driving. `tr`
     * traces the run.
     */
    const drive = (close, tr) => {
    // The first stop of the reported week is written out as the example.
    let exampleStop = tr;

    let soc = startSoc;
    // Hours into today the last night's charging ran: the day starts no earlier.
    let morning = 0;
    const out = { points: [], stops: [], days: [], miles: 0, usedKwh: 0, fastPackKwh: 0, homePackKwh: 0, homeWallKwh: 0, warmWallKwh: 0, fastWarmPackKwh: 0, homeCharges: 0, fastMinutes: 0 };

    // Twice: the first only sets Monday's morning (when Sunday night ends).
    for (let w = 0; w < 2; w++) {
        const rec = w === 1;
        soc = startSoc;
        for (let d = 0; d < 7; d++) {
            const type = s.week[d];
            const base = d * 24;
            const miles = dayMiles(type, s);
            const wh = type === 'O' ? 0 : whPerMi[type];
            const usePct = pct(miles * wh / 1000);
            const detPct = pct(detourMi * (wh || whPerMi.D) / 1000);
            const day = { day: WEEKDAYS[d], type, miles, kwhUsed: miles * wh / 1000, startSoc: soc, plannedSkipped: false, stops: [] };
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
            const plannedStop = (hour) => {
                if (soc < s.capTo - 0.5) return stopAt(hour, s.capTo, true);
                if (rec) day.plannedSkipped = true;
                return hour;
            };

            const spans = DAY_SPANS[type];
            const plan = planned(d) ? plannedSlot(spans, PLANNED_HOUR) : null;
            // The day's clock: a stop that runs past a span's end pushes the
            // next span later, rather than the line stepping back in time.
            let clock = morning;
            if (plan?.gap === 0) clock = plannedStop(Math.max(plan.hour, clock));
            let threshold = soc < s.stopBy ? s.keepAbove + detPct + LATE_STOP_MARGIN : s.stopBy;
            spans.forEach((span, i) => {
                let hour = Math.max(span.from, clock);
                if (i > 0 && plan?.gap === i) hour = plannedStop(Math.max(plan.hour, clock));
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
                    const to = Math.min(ceiling, Math.max(need <= ceiling ? need : s.capTo, soc + MIN_STOP_ADD));
                    if (rec && exampleStop) {
                        exampleStop.step('How far the first road stop charges', {
                            formula: need <= ceiling ? 'SoC_to = min(ceiling, max(need, SoC + add_min))' : 'SoC_to = min(ceiling, max(cap, SoC + add_min))',
                            values: {
                                need: val(need, '%'), cap: val(s.capTo, '%', 'setting'), SoC: val(soc, '%'),
                                add_min: val(MIN_STOP_ADD, '%', 'code:MIN_STOP_ADD'), ceiling: val(ceiling, '%', 'code:STRETCH_CAP_TO'),
                            },
                            result: to, unit: '%',
                            note: 'need = the rest of the day + the detour + Keep battery above; past the ceiling it charges to the cap and stops again later',
                        });
                    }
                    hour = stopAt(hour, to, false);
                    threshold = s.stopBy;
                }
                clock = hour;
            });
            if (spans.length && plan?.gap === spans.length) clock = plannedStop(Math.max(plan.hour, clock));
            // A stop of its own to close the week, after the day's driving
            // (a trip out, so with the detour), where no stop could carry it.
            if (close.added[d] > 0) {
                const to = Math.min(100, soc + Math.max(close.added[d], MIN_STOP_ADD) + detPct);
                clock = stopAt(spans.length ? clock : Math.max(clock, PLANNED_HOUR), to, false, true);
            }

            // The night: plugged in from plugFrom to plugUntil, to the limit.
            const homeSoc = soc;
            const limit = s.fullBeforeLong && s.week[(d + 1) % 7] === 'L' ? 100 : s.chargeTo;
            // `hours` the charger ran, warming in; `mostAdd` what the whole window could add at full power after
            // warming, % of the pack (the home ceiling). `homeKwh` what the night bought at the wall, warming in;
            // `warmKwh` the warming's share of it.
            const tonight = { added: 0, endSoc: soc, fullAt: null, ranOut: false, hours: 0, mostAdd: night.addPct, homeKwh: 0, warmKwh: 0 };
            const plugIn = Math.max(s.plugFrom, clock);
            if (rec) out.points.push([base + plugIn, soc]);
            // No home charging: nothing is added overnight, so every kWh comes
            // from the fast-stop rule above, at the fast price.
            if (night.wallKwh > 0 && soc < limit - 1e-9) {
                const add = Math.min(limit - soc, night.addPct);
                const chargeHours = night.addPct > 0 ? add / night.addPct * night.chargeHours : 0;
                tonight.added = add;
                tonight.ranOut = add < limit - soc - 1e-9;
                tonight.hours = night.warmHours + chargeHours;
                tonight.fullAt = tonight.ranOut ? null : (s.plugFrom + tonight.hours) % 24;
                tonight.warmKwh = night.warmWallKwh;
                tonight.homeKwh = night.warmWallKwh + add / 100 * usable / profile.home.eff;
                soc += add;
                if (rec) {
                    // Warming first: the line holds flat, then climbs.
                    if (night.warmHours > 0) out.points.push([base + plugIn + night.warmHours, soc - add]);
                    out.points.push([base + plugIn + tonight.hours, soc]);
                    out.homePackKwh += add / 100 * usable;
                    out.homeWallKwh += tonight.homeKwh;
                    out.warmWallKwh += tonight.warmKwh;
                    out.homeCharges += 1;
                }
            }
            tonight.endSoc = soc;
            morning = Math.max(0, plugIn + tonight.hours - 24);
            if (rec) out.days.push({ ...day, homeSoc, night: tonight });
        }
    }
    return { out, endSoc: soc };
    };

    // Close the week. Drive it; while Monday morning comes back short, charge
    // the week's last fast stop further, if every night after it ran out of
    // window (a night that tops off, or a later stop charging to its own
    // target, would absorb the extra), up to 100%; else add a stop of its own
    // after the latest driving day whose charge reaches Monday, else Sunday.
    // Rarely more than two rounds.
    const CLOSE_TOLERANCE = 0.5;
    const close = { boost: {}, added: Array(7).fill(0) };
    for (let round = 0; round < CLOSE_ROUNDS; round++) {
        const { out: o, endSoc } = drive(close, null);
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
    }
    const { out, endSoc: soc } = drive(close, trace);
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
    // 0:00, which (the week being settled) starts where this one ends.
    const WEEK = 7 * 24;
    const past = out.points.findIndex(([h]) => h > WEEK);
    if (past > 0) {
        const [h0, s0] = out.points[past - 1], [h1, s1] = out.points[past];
        const atMidnight = s0 + (s1 - s0) * (WEEK - h0) / (h1 - h0);
        const carried = out.points.slice(past).map(([h, v]) => [h - WEEK, v]);
        out.points.length = past;
        out.points.push([WEEK, atMidnight]);
        out.points.splice(0, 1, [0, atMidnight], ...carried);
    } else {
        out.points.push([WEEK, soc]);
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
        trace.step('Home cost a week', { formula: 'cost_home = E_home × price_home', values: { E_home: val(homeKwh, 'kWh'), price_home: val(s.homePrice, '$/kWh', 'setting') }, result: homeKwh * s.homePrice, unit: '$' });
        trace.step('Fast-charging time a week', { formula: 'the sum of every t_stop', result: out.fastMinutes, unit: 'min', note: `${out.stops.length} stop${out.stops.length === 1 ? '' : 's'}` });
    }
    return {
        points: out.points, stops: out.stops, days: out.days, miles: out.miles,
        stopCount: out.stops.length,
        fastMinutes: out.fastMinutes,
        fastKwh, homeKwh,
        fastCost: fastKwh * s.fastPrice,
        homeCost: homeKwh * s.homePrice,
        usedKwh: out.usedKwh,
        fastShare: out.usedKwh > 0 ? out.fastPackKwh / out.usedKwh : 0,
        // No charger, no window to have margin in.
        windows: profile.home.none ? [] : plugWindows(s, out.days.map(d => d.night)),
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
    const home = level?.none
        ? chargerText(level)
        : held(`${level ? chargerText(level) : 'home'} at $${settings.homePrice.toFixed(2)}/kWh`);
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
    const ceiling = perMonth(7 * profile.home.kw * plugHours(settings) * settings.homePrice);
    trace?.step('Most it could cost at home', {
        formula: 'cost_max = P_home × h × 7 × price_home × 52 / 12',
        values: { P_home: val(profile.home.kw, 'kW'), h: val(plugHours(settings), 'h', 'setting'), price_home: val(settings.homePrice, '$/kWh', 'setting') },
        result: ceiling, unit: '$/mo',
        note: 'every night at full power for the whole window; battery warming runs inside it, so it adds nothing here',
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
