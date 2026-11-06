/**
 * PROTOTYPE — the spread of a road trip across a vehicle's range tests.
 *
 * Road Trip prices a trip from ONE range test's efficiency. A vehicle with
 * several range tests could have been priced from any of them, and they
 * disagree — so the sweep charts can shade, at each speed or leg distance,
 * from the fastest trip any of its tests gives to the slowest. Only the
 * efficiency varies: the charging curve is the row's own, held fixed, so the
 * shading says "how much the answer depends on which range test you trust"
 * and nothing else.
 *
 * Efficiency from measured energy where a test has it, else estimated from
 * its SoC change and the vehicle's SoC window (rangeTestSpread.spreadEfficiency)
 * — the owner's call: an estimate, counted as one in the tooltip, beats a test
 * left out. Road Trip's own line has always taken the same estimate.
 */
import { countedRangeTests, spreadEfficiency } from './rangeTestSpread';
import { rangeTestBasis } from './tripEfficiency';

/**
 * Every range test of a vehicle as a trip basis: { run, basis, estimated }.
 *
 * Uncorrected: each trip prices its test at its own travel speed, under the
 * reader's correction, through tripEfficiency.efficiencyAtSpeed — the same
 * path as the row's own line, so a test's trace and the line drawn from that
 * same test cannot disagree.
 */
export function spreadTestsFor(vehicle, { sessionOf = () => null } = {}) {
    const out = [];
    // The tests that count, as on the bar charts: listed and pooled, less the
    // excluded (#394). A viewer and a contributor see the same spread.
    for (const run of countedRangeTests(vehicle)) {
        const e = spreadEfficiency(run, vehicle?.socWindowKwh);
        const basis = e && rangeTestBasis(e.miPerKwh, run, sessionOf(run));
        if (basis) out.push({ run, basis, estimated: e.estimated });
    }
    return out;
}

/**
 * Lowest and highest y at each sweep step across the tests' results, or null
 * at a step where fewer than two tests gave a usable answer — one test has no
 * spread, and drawing a zero-width one would claim agreement.
 *
 * @param {Array<Array<number|null>>} perTest  y per sweep step, one array per test
 * @returns {Array<{lo:number, hi:number, n:number}|null>}
 */
export function sweepSpread(perTest) {
    const steps = perTest[0]?.length ?? 0;
    return Array.from({ length: steps }, (_, i) => {
        const ys = perTest.map(row => row[i]).filter(y => y != null && Number.isFinite(y));
        if (ys.length < 2) return null;
        return { lo: Math.min(...ys), hi: Math.max(...ys), n: ys.length };
    });
}

/** y at x on a polyline of {x, y} sorted by x: held flat past either end, and
 *  after any vertical jump (a charge stop on a drive-time axis). */
function yAt(points, x) {
    let k = 0;
    while (k + 1 < points.length && points[k + 1].x <= x) k++;
    const a = points[k];
    const b = points[k + 1];
    if (!b || x <= a.x || b.x === a.x) return a.y;
    return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
}

/**
 * The spread of a timeline — distance, or cumulative charge time, against
 * elapsed or drive time — across the tests' trips: lowest and highest y at
 * every `stepMin` minutes until the last trip ends. Both are monotonic in
 * time, so the shading is a clean area rather than a tangle of crossings,
 * which is why the SoC view is not offered one.
 *
 * @param {Array<Array<{x:number, y:number}>>} perTest  one polyline per test (2+)
 * @returns {{ xs: number[], steps: Array<{lo:number, hi:number, n:number}> }}
 */
export function timelineSpread(perTest, stepMin = 1) {
    const end = Math.max(...perTest.map(p => p[p.length - 1]?.x ?? 0));
    const xs = [];
    for (let x = 0; x < end; x += stepMin) xs.push(x);
    xs.push(end);
    const steps = xs.map(x => {
        const ys = perTest.map(p => yAt(p, x));
        return { lo: Math.min(...ys), hi: Math.max(...ys), n: ys.length };
    });
    return { xs, steps };
}
