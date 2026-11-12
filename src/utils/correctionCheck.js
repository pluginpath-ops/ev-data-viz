/**
 * The correction check (#475): how well the condition correction predicts a
 * vehicle's own tests.
 *
 * Two range tests of one car at different conditions are a free experiment.
 * Correct one to the other's conditions and the model should land on what the
 * other actually measured; how far it lands off, and which way, is a check on
 * the model that no amount of reasoning about it can give.
 *
 * It is a CHECK, not a verdict. The tests are few, pairs on one car share
 * tests (four tests make six pairs but only three independent comparisons),
 * and every summary says how many vehicles and tests it rests on.
 *
 * ── How a pair is predicted ──────────────────────────────────────────────────
 *
 * The test nearer the standard conditions stands as the actual one (the
 * "reference"); the other is corrected to the reference's speed, altitude and
 * temperature, by correctionFactor itself — the function every chart calls —
 * so the check cannot disagree with the charts. The target has no wind, so the
 * reference is corrected to that same target too, and the prediction is
 *
 *     predicted = e_from × k_from / k_ref
 *
 * which leaves the reference's own wind in the comparison rather than
 * dropping it. With no wind on the reference, k_ref is 1.
 *
 * Three predictions per pair:
 *   none     the other test's figure as measured
 *   generic  the site's correction (the aero fraction, AERO_FRACTION)
 *   epa      the vehicle's own EPA road-load curve in place of the fraction —
 *            a CANDIDATE, never used by the site, there to show whether it
 *            would earn its place (#199). Only where one curve stands for the
 *            vehicle.
 *
 * ── The fit ──────────────────────────────────────────────────────────────────
 *
 * fitConstants searches for the constants that make the pairs agree best,
 * calling the same function. A constant is fitted only when enough vehicles
 * have a pair that moves it (FIT_MIN_VEHICLES); otherwise it is held at its
 * knob and the result says why. Every vehicle weighs the same however many
 * tests it has. The result is a suggestion for a person to read, scored on
 * vehicles it was not fitted to; nothing here writes a constant.
 *
 * Pure module — no React, no database. scripts/correctionCheck.js loads the
 * data and writes the report.
 */
import { correctionFactor, runConditions } from './conditionCorrection';
import { countedRangeTests } from './rangeTestSpread';
import { poolOf, isExcluded } from './runListing';
import { isCompositeRun } from './runUtils';
import { resolvePrimaryCoeffs } from './epaDerivations';
import { primaryEpaMapping } from './epaConfiguration';
import { KNOB_GROUPS } from '../constants/knobs';
import {
    STANDARD_CONDITIONS, ASSUMED_TEST_CONDITIONS, AERO_FRACTION, DEFAULT_ACCESSORY_W,
    ACCESSORY_COMFORT_BAND_F, ACCESSORY_HEAT_W_PER_F, ACCESSORY_COOL_W_PER_F,
} from '../constants/epa';

/** Corrects for everything the model can, as the composite range does. */
export const CHECK_MODE = 'aero_wind';

export const CHECK_METHODS = [
    { key: 'none',    label: 'Uncorrected' },
    { key: 'generic', label: 'Generic (aero fraction)' },
    { key: 'epa',     label: 'EPA curve (candidate)' },
];

/** Why a range test is not in any pair, as the report says it. */
export const CHECK_LEFT_OUT = {
    excluded:     'excluded by a curator',
    unlistedGate: 'unlisted, and missing the speed or temperature the pool needs',
    noEnergy:     'no energy recorded (an estimate from SoC would add its own error)',
    noSpeed:      'no speed recorded',
    noTemp:       'no temperature recorded',
    alone:        'the only usable test of its vehicle',
};

/** Why a vehicle has no EPA-curve prediction. */
export const NO_EPA_CURVE = {
    unlinked: 'no EPA configuration linked',
    unchosen: 'several EPA configurations linked, none chosen to stand for it',
    noCoeffs: 'its EPA configuration has no road-load coefficients',
};

const present = (v) => v != null && v !== '';
const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The EPA road-load curve that stands for a vehicle, or why there is none.
 * The configuration is the vehicle's primary one (epaConfiguration), never a
 * guess among several.
 *
 * @param {Array} mappings  [{ isPrimary, epaTestVehicle: { test_vehicle_id, epa_coefficient_sets } }]
 * @returns {{ a, b, c, source, testVehicleId, basis } | { reason: string }}
 */
export function epaCurveOf(mappings = []) {
    if (!mappings.some(m => m?.epaTestVehicle)) return { reason: 'unlinked' };
    const primary = primaryEpaMapping(mappings);
    if (!primary) return { reason: 'unchosen' };
    const coeffs = resolvePrimaryCoeffs(primary.mapping.epaTestVehicle);
    if (!coeffs) return { reason: 'noCoeffs' };
    return {
        a: coeffs.a, b: coeffs.b, c: coeffs.c, source: coeffs.source,
        testVehicleId: primary.mapping.epaTestVehicle.test_vehicle_id, basis: primary.basis,
    };
}

/**
 * The share of the EPA curve's road load that is aerodynamic at a speed —
 * what the generic aero fraction stands in for. For the report only: the
 * prediction uses the whole curve.
 */
export const epaAeroShare = ({ a, b, c }, speedMph) => (c * speedMph ** 2) / (a + b * speedMph + c * speedMph ** 2);

/**
 * A vehicle's range tests sorted into those a pair can use and those it
 * cannot, with the reason. The tests that count are the statistics' own
 * (countedRangeTests: listed and pooled, none excluded); a test the check
 * cannot use beyond that is one with no energy, speed or temperature, since
 * an assumed value would check the assumption rather than the model.
 */
export function checkTests(vehicle, sessionOf = () => null) {
    const runs = (vehicle?.runs ?? []).filter(r => r.kind === 'range' && !isCompositeRun(r) && Number(r.distance_miles) > 0);
    const counted = new Set(countedRangeTests({ runs, pooledRuns: poolOf(runs, sessionOf) }).map(r => r.id));
    const tests = [];
    const leftOut = [];
    for (const run of runs) {
        const session = sessionOf(run);
        const reason = !counted.has(run.id) ? (isExcluded(run) ? 'excluded' : 'unlistedGate')
            : !(Number(run.energy_kwh) > 0) ? 'noEnergy'
            : !present(run.speed_mph) ? 'noSpeed'
            : !present(run.temperature_f ?? session?.temperature_f) ? 'noTemp'
            : null;
        if (reason) { leftOut.push({ run, reason }); continue; }
        const conditions = runConditions(run, session);
        tests.push({
            run,
            conditions,
            miPerKwh: Number(run.distance_miles) / Number(run.energy_kwh),
            altitudeAssumed: !present(conditions.altitudeFt),
            // How far the site's correction moves this test to the standard
            // conditions: the smaller, the nearer standard, and the likelier
            // to stand as a pair's reference.
            kStandard: correctionFactor(conditions, { mode: CHECK_MODE, target: STANDARD_CONDITIONS }).factor,
        });
    }
    if (tests.length === 1) leftOut.push({ run: tests.pop().run, reason: 'alone' });
    return { tests, leftOut };
}

/** The reference test's conditions, as a correction target. */
function targetOf(test) {
    const c = test.conditions;
    return {
        speedMph: Number(c.speedMph),
        altitudeFt: present(c.altitudeFt) ? Number(c.altitudeFt) : ASSUMED_TEST_CONDITIONS.altitudeFt,
        temperatureF: Number(c.temperatureF),
        accessoryW: null,
    };
}

/**
 * One method's prediction of the reference test's mi/kWh from the other's.
 *
 * @param {Object} params  { aeroFraction, accessory } — the knobs' values when omitted
 */
export function predictPair(from, ref, method, { roadLoad = null, aeroFraction, accessory } = {}) {
    if (method === 'none') return from.miPerKwh;
    if (method === 'epa' && !roadLoad) return null;
    const target = targetOf(ref);
    const opts = {
        mode: CHECK_MODE, target, accessory,
        ...(aeroFraction != null ? { aeroFraction } : {}),
        ...(method === 'epa' ? { roadLoad } : {}),
    };
    const kFrom = correctionFactor(from.conditions, opts).factor;
    const kRef = correctionFactor(ref.conditions, opts).factor;
    return from.miPerKwh * kFrom / kRef;
}

const miss = (predicted, actual) => (predicted == null ? null : {
    predicted,
    miPerKwh: predicted - actual,
    pct: (predicted / actual - 1) * 100,
});

/** How two tests' conditions differ, for the reader to see why a pair might miss. */
function differences(from, ref) {
    const f = from.conditions, r = ref.conditions;
    return {
        speedMph: [Number(f.speedMph), Number(r.speedMph)],
        temperatureF: [Number(f.temperatureF), Number(r.temperatureF)],
        altitudeFt: [f.altitudeFt, r.altitudeFt].map(a => (present(a) ? Number(a) : null)),
        windMph: [f.windMph, r.windMph].map(w => (present(w) ? Number(w) : null)),
        mixed: [f.speedBasis === 'mixed', r.speedBasis === 'mixed'],
    };
}

/**
 * Every pair of one vehicle's usable tests, each with its three predictions.
 */
export function vehiclePairs(tests, epaCurve, params = {}) {
    const roadLoad = epaCurve && !epaCurve.reason ? epaCurve : null;
    const pairs = [];
    for (let i = 0; i < tests.length; i++) {
        for (let j = i + 1; j < tests.length; j++) {
            // The reference is the test the correction moves least; a tie goes
            // to the earlier-listed one, so the order is stable.
            const nearer = (t) => Math.abs(Math.log(t.kStandard));
            const [ref, from] = nearer(tests[j]) < nearer(tests[i]) ? [tests[j], tests[i]] : [tests[i], tests[j]];
            const misses = {};
            for (const { key } of CHECK_METHODS) misses[key] = miss(predictPair(from, ref, key, { ...params, roadLoad }), ref.miPerKwh);
            pairs.push({ from, ref, actual: ref.miPerKwh, differences: differences(from, ref), misses });
        }
    }
    return pairs;
}

/**
 * The whole check.
 *
 * @param {Array} vehicles  [{ id, name, year, runs, epaMappings }]
 * @param {Object} [opts]
 * @param {Function} [opts.sessionOf]  run → its test session
 * @returns {{ vehicles: Array, pairs: Array, leftOut: Array, summary: Object }}
 */
export function correctionCheck(vehicles, { sessionOf = () => null } = {}) {
    const out = [];
    const pairs = [];
    const leftOut = [];
    for (const vehicle of vehicles) {
        const { tests, leftOut: lo } = checkTests(vehicle, sessionOf);
        leftOut.push(...lo.map(x => ({ ...x, vehicle })));
        if (tests.length < 2) continue;
        const epaCurve = epaCurveOf(vehicle.epaMappings);
        const vp = vehiclePairs(tests, epaCurve).map(p => ({ ...p, vehicle }));
        pairs.push(...vp);
        out.push({ vehicle, tests, epaCurve, pairs: vp });
    }
    return { vehicles: out, pairs, leftOut, summary: summarize(out) };
}

/**
 * What the pairs say about each method, with the counts beside it.
 *
 * The figures are medians, per vehicle first and then across vehicles, so a
 * car with eight tests does not outvote one with two. `head2head` compares
 * the generic correction and the EPA candidate on the SAME pairs — the only
 * fair comparison when the candidate exists for some vehicles and not others.
 */
export function summarize(vehicleResults) {
    const forMethod = (key, results) => {
        const rows = results
            .map(v => ({ v, ms: v.pairs.map(p => p.misses[key]).filter(Boolean) }))
            .filter(x => x.ms.length);
        const all = rows.flatMap(x => x.ms);
        const perVehicle = rows.map(x => median(x.ms.map(m => Math.abs(m.pct))));
        return {
            nVehicles: rows.length,
            nTests: rows.reduce((s, x) => s + x.v.tests.length, 0),
            nPairs: all.length,
            readsHigh: all.filter(m => m.pct > 0).length,
            readsLow: all.filter(m => m.pct < 0).length,
            medianAbsPct: median(perVehicle),
            worstVehicleAbsPct: perVehicle.length ? Math.max(...perVehicle) : null,
        };
    };
    const methods = Object.fromEntries(CHECK_METHODS.map(({ key }) => [key, forMethod(key, vehicleResults)]));
    const withEpa = vehicleResults.filter(v => !v.epaCurve.reason);
    // Which method came closest on each pair, among those that predicted it.
    const closest = Object.fromEntries(CHECK_METHODS.map(({ key }) => [key, 0]));
    for (const p of vehicleResults.flatMap(v => v.pairs)) {
        const best = CHECK_METHODS.map(({ key }) => [key, p.misses[key]])
            .filter(([, m]) => m)
            .sort((a, b) => Math.abs(a[1].pct) - Math.abs(b[1].pct))[0];
        if (best) closest[best[0]]++;
    }
    return {
        methods,
        head2head: { generic: forMethod('generic', withEpa), epa: forMethod('epa', withEpa) },
        closest,
    };
}

// ── The fit ──────────────────────────────────────────────────────────────────

/** A constant is fitted only when at least this many vehicles have a pair that moves it. */
export const FIT_MIN_VEHICLES = 3;
/** Resamples of whole vehicles for a fitted constant's spread. */
export const FIT_BOOTSTRAP = 100;

const knob = (key) => KNOB_GROUPS.flatMap(g => g.knobs).find(k => k.key === key);

/**
 * The constants a fit may move. `support` says whether a pair moves the
 * constant at all: the aero fraction and the base draw only through a change
 * of speed (they move the speed correction the same way, so where the speeds
 * are few the two trade off, and the spread says so); heating only when a
 * test is below the comfort band, cooling only above it.
 */
export const FIT_PARAMS = [
    { key: 'AERO_FRACTION', methods: ['generic'], start: () => AERO_FRACTION,
      support: (p) => Math.abs(p.differences.speedMph[0] - p.differences.speedMph[1]) >= 5,
      needs: 'a pair 5 mph or more apart' },
    { key: 'DEFAULT_ACCESSORY_W', methods: ['generic', 'epa'], start: () => DEFAULT_ACCESSORY_W,
      support: (p) => Math.abs(p.differences.speedMph[0] - p.differences.speedMph[1]) >= 5,
      needs: 'a pair 5 mph or more apart' },
    { key: 'ACCESSORY_HEAT_W_PER_F', methods: ['generic', 'epa'], start: () => ACCESSORY_HEAT_W_PER_F,
      support: (p, band) => p.differences.temperatureF.some(t => t < band[0]),
      needs: `a test below the comfort band` },
    { key: 'ACCESSORY_COOL_W_PER_F', methods: ['generic', 'epa'], start: () => ACCESSORY_COOL_W_PER_F,
      support: (p, band) => p.differences.temperatureF.some(t => t > band[1]),
      needs: `a test above the comfort band` },
];

/** A FIT_PARAMS values map as correctionFactor's options. */
export function paramsAsOptions(values) {
    return {
        aeroFraction: values.AERO_FRACTION,
        accessory: {
            baseW: values.DEFAULT_ACCESSORY_W,
            comfortBand: ACCESSORY_COMFORT_BAND_F,
            heatWPerF: values.ACCESSORY_HEAT_W_PER_F,
            coolWPerF: values.ACCESSORY_COOL_W_PER_F,
        },
    };
}

/**
 * How far a set of constants leaves the pairs from agreeing: the mean, over
 * vehicles, of each vehicle's mean squared log miss. Logs, so reading 5% high
 * and 5% low cost the same; per vehicle first, so each car counts once.
 */
export function fitLoss(vehicleResults, method, values) {
    const opts = paramsAsOptions(values);
    let total = 0;
    let n = 0;
    for (const v of vehicleResults) {
        const roadLoad = method === 'epa' ? (v.epaCurve.reason ? null : v.epaCurve) : null;
        if (method === 'epa' && !roadLoad) continue;
        let s = 0;
        for (const p of v.pairs) s += Math.log(predictPair(p.from, p.ref, method, { ...opts, roadLoad }) / p.actual) ** 2;
        total += s / v.pairs.length;
        n++;
    }
    return n ? total / n : null;
}

/**
 * Nelder–Mead over the unit box: each free constant mapped onto its knob's
 * [min, max], so the search can never leave the range the Admin knob allows.
 */
function minimize(f, x0, { iterations = 300 } = {}) {
    const clamp = (x) => x.map(v => Math.min(1, Math.max(0, v)));
    const n = x0.length;
    let simplex = [clamp(x0)];
    for (let i = 0; i < n; i++) {
        const x = [...x0];
        x[i] = x[i] + (x[i] < 0.9 ? 0.1 : -0.1);
        simplex.push(clamp(x));
    }
    let scores = simplex.map(f);
    for (let it = 0; it < iterations; it++) {
        const order = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
        simplex = order.map(i => simplex[i]);
        scores = order.map(i => scores[i]);
        if (Math.abs(scores[n] - scores[0]) < 1e-12) break;
        const centroid = simplex.slice(0, n).reduce((c, x) => c.map((v, i) => v + x[i] / n), new Array(n).fill(0));
        const along = (t) => clamp(centroid.map((v, i) => v + t * (simplex[n][i] - v)));
        const reflected = along(-1);
        const fr = f(reflected);
        if (fr < scores[0]) {
            const expanded = along(-2);
            const fe = f(expanded);
            [simplex[n], scores[n]] = fe < fr ? [expanded, fe] : [reflected, fr];
        } else if (fr < scores[n - 1]) {
            [simplex[n], scores[n]] = [reflected, fr];
        } else {
            const contracted = along(0.5);
            const fc = f(contracted);
            if (fc < scores[n]) {
                [simplex[n], scores[n]] = [contracted, fc];
            } else {
                simplex = simplex.map(x => clamp(simplex[0].map((v, i) => v + 0.5 * (x[i] - v))));
                scores = simplex.map(f);
            }
        }
    }
    const best = scores.indexOf(Math.min(...scores));
    return simplex[best];
}

/** A small seeded generator, so a report re-run gives the same spread. */
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function fitOnce(vehicleResults, method, free, fixed) {
    if (!free.length) return { ...fixed };
    const toValue = (k, u) => k.min + u * (k.max - k.min);
    const knobs = free.map(p => knob(p.key));
    const valuesOf = (x) => ({ ...fixed, ...Object.fromEntries(free.map((p, i) => [p.key, toValue(knobs[i], x[i])])) });
    const x0 = free.map((p, i) => (fixed[p.key] - knobs[i].min) / (knobs[i].max - knobs[i].min));
    return valuesOf(minimize(x => fitLoss(vehicleResults, method, valuesOf(x)), x0));
}

/**
 * Fit the constants a method's pairs can support.
 *
 * @param {Array} vehicleResults  correctionCheck().vehicles
 * @param {'generic'|'epa'} method
 * @returns {{
 *   method, nVehicles, nPairs,
 *   params: Array<{ key, knobValue, fitted: number|null, atLimit: 'min'|'max'|null,
 *                   spread: [number, number]|null, supportVehicles: number, heldBecause: string|null }>,
 *   loss: { knobs: number, fitted: number },
 *   heldOut: { nVehicles, better: number, worse: number,
 *              medianAbsPctKnobs: number, medianAbsPctFitted: number },
 * }}
 */
export function fitConstants(vehicleResults, method, { bootstrap = FIT_BOOTSTRAP, seed = 475 } = {}) {
    const results = method === 'epa' ? vehicleResults.filter(v => !v.epaCurve.reason) : vehicleResults;
    const band = ACCESSORY_COMFORT_BAND_F;
    const knobValues = Object.fromEntries(FIT_PARAMS.map(p => [p.key, p.start()]));
    const candidates = FIT_PARAMS.filter(p => p.methods.includes(method));
    const support = (p) => results.filter(v => v.pairs.some(x => p.support(x, band))).length;
    const free = candidates.filter(p => support(p) >= FIT_MIN_VEHICLES);
    const fitted = fitOnce(results, method, free, knobValues);

    // Spread: refit on resampled sets of whole vehicles; the 10th to 90th
    // percentile of where each constant lands.
    const rand = seeded(seed);
    const draws = [];
    if (free.length && results.length > 1) {
        for (let b = 0; b < bootstrap; b++) {
            const sample = results.map(() => results[Math.floor(rand() * results.length)]);
            draws.push(fitOnce(sample, method, free, knobValues));
        }
    }
    const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

    // Held out: fit without each vehicle, then predict that vehicle's pairs.
    // The fit earns nothing unless it predicts cars it has not seen.
    const absMiss = (v, values) => {
        const opts = paramsAsOptions(values);
        const roadLoad = method === 'epa' ? v.epaCurve : null;
        return median(v.pairs.map(p => Math.abs(predictPair(p.from, p.ref, method, { ...opts, roadLoad }) / p.actual - 1) * 100));
    };
    const heldOut = results.length > 1 ? results.map(v => {
        const values = fitOnce(results.filter(x => x !== v), method, free, knobValues);
        return { knobs: absMiss(v, knobValues), fitted: absMiss(v, values) };
    }) : [];

    return {
        method,
        nVehicles: results.length,
        nPairs: results.reduce((s, v) => s + v.pairs.length, 0),
        params: candidates.map(p => {
            const isFree = free.includes(p);
            const xs = draws.map(d => d[p.key]);
            const { min, max } = knob(p.key);
            const edge = (max - min) * 1e-3;
            return {
                key: p.key,
                knobValue: knobValues[p.key],
                fitted: isFree ? fitted[p.key] : null,
                // Pressed against the knob's limit: the pairs want more than
                // the range allows, or cannot tell this constant from another.
                // Either way it is not a value to read off.
                atLimit: !isFree ? null : fitted[p.key] <= min + edge ? 'min' : fitted[p.key] >= max - edge ? 'max' : null,
                spread: isFree && xs.length ? [pct(xs, 0.1), pct(xs, 0.9)] : null,
                supportVehicles: support(p),
                heldBecause: isFree ? null
                    : `only ${support(p)} vehicle${support(p) === 1 ? '' : 's'} with ${p.needs}; ${FIT_MIN_VEHICLES} needed`,
            };
        }),
        loss: { knobs: fitLoss(results, method, knobValues), fitted: fitLoss(results, method, fitted) },
        heldOut: {
            nVehicles: heldOut.length,
            better: heldOut.filter(h => h.fitted < h.knobs).length,
            worse: heldOut.filter(h => h.fitted > h.knobs).length,
            medianAbsPctKnobs: median(heldOut.map(h => h.knobs)),
            medianAbsPctFitted: median(heldOut.map(h => h.fitted)),
        },
    };
}
