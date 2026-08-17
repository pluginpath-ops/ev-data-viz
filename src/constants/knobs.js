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
        title: 'Condition correction',
        blurb: 'How a measured range or efficiency figure is re-priced to a common basis. The aero fraction drives every correction magnitude: at 0.70 a 70→80 mph correction is +21%, at 0.60 it is ~18%.',
        knobs: [
            { key: 'AERO_FRACTION', label: 'Aero fraction at reference speed', kind: 'number',
              min: 0.30, max: 0.95, step: 0.01, unit: '',
              help: 'Share of energy spent on aerodynamic drag at the reference speed, unladen. One value for every vehicle — a slippery sedan and a boxy SUV genuinely differ, so this is an average rather than a truth.' },
            { key: 'TOWING_AERO_FRACTION', label: 'Aero fraction when towing', kind: 'number',
              min: 0.30, max: 0.99, step: 0.01, unit: '',
              help: 'A trailer roughly doubles Cd×A, so aero dominates further. Used by the road-trip simulator.' },
            { key: 'REFERENCE_SPEED_MPH', label: 'Reference speed', kind: 'number',
              min: 30, max: 100, step: 1, unit: 'mph',
              help: 'The speed the aero fraction is quoted at. Changing it rescales what that fraction means.' },
        ],
    },
    {
        title: 'Standard conditions',
        blurb: 'The basis every corrected figure is re-priced TO. Not the same as the ISA 59°F reference the density formula is built on, which is physics rather than a choice.',
        knobs: [
            { key: 'STD_SPEED_MPH', label: 'Standard speed', kind: 'number',
              min: 30, max: 100, step: 1, unit: 'mph',
              help: 'Corrected figures are stated as though driven at this speed.' },
            { key: 'STD_ALTITUDE_FT', label: 'Standard altitude', kind: 'number',
              min: -500, max: 10000, step: 100, unit: 'ft',
              help: 'Corrected figures are stated as though at this elevation.' },
            { key: 'STD_TEMP_F', label: 'Standard temperature', kind: 'number',
              min: -20, max: 120, step: 1, unit: '°F',
              help: 'Corrected figures are stated as though at this ambient temperature. Only the AIR-DENSITY effect of temperature is modelled — cabin heating and battery conditioning are not.' },
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
            { key: 'LABEL_RANGE_TOLERANCE_PCT', label: 'Label vs spec range tolerance', kind: 'number',
              min: 0, max: 25, step: 0.5, unit: '%',
              help: 'How far an EPA label range may sit from the vehicle spec range before the curator form flags it. One trim can map to several EPA configurations a few miles apart, so a small gap is normal.' },
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
