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
 *   2. 'same-run'      the charging run's OWN measured range data
 *   3. 'default-range' the vehicle's default range test
 *   4. 'recorded'      the charging run's recorded range_value data points
 *   5. 'none'          nothing usable
 *
 * Rank 2 is a refinement of the order agreed in #150. A dual-role run — one
 * drive recorded as a single row with both a charging curve and measured range
 * — is its own same-session partner, and 35 of 76 runs on the live database are
 * exactly that. Ranking the vehicle's default range test above it would pair a
 * drive against some other day's conditions while the conditions measured on
 * that very drive sat unused. After #155 splits those rows this rank stops
 * being a special case and becomes an ordinary same-session pairing.
 *
 * 'recorded' stays last, as agreed: range_value is usually the car's own
 * guess-o-meter readout, it may not match the range shown anywhere else, and it
 * answers a different question than a measured-efficiency computation.
 *
 * Pure module — no data-point access. The 'recorded' branch is *signalled* here
 * and computed by the caller, which is the side that holds the time series.
 */

import { isRangeRun } from './runUtils';

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

    // Ranks 1–3 all resolve to a range run; pick the first that yields data.
    const candidates = [
        ['paired',        explicitPairing],
        ['same-run',      isRangeRun(chargingRun) ? chargingRun : null],
        ['default-range', defaultRangeRun(vehicle, batteryKwh)],
    ];

    for (const [source, run] of candidates) {
        if (!run || !hasUsableRangeData(run, batteryKwh)) continue;
        // A default that resolves back to this same run is the same-run case,
        // already tried above — don't relabel it as inherited from elsewhere.
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
