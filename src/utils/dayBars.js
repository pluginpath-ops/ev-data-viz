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

/**
 * @param {Object} week  simulateWeek's answer
 * @returns {Array<{ day, type, miles, start, arrive, fast, planned, home, used, next,
 *   stopBands: Array<{ from, to, planned, minutes }>, minutes, cost, stops }>}
 */
export function dayBars(week) {
    return week.days.map((d, i) => {
        const added = (planned) => d.stops.filter(s => s.planned === planned).reduce((t, s) => t + s.toSoc - s.fromSoc, 0);
        const fast = added(false), planned = added(true);
        const home = d.night.added;
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
            used: start + fast + planned - d.homeSoc,
            // The week is settled, so Sunday night leads into this Monday.
            next: week.days[(i + 1) % week.days.length].startSoc,
            stopBands: d.stops.map(s => ({ from: s.fromSoc, to: s.toSoc, planned: s.planned, minutes: s.minutes })),
            minutes: d.stops.reduce((t, s) => t + s.minutes, 0),
            cost: d.stops.reduce((t, s) => t + s.cost, 0),
            stops: d.stops.length,
        };
    });
}
