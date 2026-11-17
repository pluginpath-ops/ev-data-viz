/**
 * The Weekly Charging Plan's day by day, as bars: what each day put into the
 * battery and what its driving took out, in percent of the battery.
 *
 * Two readings (owner, 2026-11-07, mockups A3 and A):
 *  - "day by day" (A3), in time order: the day out from the morning's level
 *    to arriving home (`start` → `arrive`), each fast stop inside it at the
 *    levels it charged between (`stopBands`), then the night at home up to
 *    the next morning (`arrive` → `next`), where the next day starts;
 *  - "charge in and used" (A): the charge in above zero, the driving below.
 *
 * Charge in is the day's fast stops (planned ones apart) and that night's home
 * charge. Driving is everything the day used, detours in, so each day hands
 * over to the next: start + fast + planned + home − used = next.
 *
 * (A2, the charge stacked on the morning's level and the driving falling from
 * its top, was built and replaced by A3 the same day: charge stacked before
 * the driving it came during or after made columns pass 100%.)
 */

import { homeTierOrder, tierWord } from './costToDrive';

/**
 * @param {Object} week  simulateWeek's answer
 * @returns {Array<{ day, type, miles, start, arrive, fast, planned, home, homeTiers, mostAdd, used, next,
 *   stopBands: Array<{ from, to, planned, minutes }>, minutes, cost, stops,
 *   homeCost, homeTierCost, homeTierKwh, homeTierWarmKwh, fastMinutes, fastCost, plannedMinutes, plannedCost }>}
 *   `cost`/`minutes` are every stop's; the `fast…`/`planned…` pairs split them, for the readout.
 */
export function dayBars(week) {
    return week.days.map((d, i) => {
        const added = (planned) => d.stops.filter(s => s.planned === planned).reduce((t, s) => t + s.toSoc - s.fromSoc, 0);
        const fast = added(false), planned = added(true);
        const home = d.night.added;
        // On a time-of-use plan, the night's charge by tier, [dearest, middle,
        // cheapest] in % of the battery, shared out as each tier added to the
        // pack (battery warming, taken first, adds nothing).
        const tierPack = d.night.tierPackKwh;
        const tierSum = tierPack ? tierPack.reduce((a, k) => a + k, 0) : 0;
        const start = d.startSoc;
        return {
            day: d.day,
            type: d.type,
            miles: d.miles,
            start,
            // Where the car gets home: after the day's driving and its stops.
            arrive: d.homeSoc,
            fast,
            planned,
            home,
            homeTiers: tierSum > 0 ? tierPack.map(k => home * k / tierSum) : null,
            // What the night's window could have added at full power: the home ceiling.
            mostAdd: d.night.mostAdd,
            used: start + fast + planned - d.homeSoc,
            // The week is settled, so Sunday night leads into this Monday.
            next: week.days[(i + 1) % week.days.length].startSoc,
            stopBands: d.stops.map(s => ({ from: s.fromSoc, to: s.toSoc, planned: s.planned, minutes: s.minutes })),
            minutes: d.stops.reduce((t, s) => t + s.minutes, 0),
            cost: d.stops.reduce((t, s) => t + s.cost, 0),
            stops: d.stops.length,
            // What the night cost, and on a time-of-use plan by tier ([dearest,
            // middle, cheapest], $ and wall kWh); null at One price.
            homeCost: d.night.homeCost,
            homeTierCost: d.night.tierCost,
            homeTierKwh: d.night.tierKwh,
            // The wall kWh in each tier that went to warming the battery.
            homeTierWarmKwh: d.night.tierWarmKwh,
            ...stopTotals(d.stops, false, 'fast'),
            ...stopTotals(d.stops, true, 'planned'),
        };
    });
}

/** A day's stops of one kind, as `{ <name>Minutes, <name>Cost }`. */
function stopTotals(stops, planned, name) {
    const mine = stops.filter(st => st.planned === planned);
    return {
        [`${name}Minutes`]: mine.reduce((t, st) => t + st.minutes, 0),
        [`${name}Cost`]: mine.reduce((t, st) => t + st.cost, 0),
    };
}

/**
 * A day's parts as the chart's readout lists them, top of the list first: the
 * night at home (one part per tier on a time-of-use plan, the base first), the
 * fast stops, a planned fast charge, the driving, and the battery from the
 * morning to the next. `range` is where the part's bar sits on the chart's
 * left axis in this view (`day` or `balance`); the battery has none.
 *
 * @param {Object} b       one of dayBars' days
 * @param {'day'|'balance'} view
 * @param {{names, base}|null} tiers  the week's rateTiers
 * @returns {Array<{ key, kind, tier?, name, pct, range, cost?, minutes?, kwh?, warmKwh?, miles? }>}
 */
export function dayParts(b, view, tiers) {
    const parts = [];
    // In `balance` the night stands on zero, the fast charging on top of it.
    let at = view === 'day' ? b.arrive : 0;
    for (const t of homeTierOrder(tiers)) {
        const pct = t == null ? b.home : b.homeTiers?.[t] ?? 0;
        if (pct > 0.05) {
            parts.push({
                key: t == null ? 'home' : `home-${t}`, kind: 'home', tier: t,
                name: t == null ? 'Home' : `Home, ${tierWord(tiers, t)}`,
                pct, range: [at, at + pct],
                cost: t == null ? b.homeCost : b.homeTierCost?.[t] ?? 0,
                kwh: t == null ? null : b.homeTierKwh?.[t] ?? 0,
                warmKwh: t == null ? 0 : b.homeTierWarmKwh?.[t] ?? 0,
            });
        }
        at += pct;
    }
    const stopRange = (planned) => {
        if (view !== 'day') {
            const lo = b.home + (planned ? b.fast : 0);
            return [lo, lo + (planned ? b.planned : b.fast)];
        }
        const bands = b.stopBands.filter(st => st.planned === planned);
        return [Math.min(...bands.map(st => st.from)), Math.max(...bands.map(st => st.to))];
    };
    if (b.fast > 0.05) {
        parts.push({ key: 'fast', kind: 'fast', name: 'Fast stops', pct: b.fast, range: stopRange(false), minutes: b.fastMinutes, cost: b.fastCost });
    }
    if (b.planned > 0.05) {
        parts.push({ key: 'planned', kind: 'planned', name: 'Planned fast charge', pct: b.planned, range: stopRange(true), minutes: b.plannedMinutes, cost: b.plannedCost });
    }
    if (b.used > 0.05) {
        parts.push({
            key: 'used', kind: 'drive', name: 'Driving', pct: -b.used, miles: b.miles,
            range: view === 'day' ? [Math.min(b.start, b.arrive), Math.max(b.start, b.arrive)] : [-b.used, 0],
        });
    }
    parts.push({ key: 'battery', kind: 'battery', name: 'Battery', pct: b.next - b.start, range: null });
    return parts;
}
