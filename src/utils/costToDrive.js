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
    HOME_LEVELS, levelKw, WALL_OUTLET_CHARGER_EFF, ASSUMED_ONBOARD_AC_KW, DETOUR_MPH,
    MIN_STOP_ADD, STRETCH_CAP_TO, LATE_STOP_MARGIN, DAY_SPANS,
    SETTLE_WEEKS, FALLBACK_DC_KW, EPA_LAB_TEMP_F, WEEKDAYS, ENOUGH_MARGIN_MIN,
} from '../constants/costToDrive';
import { ASSUMED_CHARGER_EFF, DC_FAST_LOSS, HWFET_AVG_MPH, STANDARD_CONDITIONS } from '../constants/epa';
import { correctionFactor } from './conditionCorrection';
import { compositeRange } from './compositeRange';
import { chargeTimeSession } from './chargeWindows';

const WEEKS_PER_MONTH = 52 / 12;
const finite = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;

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
function fastChargeOf(vehicle, specs, usableKwh) {
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

/**
 * The EPA label's highway figure as mi/kWh of the usable pack, re-priced from
 * the lab's 75°F to the reader's temperature and elevation, cabin heating or
 * cooling included. City miles are priced from the highway label, not the city
 * one, on purpose: EPA's city cycle flatters an EV's regen in a way an ordinary
 * commute does not.
 *
 * NOT re-priced for speed. The label is already adjusted toward real driving,
 * and re-pricing the cycle's 48 mph to 70 as if held double-counts it: a Model
 * Y came out near 400 Wh/mi at 70 mph in summer, a third over what it does. The
 * mixed-cycle basis says so to the correction, which then leaves speed alone.
 * Re-pricing for speed properly wants Modeled Efficiency's curve (an EPA test
 * record per car); see the plan's open items.
 */
function epaMiPerKwh(vehicle, usableKwh, { temperatureF, altitudeFt }) {
    const hwyMi = Number(vehicle?.epaRange?.hwyMi);
    if (!(hwyMi > 0) || !(usableKwh > 0)) return null;
    const base = hwyMi / usableKwh;
    const lab = {
        speedMph: HWFET_AVG_MPH,
        speedBasis: 'mixed',
        temperatureF: EPA_LAB_TEMP_F,
        altitudeFt: STANDARD_CONDITIONS.altitudeFt,
        whPerMile: 1000 / base,
    };
    const { factor } = correctionFactor(lab, { mode: 'aero', target: target(HWFET_AVG_MPH, temperatureF, altitudeFt) });
    return base * factor;
}

/**
 * Wh per mile for a day: its city share at the EPA highway figure, the rest at
 * the tested composite (or EPA, per `efficiencyFrom`), all corrected to the
 * season and elevation.
 */
function dayWhPerMi(vehicle, usableKwh, { mph, cityShare, temperatureF, altitudeFt, efficiencyFrom, sessionOf }) {
    const tested = efficiencyFrom === 'tested'
        ? compositeRange(vehicle, { target: target(mph, temperatureF, altitudeFt), sessionOf })?.miPerKwh ?? null
        : null;
    const epa = epaMiPerKwh(vehicle, usableKwh, { temperatureF, altitudeFt });
    const highway = tested ?? epa;
    const city = epa ?? highway;
    if (!(highway > 0) || !(city > 0)) return { whPerMi: null, highwayFrom: null, cityFrom: null };
    const share = cityShare / 100;
    return {
        whPerMi: share * 1000 / city + (1 - share) * 1000 / highway,
        highwayFrom: tested ? 'tested' : 'epa',
        cityFrom: epa ? 'epa' : 'highway',
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
 *   home: { kw: number, chargerKw: number, onboardKw: number, onboardAssumed: boolean, capped: boolean, eff: number },
 *   fast: { basis: string, run: Object|null, minutes: Function },
 * }}  `missing` says why the vehicle cannot be priced, when it cannot
 */
export function costToDriveVehicle(vehicle, settings, { specs = vehicle?.specs, sessionOf = () => null } = {}) {
    const usableKwh = finite(vehicle?.socWindowKwh) ? Number(vehicle.socWindowKwh) : null;
    const level = HOME_LEVELS[settings.level] ?? HOME_LEVELS[4];
    const onboardAssumed = !finite(specs?.charging?.max_ac_kw);
    const onboardKw = onboardAssumed ? ASSUMED_ONBOARD_AC_KW : Number(specs.charging.max_ac_kw);
    const chargerKw = levelKw(level);
    const home = {
        kw: Math.min(chargerKw, onboardKw),
        chargerKw, onboardKw, onboardAssumed,
        // A 48 A circuit is 11.52 kW at the wall against an 11.5 kW onboard
        // charger: equal for any reader, so not "capped".
        capped: onboardKw < chargerKw - CAPPED_TOLERANCE_KW,
        // No home charging has no charger and buys nothing at home; its
        // efficiency is never used, but must not divide by zero.
        eff: level.volts < 200 && !level.none ? WALL_OUTLET_CHARGER_EFF : ASSUMED_CHARGER_EFF,
        none: !!level.none,
    };
    if (!usableKwh) {
        return { usableKwh: null, missing: 'no usable battery capacity', whPerMi: null, highwayFrom: null, cityFrom: null, home, fast: null };
    }
    const whPerMi = { summer: {}, winter: {} };
    let highwayFrom = null, cityFrom = null;
    for (const season of ['summer', 'winter']) {
        const temperatureF = season === 'summer' ? settings.summerF : settings.winterF;
        for (const [type, mph, city] of [['D', settings.dailyMph, settings.dailyCity], ['L', settings.longMph, settings.longCity]]) {
            const day = dayWhPerMi(vehicle, usableKwh, {
                mph, cityShare: city, temperatureF, altitudeFt: settings.elevationFt,
                efficiencyFrom: settings.efficiencyFrom, sessionOf,
            });
            whPerMi[season][type] = day.whPerMi;
            highwayFrom ??= day.highwayFrom;
            cityFrom ??= day.cityFrom;
        }
    }
    if (!(whPerMi.winter.L > 0)) {
        return { usableKwh, missing: 'no range test and no EPA highway figure', whPerMi: null, highwayFrom: null, cityFrom: null, home, fast: null };
    }
    return { usableKwh, missing: null, whPerMi, highwayFrom, cityFrom, home, fast: fastChargeOf(vehicle, specs, usableKwh) };
}

/** How far below the wall's kW an onboard charger must be before it is said to cap it. */
const CAPPED_TOLERANCE_KW = 0.25;

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
 * Drive a week. Three weeks are driven and the last reported, so Monday starts
 * from whatever Sunday night left, not from a guess.
 *
 * The fast-stop rule (docs/cost-to-drive-plan.md): when the rest of the day
 * would end below `keepAbove`, the car stops when it reaches `stopBy` — later,
 * at keepAbove + the detour + LATE_STOP_MARGIN, if the day started below it —
 * and charges enough to finish the day above `keepAbove`, at least MIN_STOP_ADD,
 * under `capTo`, stretching to STRETCH_CAP_TO when that saves a second stop.
 * A planned day tops up to `capTo` unless already above it, at `plannedHour`
 * on a day off and in the gap between drives nearest it on a driving day.
 *
 * @param {Object} profile   costToDriveVehicle's answer (missing must be null)
 * @param {Object} settings  normalized settings
 * @param {Object} [opts]
 * @param {'summer'|'winter'} [opts.season]  default settings.season
 * @returns {{
 *   points: Array<[number, number]>,   [hour of the week, SoC %], Monday 0:00 = 0
 *   stops: Array<{ day, hour, endHour, planned: boolean, fromSoc, toSoc, mile, minutes, chargeMinutes, kwh, cost }>,
 *   days: Array<{ day, type, miles, kwhUsed, startSoc, homeSoc, plannedSkipped: boolean,
 *                 night: { added: number, endSoc: number, fullAt: number|null, ranOut: boolean } }>,
 *   stopCount, fastMinutes, fastKwh, homeKwh, fastCost, homeCost, usedKwh, fastShare, miles
 * }}  `fastKwh`/`homeKwh` are what was bought (losses in); `fastShare` the share of
 *     the pack energy used that came from fast chargers
 */
export function simulateWeek(profile, settings, { season = settings.season } = {}) {
    const s = settings;
    const usable = profile.usableKwh;
    const whPerMi = profile.whPerMi[season];
    const pct = (kwh) => kwh / usable * 100;
    const detourMi = s.detourMin / 60 * DETOUR_MPH;
    const planned = (d) => (s.planned & (1 << d)) !== 0;
    const nightKwh = (() => {
        const hours = ((s.plugUntil - s.plugFrom + 24) % 24) || 24;
        return { hours, addPct: pct(profile.home.kw * hours * profile.home.eff) };
    })();

    let soc = s.chargeTo;
    let sundayNight = null;
    // Hours into today the last night's charging ran: the day starts no earlier.
    let morning = 0;
    const out = { points: [], stops: [], days: [], miles: 0, usedKwh: 0, fastPackKwh: 0, homePackKwh: 0, fastMinutes: 0 };

    for (let w = 0; w <= SETTLE_WEEKS; w++) {
        const rec = w === SETTLE_WEEKS;
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

            const stopAt = (hour, toSoc, isPlanned) => {
                const fromSoc = soc;
                const chargeMinutes = profile.fast.minutes(fromSoc, toSoc);
                const minutes = chargeMinutes + (isPlanned ? 0 : s.detourMin) + s.startMin;
                const packKwh = (toSoc - fromSoc) / 100 * usable;
                const detourPct = isPlanned ? 0 : detPct;
                if (rec) {
                    const kwh = packKwh / (1 - DC_FAST_LOSS);
                    const stop = {
                        day: d, hour: base + hour, endHour: base + hour + minutes / 60, planned: isPlanned,
                        fromSoc, toSoc, mile: Math.round(driven / (usePct || 1) * miles),
                        minutes, chargeMinutes, kwh, cost: kwh * s.fastPrice,
                    };
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
            const plan = planned(d) ? plannedSlot(spans, s.plannedHour) : null;
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
                    hour = stopAt(hour, to, false);
                    threshold = s.stopBy;
                }
                clock = hour;
            });
            if (spans.length && plan?.gap === spans.length) clock = plannedStop(Math.max(plan.hour, clock));

            // The night: plugged in from plugFrom to plugUntil, to the limit.
            const homeSoc = soc;
            const limit = s.fullBeforeLong && s.week[(d + 1) % 7] === 'L' ? 100 : s.chargeTo;
            const night = { added: 0, endSoc: soc, fullAt: null, ranOut: false };
            const plugIn = Math.max(s.plugFrom, clock);
            if (rec) out.points.push([base + plugIn, soc]);
            // No home charging: nothing is added overnight, so every kWh comes
            // from the fast-stop rule above, at the fast price.
            if (nightKwh.addPct > 0 && soc < limit - 1e-9) {
                const add = Math.min(limit - soc, nightKwh.addPct);
                night.added = add;
                night.ranOut = add < limit - soc - 1e-9;
                const hours = add / nightKwh.addPct * nightKwh.hours;
                night.fullAt = night.ranOut ? null : (s.plugFrom + hours) % 24;
                soc += add;
                if (rec) {
                    out.points.push([base + plugIn + hours, soc]);
                    out.homePackKwh += add / 100 * usable;
                    if (d === 6) sundayNight = { from: base + plugIn, hours, startSoc: soc - add, add };
                }
            }
            night.endSoc = soc;
            morning = Math.max(0, plugIn + (night.added ? night.added / nightKwh.addPct * nightKwh.hours : 0) - 24);
            if (rec) out.days.push({ ...day, homeSoc, night });
        }
    }
    // The week wraps. A Sunday night that charges past midnight is, on the
    // line, Monday morning: cut it at the week's end and carry the rest to
    // Monday 0:00, which (the week being settled) starts where this one ends.
    const WEEK = 7 * 24;
    const n = sundayNight;
    if (n && n.from + n.hours > WEEK) {
        const atMidnight = n.startSoc + n.add * (WEEK - n.from) / n.hours;
        out.points[out.points.length - 1] = [WEEK, atMidnight];
        out.points.splice(0, 1, [0, atMidnight], [n.from + n.hours - WEEK, soc]);
    } else {
        out.points.push([WEEK, soc]);
    }

    const fastKwh = out.fastPackKwh / (1 - DC_FAST_LOSS);
    const homeKwh = out.homePackKwh / profile.home.eff;
    return {
        points: out.points, stops: out.stops, days: out.days, miles: out.miles,
        stopCount: out.stops.length,
        fastMinutes: out.fastMinutes,
        fastKwh, homeKwh,
        fastCost: fastKwh * s.fastPrice,
        homeCost: homeKwh * s.homePrice,
        usedKwh: out.usedKwh,
        fastShare: out.usedKwh > 0 ? out.fastPackKwh / out.usedKwh : 0,
    };
}

// ── The gas car ──────────────────────────────────────────────────────────────

/**
 * The same week in the reader's gas car: the same miles and city share, the
 * gallons and fill-ups they take. Fill-ups are reported both for the sample
 * week (what the chart draws) and as the average a week, since one week is
 * lumpy — 1 one week, 2 the next. Winter mpg loss is not modeled.
 *
 * @returns {{ points: Array<[number, number]>, fills: Array<{ day, hour, gallons, cost }>,
 *             gallons, cost, fillsPerWeek, minutesPerWeek, rangeMi }}
 */
export function simulateGasWeek(settings) {
    const s = settings;
    const mpgOf = (type) => {
        const city = (type === 'L' ? s.longCity : s.dailyCity) / 100;
        return 1 / (city / s.gasCity + (1 - city) / s.gasHwy);
    };
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
    return {
        points, fills, gallons, cost: gallons * s.gasPrice,
        fillsPerWeek, minutesPerWeek: fillsPerWeek * s.gasFillMin,
        rangeMi: miles > 0 ? s.gasTank * miles / gallons : 0,
    };
}

// ── As a reader reads them ───────────────────────────────────────────────────

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

/** The week in one line: "795 mi per week · three long days, three daily, one off". */
export function weekSummary(settings) {
    const count = (t) => [...settings.week].filter(c => c === t).length;
    const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
    const miles = count('L') * settings.longMi + count('D') * settings.dailyMi;
    const parts = [
        `${words[count('L')]} long day${count('L') === 1 ? '' : 's'}`,
        `${words[count('D')]} daily`,
        `${words[count('O')]} off`,
    ];
    return `${miles.toLocaleString('en-US')} mi per week · ${parts.join(', ')}`;
}

// ── Home Charger ────────────────────────────────────────────────────────────

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
 * One vehicle against the gas car, for the season shown and across a year
 * (winter months at winter figures, the rest at summer ones).
 *
 * @returns {{ week, summer, winter, gas, monthly: { ev, gas, saved }, yearly: { ev, gas, saved },
 *             extraMinutesPerWeek: number }}  `extraMinutesPerWeek` — fast-charging time
 *   less fill-up time; negative when the EV costs less time
 */
export function costToDriveComparison(profile, settings) {
    const summer = simulateWeek(profile, settings, { season: 'summer' });
    const winter = simulateWeek(profile, settings, { season: 'winter' });
    const week = settings.season === 'summer' ? summer : winter;
    const gas = simulateGasWeek(settings);
    const evWeek = (w) => w.fastCost + w.homeCost;
    const months = settings.winterMonths;
    const evYear = perMonth(evWeek(winter)) * months + perMonth(evWeek(summer)) * (12 - months);
    const gasYear = perMonth(gas.cost) * 12;
    return {
        week, summer, winter, gas,
        monthly: { ev: perMonth(evWeek(week)), gas: perMonth(gas.cost), saved: perMonth(gas.cost - evWeek(week)) },
        yearly: { ev: evYear, gas: gasYear, saved: gasYear - evYear },
        extraMinutesPerWeek: week.fastMinutes - gas.minutesPerWeek,
    };
}
