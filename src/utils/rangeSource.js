/**
 * Range-source resolution — which range test supplies the miles for a charging
 * test, and how that answer was reached.
 *
 * Replaces two ad-hoc resolvers that solved the same problem in opposite
 * directions: ChargeCompareView iterated range runs and hunted for a charging
 * run, RoadTripView iterated charging runs and hunted for efficiency. Both are
 * now this one function, and the answer becomes user-controllable in #153.
 *
 * ── The math ─────────────────────────────────────────────────────────────────
 *
 * Pairing charging test C with range test R needs one scalar:
 *
 *     miPerSoc = R.distance_miles / (R.start_soc − R.end_soc)
 *
 * The charging test supplies ΔSoC over time; the range test supplies miles per
 * %SoC. No battery capacity, no efficiency-unit conversion:
 *
 *     range added over t minutes = ΔSoC(t) × miPerSoc
 *     time to add M miles        = time for C to gain (M / miPerSoc) percent
 *
 * Energy-based consumers (the road-trip simulator) want mi/kWh instead, which
 * prefers measured energy and falls back to SoC-delta against usable capacity.
 *
 * ── Resolution order ─────────────────────────────────────────────────────────
 *
 *   1. 'paired'        explicit pairing chosen for this chart session
 *   2. 'default-range' the vehicle's default range test
 *   3. 'same-run'      the charging run's OWN measured range data
 *   4. 'recorded'      the charging run's recorded range_value data points
 *   5. 'none'          nothing usable
 *
 * Rank 3 extends the order agreed in #150, which did not cover dual-role runs —
 * one drive recorded as a single row carrying both a charging curve and measured
 * range, which is 35 of 76 runs on the live database. It sits BELOW the vehicle
 * default deliberately: the default range test is a deliberate, curated choice,
 * whereas a row being dual-role is an artifact of how the data happened to be
 * collected. Provenance, not a judgment about which conditions to compare against.
 *
 * Note this is the run's *measured* distance and SoC bounds, which is a different
 * thing from rank 4. 'recorded' stays last as agreed: range_value is usually the
 * car's own guess-o-meter readout, it may not match the range shown anywhere
 * else, and it answers a different question than measured efficiency.
 *
 * Rank 3 goes dormant after #155: a split charging row carries no range columns,
 * so it can never match. The same-session partner is surfaced through rank 1
 * instead, with paired_range_run_id populated from the session.
 *
 * Pure module — no data-point access. The 'recorded' branch is *signaled* here
 * and computed by the caller, which is the side that holds the time series.
 */

import { isListed, isExcluded } from './runListing';
import { correctionFactor, applyCorrection, correctionNote, runConditions } from './conditionCorrection';
import { isRangeRun } from './runUtils';
import { val } from './calcTrace';

/**
 * Sentinel partner id for "use the vehicle's EPA range".
 *
 * EPA range is a legitimate basis that is not a run: it is the manufacturer's
 * rated full-pack figure, so it prices a %SoC without any test at all. Useful
 * as a neutral yardstick when a vehicle's own range tests are all in unusual
 * conditions, or when it has none.
 *
 * A string sentinel rather than a fake run row, so it can never be confused
 * with a real run id, survives the URL round trip, and cannot be picked up by
 * defaultRangeRun() — EPA is only ever an explicit choice.
 */
export const EPA_PARTNER_ID = 'epa';

/**
 * The EPA row's id is scoped PER VEHICLE — 'epa:12', not a bare 'epa'.
 *
 * Selections and chart series are keyed by run id, so a sentinel shared across
 * vehicles collides: every vehicle's EPA row computed the same key, so one
 * selection rendered all of them as chosen, toggling one toggled all, and the
 * chart plotted every vehicle's EPA bar at once.
 */
export function epaPartnerId(vehicle) {
    return `${EPA_PARTNER_ID}:${vehicle?.id}`;
}

/** True for any EPA row id, scoped or bare. */
export function isEpaPartnerId(id) {
    const s = String(id ?? '');
    return s === EPA_PARTNER_ID || s.startsWith(`${EPA_PARTNER_ID}:`);
}

/**
 * What the EPA option is called, by where the vehicle's range came from (#324).
 * A vehicle with no EPA label keeps its row rather than dropping out of the
 * chart, and says what its figure is instead.
 */
function epaRangeName(vehicle) {
    switch (vehicle?.epaRangeBasis) {
        case 'expected': {
            const source = vehicle.epaRange?.expectedSource;
            return `Expected EPA range${source ? ` (${source})` : ''}`;
        }
        case 'unsorted': return 'EPA range (unsorted)';
        default:         return 'EPA range';
    }
}

/** The EPA option for a vehicle's partner dropdown, or null when it has no EPA range. */
export function epaRangeOption(vehicle) {
    return vehicle?.epaRangeMi > 0
        ? { id: epaPartnerId(vehicle), name: epaRangeName(vehicle), _synthetic: true }
        : null;
}

/**
 * Miles per %SoC from a range test.
 *
 * Guards the degenerate cases: no distance, missing SoC bounds, and
 * start === end (which would divide by zero and yield Infinity miles/%).
 */
export function miPerSocFrom(run, trace = null) {
    if (!run?.distance_miles) return null;
    const { start_soc: start, end_soc: end } = run;
    if (start == null || end == null) return null;
    const socDelta = start - end;
    if (!(socDelta > 0)) return null;
    trace?.step('Miles per % SoC', {
        formula: 'mi/% = d / (SoC_start − SoC_end)',
        values: { d: val(run.distance_miles, 'mi', 'data'), SoC_start: val(start, '%', 'data'), SoC_end: val(end, '%', 'data') },
        result: run.distance_miles / socDelta, unit: 'mi/%',
    });
    return run.distance_miles / socDelta;
}

/**
 * Miles per kWh from a range test.
 *
 *   1. measured energy — distance / energy_kwh                (preferred)
 *   2. SoC-delta estimate — distance / (ΔSoC% × usable kWh)   (needs capacity)
 *
 * Returns { miPerKwh, method } so callers can label an estimate as one.
 */
export function miPerKwhFrom(run, batteryKwh, trace = null) {
    if (!run?.distance_miles) return { miPerKwh: null, method: null };

    if (run.energy_kwh) {
        trace?.step('Efficiency, measured', {
            formula: 'mi/kWh = d / E', values: { d: val(run.distance_miles, 'mi', 'data'), E: val(run.energy_kwh, 'kWh', 'data') },
            result: run.distance_miles / run.energy_kwh, unit: 'mi/kWh',
        });
        return { miPerKwh: run.distance_miles / run.energy_kwh, method: 'measured-energy' };
    }

    const socDelta = (run.start_soc != null && run.end_soc != null)
        ? run.start_soc - run.end_soc
        : null;
    if (socDelta > 0 && batteryKwh > 0) {
        const energyEst = (socDelta / 100) * batteryKwh;
        if (energyEst > 0) {
            trace?.step('Efficiency, estimated from SoC', {
                formula: 'mi/kWh = d / (ΔSoC / 100 × E_pack)',
                values: { d: val(run.distance_miles, 'mi', 'data'), ΔSoC: val(socDelta, '%', 'data'), E_pack: val(batteryKwh, 'kWh', 'data') },
                result: run.distance_miles / energyEst, unit: 'mi/kWh', assumed: true,
                note: 'no energy recorded: the SoC used is priced at the vehicle\'s capacity',
            });
            return { miPerKwh: run.distance_miles / energyEst, method: 'soc-delta-estimate' };
        }
    }

    trace?.note('No energy and no SoC window: no efficiency');
    return { miPerKwh: null, method: null };
}

/** True when a run carries range data this module can actually use. */
export function hasUsableRangeData(run, batteryKwh) {
    if (!isRangeRun(run)) return false;
    return miPerSocFrom(run) != null || miPerKwhFrom(run, batteryKwh).miPerKwh != null;
}

/**
 * The vehicle's default range test: an explicitly-defaulted one first, then the
 * most recent that carries usable data.
 *
 * `is_default` has been scoped PER KIND since #155 (migration 046 split dual-
 * role runs into one kind per row) and #183 (migration 049, `runs.kind`-aware
 * `ensure_single_default_run` trigger — the DB was clearing a range default
 * the moment a charging default was set on the same vehicle, and vice versa,
 * since the trigger cleared every default row regardless of kind). A vehicle
 * can hold both a default charging run AND a default range test at once; this
 * function's first branch has read the range one since #155 shipped. The
 * most-recent fallback only fires for a vehicle whose range side has never
 * had one curated — this comment used to describe that as the ONLY case, back
 * when the trigger bug made a curated range default unreliable in practice.
 */
export function defaultRangeRun(vehicle, batteryKwh = vehicle?.socWindowKwh) {
    // A default names one test: a listed one, never one kept out of the
    // figures (#394, utils/runListing). A contributor's runs include both.
    const candidates = (vehicle?.runs || []).filter(r =>
        isListed(r) && !isExcluded(r) && hasUsableRangeData(r, batteryKwh));
    if (candidates.length === 0) return null;
    return candidates.find(r => r.isDefault || r.is_default)
        ?? [...candidates].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        ?? null;
}

/** Human-readable provenance, e.g. `eff. from Ottawa loop (est. from SoC Δ)`. */
function buildNote(source, sourceRun, energyMethod) {
    const estimate = energyMethod === 'soc-delta-estimate' ? 'est. from SoC Δ' : null;

    switch (source) {
        case 'paired':
            return `paired with ${sourceRun.name}${estimate ? ` (${estimate})` : ''}`;
        case 'same-run':
            return estimate ?? null;   // same row — naming it would be noise
        case 'default-range':
            return `eff. from ${sourceRun.name}${estimate ? ` (${estimate})` : ''}`;
        case 'recorded':
            return 'from recorded range column';
        default:
            return null;
    }
}

/**
 * Resolve the range source for one charging run.
 *
 * @param {Object}  chargingRun
 * @param {Object}  opts
 * @param {Object}  opts.vehicle            owning vehicle (for the default range test)
 * @param {Object}  [opts.explicitPairing]  range run chosen for this chart session
 * @param {number}  [opts.batteryKwh]       capacity; defaults to vehicle.socWindowKwh
 * @param {boolean} [opts.hasRecordedRange] whether the charging run's data points
 *                                          carry range_value — the caller knows,
 *                                          this module deliberately does not
 * @returns {{
 *   source: 'paired'|'same-run'|'default-range'|'recorded'|'none',
 *   sourceRun: Object|null,
 *   miPerSoc: number|null,
 *   miPerKwh: number|null,
 *   energyMethod: 'measured-energy'|'soc-delta-estimate'|null,
 *   note: string|null,
 * }}
 */
/**
 * Re-price a resolved basis for the conditions its range test was run under.
 *
 * The conditions come from conditionCorrection.runConditions, which says whose
 * reading wins when the run and its session both have one.
 */
function correctBasis(basis, run, correction, session, trace = null) {
    if (!correction || correction.mode === 'none' || !correction.mode) {
        trace?.note('Correction off: the test\'s figures as measured');
        return { ...basis, correction: null };
    }
    const result = correctionFactor(runConditions(run, session), trace ? { ...correction, trace: trace.group('Correction factor') } : correction);
    const corrected = applyCorrection(basis, result.factor);
    trace?.step('Corrected basis', {
        formula: 'mi/% = mi/%_test × k',
        values: { 'mi/%_test': val(basis.miPerSoc, 'mi/%'), k: result.factor },
        result: corrected.miPerSoc, unit: 'mi/%', note: 'mi/kWh takes the same factor',
    });
    return {
        ...corrected,
        correction: { ...result, note: correctionNote(result) },
    };
}

export function resolveRangeSource(chargingRun, {
    vehicle,
    explicitPairing = null,
    batteryKwh = vehicle?.socWindowKwh,
    hasRecordedRange = false,
    // Condition correction (#188). Applied HERE because this is the single
    // place a series' range basis is decided, so every chart corrects
    // identically instead of each deciding for itself — which is how Road Trip
    // came to correct for speed while Charge Compare did not, and the same test
    // read differently on the two. Road Trip itself resolves with no correction
    // and corrects per trip, at the travel speed, through the same model
    // (tripEfficiency.js): a trip has a speed of its own.
    correction = null,          // { mode, target, aeroFraction } | null
    session = null,             // supplies altitude/temperature the run omits
    trace = null,               // calcTrace.js, for "Show the math"
} = {}) {
    const none = {
        source: 'none', sourceRun: null,
        miPerSoc: null, miPerKwh: null, energyMethod: null, note: null,
    };
    if (!chargingRun) return none;

    // EPA range, when explicitly chosen. Rated range is a full-pack figure, so
    // one percent of SoC buys one hundredth of it. Only ever reachable by
    // explicit choice — it is never resolved automatically, because a real
    // measured test on this vehicle is always the better default.
    const wantsEpa = isEpaPartnerId(explicitPairing) || isEpaPartnerId(explicitPairing?.id);
    if (wantsEpa && vehicle?.epaRangeMi > 0) {
        trace?.step('EPA range, chosen as the basis', {
            formula: 'mi/% = R_EPA / 100', values: { R_EPA: val(vehicle.epaRangeMi, 'mi', 'data') },
            result: vehicle.epaRangeMi / 100, unit: 'mi/%', note: 'rated range is a full-pack figure; never corrected',
        });
        return {
            source: 'epa',
            sourceRun: epaRangeOption(vehicle),
            miPerSoc: vehicle.epaRangeMi / 100,
            miPerKwh: batteryKwh > 0 ? vehicle.epaRangeMi / batteryKwh : null,
            energyMethod: 'epa-rated',
            note: epaRangeName(vehicle),
        };
    }

    // Ranks 1–3 all resolve to a range run; pick the first that yields data.
    const candidates = [
        ['paired',        explicitPairing],
        ['default-range', defaultRangeRun(vehicle, batteryKwh)],
        ['same-run',      isRangeRun(chargingRun) ? chargingRun : null],
    ];

    for (const [source, run] of candidates) {
        if (!run || !hasUsableRangeData(run, batteryKwh)) continue;
        // When the vehicle default resolves back to this very run, that is the
        // same-run case reached by another route — fall through so it gets the
        // 'same-run' label rather than reading as inherited from elsewhere.
        if (source === 'default-range' && run.id === chargingRun.id) continue;

        trace?.note(`Basis: ${{ paired: 'the range test paired with this charging test', 'default-range': 'the vehicle\'s default range test', 'same-run': 'this test\'s own range data' }[source]}, ${run.name ?? `test ${run.id}`}`);
        const { miPerKwh, method } = miPerKwhFrom(run, batteryKwh, trace);
        // The conditions belong to the RANGE test, which is what measured the
        // miles — not to the charging run being priced.
        const corrected = correctBasis({ miPerSoc: miPerSocFrom(run, trace), miPerKwh }, run, correction, session, trace);
        return {
            source,
            sourceRun: run,
            miPerSoc: corrected.miPerSoc,
            miPerKwh: corrected.miPerKwh,
            energyMethod: method,
            note: buildNote(source, run, method),
            correction: corrected.correction,
        };
    }

    // Rank 4: the charging run's own recorded range column. Signaled only —
    // the miles come from interpolating the caller's data points, not from a
    // scalar, so there is nothing to return but the provenance.
    if (hasRecordedRange) {
        trace?.note('No range test: the charging test\'s own recorded range column, read point by point');
        return {
            source: 'recorded', sourceRun: null,
            miPerSoc: null, miPerKwh: null, energyMethod: null,
            note: buildNote('recorded'),
        };
    }

    return none;
}

/**
 * The range basis of one Charge Stop row: its range test (or the EPA row) as
 * the explicit pairing. Charge Stop and its "Show the math" both call this.
 */
export function pairRangeSource(chargingRun, rangeRun, { vehicle, correction = null, session = null, trace = null } = {}) {
    return resolveRangeSource(chargingRun, {
        vehicle,
        explicitPairing: isEpaPartnerId(rangeRun?.id) ? EPA_PARTNER_ID : rangeRun,
        correction,
        session,
        trace,
    });
}
