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
 * `f` is the aero fraction at the reference speed. Road Trip prices a trip at
 * its travel speed through this same model (tripEfficiency.js, SPEED_ONLY_MODE
 * when nothing else is corrected), so there is one speed model, not two;
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
 * ── Heating and cooling (#449) ───────────────────────────────────────────────
 *
 * Cold air is denser and costs more aero drag — about 6% of consumption at
 * 20°F versus 70°F — but a winter range test typically loses 20–40%, and most
 * of the rest is the heater. So every corrected mode also swaps the test's
 * ASSUMED accessory load (accessoryLoad.js: a base draw, plus a heater or A/C
 * outside a comfort band around 65°F) for the target's, converted to range
 * through the test's own consumption and its speed, because a heater costs
 * watts per hour, not watts per mile. A 20°F test corrected to 70°F gains
 * about 17% rather than the 7% of density alone.
 *
 * Built in two steps: the aero model above re-prices the traction share (its
 * ratio is the `tractionScale` accessoryFactor takes), and the accessory load
 * is swapped around it. The result is still the one factor both quantities
 * share.
 *
 * ── What this does NOT do ────────────────────────────────────────────────────
 *
 * No test records its heating or cooling, so BOTH loads are assumed, from the
 * temperature alone, as one line for every car. A heat pump draws about half a
 * resistive heater; the line is one answer for both. It is steady state: the
 * pull-down of a hot-soaked cabin is not in it, and neither are the battery
 * conditioning (folded into the line, not modelled apart), cold tyres, the
 * regen a cold pack refuses, or the extra cell resistance. Time spent stopped
 * is not counted, and the ramps are straight lines. Below freezing the error
 * in the assumed load is comparable to the effect, so a figure corrected from
 * or to 0–30°F is a rough one.
 *
 * Pure module — no React, no database.
 */

import {
    AERO_FRACTION, REFERENCE_SPEED_MPH, STANDARD_CONDITIONS, ASSUMED_TEST_CONDITIONS,
} from '../constants/epa';
import { airDensityRatio, temperatureDensityRatio, apparentAirspeed } from './epaDerivations';
import { assumedAccessoryW, effectiveAccessoryW, accessoryFactor } from './accessoryLoad';
import { val } from './calcTrace';

/**
 * Correction modes, in the order they appear in the picker. Each names what it
 * actually corrects, so a reader cannot infer a completeness the model lacks.
 *
 * The keys are in shared links (`corr=aero`), so they outlive the labels:
 * 'aero' still reads as the aero model even now that every corrected mode also
 * swaps the assumed accessory load. "Temp" in a label covers both of
 * temperature's effects, air density and heating or cooling (#449); there is
 * deliberately no mode that corrects one without the other.
 */
export const CORRECTION_MODES = [
    { key: 'none',      label: 'No correction',                 axes: [] },
    { key: 'aero',      label: 'Speed, altitude & temp',        axes: ['speed', 'altitude', 'temperature', 'accessory'] },
    { key: 'aero_wind', label: 'Speed, altitude, temp & wind',  axes: ['speed', 'altitude', 'temperature', 'wind', 'accessory'] },
];

export const DEFAULT_CORRECTION_MODE = 'none';

/**
 * The aero model on the speed axis alone. Not a reader's choice — no picker
 * offers it and no link can carry it (correctionSettings validates against
 * CORRECTION_MODES). It is how a trip is priced at its travel speed when the
 * reader corrects nothing, and how towing is always priced
 * (tripEfficiency.js): speed is the one condition a trip cannot leave as
 * tested.
 */
export const SPEED_ONLY_MODE = 'speed';

const modeAxes = (mode) => (mode === SPEED_ONLY_MODE
    ? ['speed']
    : CORRECTION_MODES.find(m => m.key === mode)?.axes ?? []);

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
        whPerMile:    consumptionWhPerMile(run),
    };
}

/**
 * The test's own consumption, in Wh/mi, or null when it recorded no energy (or
 * no distance). A heater's watts become range through this figure, so the test
 * that measured its consumption is corrected from it and one that did not is
 * corrected from ASSUMED_TEST_CONSUMPTION_WH_MI, and says so.
 */
function consumptionWhPerMile(run) {
    const kwh = Number(run?.energy_kwh);
    const miles = Number(run?.distance_miles);
    return kwh > 0 && miles > 0 ? (kwh * 1000) / miles : null;
}

/**
 * Aero-share road-load term at a given speed and air density. `airSpeedSq`,
 * when given, is the mean square of the speed through the AIR — the ground
 * speed with the wind added — and replaces the ground speed's square.
 */
function loadTerm(speedMph, densityRatio, aeroFraction, airSpeedSq = null, trace = null, label = 'Road load') {
    const vSq = (airSpeedSq ?? (speedMph ?? REFERENCE_SPEED_MPH) ** 2) / REFERENCE_SPEED_MPH ** 2;
    const load = aeroFraction * vSq * densityRatio + (1 - aeroFraction);
    trace?.step(label, {
        formula: airSpeedSq != null ? 'L = f × (v_air² / v_ref²) × ρ + (1 − f)' : 'L = f × (v / v_ref)² × ρ + (1 − f)',
        values: {
            f: val(aeroFraction, null, aeroFraction === AERO_FRACTION ? 'knob:AERO_FRACTION' : null),
            ...(airSpeedSq != null ? { 'v_air²': val(airSpeedSq, 'mph²') } : { v: val(speedMph ?? REFERENCE_SPEED_MPH, 'mph') }),
            v_ref: val(REFERENCE_SPEED_MPH, 'mph', 'knob:REFERENCE_SPEED_MPH'),
            ρ: densityRatio,
        },
        result: load, note: 'relative to the load at the reference speed in standard air',
    });
    return load;
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
 * @param {Object} conditions  { speedMph, speedBasis, altitudeFt, temperatureF, windMph, windDirDeg, whPerMile } as tested;
 *                              the wind is read only by a mode with the 'wind' axis, the consumption
 *                              only by one with 'accessory' (a blank takes ASSUMED_TEST_CONSUMPTION_WH_MI)
 * @param {Object} [opts]
 * @param {string} [opts.mode]         a CORRECTION_MODES key
 * @param {Object} [opts.target]       conditions to correct TO: { speedMph, altitudeFt, temperatureF }
 *                                     and optionally `accessoryW` (null = the temperature's own, "auto")
 * @param {number} [opts.aeroFraction] override, e.g. towing
 * @param {Object} [opts.assumed]      what a blank axis is taken as (ASSUMED_TEST_CONDITIONS)
 * @returns {{ factor: number, applied: string[], missing: string[], skipped: Array,
 *             assumed: Array<{ axis: string, value: number }>,
 *             assumedConsumptionWhMi: number|null }}
 *   `missing` lists every blank axis; `assumed` the ones corrected from an
 *   assumed value (wind is never assumed: a blank wind is calm air);
 *   `assumedConsumptionWhMi` is the consumption taken for a test that recorded
 *   no energy, null when it measured one
 */
export function correctionFactor(conditions, {
    mode = DEFAULT_CORRECTION_MODE,
    target = STANDARD_CONDITIONS,
    aeroFraction = AERO_FRACTION,
    assumed: assumedConditions = ASSUMED_TEST_CONDITIONS,
    trace = null,
} = {}) {
    const axes = modeAxes(mode);
    trace?.note(axes.length
        ? `Mode "${CORRECTION_MODES.find(m => m.key === mode)?.label}": corrects ${axes.join(', ')}`
        : 'Mode "No correction": the factor is 1 and nothing below applies');
    if (!axes.length) return { factor: 1, applied: [], missing: [], skipped: [], assumed: [], assumedConsumptionWhMi: null };

    const applied = [];
    const missing = [];
    const skipped = [];
    const assumed = [];

    // Correcting for speed assumes the test held one. Aero energy goes as the
    // MEAN OF v², while an average speed supplies the SQUARE OF THE MEAN, and
    // ⟨v²⟩ > ⟨v⟩² for any varying speed — so a mixed cycle reads as a gentle
    // steady cruise and gets over-penalised on the way to the reference speed.
    // Air density does not care what the speed trace looked like, so altitude
    // and temperature still apply.
    const mixedCycle = conditions?.speedBasis === 'mixed';

    // An axis the test records is corrected from what it recorded. A blank one
    // is corrected from the ASSUMED test conditions, never from the target:
    // taken as the target, a blank altitude looked like "no correction" but
    // re-priced the speed correction in the target's air, so moving the target
    // altitude shrank some tests and grew others (the owner caught it on the
    // range bars). An assumption is the same for every blank test and is named
    // in the note, and Data Checks lists the blanks so they get filled.
    const has = (axis, value) => {
        if (!axes.includes(axis)) return false;
        if (value == null || value === '') { missing.push(axis); return false; }
        applied.push(axis);
        return true;
    };
    const assume = (axis, key) => {
        if (!axes.includes(axis)) return target[key];
        assumed.push({ axis, value: assumedConditions[key] });
        return assumedConditions[key];
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

    // A mixed cycle's speed is SKIPPED, not blank: it has a speed, just not one
    // a correction can use, so it stands at the target and moves nothing.
    const runSpeed   = useSpeed ? Number(conditions.speedMph)
        : mixedCycle ? target.speedMph : assume('speed', 'speedMph');
    const runAlt     = useAlt  ? Number(conditions.altitudeFt)   : assume('altitude', 'altitudeFt');
    const runTemp    = useTemp ? Number(conditions.temperatureF) : assume('temperature', 'temperatureF');
    if (trace) {
        const srcOf = (used, axis) => (used ? 'data' : assumed.some(a => a.axis === axis) ? 'assumed' : 'setting');
        trace.step('The test\'s conditions', {
            values: {
                v_run: val(runSpeed, 'mph', mixedCycle ? 'setting' : srcOf(useSpeed, 'speed')),
                h_run: val(runAlt, 'ft', srcOf(useAlt, 'altitude')),
                T_run: val(runTemp, '°F', srcOf(useTemp, 'temperature')),
                ...(useWind ? { wind: val(Number(conditions.windMph), 'mph', 'data') } : {}),
            },
            assumed: assumed.length > 0,
            note: [
                ...assumed.map(a => `${a.axis} not recorded: assumed`),
                ...skipped.map(x => `${x.axis} not corrected (${x.reason})`),
            ].join(' · ') || null,
        });
        trace.step('The correction target', {
            values: {
                v_target: val(target.speedMph, 'mph', 'setting'),
                h_target: val(target.altitudeFt, 'ft', 'setting'),
                T_target: val(target.temperatureF, '°F', 'setting'),
            },
        });
    }
    const runAir = trace?.group('Air density at the test');
    const runDensity = airDensityRatio(runAlt, runAir) * temperatureDensityRatio(runTemp, runAir);
    runAir?.step('Air density ratio at the test', { formula: 'ρ_run = ρ_alt × ρ_T', values: { ρ_alt: airDensityRatio(runAlt), ρ_T: temperatureDensityRatio(runTemp) }, result: runDensity });

    const targetAir = trace?.group('Air density at the target');
    const targetDensity = airDensityRatio(target.altitudeFt, targetAir) * temperatureDensityRatio(target.temperatureF, targetAir);
    targetAir?.step('Air density ratio at the target', { formula: 'ρ_target = ρ_alt × ρ_T', values: { ρ_alt: airDensityRatio(target.altitudeFt), ρ_T: temperatureDensityRatio(target.temperatureF) }, result: targetDensity });

    const airSq    = useWind ? airSpeedSquared(runSpeed, Number(conditions.windMph), conditions.windDirDeg) : null;
    const atRun    = loadTerm(runSpeed,        runDensity,    aeroFraction, airSq, trace, 'Road load at the test');
    const atTarget = loadTerm(target.speedMph, targetDensity, aeroFraction, null,  trace, 'Road load at the target');
    if (!atRun || atRun <= 0) return { factor: 1, applied: [], missing, skipped, assumed: [], assumedConsumptionWhMi: null };

    // Consumption ratio inverted: a harder test (higher load) means the car
    // deserves a BETTER corrected efficiency than it measured.
    let factor = atRun / atTarget;
    trace?.step('Aero-only factor', { formula: 'k_aero = L_run / L_target', values: { L_run: atRun, L_target: atTarget }, result: factor });
    let assumedConsumptionWhMi = null;

    // The heater or A/C the test is assumed to have run, swapped for the
    // target's. It is priced at the test's own average moving speed, so a mixed
    // cycle — whose speed the aero axis cannot use — still has one to give.
    if (axes.includes('accessory')) {
        const heldSpeed = Number(conditions?.speedMph);
        const acc = trace?.group('Swap the accessory load (heating, cooling, base draw)');
        const accessory = accessoryFactor({
            consumptionWhMi: conditions?.whPerMile,
            runW:            assumedAccessoryW(runTemp, { trace: acc?.group('At the test') }),
            runSpeedMph:     heldSpeed > 0 ? heldSpeed : runSpeed,
            targetW:         effectiveAccessoryW(target, { trace: acc?.group('At the target') }),
            targetSpeedMph:  target.speedMph,
            tractionScale:   atTarget / atRun,
            trace:           acc,
        });
        if (accessory.factor == null) {
            trace?.note(`Accessory load not swapped (${accessory.skipped}): the aero-only factor stands`, { assumed: true });
            skipped.push({ axis: 'accessory', reason: accessory.skipped });
        } else {
            factor = accessory.factor;
            assumedConsumptionWhMi = accessory.assumedConsumptionWhMi;
            applied.push('accessory');
        }
    }

    return { factor, applied, missing, skipped, assumed, assumedConsumptionWhMi };
}

/**
 * One range test corrected, as the Range chart draws it: the factor, and the
 * distance it scales. Correcting the distance corrects range AND efficiency in
 * every unit, since both are linear in it, so the chart corrects nothing else.
 */
export function correctRunDistance(run, session, { mode, target } = {}, trace = null) {
    const result = correctionFactor(runConditions(run, session), { mode, target, trace: trace?.group('Correction factor') });
    const distanceMiles = run?.distance_miles != null ? run.distance_miles * result.factor : null;
    trace?.step('Corrected distance', {
        formula: 'd = d_test × k', values: { d_test: val(run?.distance_miles, 'mi', 'data'), k: result.factor },
        result: distanceMiles, unit: 'mi',
    });
    return { result, distanceMiles };
}

// An axis as a reader is told of it: the accessory term is "accessory load".
const axisName = (axis) => (axis === 'accessory' ? 'accessory load' : axis);

const ASSUMED_TEXT = {
    speed:       v => `${v} mph`,
    temperature: v => `${v}°F`,
    altitude:    v => `${v.toLocaleString('en-US')} ft`,
};

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
export function correctionNote({ factor, applied, missing, skipped, assumed = [], assumedConsumptionWhMi = null }) {
    // A skipped axis is worth saying even when nothing was corrected: "not
    // corrected because we cannot" is a different claim from "not corrected".
    if (!applied?.length && !skipped?.length && !assumed?.length) return null;

    const parts = [];
    const moved = [...(applied ?? []), ...assumed.map(a => a.axis)].map(axisName);
    if (moved.length) {
        const pct = (factor - 1) * 100;
        parts.push(`corrected ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% for ${moved.join(', ')}`);
    }
    for (const s of skipped ?? []) parts.push(`${axisName(s.axis)} not corrected (${s.reason})`);
    // The heater's watts became range through a consumption the test did not
    // record, so the figure leans on a stand-in, and says so.
    if (assumedConsumptionWhMi != null) parts.push(`consumption not recorded, taken as ${assumedConsumptionWhMi} Wh/mi`);
    // An assumed value is said every time it is used: it is a stand-in, and the
    // figure leans on it.
    for (const a of assumed) parts.push(`${a.axis} not recorded, taken as ${ASSUMED_TEXT[a.axis](a.value)}`);
    // A blank wind is calm air by decision, not a gap, so it goes unsaid.
    const unassumed = (missing ?? []).filter(m => m !== 'wind' && !assumed.some(a => a.axis === m));
    if (unassumed.length) parts.push(`no ${unassumed.join('/')} recorded`);
    return parts.join(' · ');
}
