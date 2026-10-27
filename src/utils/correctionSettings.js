/**
 * The reader's correction setting: one for the whole site.
 *
 * What to correct for (the mode, a CORRECTION_MODES key) and what to correct
 * TO (speed, temperature, altitude and accessory load, in calm air). Every chart that re-prices a
 * range test and the vehicle table's composite range read this one setting, so
 * a reader who sets 65 mph at 1,000 ft sees every corrected figure on that
 * basis, and a shared link carries it.
 *
 * It lives in App's chartConfig, beside the color settings, so it rides the
 * pop-out sync; it is written to the URL in one place (App) under `corr`,
 * `c_spd`, `c_tmp`, `c_alt` and `c_acc`, each only when it differs from the
 * default.
 *
 * The target defaults to the site's standard conditions (constants/epa.js,
 * an Admin knob), so an untouched setting is what every corrected figure used
 * before the reader could set it.
 *
 * The mode defaults to CORRECTED, for everything the model can (owner's call,
 * 2026-10-21). It used to default to none, on the argument that correcting
 * should be a deliberate act; but uncorrected, two tests read differently for
 * reasons that have nothing to do with the cars, and a reader who never opens
 * the control was comparing days, not vehicles. Turning it off is now the
 * deliberate act, and a link that turned it off says `corr=none`.
 *
 * Not conditionCorrection's DEFAULT_CORRECTION_MODE, which stays none: that is
 * what correctionFactor does when a caller names no mode, and a function that
 * silently corrected would be the opposite of its rule.
 *
 * The accessory load is `accessoryW`, and `null` means AUTO: the load the
 * temperature implies (accessoryLoad.js effectiveAccessoryW). The auto value is
 * never stored — only what the reader set — so moving the temperature slider
 * keeps moving the load until they take it over, and `c_acc` is written only
 * then.
 *
 * Temperature is corrected for air density and for the heating or cooling a
 * test is assumed to have used. Neither is a measurement, so a figure corrected
 * to or from an extreme is a rough one, and roughest below freezing; the sliders
 * reach 0–100°F and 8,000 ft all the same, because the reader is entitled to ask
 * and the controls say what the answer is worth.
 *
 * Pure module — no React.
 */
import { STANDARD_CONDITIONS } from '../constants/epa';
import { CORRECTION_MODES } from './conditionCorrection';
import { convValue } from './unitConversions';

/** Each target's slider, in mph, °F, ft and W whatever the reader's units. */
export const CORRECTION_TARGET_RANGES = {
    speedMph:     { min: 45,  max: 90,   step: 5 },
    temperatureF: { min: 0,   max: 100,  step: 5 },
    altitudeFt:   { min: 0,   max: 8000, step: 250 },
    accessoryW:   { min: 250, max: 5000, step: 50 },
};

/** The standard conditions, with the accessory load on auto. */
export const DEFAULT_CORRECTION_TARGET = { ...STANDARD_CONDITIONS, accessoryW: null };

/** The mode an untouched page corrects for: everything the model can. */
export const DEFAULT_READER_MODE = 'aero_wind';

const PARAMS = { speedMph: 'c_spd', temperatureF: 'c_tmp', altitudeFt: 'c_alt', accessoryW: 'c_acc' };

/**
 * A target held to its sliders, missing or unreadable values defaulted — for
 * the accessory load that is auto (`null`), so `c_acc=auto` and `c_acc=abc` are
 * auto. Held to the step too, so a hand-edited link cannot ask for 67.3 mph.
 * The default itself is not clamped: an Admin who publishes a standard outside
 * a slider still gets it on an untouched page.
 */
export function normalizeCorrectionTarget(target = DEFAULT_CORRECTION_TARGET) {
    return Object.fromEntries(Object.entries(CORRECTION_TARGET_RANGES).map(([key, { min, max, step }]) => {
        const raw = target?.[key];
        const n = Number(raw);
        if (raw == null || raw === '' || !Number.isFinite(n) || n === DEFAULT_CORRECTION_TARGET[key]) {
            return [key, DEFAULT_CORRECTION_TARGET[key]];
        }
        return [key, Math.min(max, Math.max(min, Math.round(n / step) * step))];
    }));
}

const normalizeMode = (mode) => (CORRECTION_MODES.some(m => m.key === mode) ? mode : DEFAULT_READER_MODE);

/** Whether the target differs from the standard conditions, for a control's "reset". */
export const targetDiffers = (target) => {
    const t = normalizeCorrectionTarget(target);
    return Object.keys(PARAMS).some(k => t[k] !== DEFAULT_CORRECTION_TARGET[k]);
};

/** The setting as query parameters: only what differs from the default. */
export function encodeCorrection({ mode, target } = {}) {
    const out = [];
    const m = normalizeMode(mode);
    if (m !== DEFAULT_READER_MODE) out.push(['corr', m]);
    const t = normalizeCorrectionTarget(target);
    for (const [key, param] of Object.entries(PARAMS)) {
        if (t[key] !== DEFAULT_CORRECTION_TARGET[key]) out.push([param, String(t[key])]);
    }
    return out;
}

// The target is held in mph, °F and ft, and shown in the reader's units.
export const speedText = (mph, units) => `${Math.round(convValue(mph, 'speed', units))} ${units === 'metric' ? 'km/h' : 'mph'}`;
export const tempText = (f, units) => (units === 'metric' ? `${Math.round((f - 32) * 5 / 9)}°C` : `${f}°F`);
export const altitudeText = (ft, units) => `${Math.round(convValue(ft, 'feet', units)).toLocaleString('en-US')} ${units === 'metric' ? 'm' : 'ft'}`;
export const accessoryText = (w) => `${Math.round(w).toLocaleString('en-US')} W`;

/**
 * "70 mph · 70°F · 0 ft" — the target as a summary or an exported caption
 * states it. The accessory load is named only when the reader set it: on auto
 * it follows the temperature, which the text already gives.
 *
 * @param {string[]} [fields]  which conditions to state, as
 *   CorrectionTargetFields offers them. A chart that hides a slider must not
 *   print the value it hid. Unset states all four.
 */
export function correctionTargetText(target, units = 'imperial', fields = null) {
    const t = normalizeCorrectionTarget(target);
    const shows = (key) => !fields || fields.includes(key);
    const parts = [];
    if (shows('speedMph')) parts.push(speedText(t.speedMph, units));
    if (shows('temperatureF')) parts.push(tempText(t.temperatureF, units));
    if (shows('altitudeFt')) parts.push(altitudeText(t.altitudeFt, units));
    if (shows('accessoryW') && t.accessoryW != null) parts.push(accessoryText(t.accessoryW));
    return parts.join(' · ');
}

/**
 * The correction as a chart's caption states it: "no correction", or what was
 * corrected and to what, so an exported image never passes a corrected figure
 * off as measured, nor hides the conditions it was moved to.
 */
export function correctionCaption(mode, target, units = 'imperial') {
    if (!mode || mode === 'none') return 'no correction';
    const label = CORRECTION_MODES.find(m => m.key === mode)?.label ?? mode;
    return `corrected for ${label.replace(/ \(aero\)$/, '').toLowerCase()} to ${correctionTargetText(target, units)}`;
}

/**
 * The correction in a few words, for a collapsed sidebar section: closing the
 * section must never hide that the figures have been moved.
 * `fields` is passed through to correctionTargetText.
 */
export function correctionSummary(mode, target, units = 'imperial', fields = null) {
    if (!mode || mode === 'none') return 'no correction';
    return `to ${correctionTargetText(target, units, fields)}`;
}

/** The reverse. Total: anything unreadable is the default. */
export function decodeCorrection(search) {
    const p = new URLSearchParams(search ?? '');
    return {
        mode: normalizeMode(p.get('corr')),
        target: normalizeCorrectionTarget(Object.fromEntries(
            Object.entries(PARAMS).map(([key, param]) => [key, p.get(param)]),
        )),
    };
}
