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
 * collected. Provenance, not a judgement about which conditions to compare against.
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
 * Pure module — no data-point access. The 'recorded' branch is *signalled* here
 * and computed by the caller, which is the side that holds the time series.
 */

import { isRangeRun } from './runUtils';

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

/** The EPA option for a vehicle's partner dropdown, or null when it has no rated range. */
export function epaRangeOption(vehicle) {
    return vehicle?.range > 0
        ? { id: epaPartnerId(vehicle), name: 'EPA range', _synthetic: true }
        : null;
}

/**
 * Miles per %SoC from a range test.
 *
 * Guards the degenerate cases: no distance, missing SoC bounds, and
 * start === end (which would divide by zero and yield Infinity miles/%).
 */
export function miPerSocFrom(run) {
    if (!run?.distance_miles) return null;
    const { start_soc: start, end_soc: end } = run;
    if (start == null || end == null) return null;
    const socDelta = start - end;
    if (!(socDelta > 0)) return null;
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
export function miPerKwhFrom(run, batteryKwh) {
    if (!run?.distance_miles) return { miPerKwh: null, method: null };

    if (run.energy_kwh) {
        return { miPerKwh: run.distance_miles / run.energy_kwh, method: 'measured-energy' };
    }

    const socDelta = (run.start_soc != null && run.end_soc != null)
        ? run.start_soc - run.end_soc
        : null;
    if (socDelta > 0 && batteryKwh > 0) {
        const energyEst = (socDelta / 100) * batteryKwh;
        if (energyEst > 0) {
            return { miPerKwh: run.distance_miles / energyEst, method: 'soc-delta-estimate' };
        }
    }

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
 * `is_default` is currently scoped to charging runs; #155 scopes it per kind, at
 * which point the first branch starts firing for range tests too. Until then
 * this resolves to most-recent, which is what RoadTripView already did.
 */
export function defaultRangeRun(vehicle, batteryKwh = vehicle?.battery) {
    const candidates = (vehicle?.runs || []).filter(r => hasUsableRangeData(r, batteryKwh));
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
 * @param {number}  [opts.batteryKwh]       usable capacity; defaults to vehicle.battery
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
export function resolveRangeSource(chargingRun, {
    vehicle,
    explicitPairing = null,
    batteryKwh = vehicle?.battery,
    hasRecordedRange = false,
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
    if (wantsEpa && vehicle?.range > 0) {
        return {
            source: 'epa',
            sourceRun: epaRangeOption(vehicle),
            miPerSoc: vehicle.range / 100,
            miPerKwh: batteryKwh > 0 ? vehicle.range / batteryKwh : null,
            energyMethod: 'epa-rated',
            note: 'EPA rated range',
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

        const { miPerKwh, method } = miPerKwhFrom(run, batteryKwh);
        return {
            source,
            sourceRun: run,
            miPerSoc: miPerSocFrom(run),
            miPerKwh,
            energyMethod: method,
            note: buildNote(source, run, method),
        };
    }

    // Rank 4: the charging run's own recorded range column. Signalled only —
    // the miles come from interpolating the caller's data points, not from a
    // scalar, so there is nothing to return but the provenance.
    if (hasRecordedRange) {
        return {
            source: 'recorded', sourceRun: null,
            miPerSoc: null, miPerKwh: null, energyMethod: null,
            note: buildNote('recorded'),
        };
    }

    return none;
}
