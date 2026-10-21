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
import { airDensityRatio, temperatureDensityRatio, apparentAirspeed } from './epaDerivations';

/**
 * Correction modes, in the order they appear in the picker. Each names what it
 * actually corrects, so a reader cannot infer a completeness the model lacks.
 */
export const CORRECTION_MODES = [
    { key: 'none',      label: 'No correction',                       axes: [] },
    { key: 'aero',      label: 'Speed, altitude & temp (aero)',       axes: ['speed', 'altitude', 'temperature'] },
    { key: 'aero_wind', label: 'Speed, altitude, temp & wind (aero)', axes: ['speed', 'altitude', 'temperature', 'wind'] },
    // Reserved for the phases agreed in #188. Listing them here rather than in
    // the UI keeps the vocabulary in one place as they arrive.
    // { key: 'aero_hvac',      label: '+ HVAC',            axes: [...,'hvac'] },
    // { key: 'aero_wind_hvac', label: '+ wind and HVAC',   axes: [...] },
];

export const DEFAULT_CORRECTION_MODE = 'none';

const modeAxes = (mode) =>
    CORRECTION_MODES.find(m => m.key === mode)?.axes ?? [];

/**
 * What a range test was driven in, as correctionFactor reads it. Every
 * correction builds its conditions here, so a field added once (wind was) is
 * read by every chart and the table at once rather than by whichever caller
 * remembered it.
 *
 * A run's own value wins over its session's: the session reading is the
 * shared context of the outing, and a run that states its own knows better.
 * Same rule migration 044 documents for temperature. Wind is the run's alone —
 * a session records no wind.
 */
export function runConditions(run, session = null) {
    return {
        speedMph:     run?.speed_mph,
        speedBasis:   run?.speed_basis,
        altitudeFt:   run?.altitude_ft   ?? session?.altitude_ft,
        temperatureF: run?.temperature_f ?? session?.temperature_f,
        windMph:      run?.avg_wind_speed_mph,
        windDirDeg:   run?.wind_direction_deg,
    };
}

/**
 * Aero-share road-load term at a given speed and air density. `airSpeedSq`,
 * when given, is the mean square of the speed through the AIR — the ground
 * speed with the wind added — and replaces the ground speed's square.
 */
function loadTerm(speedMph, densityRatio, aeroFraction, airSpeedSq = null) {
    const vSq = (airSpeedSq ?? (speedMph ?? REFERENCE_SPEED_MPH) ** 2) / REFERENCE_SPEED_MPH ** 2;
    return aeroFraction * vSq * densityRatio + (1 - aeroFraction);
}

/**
 * The mean square of a test's speed through the air, given the wind — the
 * apparent-wind law epaDerivations.apparentAirspeed already uses for the EPA
 * curves, so the two corrections agree on what a wind does.
 *
 * With a direction (0° a tailwind, 180° a headwind, 90° across, as runs record
 * it) it is that law at that angle. Without one, the mean of it over every
 * heading, which is v² + w² — and that is also exactly an out-and-back: the
 * headwind leg's (v + w)² and the tailwind leg's (v − w)² average to v² + w².
 * So a wind that "turns into a tailwind on the return" is recorded as its
 * speed with no direction, and it costs the test a little rather than
 * cancelling, because drag goes as the square of air speed.
 *
 * Under THIS law that holds for an out-and-back in any wind, quartering
 * included: the legs face θ and θ + 180°, and the −2vw·cos θ term of one
 * cancels the other's.
 *
 * The law is a simplification, and the simplification is the reason. Drag
 * acts along the apparent wind, and the battery pays only for its component
 * along the road, |V_rel|·(v − w·cos θ), not |V_rel|²; the sideways part is
 * carried by the tyres. On that basis an out-and-back costs w² of the aero
 * term in a head/tail wind but about w²/2 in a crosswind (70 mph, 10 mph wind:
 * 5000 / 4975 / 4950 at 0° / 45° / 90°, against 4900 calm), so a direction
 * WOULD matter on an out-and-back, and an out-and-back flag would be needed
 * to read it. Yaw drag (Cd rising off the nose) pulls the crosswind figure
 * back up by a per-vehicle amount nobody publishes. The gap is ~0.7% of energy
 * at 10 mph of wind; switching both this and apparentAirspeed to the
 * along-track form, with the flag, is an open decision, not an oversight.
 */
function airSpeedSquared(speedMph, windMph, windDirDeg = null) {
    if (windDirDeg == null || windDirDeg === '') return speedMph ** 2 + windMph ** 2;
    return apparentAirspeed(speedMph, windMph, Number(windDirDeg)) ** 2;
}

/**
 * The factor to multiply measured efficiency (and range) by.
 *
 * > 1 means the test was made HARDER than standard and the car is better than
 * it measured; < 1 means the conditions flattered it.
 *
 * @param {Object} conditions  { speedMph, speedBasis, altitudeFt, temperatureF, windMph, windDirDeg } as tested;
 *                              the wind is read only by a mode with the 'wind' axis
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
    // Wind adds to the speed through the air, so it needs a held speed to add
    // to. On a mixed cycle, or with no speed, it is left alone and says so.
    let useWind = false;
    if (axes.includes('wind') && !useSpeed && conditions?.windMph != null && conditions.windMph !== '') {
        skipped.push({ axis: 'wind', reason: 'no held speed' });
    } else if (useSpeed) {
        useWind = has('wind', conditions?.windMph);
    }

    const runSpeed   = useSpeed ? conditions.speedMph : target.speedMph;
    const runDensity = (useAlt  ? airDensityRatio(conditions.altitudeFt) : airDensityRatio(target.altitudeFt))
                     * (useTemp ? temperatureDensityRatio(conditions.temperatureF) : temperatureDensityRatio(target.temperatureF));

    const targetDensity = airDensityRatio(target.altitudeFt) * temperatureDensityRatio(target.temperatureF);

    const airSq    = useWind ? airSpeedSquared(runSpeed, Number(conditions.windMph), conditions.windDirDeg) : null;
    const atRun    = loadTerm(runSpeed,        runDensity,    aeroFraction, airSq);
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
