/**
 * EPA Curator Derivations
 *
 * Read-time, provenance-tagged derivations for the curator model described in
 * LocalDev/curator-fields-spec.md (Section 8). Every derivation is a pure
 * function of a "full" EPA test group — the shape returned by
 * DataService.getEpaTestGroupFull():
 *
 *   group = {
 *     ...config fields (accessory_load_w_override, charger_efficiency_override,
 *                       label_range_published, cd_range_combined_calc, …),
 *     epa_coefficient_sets: [{ category, is_primary, target_a/b/c, set_a/b/c, … }],
 *     epa_tests: [{ procedure_code, total_dc_energy_kwh, ac_recharge_kwh, …,
 *                   epa_test_phases: [{ phase_index, phase_type,
 *                                       dc_energy_kwh, distance_mi }] }],
 *   }
 *
 * THE η FIX (vs. the old epaPhysics.calibrateEfficiency):
 *   η is back-solved from DC-side HWY-phase consumption — the *raw battery-side*
 *   energy that actually left the pack — NOT the AC-side *adjusted* label MPGe.
 *   The label value bakes in EPA's ~0.7–0.78 real-world derate; feeding it into
 *   the back-solve deflated η ~0.78× (R1S read 1.45 mi/kWh vs. real 2.1–2.4).
 *   DC phase energy removes that derate, so η lands in the true 0.80–0.90 band.
 *
 * Procedure precedence (spec): 77 (MCT) preferred for all derivations,
 *   84 (Charge Depleting Highway) as the highway/η fallback,
 *   81 (Charge Depleting UDDS) stored but excluded from efficiency derivation.
 *
 * Each derivation returns a provenance record:
 *   { value, source, certain, flags[], basis? }
 *     value   — number or null when uncomputable
 *     source  — where the value came from (see per-derivation docs)
 *     certain — true only for a measured value inside its sanity band
 *     flags   — machine-readable sanity warnings (e.g. 'eta-out-of-band')
 *     basis   — optional detail (test number, phase indices) for the UI
 *
 * Per-DERIVATION provenance, not per-vehicle: η can be 'measured' while charger
 * efficiency is 'assumed' on the same record.
 */

import { roadLoadForce } from './epaPhysics';

// EPA constants live in src/constants/epa.js (single source of truth). Imported
// here for use, and re-exported so existing `… from './epaDerivations'` imports
// (TestPhaseEditor, EpaCuratorEditor, etc.) keep working.
import {
    LBF_MILE_TO_KWH, DEFAULT_ETA, HWFET_AVG_MPH, MPG_E_CONVERSION, CURVE_SPEED_RANGE,
    PROC_MCT, PROC_CD_HWY, PROC_CD_UDDS, PROC_FTP75,
    ETA_BAND, CHARGER_EFF_BAND, SS_SPEED_BAND,
    DEFAULT_ACCESSORY_W, ASSUMED_CHARGER_EFF,
} from '../constants/epa';

export {
    PROC_MCT, PROC_CD_HWY, PROC_CD_UDDS, PROC_FTP75,
    ETA_BAND, CHARGER_EFF_BAND, SS_SPEED_BAND,
    DEFAULT_ACCESSORY_W, ASSUMED_CHARGER_EFF,
};

// ── Small helpers ───────────────────────────────────────────────────────────

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const inBand = (v, [lo, hi]) => v != null && v >= lo && v <= hi;

/**
 * Pick the coefficient set that drives derivations: the primary (City/Highway)
 * set, else the first available. Prefers target_* coefficients over set_*.
 *
 * @returns {{ a, b, c, source: 'target'|'set', category }|null}
 */
export function resolvePrimaryCoeffs(group) {
    const sets = group?.epa_coefficient_sets || [];
    if (!sets.length) return null;
    const primary = sets.find(s => s.is_primary)
        || sets.find(s => s.category === 'City/Highway')
        || sets[0];

    const ta = num(primary.target_a), tb = num(primary.target_b), tc = num(primary.target_c);
    if (ta != null && tb != null && tc != null) {
        return { a: ta, b: tb, c: tc, source: 'target', category: primary.category };
    }
    const sa = num(primary.set_a), sb = num(primary.set_b), sc = num(primary.set_c);
    if (sa != null && sb != null && sc != null) {
        return { a: sa, b: sb, c: sc, source: 'set', category: primary.category };
    }
    return null;
}

/**
 * Choose the test to derive from, honouring procedure precedence:
 * 77 (MCT) → 84 (CD-Hwy). 81 and others are never used for efficiency.
 *
 * @returns {object|null} the selected test row (with epa_test_phases)
 */
export function pickDerivationTest(tests = []) {
    const byProc = (code) => tests.find(t => Number(t.procedure_code) === code);
    return byProc(PROC_MCT) || byProc(PROC_CD_HWY) || null;
}

/** Sum dc_energy_kwh / distance for a set of phases → kWh/100mi (or null). */
function phaseConsumptionKwh100mi(phases) {
    let dc = 0, dist = 0;
    for (const p of phases) {
        const e = num(p.dc_energy_kwh), d = num(p.distance_mi);
        if (e == null || d == null || d <= 0) continue;
        dc += e; dist += d;
    }
    return dist > 0 ? (dc / dist) * 100 : null;
}

/** Accessory load in kW from the group override, defaulting to 300 W. */
function accessoryKw(group) {
    const w = num(group?.accessory_load_w_override);
    return (w != null && w > 0 ? w : DEFAULT_ACCESSORY_W) / 1000;
}

/** Battery-side consumption (kWh/100mi) at a steady speed for a given η. */
function batteryConsumptionAt(speedMph, a, b, c, eta, accKw) {
    const eWheel = roadLoadForce(speedMph, a, b, c) * LBF_MILE_TO_KWH * 100;
    const eAcc   = accKw * 100 / speedMph;
    return eWheel / eta + eAcc;
}

// ── Derivation 1: Drivetrain efficiency η ───────────────────────────────────

/**
 * Back-solve η from the HWY phase(s) of the preferred test, against road-load
 * energy at the HWFET average speed (48.3 mph), minus accessory load.
 *
 *   η = E_wheel(48.3) / (dcConsumption − E_acc)
 *
 * where dcConsumption is the measured DC-side kWh/100mi of the HWY phase(s).
 *
 * source: 'measured' (proc 77) | 'measured-fallback' (proc 84) | 'estimated'
 * certain: true only when measured AND inside ETA_BAND.
 */
export function deriveDrivetrainEta(group) {
    const coeffs = resolvePrimaryCoeffs(group);
    if (!coeffs) {
        return { value: DEFAULT_ETA, source: 'estimated', certain: false,
            flags: ['no-coefficients'] };
    }

    const test = pickDerivationTest(group?.epa_tests || []);
    const hwyPhases = (test?.epa_test_phases || []).filter(p => p.phase_type === 'HWY');
    const dcConsumption = phaseConsumptionKwh100mi(hwyPhases);

    if (!test || dcConsumption == null) {
        return { value: DEFAULT_ETA, source: 'estimated', certain: false,
            flags: [test ? 'no-hwy-phase' : 'no-test'] };
    }

    const { a, b, c } = coeffs;
    const eWheel = roadLoadForce(HWFET_AVG_MPH, a, b, c) * LBF_MILE_TO_KWH * 100;
    const eAcc   = accessoryKw(group) * 100 / HWFET_AVG_MPH;
    const denom  = dcConsumption - eAcc;

    if (denom <= 0) {
        return { value: DEFAULT_ETA, source: 'estimated', certain: false,
            flags: ['nonphysical-consumption'] };
    }

    const eta = eWheel / denom;
    const source = Number(test.procedure_code) === PROC_MCT ? 'measured' : 'measured-fallback';
    const flags = [];
    if (!inBand(eta, ETA_BAND)) flags.push('eta-out-of-band');

    return {
        value: eta,
        source,
        certain: source === 'measured' && flags.length === 0,
        flags,
        basis: {
            test_number: test.test_number ?? null,
            procedure_code: Number(test.procedure_code),
            phase_indices: hwyPhases.map(p => p.phase_index),
            dc_consumption_kwh_100mi: dcConsumption,
        },
    };
}

// ── Derivation 2: Charger efficiency ────────────────────────────────────────

/**
 * Charger efficiency = total DC energy ÷ AC recharge energy for the preferred
 * test. Falls back to an assumed 0.88 when AC recharge is unavailable, or to a
 * manual override when pinned.
 *
 * source: 'manual' | 'measured' | 'assumed'
 */
export function deriveChargerEfficiency(group) {
    const override = num(group?.charger_efficiency_override);
    if (override != null && override > 0 && override <= 1) {
        const flags = inBand(override, CHARGER_EFF_BAND) ? [] : ['charger-out-of-band'];
        return { value: override, source: 'manual', certain: false, flags };
    }

    const test = pickDerivationTest(group?.epa_tests || []);
    const dc = num(test?.total_dc_energy_kwh);
    const ac = num(test?.ac_recharge_kwh);

    if (dc != null && ac != null && ac > 0) {
        const eff = dc / ac;
        const flags = inBand(eff, CHARGER_EFF_BAND) ? [] : ['charger-out-of-band'];
        return {
            value: eff,
            source: 'measured',
            certain: flags.length === 0,
            flags,
            basis: { test_number: test.test_number ?? null,
                total_dc_energy_kwh: dc, ac_recharge_kwh: ac },
        };
    }

    return { value: ASSUMED_CHARGER_EFF, source: 'assumed', certain: false,
        flags: ['no-ac-recharge'] };
}

// ── Derivation 3: Effective adjustment factor ───────────────────────────────

/**
 * Effective adjustment factor = published label range ÷ computed combined
 * (unadjusted) range. ~0.70 indicates the default 2-cycle shortcut; ~0.72+
 * indicates a vehicle-specific 5-cycle adjustment. Reveals the manufacturer's
 * label methodology instead of guessing it.
 *
 * source: 'computed' | null (when inputs absent)
 */
export function deriveEffectiveAdjustmentFactor(group) {
    const published = num(group?.label_range_published);
    const calc      = num(group?.cd_range_combined_calc);

    if (published == null || calc == null || calc <= 0) {
        return { value: null, source: null, certain: false, flags: ['no-range-data'] };
    }

    const factor = published / calc;
    // Plausible adjustment factors sit in ~0.6–0.8; flag anything well outside.
    const flags = factor >= 0.55 && factor <= 0.85 ? [] : ['adj-factor-implausible'];
    const method = factor >= 0.715 ? 'vehicle-specific 5-cycle' : 'default 2-cycle';

    return {
        value: factor,
        source: 'computed',
        certain: flags.length === 0,
        flags,
        basis: { label_range_published: published, cd_range_combined_calc: calc, method },
    };
}

// ── Derivation 4: Implied steady-state speed (validation) ───────────────────

/**
 * Invert the SS-phase DC consumption through the derived η to solve for the
 * steady-state speed the lab effectively held. Should land ~55–70 mph if the
 * model is self-consistent; otherwise the inputs or η are suspect.
 *
 * source: 'computed' | null
 */
export function deriveImpliedSsSpeed(group, etaResult = deriveDrivetrainEta(group)) {
    const coeffs = resolvePrimaryCoeffs(group);
    const eta = etaResult?.value;
    if (!coeffs || !eta) {
        return { value: null, source: null, certain: false, flags: ['no-eta-or-coeffs'] };
    }

    const test = pickDerivationTest(group?.epa_tests || []);
    const ssPhases = (test?.epa_test_phases || []).filter(p => p.phase_type === 'SS');
    const ssConsumption = phaseConsumptionKwh100mi(ssPhases);
    if (ssConsumption == null) {
        return { value: null, source: null, certain: false, flags: ['no-ss-phase'] };
    }

    const { a, b, c } = coeffs;
    const accKw = accessoryKw(group);

    // Scan the plausible speed range for the best match (monotonic above ~10 mph,
    // so a fine linear scan is sufficient and avoids derivative edge cases).
    let best = null, bestErr = Infinity;
    for (let v = 10; v <= 120; v += 0.25) {
        const pred = batteryConsumptionAt(v, a, b, c, eta, accKw);
        const err = Math.abs(pred - ssConsumption);
        if (err < bestErr) { bestErr = err; best = v; }
    }

    const flags = inBand(best, SS_SPEED_BAND) ? [] : ['implied-ss-speed-out-of-band'];
    return {
        value: best,
        source: 'computed',
        certain: flags.length === 0,
        flags,
        basis: { ss_consumption_kwh_100mi: ssConsumption, eta_used: eta },
    };
}

// ── Convenience: all derivations at once ────────────────────────────────────

/**
 * Compute every Section-8 derivation for a group in one pass, sharing the η
 * result with the implied-SS-speed calculation.
 *
 * @returns {{ eta, chargerEfficiency, effectiveAdjustmentFactor, impliedSsSpeed }}
 *   each a provenance record from the functions above.
 */
export function deriveAll(group) {
    const eta = deriveDrivetrainEta(group);
    return {
        eta,
        chargerEfficiency:          deriveChargerEfficiency(group),
        effectiveAdjustmentFactor:  deriveEffectiveAdjustmentFactor(group),
        impliedSsSpeed:             deriveImpliedSsSpeed(group, eta),
    };
}

/** Convenience: MPGe from a kWh/100mi value (mirrors epaPhysics). */
export function kwh100miToMpge(kwh100mi) {
    if (kwh100mi == null || kwh100mi <= 0) return null;
    return (MPG_E_CONVERSION * 100) / kwh100mi;
}

// ── Altitude / air density ──────────────────────────────────────────────────

/**
 * Air-density ratio (ρ_altitude / ρ_sea_level) at a given elevation, via the
 * standard barometric approximation:  ρ_ratio = (1 − 2.25577e-5·h_m)^4.2559.
 * Input is in feet; ~0.83 at 5,100 ft. Used only at plot time to scale the
 * aerodynamic (C) road-load term — never written back to stored data or η.
 *
 * @param {number} elevationFt
 * @returns {number} density ratio (1.0 at sea level)
 */
export function airDensityRatio(elevationFt) {
    const hM = (elevationFt || 0) * 0.3048;
    const base = 1 - 2.25577e-5 * hM;
    if (base <= 0) return 0; // far above the troposphere; guard the fractional power
    return Math.pow(base, 4.2559);
}

/** Standard-condition ambient temperature (°F), matching the ISA sea-level
 *  reference (15°C) that airDensityRatio's altitude formula assumes. */
export const STANDARD_TEMP_F = 59;

/**
 * Air-density ratio from ambient temperature alone, via the ideal gas law at
 * constant pressure (ρ ∝ 1/T): colder air is denser (ratio > 1), hotter air
 * is thinner (ratio < 1). Independent of, and multiplies with, airDensityRatio
 * — same plot-time-only scale on the aerodynamic (C) term, never persisted.
 *
 * @param {number|null} tempF  ambient temperature in °F; null/undefined ⇒ 1 (no adjustment)
 * @returns {number} density ratio (1.0 at the standard temperature)
 */
export function temperatureDensityRatio(tempF) {
    if (tempF == null || tempF === '') return 1;
    const actualRankine   = Number(tempF) + 459.67;
    const standardRankine = STANDARD_TEMP_F + 459.67;
    if (actualRankine <= 0) return 1; // guard absolute-zero-adjacent nonsense input
    return standardRankine / actualRankine;
}

// ── Curve builder (curator model) ───────────────────────────────────────────

/**
 * Build the steady-state efficiency curve from the curator model: coefficients
 * from epa_coefficient_sets (primary set) and η from the DC-side back-solve.
 * Replaces epaPhysics.buildEpaCurve, which read flat columns and the old
 * AC-adjusted calibration.
 *
 * Uses the same accessory load as the η derivation so the curve is internally
 * consistent (it passes through the measured HWY point at 48.3 mph).
 *
 * Altitude (viewing condition): `densityRatio` scales ONLY the aerodynamic C
 * term, at plot time, AFTER η was derived at standard density. η and the stored
 * coefficients are never modified — passing 1 (default) reproduces the standard
 * sea-level curve exactly.
 *
 * Accessory load (viewing condition): `accessoryOverrideW`, when given, replaces
 * the group's stored accessory load for THIS curve only, at plot time. η (which
 * was derived using the group's own accessory load) is never recomputed.
 *
 * @param {object} group       — full group (with epa_coefficient_sets + epa_tests)
 * @param {number|null} useableKwh — battery capacity for range; null ⇒ rangeMi null
 * @param {number} densityRatio   — ρ_altitude / ρ_sea_level (default 1 = sea level)
 * @param {number|null} accessoryOverrideW — override accessory draw in watts; null ⇒ use the group's own value
 * @returns {Array<{ mph, kwh100mi, miPerKwh, mpge, rangeMi }>}
 */
export function buildEpaCurveFromModel(group, useableKwh, densityRatio = 1, accessoryOverrideW = null) {
    const coeffs = resolvePrimaryCoeffs(group);
    if (!coeffs) return [];

    const eta   = deriveDrivetrainEta(group).value;
    const accKw = accessoryOverrideW != null ? accessoryOverrideW / 1000 : accessoryKw(group);
    const { a, b } = coeffs;
    const c = coeffs.c * densityRatio; // aerodynamic term only, display-time scale
    const [vMin, vMax] = CURVE_SPEED_RANGE;

    const out = [];
    for (let v = vMin; v <= vMax; v++) {
        const kwh100mi = batteryConsumptionAt(v, a, b, c, eta, accKw);
        if (kwh100mi == null || kwh100mi <= 0) continue;
        const miPerKwh = 100 / kwh100mi;
        out.push({
            mph: v,
            kwh100mi,
            miPerKwh,
            mpge: miPerKwh * MPG_E_CONVERSION,
            rangeMi: useableKwh > 0 ? useableKwh / (kwh100mi / 100) : null,
        });
    }
    return out;
}
