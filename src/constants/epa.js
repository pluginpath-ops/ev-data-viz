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
export const US06_AVG_MPH     = 48.4;
export const HIGHWAY_BAND_MPH = [65, 75];    // reference band drawn on the curve

// ── Tunable knobs: pristine defaults ────────────────────────────────────────
// Single source of truth for the adjustable model assumptions and sanity bands.
// The Admin "Model Constants" panel (src/components/admin/ConstantsKnobs.jsx)
// reads these as the reset baseline and writes per-browser overrides via
// constants/overrides.js. Each export below is the default UNLESS a local
// override is set (applied on page reload).
export const EPA_DEFAULTS = {
    // assumptions
    DEFAULT_ETA:         0.88,        // fallback drivetrain efficiency
    DEFAULT_ACCESSORY_W: 300,         // constant accessory draw, watts
    ASSUMED_CHARGER_EFF: 0.88,        // when AC recharge is unavailable (CSI obs ~0.87–0.89)
    // sanity bands (Section-8 flags) + curve extent
    ETA_BAND:          [0.75, 0.92],
    CHARGER_EFF_BAND:  [0.80, 0.92],
    SS_SPEED_BAND:     [55, 70],      // mph
    CURVE_SPEED_RANGE: [5, 120],      // mph, inclusive
};

// Resolved values (override ∥ default). These are what the math imports.
export const DEFAULT_ETA         = resolve('DEFAULT_ETA',         EPA_DEFAULTS.DEFAULT_ETA);
export const DEFAULT_ACCESSORY_W = resolve('DEFAULT_ACCESSORY_W', EPA_DEFAULTS.DEFAULT_ACCESSORY_W);
export const ACCESSORY_LOAD_KW   = DEFAULT_ACCESSORY_W / 1000;  // derived (kW)
export const ASSUMED_CHARGER_EFF = resolve('ASSUMED_CHARGER_EFF', EPA_DEFAULTS.ASSUMED_CHARGER_EFF);
export const ETA_BAND          = resolve('ETA_BAND',          EPA_DEFAULTS.ETA_BAND);
export const CHARGER_EFF_BAND  = resolve('CHARGER_EFF_BAND',  EPA_DEFAULTS.CHARGER_EFF_BAND);
export const SS_SPEED_BAND     = resolve('SS_SPEED_BAND',     EPA_DEFAULTS.SS_SPEED_BAND);
export const CURVE_SPEED_RANGE = resolve('CURVE_SPEED_RANGE', EPA_DEFAULTS.CURVE_SPEED_RANGE);

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
