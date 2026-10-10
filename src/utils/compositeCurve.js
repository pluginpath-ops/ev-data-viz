/**
 * The composite curve: one line that stands for a vehicle's charging behavior
 * (#313), aggregated from its charging tests.
 *
 * Not "nominal": in this codebase nominal means RATED, as filed
 * (`nominal_pack_kwh`). This is measured and aggregated — docs/vocabulary.md.
 *
 * ## Why it is not a plain average
 *
 * A charger can only pull a curve DOWN. The iX3 on a Supercharger sits flat at
 * ~185 kW from 10% to 60%; on an 800 V charger it draws ~390. Above 70% the car
 * is the limit and the two agree. A per-SoC mean gives ~285 kW at 20% — a
 * session nobody will ever have. The R2 shows the same thing milder: two tests
 * peak near 225 kW, two sit flat around 190 on a lesser stall, and all four
 * agree within 10 kW above 50%.
 *
 * So a reading the charger held back is not a typical value, it is a floor on
 * what the car could do. It is set aside WHERE it was held back, and only
 * there — the same test still counts once the car's own taper takes over.
 *
 * Two ways to know a reading was held back:
 *
 *   recorded   `runs.charger_voltage_class` (migration 076) says which class
 *              of charger the test was taken on. On an 800 V car the classes
 *              are different conditions, not a good and a bad measurement:
 *              each gets a composite of its own (see compositeCurves).
 *   inferred   the test sat on a ceiling — within PLATEAU_SHARE of its own
 *              peak — while another test of the same car drew HELD_BACK_MARGIN
 *              more at the same SoC. Flatness is what separates a charger limit
 *              from a cold pack: a cold session reads low too, but it climbs as
 *              it warms instead of holding a ceiling, and it stays in.
 *
 * Everything set aside is NAMED, with the SoC span, never silently dropped —
 * the stance `alignmentExclusion` takes for race mode.
 *
 * ## What it is quoted at
 *
 * Unweighted mean of the readings that count, per 1% of SoC. With 2–4 tests a
 * median is barely defined and a condition-weighted mean would be weighted by
 * one session; the conditions are reported beside the curve instead
 * (temperature span, preconditioned count), and `n` is carried on every point
 * so a chart can mark where support thins.
 *
 * ## Which domain it averages in
 *
 * At each SoC, never at each minute. Power is the mean kW at that SoC; time is
 * the mean of the tests' MINUTES to reach it — the tests' SoC-vs-time curves
 * averaged horizontally. Averaging vertically instead (mean SoC after τ
 * minutes) answers "how much after 15 minutes" rather than "how long to 80%",
 * and the two disagree only where the tests do: measured on the 2026-09-28
 * data, ≤0.1 min for the R2 to 70%, and ±0.6 min for the iX3 on Superchargers
 * to 90% — where its two sessions themselves differ by 11 minutes.
 *
 * Its real weakness is a feature at different SoC in different tests: one
 * test's taper starting at 30% and another's at 40% average to a gentle taper
 * from 30 to 40% that neither car made. The test spread widens there, which is
 * where to look. Registering the knees before averaging is the fix if a
 * vehicle with many tests ever needs it.
 *
 * Stored as a synthetic run (migration 077, see planCompositeRebuild).
 *
 * Pure module — no React, no chart library.
 */

import { isExcluded } from './runListing';
import { interpolate } from './interpolate';
import { trimRamp } from './socAlignment';
import { isCompositeRun } from './runUtils';
import { resolveVoltageClass, VOLTAGE_CLASSES } from './platforms';
import { convTemp, tempLabel } from './unitConversions';

/** Fewest tests a composite is offered from. At one, the composite IS the test,
 *  and drawing it as something else would be a fiction. */
export const COMPOSITE_MIN_TESTS = 2;

/**
 * A reading within this share of its test's own peak is on that test's ceiling.
 *
 * Not tighter: a charger that limits CURRENT draws more power as pack voltage
 * climbs, so its "flat" ceiling slopes upward. The iX3 on a Supercharger goes
 * 173 → 192 kW across 10–60% — 90% of its peak at the low end. At 0.92 its
 * first fifteen percent counted and dragged the composite to 284 kW at 10%.
 */
export const PLATEAU_SHARE = 0.85;

/** How much more another test must draw at the same SoC for a ceiling reading
 *  to count as held back. Wide enough that two sessions merely a little apart
 *  both stay in — the R2's 10-80 test and OoS's sit 2% apart at 30%. */
export const HELD_BACK_MARGIN = 1.12;

/** Fewer contributors than this at a SoC is thin support, and drawn as such. */
export const THIN_SUPPORT = 2;

const finite = (x) => x != null && x !== '' && Number.isFinite(Number(x));

/**
 * Whether a run may feed a composite: a measured charging test, not excluded
 * from the statistics (#394 — an UNLISTED test still counts: that is the
 * pool), and not synthetic.
 *
 * An INHERITED test counts. A curator linked it because it is this car's
 * charging behavior too — a variant sharing the pack — and the composite
 * stands for the car, so leaving it out made a variant with two inherited
 * tests show no composite at all. It is read as the charts draw it, scaled by
 * its link's capacity factor (DataService.getPointsForRuns).
 *
 * Unlike a best charge window (chargeWindows.countsTowardBest), which still
 * skips inherited tests: a best is a session this car was measured having.
 */
export function compositeEligible(run) {
    if (!run || run.kind !== 'charging') return false;
    // A stored composite is synthetic too; said outright so it never feeds
    // itself — nor, inherited, another vehicle's.
    return !(isExcluded(run) || run.synthetic || isCompositeRun(run));
}

/** A vehicle's OWN stored composites — never one it reads through a spec link. */
export const storedComposites = (vehicle) =>
    (vehicle?.runs ?? []).filter(r => isCompositeRun(r) && !r._inherited);

/** The vehicle's voltage class in volts (400 | 800), or null when unknown. */
export function vehicleVoltageClass(vehicle) {
    return resolveVoltageClass(
        vehicle?.platforms?.electrical,
        vehicle?.specs?.charging?.battery_nominal_voltage_v,
    )?.v ?? null;
}

/**
 * A test's charge rate and clock time at each whole % of SoC it covers.
 *
 * The opening ramp comes off first (socAlignment.trimRamp): the handshake
 * describes the plug, not the car, and would drag the low end down for every
 * test whose logging began at plug-in. Readings are interpolated strictly
 * INSIDE the test's data — never extended past it.
 *
 * @returns {Map<number, {kw: number|null, t: number|null}>}
 */
export function resampleBySoc(points) {
    const settled = trimRamp(points ?? []);
    // SoC must rise for interpolation to mean anything; a logger that repeats
    // or steps back a percent keeps its first reading of each SoC.
    const rising = [];
    for (const p of settled) {
        if (!finite(p?.soc)) continue;
        const soc = Number(p.soc);
        if (rising.length && soc <= rising[rising.length - 1].soc) continue;
        rising.push({
            soc,
            kw: finite(p.chargeRate) ? Number(p.chargeRate) : null,
            t:  finite(p.time) ? Number(p.time) : null,
        });
    }
    const out = new Map();
    if (rising.length < 2) return out;
    const lo = Math.ceil(rising[0].soc);
    const hi = Math.floor(rising[rising.length - 1].soc);
    const last = rising[rising.length - 1];
    // interpolate() finds no bracketing pair AT the final sample and returns
    // null, which would cost a test logged to exactly 80% its 80% reading.
    const read = (key, b) => (b === last.soc ? last[key] : interpolate(rising, 'soc', key, b));
    for (let b = lo; b <= hi; b++) {
        const kw = read('kw', b);
        const t  = read('t', b);
        if (kw == null && t == null) continue;
        out.set(b, { kw, t });
    }
    return out;
}

/**
 * One composite from a set of tests taken under the same charger condition.
 *
 * @param {Array<{run: Object, points: Array}>} tests
 * @returns {{
 *   points: Array<{soc: number, chargeRate: number, time: number|null, n: number,
 *                  spreadHi: number|null, spreadLo: number|null}>,   see testSpread
 *   tests: Array<{runId, name}>,
 *   heldBack: Array<{runId, name, from: number, to: number}>,
 *   conditions: {tempMinF: number|null, tempMaxF: number|null, preconditioned: {yes, no, unknown}},
 * } | null}  null when fewer than COMPOSITE_MIN_TESTS tests have any data
 */
export function buildComposite(tests) {
    const series = (tests ?? [])
        .map(({ run, points }) => {
            const bySoc = resampleBySoc(points);
            let peak = 0;
            for (const { kw } of bySoc.values()) if (kw > peak) peak = kw;
            return { run, bySoc, peak };
        })
        .filter(s => s.bySoc.size > 0);
    if (series.length < COMPOSITE_MIN_TESTS) return null;

    const socs = [...new Set(series.flatMap(s => [...s.bySoc.keys()]))].sort((a, b) => a - b);
    const heldAt = new Map(series.map(s => [s.run.id, []]));   // runId → SoCs set aside
    const used = new Set();

    // The clock starts at the first percent some test timed — a test logged
    // without a clock (SoC and power only) may reach lower than any that has
    // one, and must not leave the whole curve without time — and stops at the
    // first gap after that.
    let clock = 0, clockState = 'waiting';   // → 'running' → 'stopped'
    const points = [];
    for (let i = 0; i < socs.length; i++) {
        const soc = socs[i];
        const readings = series
            .map(s => ({ s, at: s.bySoc.get(soc) }))
            .filter(r => r.at?.kw != null);
        if (!readings.length) continue;

        const top = Math.max(...readings.map(r => r.at.kw));
        const counted = readings.filter(({ s, at }) => {
            const onCeiling = at.kw >= s.peak * PLATEAU_SHARE;
            const outdrawn  = top >= at.kw * HELD_BACK_MARGIN;
            if (onCeiling && outdrawn) { heldAt.get(s.run.id).push(soc); return false; }
            return true;
        });
        // `top` is never itself held back, so `counted` is never empty.
        counted.forEach(r => used.add(r.s.run.id));
        const kw = counted.reduce((sum, r) => sum + r.at.kw, 0) / counted.length;
        const spread = testSpread(counted.map(r => r.at.kw), kw);

        points.push({
            soc,
            chargeRate: Math.round(kw * 10) / 10,
            time: clockState === 'running' ? Math.round(clock * 100) / 100 : null,
            n: counted.length,
            spreadHi: spread && Math.round(spread.hi * 10) / 10,
            spreadLo: spread && Math.round(spread.lo * 10) / 10,
        });

        // Minutes to the next whole percent, from the same tests that counted
        // here. Averaged as time rather than derived from the averaged kW, so
        // no pack capacity has to be assumed.
        const next = socs[i + 1];
        if (next == null) break;
        const steps = counted
            .map(({ s, at }) => {
                const after = s.bySoc.get(next);
                return at.t != null && after?.t != null && after.t > at.t ? after.t - at.t : null;
            })
            .filter(dt => dt != null);
        if (steps.length) {
            if (clockState === 'waiting') { clockState = 'running'; points[points.length - 1].time = 0; }
            if (clockState === 'running') clock += steps.reduce((a, b) => a + b, 0) / steps.length;
        } else if (clockState === 'running') {
            clockState = 'stopped';   // a gap with no clock: say nothing past it rather than guess
        }
    }

    // Minutes per percent are smoothed with the power, then summed back into
    // the clock — smoothing kW alone would leave time following an unsmoothed
    // curve beside a smoothed one.
    points.forEach((p, i) => {
        const next = points[i + 1];
        p.step = p.time != null && next?.time != null ? next.time - p.time : null;
    });
    smoothAlongSoc(points, ['chargeRate', 'spreadHi', 'spreadLo', 'step']);
    let resummed = 0;
    for (const p of points.slice(points.findIndex(q => q.time != null))) {
        if (p.time == null) break;
        p.time = Math.round(resummed * 100) / 100;
        if (p.step == null) break;
        resummed += p.step;
    }
    for (const p of points) {
        delete p.step;
        for (const k of ['chargeRate', 'spreadHi', 'spreadLo']) {
            if (p[k] != null) p[k] = Math.round(p[k] * 10) / 10;
        }
    }

    const temps = series.map(s => s.run.temperature_f).filter(finite).map(Number);
    const pre = { yes: 0, no: 0, unknown: 0 };
    for (const s of series) {
        if (s.run.preconditioned === true) pre.yes++;
        else if (s.run.preconditioned === false) pre.no++;
        else pre.unknown++;
    }

    return {
        points,
        // `from`: the vehicle an inherited test was measured on, so the ⓘ can
        // say why a test this car's list marks as inherited stands behind it.
        tests: series.filter(s => used.has(s.run.id)).map(s => ({
            runId: s.run.id, name: s.run.name,
            ...(s.run._inherited ? { from: s.run._sourceVehicleName ?? null } : {}),
        })),
        heldBack: series.flatMap(s => spans(heldAt.get(s.run.id))
            .map(([from, to]) => ({ runId: s.run.id, name: s.run.name, from, to }))),
        conditions: {
            tempMinF: temps.length ? Math.min(...temps) : null,
            tempMaxF: temps.length ? Math.max(...temps) : null,
            preconditioned: pre,
        },
    };
}

/**
 * Half-width of the smoothing window, in points of SoC either side.
 *
 * A composite's mean steps wherever a test joins or leaves it — a test's data
 * starts or ends, a charger-limited stretch begins or stops being set aside —
 * and the step is an artefact of which tests happened to cover that percent,
 * not something the car did. ±3% turns a step into a ramp over 7% of SoC.
 * Measured on the 2026-09-28 data: the iX3's 800 V composite stepped 29 kW at
 * 31% and now moves under 18 kW a percent; the R2's 9 kW step where CarWow
 * rejoins at 44% is gone. The cost is the knee — the iX3's 30% reading moves
 * from 356 to 348 kW — which is why the window is not wider.
 */
export const SMOOTHING_HALF_WINDOW = 3;

/** A gap in SoC wider than this ends one stretch of the curve and starts another;
 *  smoothing never reaches across it, so a real gap stays a gap. */
export const SMOOTHING_MAX_GAP = 10;

/**
 * Moving average of `keys` along SoC, in place, within each stretch of the
 * curve that has no gap wider than SMOOTHING_MAX_GAP.
 *
 * The window shrinks SYMMETRICALLY at a stretch's ends rather than going
 * one-sided: a one-sided average on a curving taper drags the end point
 * toward its neighbours, which bends the tail it is meant to preserve. A null
 * value (no spread where one test stands alone) stays null, and is never
 * averaged in. Values are left unrounded: each caller knows its own precision
 * (a kW to 0.1 is fine; minutes per percent to 0.1 is a 5% error).
 */
export function smoothAlongSoc(points, keys) {
    if (!points?.length) return points;
    const stretches = [];
    let start = 0;
    for (let i = 1; i <= points.length; i++) {
        if (i === points.length || points[i].soc - points[i - 1].soc > SMOOTHING_MAX_GAP) {
            stretches.push([start, i - 1]);
            start = i;
        }
    }
    for (const key of keys) {
        const raw = points.map(p => p[key]);
        for (const [a, b] of stretches) {
            for (let i = a; i <= b; i++) {
                if (raw[i] == null) continue;
                const h = Math.min(SMOOTHING_HALF_WINDOW, i - a, b - i);
                const near = raw.slice(i - h, i + h + 1).filter(v => v != null);
                points[i][key] = near.reduce((x, y) => x + y, 0) / near.length;
            }
        }
    }
    return points;
}

/**
 * The test spread at one SoC: from the best test down to one standard
 * deviation below the mean.
 *
 * Deliberately lopsided. The top edge is what the car HAS done — the best
 * session — and the bottom edge says how far a session ordinarily falls short
 * of the mean. It is not a confidence band (#314): that would say where a
 * repeat would land, symmetric and sized by n. Here n is 2 to 4, so the
 * deviation is the SAMPLE one (n − 1), which is wide on purpose at n = 2.
 *
 * Only the readings that count: a stretch a charger held back is not part of
 * how the car spreads, and it is already below the top.
 *
 * @returns {{hi: number, lo: number} | null}  null below two readings — one
 *   test has no spread, and drawing a zero-width one would claim agreement.
 */
export function testSpread(kws, mean) {
    if (!(kws?.length >= 2)) return null;
    const m = mean ?? kws.reduce((a, b) => a + b, 0) / kws.length;
    const sd = Math.sqrt(kws.reduce((a, k) => a + (k - m) ** 2, 0) / (kws.length - 1));
    return { hi: Math.max(...kws), lo: m - sd };
}

/** Consecutive whole-percent SoCs as [from, to] spans. */
function spans(socs) {
    const out = [];
    for (const s of socs ?? []) {
        const last = out[out.length - 1];
        if (last && s === last[1] + 1) last[1] = s;
        else out.push([s, s]);
    }
    return out;
}

/**
 * How much of a test must be charger-limited before it is taken to have been
 * on a lower-class charger, in points of SoC. A few percent held back is a
 * busy stall or a noisy reading; a 400 V charger under an 800 V car holds it
 * back for half the pack — the iX3's Supercharger tests for ~50 points, the
 * Gravity's for ~46.
 */
export const LOWER_CLASS_SPAN = 15;

/**
 * Which charger class each test was taken on, for an 800 V car: what was
 * recorded, else what its curve says.
 *
 * Inference reads the same held-back stretches a composite leaves out: a test
 * charger-limited across LOWER_CLASS_SPAN or more against the car's other tests
 * is taken to have been on a 400 V charger. It cannot tell a 400 V charger from
 * an 800 V one that was power-limited (a 150 kW unit, a shared cabinet) — both
 * hold the car down the same way — so an inferred class is always marked as
 * inferred, and a recorded one always wins.
 *
 * @returns {Map<runId, {classV: number|null, inferred: boolean}>}
 */
export function chargerClassOf(tests, vehicleClassV) {
    const out = new Map();
    for (const { run } of tests) {
        const recorded = finite(run.charger_voltage_class) ? Number(run.charger_voltage_class) : null;
        out.set(run.id, { classV: recorded, inferred: false });
    }
    if (vehicleClassV !== 800) return out;   // a 400 V car meets no lower class

    const lower = Math.min(...VOLTAGE_CLASSES);
    // Compare against everything not KNOWN to be on the lower class.
    const probe = buildComposite(tests.filter(t => out.get(t.run.id).classV !== lower));
    for (const h of probe?.heldBack ?? []) {
        const known = out.get(h.runId);
        if (known.classV != null) continue;
        const span = (probe.heldBack.filter(x => x.runId === h.runId)
            .reduce((n, x) => n + (x.to - x.from + 1), 0));
        if (span >= LOWER_CLASS_SPAN) out.set(h.runId, { classV: lower, inferred: true });
    }
    return out;
}

/**
 * A vehicle's composite curves.
 *
 * A 400 V car (or one whose class is unknown) gets one, with charger-limited
 * stretches left out. An 800 V car gets one PER CHARGER CLASS — on 800 V
 * chargers and on 400 V chargers — because the two are different conditions,
 * not a good measurement and a bad one: "what does it do on a Supercharger" is
 * a question worth a line of its own. Each class needs COMPOSITE_MIN_TESTS of
 * its own; a class with fewer is named, never averaged into the other.
 *
 * @param {Object} vehicle  carries `runs`, and `platforms`/`specs` for its class
 * @param {Object} pointsByRunId  loaded data points, keyed by run id
 * @returns {{
 *   curves: Array<{key: string, chargerClassV: number|null, inferredTests: string[]} & ReturnType<typeof buildComposite>>,
 *   setAside: Array<{runId, name, reason: string}>,   tests in a class too small to build from
 *   missing: Array<string|number>,   eligible tests whose points are not loaded yet
 * }}
 */
export function compositeCurves(vehicle, pointsByRunId = {}) {
    const vehicleClassV = vehicleVoltageClass(vehicle);
    const eligible = (vehicle?.runs ?? []).filter(compositeEligible);
    const missing = eligible.filter(r => !(r.id in pointsByRunId)).map(r => r.id);
    const tests = eligible
        .filter(r => r.id in pointsByRunId)
        .map(run => ({ run, points: pointsByRunId[run.id] }));

    const classes = chargerClassOf(tests, vehicleClassV);
    const split = vehicleClassV === 800;
    const groups = new Map();   // charger class (null = one curve, no split) → tests
    for (const t of tests) {
        const key = split ? (classes.get(t.run.id).classV ?? vehicleClassV) : null;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
    }

    const curves = [];
    const setAside = [];
    for (const [chargerClassV, members] of groups) {
        const built = buildComposite(members);
        if (built) {
            curves.push({
                key: `${vehicle.id}:${chargerClassV ?? 'all'}`,
                chargerClassV,
                ...built,
                inferredTests: members.filter(t => classes.get(t.run.id).inferred).map(t => t.run.name),
            });
            continue;
        }
        // Too few to build from. Said, not dropped: a vehicle that draws
        // nothing when the composite is switched on needs a reason beside it.
        for (const { run } of members) {
            const { inferred } = classes.get(run.id);
            setAside.push({
                runId: run.id,
                name: run.name,
                reason: chargerClassV != null
                    ? `the only test on ${chargerClassV} V chargers${inferred ? ' (inferred from its curve)' : ''} — a composite needs ${COMPOSITE_MIN_TESTS}`
                    : `the only test — a composite needs ${COMPOSITE_MIN_TESTS}`,
            });
        }
    }
    // Highest class first: the car's own condition, then what slows it.
    curves.sort((a, b) => (b.chargerClassV ?? Infinity) - (a.chargerClassV ?? Infinity));
    return { curves, setAside, missing };
}

// ── Stored as runs (migration 077) ──────────────────────────────────────────
//
// A composite is stored as a synthetic charging run whose `composite` column
// says how it was built, so every chart, pairing, URL, DEF tag and the vehicle
// table take it as they take a test. These turn a vehicle's tests into the
// rows to write; DataService.rebuildComposites writes them.

/**
 * Bumped whenever the method changes — the thresholds, the smoothing, what is
 * excluded — so Admin → Data checks can say which stored composites were built
 * the old way.
 */
export const COMPOSITE_VERSION = 2;   // 2: inherited tests count; the clock starts at the first timed test

/**
 * What a vehicle's composites are built FROM, as one comparable string. A
 * stored composite whose fingerprint differs is out of date: a test was added,
 * removed, excluded, re-uploaded, renamed or given a charger class since.
 *
 * Point count and peak stand in for the points themselves — no stored
 * timestamp moves when a test's points are replaced (runs.updated_at has no
 * trigger), and fetching every point to compare would cost what rebuilding does.
 * An inherited test's id names its link, and its capacity factor scales every
 * kW it contributes, so a re-scaled link is a changed test.
 */
export function compositeFingerprint(vehicle) {
    const tests = (vehicle?.runs ?? []).filter(compositeEligible)
        .map(r => [r.id, r.name ?? '', r.charger_voltage_class ?? '', r.temperature_f ?? '',
                   r.preconditioned ?? '', r.dataPointCount ?? '', r.charge_summary?.peakKw ?? '',
                   r._capacityFactor ?? ''].join(':'))
        .sort();
    return `class=${vehicleVoltageClass(vehicle) ?? '?'}|${tests.join(',')}`;
}

/** A composite's run name: "Composite (4 tests)", "Composite on 400 V chargers (2 tests)". */
export function compositeRunName(curve) {
    const label = compositeLabel(curve);
    return label.charAt(0).toUpperCase() + label.slice(1);
}

/** What is stored in runs.composite for one curve — see migration 077. */
export function compositeRecord(curve, fingerprint) {
    return {
        chargerClassV: curve.chargerClassV ?? null,
        version: COMPOSITE_VERSION,
        fingerprint,
        tests: curve.tests,
        heldBack: curve.heldBack,
        inferredTests: curve.inferredTests ?? [],
        conditions: curve.conditions,
    };
}

/**
 * The writes that bring a vehicle's stored composites up to date with its
 * tests: one per composite the tests now support, each UPDATING the stored
 * composite of the same charger class when there is one — so its id, DEF tag,
 * range pairings and shared links survive — and inserting otherwise; and the
 * stored composites no class supports any more, to delete.
 *
 * @param {Object} vehicle  with ALL its runs (tests and stored composites), and
 *                          `platforms`/`specs` for its voltage class
 * @param {Object} pointsByRunId  the points of every eligible test
 * @returns {{ writes: Array<{id: number|null, name: string, composite: Object, points: Array}>,
 *             deletes: Array<number> }}
 */
export function planCompositeRebuild(vehicle, pointsByRunId) {
    const { curves } = compositeCurves(vehicle, pointsByRunId);
    const fingerprint = compositeFingerprint(vehicle);
    const stored = storedComposites(vehicle);
    const byClass = new Map(stored.map(r => [r.composite.chargerClassV ?? null, r]));
    const writes = curves.map(curve => ({
        id: byClass.get(curve.chargerClassV ?? null)?.id ?? null,
        name: compositeRunName(curve),
        composite: compositeRecord(curve, fingerprint),
        points: curve.points,
    }));
    const kept = new Set(writes.map(w => w.id).filter(id => id != null));
    return { writes, deletes: stored.filter(r => !kept.has(r.id)).map(r => r.id) };
}

/**
 * A vehicle's stored composites that are out of date — built by an older
 * method, or from tests that have changed since. Empty when all are current.
 */
export function staleComposites(vehicle) {
    const fingerprint = compositeFingerprint(vehicle);
    return storedComposites(vehicle)
        .filter(r => r.composite.version !== COMPOSITE_VERSION || r.composite.fingerprint !== fingerprint);
}

/** Whether a vehicle has enough eligible tests that a composite is worth building. */
export const mayHaveComposite = (vehicle) =>
    (vehicle?.runs ?? []).filter(compositeEligible).length >= COMPOSITE_MIN_TESTS;

/** The legend's name for a composite: "composite (3 tests)", "composite on 400 V chargers (2 tests)". */
export function compositeLabel(curve) {
    const n = curve.tests.length;
    const on = curve.chargerClassV != null ? ` on ${curve.chargerClassV} V chargers` : '';
    return `composite${on} (${n} test${n === 1 ? '' : 's'})`;
}

/**
 * The conditions a composite was drawn from, as one line: "65–80°F · 2 of 4
 * preconditioned". `units` is the app's unit system.
 */
export function compositeConditions(curve, units = 'imperial') {
    const { tempMinF, tempMaxF, preconditioned: p } = curve.conditions;
    const t = (f) => convTemp(f, units);
    const parts = [];
    if (tempMinF != null) {
        parts.push(tempMinF === tempMaxF
            ? `${t(tempMinF)}${tempLabel(units)}`
            : `${t(tempMinF)}–${t(tempMaxF)}${tempLabel(units)}`);
    }
    const total = p.yes + p.no + p.unknown;
    if (p.yes || p.no) parts.push(`${p.yes} of ${total} preconditioned`);
    return parts.join(' · ');
}

/**
 * Everything a reader needs beside a composite, as one line: its conditions,
 * which tests had their charger class read from the curve, and which
 * charger-limited stretches it left out. The picker row and the chart's notes
 * say the same thing, so it is said once, here.
 */
export function compositeNote(curve, units = 'imperial') {
    const span = (h) => (h.from === h.to ? `${h.from}%` : `${h.from}–${h.to}%`);
    return [
        compositeConditions(curve, units),
        curve.inferredTests?.length
            ? `charger class read from the curve, not recorded: ${curve.inferredTests.join(', ')}` : '',
        curve.heldBack?.length
            ? `charger-limited stretches left out: ${curve.heldBack.map(h => `${h.name} ${span(h)}`).join(', ')}` : '',
    ].filter(Boolean).join(' · ');
}

/**
 * What a composite is, for its ⓘ in the test picker: how it was made, from
 * which tests, and then its note. The row has no single source to credit, so
 * this sits where a test's ↗ source link would.
 */
export function compositeExplainer(curve, units = 'imperial') {
    const names = curve.tests.map(t => (t.from ? `${t.name} (inherited from ${t.from})` : t.name)).join(', ');
    const note = compositeNote(curve, units);
    return `The mean of ${curve.tests.length} tests at each SoC, smoothed over ±${SMOOTHING_HALF_WINDOW}%: ${names}.`
        + (note ? ` ${note.charAt(0).toUpperCase()}${note.slice(1)}.` : '')
        + ' Dotted where only one test covers it.';
}
