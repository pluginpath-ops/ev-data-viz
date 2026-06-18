/**
 * UI metadata for the tunable-constant "knobs" shown in the Admin panel.
 *
 * Defaults are NOT redefined here — they come from EPA_DEFAULTS in constants/epa.js
 * (single source of truth). This file only describes how to render and bound each
 * knob (label, help text, input kind, min/max/step).
 *
 * kind:
 *   'number' → single scalar (an input[type=number])
 *   'range'  → a [min, max] pair (two number inputs)
 */
import { EPA_DEFAULTS } from './epa';

export const KNOB_GROUPS = [
    {
        title: 'EPA model assumptions',
        blurb: 'The genuine tunables in the efficiency back-solve. Changing these shifts every derived curve.',
        knobs: [
            { key: 'DEFAULT_ETA', label: 'Drivetrain efficiency η (fallback)', kind: 'number',
              min: 0.50, max: 1.00, step: 0.01, unit: '',
              help: 'Used when no HWFET/DC phase data is available to back-solve η.' },
            { key: 'DEFAULT_ACCESSORY_W', label: 'Accessory load', kind: 'number',
              min: 0, max: 2000, step: 25, unit: 'W',
              help: 'Constant parasitic draw (HVAC, electronics) assumed in the back-solve.' },
            { key: 'ASSUMED_CHARGER_EFF', label: 'Assumed charger efficiency', kind: 'number',
              min: 0.50, max: 1.00, step: 0.01, unit: '',
              help: 'AC→DC charging efficiency when measured AC recharge energy is unavailable.' },
        ],
    },
    {
        title: 'Sanity bands & curve extent',
        blurb: 'Bounds for the Section-8 "out of band" flags and the speed range the curve is plotted over.',
        knobs: [
            { key: 'ETA_BAND', label: 'η valid band', kind: 'range',
              min: 0.50, max: 1.00, step: 0.01, unit: '',
              help: 'A derived η outside this range is flagged.' },
            { key: 'CHARGER_EFF_BAND', label: 'Charger-efficiency valid band', kind: 'range',
              min: 0.50, max: 1.00, step: 0.01, unit: '',
              help: 'A derived charger efficiency outside this range is flagged.' },
            { key: 'SS_SPEED_BAND', label: 'Steady-state speed band', kind: 'range',
              min: 30, max: 90, step: 1, unit: 'mph',
              help: 'An implied steady-state cycle speed outside this range is flagged.' },
            { key: 'CURVE_SPEED_RANGE', label: 'Curve speed range', kind: 'range',
              min: 0, max: 160, step: 5, unit: 'mph',
              help: 'Lowest/highest speed the efficiency curve is computed over.' },
        ],
    },
];

/** All knob keys, flattened. */
export const KNOB_KEYS = KNOB_GROUPS.flatMap(g => g.knobs.map(k => k.key));

/** Pristine default for a knob key (from EPA_DEFAULTS). */
export const knobDefault = (key) => EPA_DEFAULTS[key];
