// Conversion factors live in src/constants/units.js (single source of truth);
// re-exported here so existing `… from './unitConversions'` imports keep working.
import {
    MI_TO_KM, IN_TO_MM, LBS_TO_KG, CUFT_TO_L, LBFT_TO_NM, FT_TO_M, HP_TO_KW,
    MPG_E_CONVERSION,
} from '../constants/units';

export {
    MI_TO_KM, IN_TO_MM, LBS_TO_KG, CUFT_TO_L, LBFT_TO_NM, FT_TO_M, HP_TO_KW,
    MPG_E_CONVERSION,
};

// ── Formatted strings (value + unit label) ────────────────────────────────
//
// Both branches round. The metric ones always did — a conversion produces a
// long float, so rounding was unavoidable there — while the imperial ones
// interpolated the stored number raw, which was fine only for as long as every
// value was one a human had typed. It isn't any more: an inherited run's
// distance is `stored × its link's factors`, which renders as 59.059000000000005.
// r1 is lossless for anything already at one decimal, so this clamps the
// computed values without touching the entered ones.

export const fmtDistance  = (mi,   sys) => sys === 'metric' ? `${r1(mi * MI_TO_KM)} km`           : `${r1(mi)} mi`;
export const fmtSpeed     = (mph,  sys) => sys === 'metric' ? `${r1(mph * MI_TO_KM)} kph`          : `${r1(mph)} mph`;
/**
 * A run's speed basis, when it needs one: an average over a varying-speed cycle
 * rather than a held setpoint.
 *
 * Deliberately its OWN string rather than a suffix on the speed. Chart bar
 * pills are dropped WITHOUT TRACE when wider than the bar, so lengthening the
 * speed made the whole pill vanish on a narrow bar — the marker cost the reader
 * the number it was meant to qualify. A separate short pill cannot do that.
 */
export const speedBasisNote = (run) =>
    run?.speed_basis === 'mixed' ? 'mixed cycle' : null;

export const fmtTemp      = (degF, sys) => sys === 'metric' ? `${r1((degF - 32) * 5 / 9)}°C`       : `${r1(degF)}°F`;
export const fmtWeight    = (lbs,  sys) => sys === 'metric' ? `${r1(lbs * LBS_TO_KG)} kg`          : `${r1(lbs)} lbs`;
export const fmtVolume    = (cuft, sys) => sys === 'metric' ? `${r1(cuft * CUFT_TO_L)} L`          : `${r1(cuft)} cu ft`;
export const fmtDimension = (in_,  sys) => sys === 'metric' ? `${Math.round(in_ * IN_TO_MM)} mm`   : `${r1(in_)} in`;
export const fmtTorque    = (lbft, sys) => sys === 'metric' ? `${r1(lbft * LBFT_TO_NM)} Nm`       : `${r1(lbft)} lb-ft`;
export const fmtPower     = (hp,   sys) => sys === 'metric' ? `${r1(hp * HP_TO_KW)} kW`             : `${r1(hp)} hp`;

// ── Raw conversions (no label) — for chart data values ────────────────────

export const convDistance = (mi,   sys) => sys === 'metric' ? r1(mi * MI_TO_KM)        : mi;
export const convSpeed    = (mph,  sys) => sys === 'metric' ? r1(mph * MI_TO_KM)        : mph;
export const convTemp     = (degF, sys) => sys === 'metric' ? r1((degF - 32) * 5 / 9)  : degF;

// ── Unit label strings ────────────────────────────────────────────────────

export const distanceLabel = sys => sys === 'metric' ? 'km'  : 'mi';
export const speedLabel    = sys => sys === 'metric' ? 'kph' : 'mph';
export const tempLabel     = sys => sys === 'metric' ? '°C'  : '°F';

// ── Efficiency ────────────────────────────────────────────────────────────

export function effOptions(sys) {
    return sys === 'metric'
        ? [{ value: 'mi_kwh', label: 'km/kWh' }, { value: 'wh_mi', label: 'kWh/100km' }]
        : [{ value: 'mi_kwh', label: 'mi/kWh' }, { value: 'wh_mi', label: 'Wh/mi'     }];
}

export function calcEff(distMi, energyKwh, effUnit, sys) {
    if (!energyKwh || !distMi || energyKwh <= 0 || distMi <= 0) return null;
    if (sys === 'metric') {
        const km = distMi * MI_TO_KM;
        return effUnit === 'wh_mi'
            ? r2(energyKwh * 100 / km)   // kWh/100km
            : r2(km / energyKwh);         // km/kWh
    }
    return effUnit === 'wh_mi'
        ? r1(energyKwh * 1000 / distMi)  // Wh/mi
        : r2(distMi / energyKwh);         // mi/kWh
}

export const effLabel = (effUnit, sys) =>
    sys === 'metric'
        ? (effUnit === 'wh_mi' ? 'kWh/100km' : 'km/kWh')
        : (effUnit === 'wh_mi' ? 'Wh/mi'     : 'mi/kWh');

// ── Raw conversion via unitGroup (no label) — for chart data ─────────────

export function convValue(value, unitGroup, sys) {
    if (value == null || sys === 'imperial') return value;
    switch (unitGroup) {
        case 'distance':  return r1(value * MI_TO_KM);
        case 'speed':     return r1(value * MI_TO_KM);
        case 'weight':    return r1(value * LBS_TO_KG);
        case 'volume':    return r1(value * CUFT_TO_L);
        case 'dimension': return Math.round(value * IN_TO_MM);
        case 'torque':    return r1(value * LBFT_TO_NM);
        case 'power':     return r1(value * HP_TO_KW);
        case 'feet':      return r1(value * FT_TO_M);
        default:          return value;
    }
}

// ── Spec field formatting via unitGroup ───────────────────────────────────

export function formatSpecValue(value, unitGroup, sys) {
    if (value == null) return '—';
    switch (unitGroup) {
        case 'distance':  return fmtDistance(value, sys);
        case 'speed':     return fmtSpeed(value, sys);
        case 'weight':    return fmtWeight(value, sys);
        case 'volume':    return fmtVolume(value, sys);
        case 'dimension': return fmtDimension(value, sys);
        case 'torque':    return fmtTorque(value, sys);
        case 'power':     return fmtPower(value, sys);
        case 'feet':      return sys === 'metric' ? `${r1(value * FT_TO_M)} m` : `${r1(value)} ft`;
        default:          return String(value);
    }
}

// ── MPGe (Miles Per Gallon equivalent) ───────────────────────────────────────

/**
 * Convert mi/kWh to MPGe (Miles Per Gallon equivalent).
 * MPGe = (mi/kWh) × 33.705 kWh/gal
 * @param {number|null} miPerKwh
 * @returns {number|null}
 */
export function miKwhToMpge(miPerKwh) {
    if (miPerKwh == null) return null;
    return Math.round(miPerKwh * MPG_E_CONVERSION * 10) / 10;
}

// ── Rounding ──────────────────────────────────────────────────────────────────

/** Round to a given number of decimal places. Returns null for null/NaN input. */
export function roundTo(value, decimals) {
    if (value == null) return null;
    const n = Number(value);
    if (isNaN(n)) return null;
    return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

// Internal shorthands used throughout this file
function r1(v) { return Math.round(v * 10) / 10; }
function r2(v) { return Math.round(v * 100) / 100; }
