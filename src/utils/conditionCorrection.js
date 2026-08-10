/**
 * Correct measured range and efficiency to a common basis.
 *
 * Two tests are only comparable if they were run under the same conditions, and
 * they never are. A 70 mph test reads better than an 80 mph one, a Denver test
 * better than a sea-level one, a summer test better than a winter one — none of
 * which says anything about the car. This re-prices a measurement as though it
 * had been taken at standard conditions, so "X goes further than Y" is a claim
 * about the cars rather than about the days they were driven.
 *
 * ── One factor, both quantities ──────────────────────────────────────────────
 *
 * Efficiency is DERIVED from a range test (distance ÷ energy), so a correction
 * factor k applied to consumption moves both by exactly k:
 *
 *     eff′/eff = C/C′ = k
 *     range′   = energy × eff′ = energy × eff × k = distance × k
 *
 * There is no ordering question and nothing to keep in step: correcting range
 * and correcting efficiency are the same operation.
 *
 * ── The generic model ────────────────────────────────────────────────────────
 *
 * Consumption splits into a share that scales with air density and speed (aero)
 * and a share that does not (rolling resistance, drivetrain, accessories):
 *
 *     C ∝ f · (v/v_ref)² · (ρ/ρ_ref) + (1 − f)
 *
 * `f` is the aero fraction at the reference speed. This is the same split that
 * roadTripSimulation's speedCorrectionFactor has always used for speed alone;
 * density is the same idea with a different ratio, so the two compose rather
 * than competing.
 *
 * A GENERIC f is used for every vehicle, deliberately. Per-vehicle EPA road-load
 * coefficients would be more precise, but only about half the fleet has them,
 * and a chart where half the series are corrected precisely and half not at all
 * is not a common basis — it is two treatments in one comparison, which is worse
 * than correcting none. `correctionModel` leaves room for the EPA path to be
 * offered later as a marked refinement.
 *
 * ── What this does NOT do ────────────────────────────────────────────────────
 *
 * Temperature is corrected for AIR DENSITY ONLY. Cold air is denser and so
 * costs more aero drag — about 6% of consumption at 20°F versus 70°F. But a
 * winter range test typically loses 20–40%, and the rest is cabin heating,
 * battery conditioning, tyre pressure and regen limits, none of which is
 * modelled here. Hence the mode names say "aero": calling a winter test
 * "corrected to 70°F" when a fifth of the penalty has been removed would be an
 * authoritative-looking number that is still mostly wrong.
 *
 * Pure module — no React, no database.
 */

import {
    AERO_FRACTION, REFERENCE_SPEED_MPH, STANDARD_CONDITIONS,
} from '../constants/epa';
import { airDensityRatio, temperatureDensityRatio } from './epaDerivations';

/**
 * Correction modes, in the order they appear in the picker. Each names what it
 * actually corrects, so a reader cannot infer a completeness the model lacks.
 */
export const CORRECTION_MODES = [
    { key: 'none',      label: 'No correction',                       axes: [] },
    { key: 'aero',      label: 'Speed, altitude & temp (aero)',       axes: ['speed', 'altitude', 'temperature'] },
    // Reserved for the phases agreed in #188. Listing them here rather than in
    // the UI keeps the vocabulary in one place as they arrive.
    // { key: 'aero_hvac',      label: '+ HVAC',            axes: [...,'hvac'] },
    // { key: 'aero_wind',      label: '+ wind (aero)',     axes: [...,'wind'] },
    // { key: 'aero_wind_hvac', label: '+ wind and HVAC',   axes: [...] },
];

export const DEFAULT_CORRECTION_MODE = 'none';

const modeAxes = (mode) =>
    CORRECTION_MODES.find(m => m.key === mode)?.axes ?? [];

/** Aero-share road-load term at a given speed and air density. */
function loadTerm(speedMph, densityRatio, aeroFraction) {
    const v = (speedMph ?? REFERENCE_SPEED_MPH) / REFERENCE_SPEED_MPH;
    return aeroFraction * v * v * densityRatio + (1 - aeroFraction);
}

/**
 * The factor to multiply measured efficiency (and range) by.
 *
 * > 1 means the test was made HARDER than standard and the car is better than
 * it measured; < 1 means the conditions flattered it.
 *
 * @param {Object} conditions  { speedMph, altitudeFt, temperatureF } as tested
 * @param {Object} [opts]
 * @param {string} [opts.mode]         a CORRECTION_MODES key
 * @param {Object} [opts.target]       standard conditions to correct TO
 * @param {number} [opts.aeroFraction] override, e.g. towing
 * @returns {{ factor: number, applied: string[], missing: string[], skipped: Array }}
 */
export function correctionFactor(conditions, {
    mode = DEFAULT_CORRECTION_MODE,
    target = STANDARD_CONDITIONS,
    aeroFraction = AERO_FRACTION,
} = {}) {
    const axes = modeAxes(mode);
    if (!axes.length) return { factor: 1, applied: [], missing: [], skipped: [] };

    const applied = [];
    const missing = [];
    const skipped = [];

    // Correcting for speed assumes the test held one. Aero energy goes as the
    // MEAN OF v², while an average speed supplies the SQUARE OF THE MEAN, and
    // ⟨v²⟩ > ⟨v⟩² for any varying speed — so a mixed cycle reads as a gentle
    // steady cruise and gets over-penalised on the way to the reference speed.
    // Air density does not care what the speed trace looked like, so altitude
    // and temperature still apply.
    const mixedCycle = conditions?.speedBasis === 'mixed';

    // An axis is only corrected when the test SAYS what it was. Assuming a
    // default would silently invent a correction — the opposite of the point.
    const has = (axis, value) => {
        if (!axes.includes(axis)) return false;
        if (value == null || value === '') { missing.push(axis); return false; }
        applied.push(axis);
        return true;
    };

    let useSpeed = false;
    if (mixedCycle && axes.includes('speed')) {
        skipped.push({ axis: 'speed', reason: 'mixed cycle' });
    } else {
        useSpeed = has('speed', conditions?.speedMph);
    }
    const useAlt   = has('altitude', conditions?.altitudeFt);
    const useTemp  = has('temperature', conditions?.temperatureF);

    const runSpeed   = useSpeed ? conditions.speedMph : target.speedMph;
    const runDensity = (useAlt  ? airDensityRatio(conditions.altitudeFt) : airDensityRatio(target.altitudeFt))
                     * (useTemp ? temperatureDensityRatio(conditions.temperatureF) : temperatureDensityRatio(target.temperatureF));

    const targetDensity = airDensityRatio(target.altitudeFt) * temperatureDensityRatio(target.temperatureF);

    const atRun    = loadTerm(runSpeed,        runDensity,    aeroFraction);
    const atTarget = loadTerm(target.speedMph, targetDensity, aeroFraction);
    if (!atRun || atRun <= 0) return { factor: 1, applied: [], missing, skipped };

    // Consumption ratio inverted: a harder test (higher load) means the car
    // deserves a BETTER corrected efficiency than it measured.
    return { factor: atRun / atTarget, applied, missing, skipped };
}

/**
 * Apply a correction factor to a resolved range basis.
 *
 * Both figures take the same factor, per the identity above — this exists so
 * callers cannot accidentally scale one and not the other.
 */
export function applyCorrection({ miPerKwh, miPerSoc }, factor) {
    if (!factor || factor === 1) return { miPerKwh, miPerSoc };
    return {
        miPerKwh: miPerKwh != null ? miPerKwh * factor : null,
        miPerSoc: miPerSoc != null ? miPerSoc * factor : null,
    };
}

/**
 * A short human note for a corrected series — what moved it, and by how much.
 * Charts show this so a corrected number never passes for a measured one.
 */
export function correctionNote({ factor, applied, missing, skipped }) {
    // A skipped axis is worth saying even when nothing was corrected: "not
    // corrected because we cannot" is a different claim from "not corrected".
    if (!applied?.length && !skipped?.length) return null;

    const parts = [];
    if (applied?.length) {
        const pct = (factor - 1) * 100;
        parts.push(`corrected ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% for ${applied.join(', ')}`);
    }
    for (const s of skipped ?? []) parts.push(`${s.axis} not corrected (${s.reason})`);
    if (missing?.length) parts.push(`no ${missing.join('/')} recorded`);
    return parts.join(' · ');
}
