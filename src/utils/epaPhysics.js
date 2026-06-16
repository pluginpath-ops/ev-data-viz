/**
 * EPA Road-Load Physics
 *
 * Pure functions for computing theoretical steady-state efficiency vs speed
 * curves from EPA road-load coefficients (A, B, C).
 *
 * All physics is done in imperial units (lbf, mph, kWh) matching EPA data.
 * Unit conversion for display (metric, MPGe) happens in the calling component.
 *
 * Key formula derivation:
 *   Road-load force:  F(v) = A + B·v + C·v²   [lbf, v in mph]
 *   Wheel power:      P_wheel = F(v) · v / 375 · 0.7457   [kW]
 *                     (375 lbf·mph/hp; 1 hp = 0.7457 kW)
 *   Wheel energy:     E_wheel = P_wheel / v = F(v) · 0.001989   [kWh/mile]
 *                     (0.001989 = 4.44822 N/lbf × 1609.34 m/mi / 3,600,000 J/kWh)
 *   Battery energy:   E_bat = E_wheel / η_eff + P_acc / v   [kWh/mile]
 *
 * η_eff is back-solved from the HWFET unadjusted measurement using the HWFET
 * average speed (48.3 mph) as a proxy for the full 765-point drive cycle.
 * This is an intentional approximation that makes the curve pass exactly
 * through the EPA's own highway data point without embedding the drive trace.
 */

// ── Physical constants ────────────────────────────────────────────────────────
// Defined in src/constants/epa.js (single source of truth); re-exported here so
// existing `import { … } from './epaPhysics'` call sites keep working.
import {
    HWFET_AVG_MPH, US06_AVG_MPH, HIGHWAY_BAND_MPH, ACCESSORY_LOAD_KW,
    MPG_E_CONVERSION, LBF_MILE_TO_KWH, DEFAULT_ETA, CURVE_SPEED_RANGE,
} from '../constants/epa';

export {
    HWFET_AVG_MPH, US06_AVG_MPH, HIGHWAY_BAND_MPH, ACCESSORY_LOAD_KW,
    MPG_E_CONVERSION, LBF_MILE_TO_KWH, DEFAULT_ETA, CURVE_SPEED_RANGE,
};

// ── Coefficient resolution ────────────────────────────────────────────────────

/**
 * Select which set of road-load coefficients to use.
 *
 * Preference order:
 *   1. target_a/b/c — EPA-certified road load (what the vehicle experiences on the road)
 *   2. set_a/b/c    — dyno-programmed load (fallback when target is absent)
 *
 * WHY target is preferred:
 *   The "target" coefficients come from the vehicle's coast-down test and represent
 *   the true aerodynamic and rolling-resistance forces the vehicle must overcome on
 *   the road. The "set" (programmed) coefficients are what gets sent to the chassis
 *   dynamometer controller. Because the dyno drums have their own tire-contact
 *   friction, the programmed values are adjusted downward (often giving a negative A)
 *   so that:
 *       F_set(v)  +  F_drum_friction(v)  =  F_target(v)
 *   Using set alone would dramatically understate road load at highway speeds
 *   (30–55 % for heavy vehicles), producing falsely optimistic efficiency curves.
 *
 * @param {object} epaGroup — row from epa_test_groups
 * @returns {{ a: number, b: number, c: number }}
 */
export function resolveCoeffs(epaGroup) {
    const hasTarget =
        epaGroup.target_a != null &&
        epaGroup.target_b != null &&
        epaGroup.target_c != null;

    if (hasTarget) {
        return { a: epaGroup.target_a, b: epaGroup.target_b, c: epaGroup.target_c };
    }
    return { a: epaGroup.set_a, b: epaGroup.set_b, c: epaGroup.set_c };
}

// ── Core physics ──────────────────────────────────────────────────────────────

/**
 * Road-load force at a given speed.
 * F(v) = A + B·v + C·v²
 *
 * @param {number} v — speed in mph
 * @param {number} a — lbf (rolling resistance + constant losses)
 * @param {number} b — lbf/mph (speed-proportional losses)
 * @param {number} c — lbf/mph² (aerodynamic drag)
 * @returns {number} force in lbf
 */
export function roadLoadForce(v, a, b, c) {
    return a + b * v + c * v * v;
}

/**
 * Back-solve effective drivetrain efficiency η_eff from the HWFET unadjusted
 * measurement (battery-side kWh, pre-correction-factor).
 *
 * At the HWFET average speed (48.3 mph), steady-state consumption should equal
 * the measured value. Solving for η:
 *   hwfetUnadj = F(48.3) × 0.1989 / η + P_acc × 100 / 48.3   [kWh/100mi]
 *   η = F(48.3) × 0.1989 / (hwfetUnadj - P_acc × 100 / 48.3)
 *
 * η_eff lumps motor inverter losses, gearbox losses, and the net benefit of
 * regenerative braking into a single composite factor. Typical EVs: 0.80–0.95.
 *
 * Fallback to DEFAULT_ETA (0.88) when HWFET data is absent.
 * Clamped to [0.60, 0.98] to reject physically implausible back-solves.
 *
 * @param {number} a — road-load A coefficient (lbf)
 * @param {number} b — road-load B coefficient (lbf/mph)
 * @param {number} c — road-load C coefficient (lbf/mph²)
 * @param {number|null} hwfetUnadjKwh100mi
 * @returns {number} η_eff (dimensionless, 0–1)
 */
export function calibrateEfficiency(a, b, c, hwfetUnadjKwh100mi) {
    if (!hwfetUnadjKwh100mi || hwfetUnadjKwh100mi <= 0) return DEFAULT_ETA;

    const fAtHwfet = roadLoadForce(HWFET_AVG_MPH, a, b, c);
    const eWheelKwh100mi = fAtHwfet * LBF_MILE_TO_KWH * 100;
    const eAccKwh100mi   = ACCESSORY_LOAD_KW * 100 / HWFET_AVG_MPH;
    const denominator    = hwfetUnadjKwh100mi - eAccKwh100mi;

    if (denominator <= 0) return DEFAULT_ETA;

    const eta = eWheelKwh100mi / denominator;
    return Math.max(0.60, Math.min(0.98, eta));
}

/**
 * Battery-side energy consumption at a single steady-state speed.
 *
 * @param {number} speedMph
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} etaEff — from calibrateEfficiency()
 * @returns {number} kWh/100mi
 */
export function batteryKwh100mi(speedMph, a, b, c, etaEff) {
    if (speedMph <= 0) return null;
    const f = roadLoadForce(speedMph, a, b, c);
    const eWheel = f * LBF_MILE_TO_KWH * 100;        // kWh/100mi wheel
    const eAcc   = ACCESSORY_LOAD_KW * 100 / speedMph; // kWh/100mi accessories
    return eWheel / etaEff + eAcc;
}

// ── Curve builder ─────────────────────────────────────────────────────────────

/**
 * Build the full steady-state curve from CURVE_SPEED_RANGE[0] to [1] mph
 * at 1-mph intervals.
 *
 * @param {object} epaGroup — row from epa_test_groups
 * @param {number|null} useableKwh — battery capacity for range calculation
 * @returns {Array<{ mph, kwh100mi, miPerKwh, mpge, rangeMi }>}
 *   rangeMi is null when useableKwh is null/zero.
 */
export function buildEpaCurve(epaGroup, useableKwh) {
    const { a, b, c } = resolveCoeffs(epaGroup);
    if (a == null || b == null || c == null) return [];

    // Prefer unadjusted HWFET (raw dyno value) for calibration; fall back to
    // adjusted (RND_ADJ_FE kWh/100mi from the test car sheet). Unadj is rarely
    // present in the test car list; adj is populated for every HWFE/HWY row and
    // is accurate enough for the steady-state comparative curve.
    const hwfetKwh = epaGroup.hwfet_unadj_kwh_100mi ?? epaGroup.hwfet_adj_kwh_100mi;
    const eta = calibrateEfficiency(a, b, c, hwfetKwh);
    const results = [];
    const [vMin, vMax] = CURVE_SPEED_RANGE;

    for (let v = vMin; v <= vMax; v++) {
        const kwh100mi = batteryKwh100mi(v, a, b, c, eta);
        if (kwh100mi == null || kwh100mi <= 0) continue;

        const miPerKwh = 100 / kwh100mi;
        const mpge     = miPerKwh * MPG_E_CONVERSION;
        const rangeMi  = useableKwh > 0 ? useableKwh / (kwh100mi / 100) : null;

        results.push({ mph: v, kwh100mi, miPerKwh, mpge, rangeMi });
    }

    return results;
}

// ── Useable kWh resolution ────────────────────────────────────────────────────

/**
 * Resolve the best available useable battery capacity (kWh).
 *
 * Priority:
 *   1. epa_test_groups.useable_kwh          — EPA's own reported value (often absent)
 *   2. vehicle.specs.charging.battery_usable_kwh — contributor-entered spec
 *   3. vehicle.battery                       — gross capacity as-is
 *
 * Returns null when none of the above yield a positive number.
 *
 * @param {object} epaGroup — row from epa_test_groups
 * @param {object} vehicle  — app vehicle object
 * @returns {number|null}
 */
export function resolveUseableKwh(epaGroup, vehicle) {
    if (epaGroup?.useable_kwh > 0) return epaGroup.useable_kwh;
    const specUsable = vehicle?.specs?.charging?.battery_usable_kwh;
    if (specUsable > 0) return specUsable;
    if (vehicle?.battery > 0) return vehicle.battery;
    return null;
}

/**
 * Return a short label describing which source resolveUseableKwh() used.
 * Matches the priority order exactly.
 *
 * @returns {'EPA'|'spec'|'gross'|null}
 */
export function resolveUseableKwhSource(epaGroup, vehicle) {
    if (epaGroup?.useable_kwh > 0) return 'EPA';
    const specUsable = vehicle?.specs?.charging?.battery_usable_kwh;
    if (specUsable > 0) return 'spec';
    if (vehicle?.battery > 0) return 'gross';
    return null;
}
