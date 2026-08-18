/**
 * How the EPA label range was produced — the model behind the methodology
 * diagram (#206).
 *
 * The question this answers is the one every independent range test raises:
 * *why doesn't my 70 mph result match the sticker?* The answer is not one thing,
 * it is four, and each is a step here:
 *
 *   1. Neither tested cycle is a highway trip. HWFET averages 48.3 mph; UDDS
 *      averages 19.6. Nothing in the label was driven at 70.
 *   2. Range is COMPUTED — total energy ÷ measured consumption — not driven to
 *      empty on the road.
 *   3. Everything is multiplied by 0.7.
 *   4. The label is 55% city and 45% highway. City range runs well above
 *      highway, so the number on the sticker is mostly a city figure.
 *
 * Then a fifth, smaller one: a manufacturer may label at or below the computed
 * value, never above, so the sticker often sits a percent or two under.
 *
 * ── The two test methods ─────────────────────────────────────────────────────
 *
 * MCT — one multi-cycle test to depletion, city and highway phases interleaved.
 * Per-phase consumption is reported, so city and highway consumption both come
 * out of a single run and the cold-start phase can be weighted properly.
 *
 * SCT — two separate single-cycle depletion runs, one UDDS and one HWFET, each
 * reporting only recharge energy and distance. Consumption is energy ÷ distance
 * by definition, which is why recomputing an SCT range from its own consumption
 * is circular and proves nothing.
 *
 * Composite city and highway consumption are comparable ACROSS the two methods:
 * MCT's energy-share-weighted city figure and SCT's single-run city figure both
 * fold the cold start in at its natural share. Only the phase drill-down is
 * method-specific.
 *
 * Pure module: no data access, no React. Every number the diagram draws is
 * computed once here, so the template stays a template.
 */

import {
    LABEL_ADJUSTMENT, LABEL_WEIGHT_CITY, LABEL_WEIGHT_HWY,
    UDDS_AVG_MPH, HWFET_AVG_MPH, MPG_E_CONVERSION, ASSUMED_CHARGER_EFF,
    DERIVED_5CYCLE, HWFET_MI, UDDS_MI,
} from '../constants/epa';

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The derived-5-cycle regression — the alternative to the flat 0.7 factor.
 *
 *     1/FE_adj = intercept + slope / FE_unadj
 *
 * @param {number} feUnadj   unadjusted fuel economy (MPGe here)
 * @param {'city'|'hwy'} cycle
 */
export function derived5CycleFe(feUnadj, cycle) {
    const c = DERIVED_5CYCLE[cycle];
    if (!c || !(feUnadj > 0)) return null;
    return 1 / (c.intercept + c.slope / feUnadj);
}

/**
 * The unadjusted efficiency at which the two adjustment methods agree.
 *
 * Solving 0.7·x = 1/(a + b/x) gives x = (1 − 0.7b) / (0.7a). Above it the
 * regression is harsher than the flat factor; below it, kinder.
 */
export function derived5CycleCrossoverFe(cycle) {
    const c = DERIVED_5CYCLE[cycle];
    if (!c) return null;
    return (1 - LABEL_ADJUSTMENT * c.slope) / (LABEL_ADJUSTMENT * c.intercept);
}

/**
 * How the two adjustment methods compare at a given unadjusted efficiency.
 *
 * ── Why this matters, and it is not a rounding difference ────────────────────
 *
 * The regression's intercept is a fixed cost in the INVERSE domain, so it does
 * not scale with efficiency. As FE_unadj rises, `slope/FE_unadj` shrinks toward
 * nothing and the intercept comes to dominate, capping adjusted economy at
 * 1/intercept — about 307 MPGe city — no matter how efficient the vehicle is.
 * The flat 0.7 factor has no such ceiling.
 *
 * The consequence is that the regression penalises efficient vehicles and the
 * flat factor does not. They agree around 76 MPGe unadjusted city; by 154 —
 * roughly where the R2 sits — the regression is ~15% harsher. A manufacturer
 * with an efficient BEV therefore has a real reason to prefer the two-cycle
 * test and take the flat 0.7.
 *
 * ⚠ The equations are fitted on GASOLINE vehicles and are unvalidated against
 * any real EV certification record (#206). This function computes what they
 * would do, which is not the same as evidence that they are applied this way.
 *
 * @returns {{ fixed, derived, penaltyPct, crossoverFe }|null}
 *          penaltyPct > 0 means the regression is harsher than the flat factor
 */
export function adjustmentComparison(feUnadj, cycle) {
    const derived = derived5CycleFe(feUnadj, cycle);
    if (derived == null) return null;
    const fixed = feUnadj * LABEL_ADJUSTMENT;
    return {
        fixed,
        derived,
        penaltyPct: ((fixed - derived) / fixed) * 100,
        crossoverFe: derived5CycleCrossoverFe(cycle),
    };
}

/**
 * City consumption from MCT phases, with the cold start weighted by its share
 * of the test's total energy.
 *
 * The first UDDS phase is run from a cold soak and costs materially more per
 * mile — 235.86 Wh/mi against ~185 for the rest, on the R2. Averaging the
 * phases evenly would let that one bag speak for a quarter of the city number
 * when it accounts for about two percent of the energy actually used.
 *
 *     f = e_udds1 / e_total
 *     ec_city = f·ec_udds1 + (1 − f)·mean(ec_udds[2:])
 */
/**
 * How far a bag may fall short of its cycle and still count as having driven it.
 *
 * A driving cycle is a fixed trace, so a completed bag lands on its nominal
 * distance to within the dyno's reporting precision — the Model Y Performance's
 * two full highway bags are 10.265 and 10.266 mi against a nominal 10.26,
 * +0.05%. There is no mechanism that produces a genuine 3%-short HWFET.
 *
 * Deliberately much tighter than CYCLE_DIST_TOL (±0.7 mi), which answers a
 * different question: that one decides WHICH cycle a bag drove, and correctly
 * types a 9.96 mi bag as highway. This decides whether it FINISHED.
 */
export const CYCLE_COMPLETE_TOL = 0.01;

const NOMINAL_CYCLE_MI = { HWY: HWFET_MI, UDDS: UDDS_MI, 'Cold-UDDS': UDDS_MI };

/**
 * Did this bag drive its whole cycle?
 *
 * A depletion run ends when the vehicle stops, which is almost never on a cycle
 * boundary — so the last bag is a partial one, and its Wh/mi is not a cycle's
 * Wh/mi. It reads high, both because the pack is flat and sagging by then and
 * because the fixed costs of the bag are spread over fewer miles: the Model Y
 * Performance's final highway bag is 251.66 Wh/mi against 200.25 and 194.68 for
 * the two that completed.
 *
 * Averaging it in dropped that record's derived highway range to 378.3 mi
 * against the 412.88 the record itself states. Excluding it gives 412.87.
 *
 * Its ENERGY still counts toward the test total — it was really consumed. Only
 * its consumption RATE is unusable, which is exactly EPA's construction:
 * price the whole pack at the rate the complete cycles consumed it.
 *
 * Unknown distance ⇒ complete. A record that never reported bag distances
 * cannot be judged, and excluding everything would be worse than including it.
 */
export function isCompleteCycle(phase) {
    const nominal = NOMINAL_CYCLE_MI[phase?.cycle];
    const d = Number(phase?.distanceMi);
    if (!nominal || !Number.isFinite(d) || d <= 0) return true;
    return Math.abs(d - nominal) / nominal <= CYCLE_COMPLETE_TOL;
}

export function cityConsumptionFromPhases(uddsPhases, totalEnergyWh) {
    if (!uddsPhases?.length || !(totalEnergyWh > 0)) return null;
    // Complete cycles only — see isCompleteCycle. Applied to city as well as
    // highway: the partial bag lands wherever the run happens to end, and there
    // is no reason it favours one cycle.
    const complete = uddsPhases.filter(isCompleteCycle);
    if (!complete.length) return null;

    const [cold, ...warm] = complete;
    if (!warm.length) return cold.whPerMi ?? null;

    const f = cold.wh / totalEnergyWh;
    return f * cold.whPerMi + (1 - f) * mean(warm.map(p => p.whPerMi));
}

/** Highway consumption — a plain mean over the bags that finished their cycle. */
export function highwayConsumptionFromPhases(hwyPhases) {
    if (!hwyPhases?.length) return null;
    const complete = hwyPhases.filter(isCompleteCycle);
    if (!complete.length) return null;
    return mean(complete.map(p => p.whPerMi));
}

/**
 * MPGe from consumption.
 *
 * Two corrections, and leaving either out produces a number that looks fine:
 *
 * ADJUSTMENT. Computed from the ADJUSTED consumption — the unadjusted figure
 * divided by 0.7, the same 0.7 that multiplies range. Skipping it reads ~40% high.
 *
 * ENERGY BASIS. MPGe is a WALL-TO-WHEELS figure: the gallon-equivalent is
 * energy drawn from the outlet, not energy that left the pack. An MCT record
 * reports DC-side phase energy, so its consumption must be grossed up by the
 * charging efficiency first. An SCT record reports AC recharge energy and needs
 * no such step — which is exactly why the Lightning reproduces its published
 * 77.8 / 62.9 straight from the spreadsheet while a DC-basis record does not.
 *
 * Missing this read the R2 at 114.8 MPGe combined, against ~98 once the losses
 * are put back. Plausible enough to ship, wrong enough to matter.
 */
function mpgeFrom(whPerMi, { energyBasis, chargeEff, adjustment }) {
    if (!(whPerMi > 0)) return null;
    if (energyBasis === 'dc' && !(chargeEff > 0)) return null;

    const whPerMiAc = energyBasis === 'dc' ? whPerMi / chargeEff : whPerMi;
    return (MPG_E_CONVERSION * 1000) / (whPerMiAc / adjustment);
}

/** One cycle's row: consumption in, ranges and MPGe out. */
function cycleFrom({ whPerMi, rangeUnadjMi, energyBasis, chargeEff, adjustment }) {
    if (!(rangeUnadjMi > 0)) return null;
    return {
        whPerMi,
        energyBasis,
        rangeUnadjMi,
        rangeAdjMi: rangeUnadjMi * adjustment,
        mpge: mpgeFrom(whPerMi, { energyBasis, chargeEff, adjustment }),
        // The same figure before the adjustment, which is what EPA publishes as
        // "Unadj FE" and therefore the only one our derivation can be checked
        // against. The adjusted value cannot serve: it embeds the factor, so
        // comparing it would test the factor and the derivation together and
        // pass whenever their errors happened to cancel.
        mpgeUnadj: mpgeFrom(whPerMi, { energyBasis, chargeEff, adjustment: 1 }),
        // What the flat shortcut would have produced, so the diagram can show
        // the two side by side. Identical for the 57% of configurations whose
        // published factor IS 0.700, which is the point: it degenerates.
        rangeAdjFixedMi: rangeUnadjMi * LABEL_ADJUSTMENT,
    };
}

/**
 * Bounds on a published adjustment factor before it is trusted over the flat
 * one. The real spread across six guide years is 0.607-0.738; anything outside
 * 0.55-0.85 is a corrupt row rather than a vehicle.
 */
export const ADJUSTMENT_PLAUSIBLE_MIN = 0.55;
export const ADJUSTMENT_PLAUSIBLE_MAX = 0.85;

/** 55/45 arithmetic blend — miles over a split of driving add. */
const blendArithmetic = (city, hwy) =>
    (city > 0 && hwy > 0) ? LABEL_WEIGHT_CITY * city + LABEL_WEIGHT_HWY * hwy : null;

/** 55/45 harmonic blend — the same split expressed as consumption. */
const blendHarmonic = (city, hwy) =>
    (city > 0 && hwy > 0) ? 1 / (LABEL_WEIGHT_CITY / city + LABEL_WEIGHT_HWY / hwy) : null;

/**
 * Which blend reproduces the published combined range.
 *
 * Compared after rounding to whole miles, because that is how EPA publishes it
 * and an unrounded comparison would call every row 'neither'. A row where both
 * land on the label — the common case, when city and highway are close — reads
 * as 'arithmetic', since that is the documented default and claiming the
 * ambiguous case for harmonic would overstate it.
 */
function labelBlendAgreement(labeled, arithmetic, harmonic) {
    const label = Number(labeled);
    if (!(label > 0)) return null;
    if (arithmetic > 0 && Math.round(arithmetic) === Math.round(label)) return 'arithmetic';
    if (harmonic  > 0 && Math.round(harmonic)  === Math.round(label)) return 'harmonic';
    return (arithmetic > 0 || harmonic > 0) ? 'neither' : null;
}

/**
 * Which adjustment factor this vehicle's label actually used.
 *
 * `LABEL_ADJUSTMENT` is 0.700, and for 57% of configurations that is exactly
 * right — EPA's own published ratio is 0.700000 to six decimals. For the rest
 * it is not: the 2027 R2 is 0.7051 at 20" and 0.7294 at 21", and substituting
 * the real figure reproduces EPA's published city and highway ranges (337.73 →
 * 338, 276.47 → 276) and its unadjusted MPGe to within 0.03%.
 *
 * So the flat factor is a fallback, not the model. Where the Fuel Economy Guide
 * has been linked, `label_adjustment_factor` is the measured value and wins.
 *
 * Bounded because it is promoted data rather than a constant: a factor outside
 * 0.55–0.85 is a corrupt row, not a vehicle, and silently scaling every figure
 * on the diagram by it would be worse than ignoring it.
 *
 * @returns {{ value, source: 'guide'|'default', declared: string|null }}
 */
export function resolveAdjustment(record) {
    const published = Number(record?.adjustmentFactor);
    const usable = Number.isFinite(published)
        && published >= ADJUSTMENT_PLAUSIBLE_MIN
        && published <= ADJUSTMENT_PLAUSIBLE_MAX;

    return {
        value:    usable ? published : LABEL_ADJUSTMENT,
        source:   usable ? 'guide' : 'default',
        declared: record?.calcApproach ?? null,
    };
}

/**
 * Build the diagram model from one cert record.
 *
 * @param {Object} record
 * @param {'mct'|'sct'} record.testMethod
 * @param {number} [record.labeledRangeMi]  the published label, for the derate
 * @param {number} [record.totalDcWh]       MCT: battery-side energy to depletion
 * @param {number} [record.rechargeAcWh]    AC-side refill energy
 * @param {Array}  [record.phases]          MCT: [{ cycle:'UDDS'|'HWY', index, whPerMi, wh }]
 * @param {Array}  [record.runs]            SCT: [{ cycle, procedureCode, rechargeWh, rangeMi }]
 * @returns {Object|null} model, or null when the record cannot produce one
 */
export function buildMethodologyModel(record) {
    if (!record) return null;

    // Resolved first: MCT consumption is DC-side, and turning that into the
    // wall-to-wheels basis MPGe is defined on needs the charging efficiency.
    const chargeEfficiency = chargeEfficiencyFrom(record);

    const adjustment = resolveAdjustment(record);

    const cycles = record.testMethod === 'sct'
        ? sctCycles(record, adjustment.value)
        : mctCycles(record, chargeEfficiency.value, adjustment.value);

    if (!cycles?.city || !cycles?.hwy) return null;

    // Combined RANGE is arithmetic; combined MPGE is harmonic. Not a typo —
    // they are different kinds of average because they answer different
    // questions. Miles over a 55/45 split of driving add; efficiency over that
    // same split does not, since the two cycles cover their shares at different
    // rates.
    //
    // Arithmetic is the DEFAULT, not a certainty. On the 339 published rows
    // where the two blends differ by more than rounding, arithmetic reproduces
    // EPA's combined figure 72% of the time and harmonic 28% — but the R2 and
    // the Silverado EV Max are exactly harmonic (306.97 → 307, and 329.89 →
    // 330), and nothing in the row says which a configuration uses. So both are
    // computed and `blendAgreeing` records which one actually reproduced the
    // label, rather than the model asserting one and quietly missing by 3 mi.
    const combinedMi      = blendArithmetic(cycles.city.rangeAdjMi, cycles.hwy.rangeAdjMi);
    const combinedHarmMi  = blendHarmonic(cycles.city.rangeAdjMi, cycles.hwy.rangeAdjMi);
    const combinedFixedMi = blendArithmetic(cycles.city.rangeAdjFixedMi, cycles.hwy.rangeAdjFixedMi);

    const combinedMpge = (cycles.city.mpge > 0 && cycles.hwy.mpge > 0)
        ? 1 / (LABEL_WEIGHT_CITY / cycles.city.mpge + LABEL_WEIGHT_HWY / cycles.hwy.mpge)
        : null;

    const labeledMi = record.labeledRangeMi ?? null;

    return {
        vehicleName: record.vehicleName ?? null,
        modelYear:   record.modelYear ?? null,
        testMethod:  record.testMethod,
        // The factor actually applied, plus the flat shortcut it replaced. Both,
        // because the gap between them IS the answer to "why doesn't my car
        // match the sticker" — and they coincide for most vehicles, so showing
        // both degenerates gracefully rather than cluttering the common case.
        adjustment:       adjustment.value,
        adjustmentSource: adjustment.source,
        adjustmentFixed:  LABEL_ADJUSTMENT,
        adjustmentDeclared: adjustment.declared,
        weights:     { city: LABEL_WEIGHT_CITY, hwy: LABEL_WEIGHT_HWY },
        cycleSpeeds: { city: UDDS_AVG_MPH, hwy: HWFET_AVG_MPH },
        adjustmentMethod: record.adjustmentMethod ?? null,
        cycles,
        combinedMi,
        combinedFixedMi,
        combinedHarmMi,
        // 'arithmetic' | 'harmonic' | 'neither' | null — which blend reproduces
        // the published combined range, once both are rounded as EPA rounds.
        blendAgreeing: labelBlendAgreement(record.labeledRangeMi, combinedMi, combinedHarmMi),
        combinedMpge,
        labeledMi,
        // How far the manufacturer labelled below what the test computed. Not an
        // error term: labelling low is permitted and labelling high is not.
        deratePct: (labeledMi > 0 && combinedMi > 0)
            ? ((combinedMi - labeledMi) / combinedMi) * 100
            : null,
        chargeEfficiency,
        phases: record.phases ?? null,
        runs:   record.runs ?? null,
    };
}

/** MCT: consumption per cycle from the phase table, range computed from it. */
function mctCycles(record, chargeEff, adjustment) {
    const { phases, totalDcWh } = record;
    if (!phases?.length || !(totalDcWh > 0)) return null;

    const udds = phases.filter(p => p.cycle === 'UDDS').sort((a, b) => a.index - b.index);
    const hwy  = phases.filter(p => p.cycle === 'HWY').sort((a, b) => a.index - b.index);

    const cityWhPerMi = cityConsumptionFromPhases(udds, totalDcWh);
    const hwyWhPerMi  = highwayConsumptionFromPhases(hwy);
    if (!(cityWhPerMi > 0) || !(hwyWhPerMi > 0)) return null;

    return {
        // Range is total energy ÷ consumption — the whole pack priced at the
        // rate that cycle consumed it. This is the step people read as "they
        // drove it until it stopped". They did not.
        city: { ...cycleFrom({ whPerMi: cityWhPerMi, rangeUnadjMi: totalDcWh / cityWhPerMi, energyBasis: 'dc', chargeEff, adjustment }), basis: 'computed' },
        hwy:  { ...cycleFrom({ whPerMi: hwyWhPerMi,  rangeUnadjMi: totalDcWh / hwyWhPerMi,  energyBasis: 'dc', chargeEff, adjustment }), basis: 'computed' },
    };
}

/**
 * SCT: each run drove its own cycle to depletion, so range is MEASURED and
 * consumption is the derived quantity — the opposite of MCT.
 */
function sctCycles(record, adjustment) {
    const byCycle = (name) => (record.runs ?? []).find(r => r.cycle === name);
    const city = byCycle('UDDS');
    const hwy  = byCycle('HWFET') ?? byCycle('HWY');
    if (!city || !hwy) return null;

    const row = (run) => {
        if (!(run.rangeMi > 0) || !(run.rechargeWh > 0)) return null;
        return {
            ...cycleFrom({ whPerMi: run.rechargeWh / run.rangeMi, rangeUnadjMi: run.rangeMi, energyBasis: 'ac', adjustment }),
            basis: 'measured',
        };
    };
    const c = row(city), h = row(hwy);
    return (c && h) ? { city: c, hwy: h } : null;
}

/**
 * AC → DC charging efficiency, measured when the record reports both sides.
 *
 * Returned with `measured` so the diagram can say which it is drawing. An
 * imputed number presented as a measurement would undercut the point of a
 * diagram whose whole job is showing where figures come from.
 */
function chargeEfficiencyFrom({ totalDcWh, rechargeAcWh }) {
    if (totalDcWh > 0 && rechargeAcWh > 0) {
        return { value: totalDcWh / rechargeAcWh, measured: true };
    }
    // An SCT record reports no DC energy at all, so there is no loss to
    // separate — and none needed, since its consumption is already AC-side.
    if (!(totalDcWh > 0)) return { value: null, measured: false };
    // DC energy without AC recharge: the assumed prior carries the MPGe
    // conversion, flagged so the diagram can say the number is imputed.
    return { value: ASSUMED_CHARGER_EFF, measured: false };
}
