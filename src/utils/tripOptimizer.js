/**
 * Trip Optimizer — the best travel speed and charge per stop for one vehicle.
 *
 * The two settings trade against each other, so tuning them one sweep at a
 * time means iterating back and forth: a faster speed wants a different stop
 * plan, which wants a different speed. The view simulates the whole grid of
 * both (it is cheap — a simulation is tens of microseconds) and this module
 * reads the answer off it: the best cell, the best of one setting at each
 * value of the other (the envelope lines), and how flat the optimum is.
 *
 * The flatness is the finding most worth showing. The best cell is usually
 * one of dozens within a few minutes of it, and "anything from 68 to 76 mph"
 * is better advice than "72 mph" — it is also what a driver can actually hold.
 *
 * Pure: no React, no simulation. A grid is `totals[speedIndex][stopIndex]`, the
 * trip's total minutes, or null where the simulation was unrealistic or did not
 * finish.
 */

const range = (min, max, step) => Array.from(
    { length: Math.round((max - min) / step) + 1 },
    (_, i) => min + i * step,
);

/** Travel speeds searched, mph. Fine, so the envelope and the map read smoothly. */
export const OPT_SPEED_MPH = range(45, 100, 1);

/** Distance added per stop searched under the fixed-charging-range sim, mi. */
export const OPT_LEG_MI = range(60, 260, 10);

/** Minutes per stop searched under the fixed-charge-time sim. */
export const OPT_CHARGE_MIN = range(10, 60, 2.5);

/** How far from the best a plan may be and still count as "as good", minutes. */
export const NEAR_BEST_MIN = 5;

/** The per-stop values searched for a sim mode, and the simulation field they set. */
export function stopAxisFor(mode) {
    return mode === 'time'
        ? { values: OPT_CHARGE_MIN, param: 'chargeTimeMinutes' }
        : { values: OPT_LEG_MI, param: 'legDistanceMi' };
}

/** The fastest cell of a grid, or null if no cell finished. */
export function bestOf(totals) {
    let best = null;
    totals.forEach((row, si) => row.forEach((total, ti) => {
        if (total == null) return;
        if (!best || total < best.total) best = { si, ti, total };
    }));
    return best;
}

/**
 * At each speed, the fastest stop plan: `{ total, ti }` per speed index, or
 * null at a speed where nothing finished.
 */
export function envelopeBySpeed(totals) {
    return totals.map(row => {
        let out = null;
        row.forEach((total, ti) => {
            if (total != null && (!out || total < out.total)) out = { total, ti };
        });
        return out;
    });
}

/** At each stop plan, the fastest speed: `{ total, si }` per stop index, or null. */
export function envelopeByStop(totals) {
    const stops = totals[0]?.length ?? 0;
    return Array.from({ length: stops }, (_, ti) => {
        let out = null;
        totals.forEach((row, si) => {
            const total = row[ti];
            if (total != null && (!out || total < out.total)) out = { total, si };
        });
        return out;
    });
}

/**
 * Every cell within `tolMin` of the best: the mask, how many cells, and the
 * index span of speeds and of stop plans it covers. The spans bound the
 * region, which need not be a rectangle — the map draws the mask itself.
 */
export function nearBest(totals, tolMin = NEAR_BEST_MIN) {
    const best = bestOf(totals);
    if (!best) return null;
    const limit = best.total + tolMin;
    let count = 0;
    let siLo = Infinity, siHi = -Infinity, tiLo = Infinity, tiHi = -Infinity;
    const mask = totals.map((row, si) => row.map((total, ti) => {
        const near = total != null && total <= limit;
        if (near) {
            count++;
            siLo = Math.min(siLo, si); siHi = Math.max(siHi, si);
            tiLo = Math.min(tiLo, ti); tiHi = Math.max(tiHi, ti);
        }
        return near;
    }));
    return { mask, count, speeds: [siLo, siHi], stops: [tiLo, tiHi], limit };
}

/**
 * What the stops of one simulated trip look like to a driver: how many en-route
 * stops, and the average SoC arrived at and left with. The destination top-up is
 * not an en-route stop and is left out.
 */
export function chargeWindow(sim) {
    const stops = (sim?.segments ?? []).filter(seg => seg.type === 'charge'
        && seg.startDist < (sim.totalDistMi ?? Infinity) - 0.01);
    if (!stops.length) return { stops: 0, arriveSoc: null, leaveSoc: null };
    const mean = key => Math.round(stops.reduce((sum, seg) => sum + seg[key], 0) / stops.length);
    return { stops: stops.length, arriveSoc: mean('startSoc'), leaveSoc: mean('endSoc') };
}

/**
 * The index of the value nearest `x` in a sorted list — where a setting typed
 * by hand (a 147 mi leg) sits on the grid.
 */
export function nearestIndex(values, x) {
    let best = 0;
    values.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(values[best] - x)) best = i; });
    return best;
}
