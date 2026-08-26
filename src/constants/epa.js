/**
 * EPA model constants — the single place to tune the EPA math.
 *
 * Physical constants, tunable assumptions, sanity bands, drive-cycle definitions
 * and unit-detection thresholds for the EPA subsystem. Leaf module: imports only
 * from constants/units (no app deps), so it can't create import cycles even
 * though epaPhysics / epaDerivations / the parsers all depend on it.
 */
import { MPG_E_CONVERSION } from './units';
import { resolve } from './overrides';
export { MPG_E_CONVERSION };

// ── Physical constants (NOT tunable — physical/definitional facts) ───────────
/** lbf·mile → kWh: 4.44822 N/lbf × 1609.34 m/mi ÷ 3.6e6 J/kWh. */
export const LBF_MILE_TO_KWH  = 0.001989;
export const HWFET_AVG_MPH    = 48.3;        // HWFET cycle average speed (η anchor)
export const UDDS_AVG_MPH     = 19.6;        // UDDS cycle average speed
export const US06_AVG_MPH     = 48.4;
export const HIGHWAY_BAND_MPH = [65, 75];    // reference band drawn on the curve

// EPA label arithmetic (#206). Regulatory definitions, so they live up here with
// the physical facts rather than in the tunable block below — changing them does
// not model the world differently, it computes a different number than the one
// on the window sticker.
export const LABEL_ADJUSTMENT   = 0.7;       // fixed adjustment applied to unadjusted range
export const LABEL_WEIGHT_CITY  = 0.55;
export const LABEL_WEIGHT_HWY   = 0.45;

/**
 * The five EPA drive cycles, and what each one exists to capture.
 *
 * Two of them — FTP-75 and HWFET — are what a two-cycle test actually drives.
 * The other three are the conditions the 0.7 factor stands in for when they are
 * NOT driven: hard acceleration and sustained high speed (US06), air
 * conditioning against a hot ambient and solar load (SC03), and cold-weather
 * operation (Cold FTP). That is what the factor means, and it is why it is a
 * blanket 30% haircut rather than a measurement.
 *
 * `schedule` names the underlying driving trace, which is where the vocabulary
 * gets confusing: a BEV multi-cycle test reports UDDS and HWY phases, and those
 * are the same traces as the FTP-75 city and HWFET highway tests. UDDS is one
 * run of the city trace (19.6 mph average); FTP-75 is the label test built from
 * it, which repeats the first segment hot and averages 21.2 mph as a result.
 */
export const DRIVE_CYCLES = {
    ftp75: {
        label: 'FTP-75 city', schedule: 'UDDS trace, cold + hot start',
        avgMph: 21.2, maxMph: 56.7, tempF: 75, condition: 'cold start',
    },
    hwfet: {
        label: 'HWFET highway', schedule: 'HWY phases',
        avgMph: 48.3, maxMph: 59.9, tempF: 75, condition: 'warm',
    },
    us06: {
        label: 'US06', schedule: 'aggressive supplemental',
        avgMph: 48.4, maxMph: 80.3, tempF: 75, condition: 'hard acceleration, high speed',
    },
    sc03: {
        label: 'SC03', schedule: 'air-conditioning supplemental',
        avgMph: 21.6, maxMph: 54.8, tempF: 95, condition: 'A/C + solar load',
    },
    coldFtp: {
        label: 'Cold FTP', schedule: 'UDDS trace at 20°F',
        avgMph: 21.2, maxMph: 56.7, tempF: 20, condition: 'cold start',
    },
};

/** The two a two-cycle test drives; the rest are priced by LABEL_ADJUSTMENT. */
export const TWO_CYCLE_KEYS = ['ftp75', 'hwfet'];
export const FIVE_CYCLE_KEYS = ['ftp75', 'hwfet', 'us06', 'sc03', 'coldFtp'];

/**
 * Derived-5-cycle regression, the alternative to the flat 0.7 factor.
 *
 * Fitted on gasoline vehicles. The intercept is a fixed cost in the INVERSE
 * domain, so it does not scale with efficiency — see utils/epaMethodology.js
 * for what that does to an efficient EV. Encoded, and flagged unvalidated
 * against any real EV record (#206).
 */
export const DERIVED_5CYCLE = {
    city: { intercept: 0.003259, slope: 1.1805 },
    hwy:  { intercept: 0.001376, slope: 1.3466 },
};

/**
 * Roughly what each certification path costs in lab time.
 *
 * ⚠ PROVENANCE: these are curator estimates (#206), NOT sourced from EPA
 * documentation, and they are presented as relative magnitudes for that reason.
 * What can be checked is the SHAPE, and it holds:
 *
 *   • SCT ≈ 2 × MCT because it is literally two depletion runs where MCT is
 *     one — each needing its own soak, full depletion and full recharge
 *     measurement.
 *   • 5-cycle is much larger than either because US06, SC03 and cold FTP each
 *     need the vehicle thermally conditioned to a different cell — 20°F for the
 *     cold FTP, 95°F with solar load for SC03 — and conditioning a pack to
 *     soak temperature dominates the clock, not the driving.
 *
 * The absolute figures are unverified. Treat them as "one day / a couple of
 * days / most of a week", which is the comparison the diagram needs anyway.
 *
 * PER CONFIGURATION, which is the multiplier that matters: certification is per
 * test group and vehicle configuration, not per model. Our own schema says so —
 * epa_test_groups is keyed by test_group_id + vehicle_config_number, and the R2
 * fixture is specifically the 20" AT variant. A model line with several packs,
 * drive layouts and wheel sizes multiplies every figure below.
 */
export const PATH_EFFORT = {
    mct:        '~1 day',
    sct:        '~2 days',
    five_cycle: '~1 week',
};

// ── Tunable knobs: pristine defaults ────────────────────────────────────────
// Single source of truth for the adjustable model assumptions and sanity bands.
// The Admin "Model Constants" panel (src/components/admin/ConstantsKnobs.jsx)
// reads these as the reset baseline.
//
// Each resolved export below is the default UNLESS an override sits over it:
// this browser's local sandbox first, then the value an admin published to the
// site (#261), then this file. Both override layers are read ONCE, here, at
// module load — the site layer is seeded before the app's module graph loads
// (src/main.jsx) precisely so that stays true. A change of either kind applies
// on the next page reload.
export const EPA_DEFAULTS = {
    // assumptions
    // Fallback drivetrain efficiency on the HWFET basis, from the fleet median
    // of the measured values. Was 0.88, which sat outside the observed
    // p5-p95 of 0.763-0.865 — a fallback only ever appears on records that
    // could not be derived, so nothing on screen ever contradicted it and the
    // statistics exclude it by design. The knob panel now shows this measure's
    // distribution beside the value, which is what surfaced the gap.
    DEFAULT_ETA:         0.826,
    // The same fallback on the CRUISE basis, for a speed curve with no phases
    // to derive from. A separate constant because the two are not the same
    // quantity: a steady-state η runs ~13% above a HWFET one on the same
    // vehicle, so one number cannot stand in for both without being wrong for
    // one of them. Fleet median of the measured steady-state values.
    DEFAULT_SS_ETA:      0.929,
    DEFAULT_ACCESSORY_W: 300,         // constant accessory draw, watts
    // Used when AC recharge energy is unavailable. Was 0.88 from a read of CSI
    // observations (~0.87–0.89); now 0.855, from the two cert records where BOTH
    // sides are reported and the ratio is measured rather than inferred:
    //   Rivian R2 (MCT)        89,549.27 DC / 104,689 AC = 85.5%
    //   Ford Lightning ER (SCT) ~131 kWh usable / 152.974 = 85.6%
    // Refine as more MCT records with real DC energy accumulate (#206).
    ASSUMED_CHARGER_EFF: 0.855,
    // Condition correction (#188). The aero/rolling split is what lets a
    // measurement be re-priced for speed and air density without per-vehicle
    // road-load coefficients — see utils/conditionCorrection.js. These moved
    // here from roadTripSimulation.js when a second consumer appeared.
    AERO_FRACTION:        0.70,   // energy share from aero at the reference speed, unladen
    TOWING_AERO_FRACTION: 0.85,   // a trailer roughly doubles Cd×A
    REFERENCE_SPEED_MPH:  70,     // the speed the aero fraction is quoted at

    // What "standard conditions" means when correcting. NOT the same as
    // STANDARD_TEMP_F (59°F), which is the ISA sea-level reference the density
    // formula itself is built on and is not a product choice.
    STD_SPEED_MPH:   70,
    STD_ALTITUDE_FT: 0,
    STD_TEMP_F:      70,

    // How far the EPA label range may sit from the vehicle's spec range before
    // the curator form flags it. NOT a tie between the fields: one vehicle trim
    // legitimately maps to several EPA configurations — different wheels, tyres
    // or a carry-over year — and those differ by a few miles without either
    // number being wrong.
    //
    // 5% tolerates that (a few miles on a 300-mile car) while still catching the
    // failure worth catching: a link to the wrong pack or a mistyped figure,
    // which are usually tens of miles out. Tunable because the right threshold
    // is a curation judgement, not a fact.
    LABEL_RANGE_TOLERANCE_PCT: 5,

    // sanity bands (Section-8 flags) + curve extent
    ETA_BAND:          [0.75, 0.92],
    CHARGER_EFF_BAND:  [0.80, 0.92],
    SS_SPEED_BAND:     [55, 70],      // mph
    CURVE_SPEED_RANGE: [5, 120],      // mph, inclusive

    // What a battery-electric traction pack can plausibly hold. Deliberately
    // wide: the job is catching an import that read the wrong field, not
    // judging a pack. A bulk import of every MY2026 CSI produced records at
    // 2-5 kWh — an aux battery or an amp-hour figure landing in a kWh column —
    // and nothing said so.
    PACK_KWH_BAND: [20, 250],

    // How far a test's stated total DC energy may sit from the sum of its own
    // phases. They are the same measurement reported twice, so they should
    // agree to rounding; anything larger means a phase is missing or mistyped.
    PHASE_SUM_TOLERANCE_PCT: 1,

    // How much higher a steady-state η runs than the HWFET one on the same
    // vehicle, for correcting a record that has no constant-speed phase.
    //
    // MEASURED, not chosen: the fleet median of ss_eta / eta across 210
    // certification groups that carry both. IQR 1.1162-1.1449, so half the
    // fleet sits within 2.5% of this and the full observed range is
    // 1.0647-1.2830.
    //
    // Worth knowing what it is worth. Applying it to a group with no
    // constant-speed phase lands within a few percent for the middle of the
    // fleet and 13.7% out at the extreme — against a guaranteed 11.4% low, in
    // one direction, for every such vehicle if it is not applied at all.
    //
    // A FLAT factor, deliberately. The ratio decomposes into a road-load shape
    // term computable from the coefficients and a remainder, and the obvious
    // improvement — correct each vehicle by its own aerodynamics — makes it
    // WORSE: the remainder scatters at 5.3% against the raw ratio's 2.5%,
    // because the two halves encode the same aerodynamics and cancel. The ratio
    // is tight precisely because that cancellation happens.
    //
    // Make medians run 1.081 to 1.173, so a class or make refinement is
    // available later. Two badges of one car agree to 0.3% — Toyota 1.0844
    // against Subaru 1.0811, the bZ4X and Solterra — which is the best
    // repeatability check the corpus offers.
    HWFET_TO_SS_ETA_RATIO: 1.1281,

    // The speed the multi-cycle constant-speed section is driven at.
    //
    // SPECIFIED, not assumed. J1634 sets the constant-speed section at 65 mph,
    // which is why this drives a derivation rather than only a sanity check.
    // The CSI does not restate it per test, so it stays a knob: a manufacturer
    // that deviated, or a report that says otherwise, is a curator override
    // rather than a reason to distrust the whole derivation.
    //
    // It moves η a long way, so it is worth knowing what changed. The MY2027
    // CLA 350 reads 0.839 at 60 and 0.918 at 65 from identical phase data —
    // this was 60 while the speed was a guess, and correcting it raises every
    // steady-state η by roughly eight points.
    SS_CYCLE_SPEED_MPH: 65,
};

// Resolved values (override ∥ default). These are what the math imports.
export const DEFAULT_ETA         = resolve('DEFAULT_ETA',         EPA_DEFAULTS.DEFAULT_ETA);
export const DEFAULT_SS_ETA      = resolve('DEFAULT_SS_ETA',      EPA_DEFAULTS.DEFAULT_SS_ETA);
export const DEFAULT_ACCESSORY_W = resolve('DEFAULT_ACCESSORY_W', EPA_DEFAULTS.DEFAULT_ACCESSORY_W);
export const ACCESSORY_LOAD_KW   = DEFAULT_ACCESSORY_W / 1000;  // derived (kW)
export const ASSUMED_CHARGER_EFF = resolve('ASSUMED_CHARGER_EFF', EPA_DEFAULTS.ASSUMED_CHARGER_EFF);
export const AERO_FRACTION        = resolve('AERO_FRACTION',        EPA_DEFAULTS.AERO_FRACTION);
export const TOWING_AERO_FRACTION = resolve('TOWING_AERO_FRACTION', EPA_DEFAULTS.TOWING_AERO_FRACTION);
export const REFERENCE_SPEED_MPH  = resolve('REFERENCE_SPEED_MPH',  EPA_DEFAULTS.REFERENCE_SPEED_MPH);

/** The basis every corrected figure is re-priced to. */
export const STANDARD_CONDITIONS = {
    speedMph:     resolve('STD_SPEED_MPH',   EPA_DEFAULTS.STD_SPEED_MPH),
    altitudeFt:   resolve('STD_ALTITUDE_FT', EPA_DEFAULTS.STD_ALTITUDE_FT),
    temperatureF: resolve('STD_TEMP_F',      EPA_DEFAULTS.STD_TEMP_F),
};

export const LABEL_RANGE_TOLERANCE_PCT = resolve('LABEL_RANGE_TOLERANCE_PCT', EPA_DEFAULTS.LABEL_RANGE_TOLERANCE_PCT);
export const ETA_BAND          = resolve('ETA_BAND',          EPA_DEFAULTS.ETA_BAND);
export const CHARGER_EFF_BAND  = resolve('CHARGER_EFF_BAND',  EPA_DEFAULTS.CHARGER_EFF_BAND);
export const SS_SPEED_BAND     = resolve('SS_SPEED_BAND',     EPA_DEFAULTS.SS_SPEED_BAND);
export const CURVE_SPEED_RANGE = resolve('CURVE_SPEED_RANGE', EPA_DEFAULTS.CURVE_SPEED_RANGE);
export const PACK_KWH_BAND     = resolve('PACK_KWH_BAND',     EPA_DEFAULTS.PACK_KWH_BAND);
export const PHASE_SUM_TOLERANCE_PCT =
    resolve('PHASE_SUM_TOLERANCE_PCT', EPA_DEFAULTS.PHASE_SUM_TOLERANCE_PCT);
export const HWFET_TO_SS_ETA_RATIO =
    resolve('HWFET_TO_SS_ETA_RATIO', EPA_DEFAULTS.HWFET_TO_SS_ETA_RATIO);
export const SS_CYCLE_SPEED_MPH =
    resolve('SS_CYCLE_SPEED_MPH', EPA_DEFAULTS.SS_CYCLE_SPEED_MPH);

// ── EPA test procedure codes ────────────────────────────────────────────────
export const PROC_MCT     = 77; // Multi-Cycle Test — city + highway + totals in one run
export const PROC_CD_HWY  = 84; // Charge Depleting Highway — η fallback
export const PROC_CD_UDDS = 81; // Charge Depleting UDDS — stored, excluded from derivation
export const PROC_FTP75   = 2;

// ── Drive-cycle distances (phase-type inference) ────────────────────────────
export const HWFET_MI       = 10.26;  // HWFET cycle distance (→ HWY)
export const UDDS_MI        = 7.45;   // UDDS cycle distance (→ UDDS)
export const CYCLE_DIST_TOL = 0.7;    // ± match tolerance, miles

// ── MPGe unit detection (CSV/PDF disambiguation) ────────────────────────────
export const MPGE_MAGNITUDE_THRESHOLD = 60;  // ≥ ⇒ value is MPGe, else kWh/100mi
export const MPGE_PLACEHOLDER_MIN     = 400; // ≥ ⇒ EPA "no data" sentinel
