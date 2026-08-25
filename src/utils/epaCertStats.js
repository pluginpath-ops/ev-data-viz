/**
 * Statistics from the certification records (#236, cert-side half).
 *
 * The other dataset. Where the guide holds what reached the window sticker for
 * 1,175 configurations, these are the lab's own measurements for 181 — road
 * load, drivetrain efficiency, charger efficiency, the energy actually
 * discharged. Nobody else publishes them grouped, because doing so needs both
 * halves and the link between them.
 *
 * ── Why this waited for #238 ────────────────────────────────────────────────
 *
 * A certification record identifies itself by a manufacturer's Vehicle ID. It
 * knows nothing about class, brand or drivetrain — those live on the Fuel
 * Economy Guide row, and only a curator can connect the two. Before the linking
 * sweep 45 groups had that link; now 181 do, which is the difference between a
 * figure describing a dozen makes and one describing the fleet.
 *
 * ── Derivations are not recomputed here ─────────────────────────────────────
 *
 * η, charger efficiency and the adjustment factor come from `epaDerivations`,
 * unchanged. The catalogue's rule is that a derivation gets exactly one
 * implementation — the η back-solve is the heart of the model and a second
 * version written for a statistics page would be free to drift from the one the
 * curves and the curator form use.
 */
import {
    resolvePrimaryCoeffs, pickDerivationTest,
    deriveDrivetrainEta, deriveSteadyStateEta, deriveChargerEfficiency,
    deriveEffectiveAdjustmentFactor,
} from './epaDerivations';
import { PROC_MCT, PROC_CD_HWY } from '../constants/epa';
import { bodyClassLabel, driveGroup, resolveBrand } from './feGuideBrowse';

/** Whether a derivation's source means it was actually derived. */
const isMeasured = (measureKey, source) =>
    source != null && !(NOT_MEASURED_SOURCES[measureKey] ?? []).includes(source);

const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

// ── Measures ─────────────────────────────────────────────────────────────────

/**
 * The source values that mean "this was not derived from the group's own
 * numbers" — a constant standing in for a measurement that could not be made.
 *
 * Listed per derivation because they DIFFER, and that difference already caused
 * the bug this constant exists to prevent: `deriveDrivetrainEta` calls its
 * fallback `estimated` while `deriveChargerEfficiency` calls its `assumed`. A
 * single check for 'assumed' therefore let every un-derivable η through, and
 * the fleet median came out at exactly DEFAULT_ETA — the assumption, published
 * as a measurement of 181 vehicles.
 *
 * A test asserts these names still match what the derivations return, so a
 * rename there breaks a test rather than silently restoring the bug.
 */
export const NOT_MEASURED_SOURCES = {
    eta: ['estimated'],
    charger_eff: ['assumed'],
    // deriveSteadyStateEta has no fallback at all — it returns a null value and
    // a null source when it cannot compute, rather than a constant. Listed
    // anyway so the vocabulary is complete and a future fallback cannot be
    // added without this file noticing.
    ss_eta: [],
};

/**
 * What the lab record can be asked.
 *
 * `assumedIsNotData` marks the derivations that fall back to a constant when
 * they cannot be computed. Including those would report the assumption as a
 * measurement. They are counted as excluded instead, and the view says how many.
 */
export const CERT_MEASURES = [
    // Ordered as a curator reads a record: what the dynamometer was set to,
    // then how efficiently the car turns energy into miles, then how much
    // energy it holds, then how much is lost putting it there.
    { key: 'rolling_a', label: 'Rolling resistance (A)', unit: 'lbf', digits: 2,
      hint: 'The speed-independent road-load term: tyres and driveline drag.' },
    { key: 'aero_c', label: 'Aero drag (C)', unit: 'lbf/mph\u00b2', digits: 4,
      hint: 'The road-load coefficient that scales with the square of speed \u2014 the aerodynamic term. Present on 203 of 204 groups, so it is the highest-coverage figure the certification side has.' },
    { key: 'eta', label: 'Drivetrain efficiency (\u03b7, HWFET)', unit: '', axisLabel: '\u03b7', digits: 3, assumedIsNotData: true,
      hint: 'Back-solved from the HWY phase against road load at the cycle\'s 48.3 mph average. A transient cycle measured with a steady-state formula, so it absorbs braking losses and the convexity of the drag term \u2014 which is why it reads about 13% below the steady-state figure. Groups where it could not be derived fall back to a default and are excluded rather than counted as measurements.' },
    { key: 'ss_eta', label: 'Drivetrain efficiency (\u03b7, steady state)', unit: '', axisLabel: '\u03b7', digits: 3,
      hint: 'Back-solved from the constant-speed phases at the 65 mph J1634 specifies. Only a multi-cycle test has those phases, so the coverage here against the HWFET measure is exactly how much of the fleet a steady-state basis could describe.' },
    { key: 'ss_eta_ratio', label: 'Steady-state \u00f7 HWFET \u03b7', unit: '', axisLabel: 'ratio', digits: 4,
      hint: 'Computed PER GROUP, on the groups carrying both. Its spread is what decides whether one fleet-wide factor can stand in for a missing steady-state measurement \u2014 and it is tight, median 1.128 with an interquartile range of 2.5%, which is what HWFET_TO_SS_ETA_RATIO is set from.' },
    { key: 'usable_kwh', label: 'Usable energy', unit: 'kWh', digits: 1,
      hint: 'Total DC energy discharged to depletion on the derivation test \u2014 the pack\'s measured usable capacity.' },
    { key: 'usable_fraction', label: 'Usable \u00f7 gross pack', unit: '', axisLabel: 'fraction', digits: 3,
      hint: 'Measured usable energy against the guide\'s gross pack figure. Migration 053 cited 0.939\u20130.955 from four packs by hand; this is the same quantity across every linked group. Ratios above 1 are dropped \u2014 a pack cannot deliver more than it holds, so the two sources disagree and the gross figure is the softer of them.' },
    { key: 'charger_eff', label: 'Charger efficiency', unit: '', axisLabel: 'ratio', digits: 3, assumedIsNotData: true,
      hint: 'DC energy discharged \u00f7 AC energy to refill. Read only from a procedure the derivations use \u2014 77 or 84, never 86, where a short cycle against a full recharge reads 0.04.' },
    { key: 'etw_lbs', label: 'Test weight', unit: 'lb', digits: 0,
      hint: 'Equivalent test weight \u2014 the mass the dynamometer was set to, which moves with the pack.' },
    { key: 'adjustment_factor', label: 'Effective adjustment (computed)', unit: '', axisLabel: 'factor', digits: 4,
      hint: 'Published label range \u00f7 OUR computed unadjusted range \u2014 not EPA\'s published adjustment factor, which the guide carries separately and which sits at exactly 0.700 for over half the fleet. This one lands near 0.66 and almost never on 0.70, so it is measuring our computed range as much as the adjustment. Read it as a check on the model, not as the factor EPA applied.' },
];
export const certMeasureByKey = (key) => CERT_MEASURES.find(m => m.key === key) ?? null;

/** Usable energy: the DC discharged to depletion on the test the model uses. */
export function derivedUsableKwh(group) {
    const explicit = num(group?.useable_kwh);
    if (explicit != null) return explicit;
    const test = pickDerivationTest(group?.epa_tests || []);
    return num(test?.total_dc_energy_kwh);
}

/**
 * One certification group, flattened to measures and the dimensions it can be
 * grouped by.
 *
 * The dimensions come from the LINKED GUIDE ROW, not from the certification
 * record, because the certification record does not know them. That is the
 * whole shape of this dataset: the lab measured it, the guide says what it is.
 */
export function certObservation(group, brandIndex) {
    const guide = group?.epa_fe_guide ?? null;
    const coeffs = resolvePrimaryCoeffs(group);
    const eta = deriveDrivetrainEta(group);
    const ssEta = deriveSteadyStateEta(group);
    const charger = deriveChargerEfficiency(group);
    const adjustment = deriveEffectiveAdjustmentFactor(group);

    const usable = derivedUsableKwh(group);
    const gross = num(guide?.nominal_pack_kwh);
    const { brand, parent } = resolveBrand(guide?.division, brandIndex);

    return {
        test_group_id: group.test_group_id,
        model_year:    group.model_year,
        carline:       guide?.carline ?? group.epa_carline_name ?? group.display_name ?? null,
        division:      guide?.division ?? null,

        // Dimensions, from the guide row.
        brand,
        parent_name: parent,
        body_class:  bodyClassLabel(guide?.carline_class),
        drive_group: driveGroup(guide?.drive_desc),

        // Measures. A derivation that fell back to its default contributes
        // null, not the default — see CERT_MEASURES.
        aero_c:     coeffs?.c ?? null,
        rolling_a:  coeffs?.a ?? null,
        etw_lbs:    coeffs?.equivTestWeightLbs ?? null,
        eta:         isMeasured('eta', eta?.source) && isPossible(eta)
            ? (eta?.value ?? null) : null,
        charger_eff: isMeasured('charger_eff', charger?.source) ? (charger?.value ?? null) : null,
        usable_kwh: usable,
        // Above 1 the two sources contradict each other — a pack cannot
        // deliver more than it holds — and three Teslas do, at 1.02 to 1.03.
        // Dropped rather than averaged in: the gross figure is voltage x
        // amp-hours as filed, and 053 already warns it is the soft one.
        usable_fraction: (() => {
            if (usable == null || gross == null || gross <= 0) return null;
            const f = usable / gross;
            return f > 1 ? null : f;
        })(),
        ss_eta: isPossible(ssEta) ? (ssEta?.value ?? null) : null,
        // Per group, and only where BOTH exist. A ratio of two fleet medians
        // would answer a different question — whether the typical car's two
        // figures differ — when what decides a correction factor is whether the
        // SAME car's two figures differ by a consistent amount.
        ss_eta_ratio: (() => {
            const measured = isMeasured('eta', eta?.source) && isPossible(eta)
                ? num(eta?.value) : null;
            const ss = isPossible(ssEta) ? num(ssEta?.value) : null;
            if (measured == null || ss == null || measured <= 0) return null;
            return ss / measured;
        })(),
        adjustment_factor: adjustment?.value ?? null,

        // Kept so the view can say what it left out rather than only how much
        // it kept.
        _etaSource: eta?.source ?? null,
        _ssEtaSource: ssEta?.source ?? null,
        _chargerSource: charger?.source ?? null,
    };
}

/**
 * A derivation that flagged its own result impossible is not a measurement.
 *
 * `isMeasured` asks where a value came from; this asks whether it can be true.
 * They are different questions and both have to pass. A steady-state η above 1
 * is a drivetrain returning more energy than it was given — the inputs
 * contradict each other — and Nissan's six groups did exactly that, inflating
 * their ratio to 1.53 against a fleet median of 1.13 and pulling the fleet
 * figures with them.
 *
 * Excluded from the statistics rather than clamped: the number is not a
 * measurement of anything, and clamping would publish the bound as if it were.
 * It stays visible on the vehicle card, flagged, where it is a fault to fix.
 */
const NONPHYSICAL = ['nonphysical-eta', 'nonphysical-consumption'];
const isPossible = (result) => !(result?.flags ?? []).some(f => NONPHYSICAL.includes(f));

/** Every linked group as an observation. */
export const certObservations = (groups, brandIndex) =>
    (groups ?? []).map(g => certObservation(g, brandIndex));

/**
 * How many observations a measure actually has, and how many were set aside.
 *
 * Reported beside every figure. "Median η 0.87 (n=61; 28 groups could not be
 * derived)" is a statistic; "median η 0.87" over a population padded with the
 * default constant is not, and the two are indistinguishable on screen unless
 * the second number is there.
 */
export function coverageFor(observations, measureKey) {
    const measure = certMeasureByKey(measureKey);
    let usable = 0, assumed = 0, missing = 0;
    for (const o of observations) {
        if (o[measureKey] != null) { usable += 1; continue; }
        const src = measureKey === 'eta' ? o._etaSource
            : measureKey === 'charger_eff' ? o._chargerSource
                : null;
        if (measure?.assumedIsNotData && (NOT_MEASURED_SOURCES[measureKey] ?? []).includes(src)) assumed += 1;
        else missing += 1;
    }
    return { usable, assumed, missing, total: observations.length };
}
