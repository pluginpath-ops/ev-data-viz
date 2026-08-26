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
            { key: 'DEFAULT_ETA', label: 'Drivetrain efficiency η (fallback, HWFET)', kind: 'number',
              min: 0.50, max: 1.00, step: 0.001, unit: '',
              help: 'Used when no HWFET/DC phase data is available to back-solve η. On the HWFET basis, so it should sit near the observed median of that measure — which is NOT where a steady-state η sits.' },
            { key: 'DEFAULT_SS_ETA', label: 'Drivetrain efficiency η (fallback, steady state)', kind: 'number',
              min: 0.50, max: 1.00, step: 0.001, unit: '',
              help: 'The same fallback for a speed curve, which predicts steady cruise. A separate value because a steady-state η runs about 13% above a HWFET one on the same vehicle, so one number cannot stand in for both without being wrong for one of them.' },
            { key: 'DEFAULT_ACCESSORY_W', label: 'Accessory load', kind: 'number',
              min: 0, max: 2000, step: 25, unit: 'W',
              help: 'Constant parasitic draw (HVAC, electronics) assumed in the back-solve.' },
            { key: 'ASSUMED_CHARGER_EFF', label: 'Assumed charger efficiency', kind: 'number',
              min: 0.50, max: 1.00, step: 0.01, unit: '',
              help: 'AC→DC charging efficiency when measured AC recharge energy is unavailable.' },
            { key: 'HWFET_TO_SS_ETA_RATIO', label: 'HWFET → steady-state η ratio', kind: 'number',
              min: 1.00, max: 1.50, step: 0.0001, unit: '',
              help: 'How much higher a steady-state η runs than the HWFET one on the same vehicle — the fleet median across every group carrying both. For correcting a record with no constant-speed phase, where the alternative is being systematically 11% low. Flat rather than per-vehicle on purpose: correcting by each car’s own aerodynamics makes the spread worse, because the ratio is tight precisely because the aerodynamics cancel.' },
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
            { key: 'PACK_KWH_BAND', label: 'Traction pack energy band', kind: 'range',
              min: 0, max: 400, step: 5, unit: 'kWh',
              help: 'A pack outside this range is flagged as an import fault rather than a vehicle. CSI battery capacity is stated in amp-hours, and an amp-hour figure reaching a kWh column is what produced the 2–5 kWh records.' },
            { key: 'PHASE_SUM_TOLERANCE_PCT', label: 'Phase-sum tolerance', kind: 'number',
              min: 0, max: 10, step: 0.25, unit: '%',
              help: 'How far a test’s stated total DC energy may sit from the sum of its own phases. They are one measurement reported twice, so a gap means a phase is missing or mistyped.' },
            { key: 'SS_CYCLE_SPEED_MPH', label: 'Steady-state cycle speed', kind: 'number',
              min: 30, max: 90, step: 1, unit: 'mph',
              help: 'The speed J1634 specifies for the multi-cycle constant-speed section, and the anchor the steady-state η is back-solved at. The CSI does not restate it per test, so override it only for a report that says otherwise. It moves η a long way — the MY2027 CLA 350 reads 0.839 at 60 mph and 0.918 at 65 from identical phase data.' },
        ],
    },
];

/** All knob keys, flattened. */
export const KNOB_KEYS = KNOB_GROUPS.flatMap(g => g.knobs.map(k => k.key));

/** Pristine default for a knob key (from EPA_DEFAULTS). */
export const knobDefault = (key) => EPA_DEFAULTS[key];
