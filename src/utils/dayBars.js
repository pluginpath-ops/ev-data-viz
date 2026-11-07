/**
 * The Weekly Charging Plan's day by day, as bars: what each day put into the
 * battery and what its driving took out, in percent of the battery.
 *
 * Two readings of the same figures (owner, 2026-11-07, mockups A and A2):
 *  - "from the morning": each day starts at that morning's level, the charge
 *    in rises from it (`start` → `top`), and the driving falls from the top to
 *    the next morning's level (`top` → `next`), where the next day starts;
 *  - "charge in and used": the charge in above zero, the driving below it.
 *
 * Charge in is the day's fast stops (planned ones apart) and that night's home
 * charge. Driving is everything the day used, detours in, so the week balances:
 * top − used = next.
 */

/**
 * @param {Object} week  simulateWeek's answer
 * @returns {Array<{ day, type, miles, start, fast, planned, home, used, top, next, minutes, cost, stops }>}
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
            fast,
            planned,
            home,
            used: start + fast + planned - d.homeSoc,
            top: start + fast + planned + home,
            // The week is settled, so Sunday night leads into this Monday.
            next: week.days[(i + 1) % week.days.length].startSoc,
            minutes: d.stops.reduce((t, s) => t + s.minutes, 0),
            cost: d.stops.reduce((t, s) => t + s.cost, 0),
            stops: d.stops.length,
        };
    });
}
