import { describe, it, expect } from 'vitest';
import {
    buildMethodologyModel, cityConsumptionFromPhases,
    derived5CycleFe, derived5CycleCrossoverFe, adjustmentComparison,
} from '../epaMethodology';
import { R2_MCT, LIGHTNING_SCT, R2_GUIDE_ADJUSTMENT } from '../epaMethodologyFixtures';
import { isCompleteCycle, highwayConsumptionFromPhases } from '../epaMethodology';

/**
 * The expected values are from the certification records themselves, not from
 * this implementation — see #206. That is what makes them a test rather than a
 * snapshot: they were derived by hand from the published labels first.
 *
 * The binding assertion in both cases is `combined >= labeled`. It is a
 * regulatory invariant — a manufacturer may label at or below the computed
 * value and never above — so a violation means the derivation is wrong or the
 * record mixes configurations, and no amount of internal consistency will catch
 * that.
 */

const close = (actual, expected, tol) => expect(Math.abs(actual - expected)).toBeLessThan(tol);

describe('the published adjustment factor (#222)', () => {
    // The R2 20in AT as EPA publishes it in the MY27 Fuel Economy Guide.
    const PUBLISHED = { cityMi: 338, hwyMi: 276, combMi: 307 };
    const withGuide = { ...R2_MCT, adjustmentFactor: R2_GUIDE_ADJUSTMENT, calcApproach: 'Electric Vehicle 5-cycle label' };

    it('reproduces all three published figures, which the flat factor does not', () => {
        // The whole case for reading the factor rather than assuming it. 0.700
        // misses every one of these; 0.7051 hits every one.
        const m = buildMethodologyModel(withGuide);

        expect(Math.round(m.cycles.city.rangeAdjMi)).toBe(PUBLISHED.cityMi);
        expect(Math.round(m.cycles.hwy.rangeAdjMi)).toBe(PUBLISHED.hwyMi);
        expect(Math.round(m.combinedHarmMi)).toBe(PUBLISHED.combMi);

        const flat = buildMethodologyModel(R2_MCT);
        expect(Math.round(flat.cycles.city.rangeAdjMi)).not.toBe(PUBLISHED.cityMi);
        expect(Math.round(flat.cycles.hwy.rangeAdjMi)).not.toBe(PUBLISHED.hwyMi);
    });

    it('keeps the flat factor available alongside it', () => {
        // The diagram draws both. They coincide for the 57% of configurations
        // published at exactly 0.700, so the second line costs nothing there.
        const m = buildMethodologyModel(withGuide);
        expect(m.adjustment).toBe(R2_GUIDE_ADJUSTMENT);
        expect(m.adjustmentSource).toBe('guide');
        expect(m.adjustmentFixed).toBe(0.7);
        expect(m.combinedFixedMi).toBeCloseTo(buildMethodologyModel(R2_MCT).combinedMi, 6);
    });

    it('records which blend reproduced the label rather than asserting one', () => {
        // The R2 is harmonic. The fleet is 72% arithmetic. Both are real, and
        // nothing in a record says which applies, so the model reports rather
        // than decides.
        expect(buildMethodologyModel(withGuide).blendAgreeing).toBe('harmonic');
    });

    it('does not mistake the old coincidence for agreement', () => {
        // Why this went unnoticed: at 0.700 the ARITHMETIC combine lands on
        // 307.92, one mile from the 307 label, so the combined number looked
        // roughly right while both cycle figures were wrong by 2-3 mi. A check
        // on the combined alone would still pass today.
        const flat = buildMethodologyModel(R2_MCT);
        expect(flat.combinedMi).toBeCloseTo(307.92, 1);
        expect(flat.blendAgreeing).toBe('neither');
    });

    it('ignores a corrupt factor rather than scaling every figure by it', () => {
        for (const bad of [0.2, 1.4, 0, -0.7, NaN, null, undefined, 'x']) {
            const m = buildMethodologyModel({ ...R2_MCT, adjustmentFactor: bad });
            expect(m.adjustment, String(bad)).toBe(0.7);
            expect(m.adjustmentSource, String(bad)).toBe('default');
        }
    });

    it('falls back cleanly when no guide row is linked', () => {
        const m = buildMethodologyModel(R2_MCT);
        expect(m.adjustment).toBe(0.7);
        expect(m.adjustmentSource).toBe('default');
        expect(m.adjustmentDeclared).toBeNull();
    });
});

describe('MCT — Rivian R2', () => {
    const m = buildMethodologyModel(R2_MCT);

    it('weights the cold-start bag by its energy share, not evenly', () => {
        // Evenly averaging the four UDDS bags gives 198.45; the cold bag is only
        // ~2% of the energy, so the honest number sits near the warm ones.
        close(m.cycles.city.whPerMi, 186.96, 0.01);
        expect(m.cycles.city.whPerMi).toBeLessThan(198);
    });

    it('takes highway consumption as a plain mean', () => {
        close(m.cycles.hwy.whPerMi, 228.385, 0.01);
    });

    it('computes unadjusted range as total energy over consumption', () => {
        close(m.cycles.city.rangeUnadjMi, 478.98, 0.02);
        close(m.cycles.hwy.rangeUnadjMi,  392.10, 0.02);
    });

    it('applies the 0.7 adjustment', () => {
        close(m.cycles.city.rangeAdjMi, 335.29, 0.02);
        close(m.cycles.hwy.rangeAdjMi,  274.47, 0.02);
    });

    it('combines range arithmetically, 55/45, and lands on the label', () => {
        close(m.combinedMi, 307.92, 0.02);
        expect(m.combinedMi).toBeGreaterThanOrEqual(m.labeledMi);
        close(m.deratePct, 0.30, 0.02);
    });

    it('measures charge efficiency when both sides are reported', () => {
        expect(m.chargeEfficiency.measured).toBe(true);
        close(m.chargeEfficiency.value, 0.855, 0.001);
    });

    it('converts DC-side consumption to the wall for MPGe', () => {
        // MPGe is wall-to-wheels. MCT phase energy is battery-side, so the
        // charging loss has to be put back before converting — without it the
        // R2 read 114.8 combined, which is Model-3 territory for a midsize SUV.
        expect(m.cycles.city.energyBasis).toBe('dc');
        close(m.cycles.city.mpge, 107.95, 0.05);
        close(m.cycles.hwy.mpge,   88.37, 0.05);
        close(m.combinedMpge,      98.16, 0.05);

        // The uncorrected value, stated so a regression is recognisable rather
        // than merely a failing number.
        expect(m.combinedMpge).toBeLessThan(114);
    });

    it('is mostly a city number — which is why a highway test disagrees', () => {
        // The whole point of the diagram: adjusted highway is 274 mi, the label
        // says 307. Someone testing at 70 mph is comparing against neither.
        expect(m.cycles.hwy.rangeAdjMi).toBeLessThan(m.labeledMi);
        expect(m.cycles.city.rangeAdjMi).toBeGreaterThan(m.labeledMi);
    });
});

describe('SCT — Ford F-150 Lightning ER', () => {
    const m = buildMethodologyModel(LIGHTNING_SCT);

    it('derives consumption from recharge energy over measured distance', () => {
        close(m.cycles.city.whPerMi, 303.21, 0.01);
        close(m.cycles.hwy.whPerMi,  375.00, 0.01);
    });

    it('treats range as measured, not computed', () => {
        expect(m.cycles.city.basis).toBe('measured');
        close(m.cycles.city.rangeUnadjMi, 504.521, 0.001);
        close(m.cycles.hwy.rangeUnadjMi,  407.934, 0.001);
    });

    it('adjusts and combines to the label', () => {
        close(m.cycles.city.rangeAdjMi, 353.16, 0.01);
        close(m.cycles.hwy.rangeAdjMi,  285.55, 0.01);
        close(m.combinedMi, 322.74, 0.02);
        expect(m.combinedMi).toBeGreaterThanOrEqual(m.labeledMi);
        close(m.deratePct, 0.85, 0.02);
    });

    it('computes MPGe from adjusted consumption, harmonic for combined', () => {
        // Already AC-side, so no charging correction — and these reproduce the
        // published label figures exactly, which is what validates the whole
        // conversion. The DC correction added for MCT must not disturb them.
        expect(m.cycles.city.energyBasis).toBe('ac');
        close(m.cycles.city.mpge, 77.8, 0.1);
        close(m.cycles.hwy.mpge,  62.9, 0.1);
        close(m.combinedMpge,     70.3, 0.1);
        // Harmonic, so combined sits below the arithmetic mean of the two.
        expect(m.combinedMpge).toBeLessThan((77.8 + 62.9) / 2);
    });

    it('reports charge efficiency as unavailable rather than imputing it', () => {
        expect(m.chargeEfficiency.measured).toBe(false);
        expect(m.chargeEfficiency.value).toBeNull();
    });
});

describe('degenerate records', () => {
    it('returns null rather than a half-model', () => {
        expect(buildMethodologyModel(null)).toBeNull();
        expect(buildMethodologyModel({ testMethod: 'mct', phases: [], totalDcWh: 0 })).toBeNull();
        // Half an SCT pair is the trap the issue calls out: never combine from one run.
        expect(buildMethodologyModel({
            testMethod: 'sct',
            runs: [{ cycle: 'UDDS', rechargeWh: 152974, rangeMi: 504.521 }],
        })).toBeNull();
    });

    it('falls back to the single bag when there is no warm phase to average', () => {
        expect(cityConsumptionFromPhases([{ whPerMi: 200, wh: 1000 }], 50000)).toBe(200);
        expect(cityConsumptionFromPhases([], 50000)).toBeNull();
        expect(cityConsumptionFromPhases([{ whPerMi: 200, wh: 1000 }], 0)).toBeNull();
    });
});

describe('derived 5-cycle vs the flat 0.7 factor', () => {
    // The claim being checked: the regression penalises efficient vehicles and
    // the flat factor does not, because the regression's intercept is a fixed
    // cost in the inverse domain and so does not scale with efficiency.
    //
    // Everything here is arithmetic on the published equations. It corroborates
    // the MECHANISM, not the practice — the equations are gasoline-fitted and
    // unvalidated against a real EV record (#206).

    it('agrees with the flat factor around 76 MPGe unadjusted city', () => {
        const x = derived5CycleCrossoverFe('city');
        close(x, 76.1, 0.2);
        const at = adjustmentComparison(x, 'city');
        close(at.penaltyPct, 0, 0.01);
    });

    it('is harsher above the crossover and kinder below it', () => {
        // An efficient EV: the R2 sits near 154 MPGe unadjusted city.
        const efficient = adjustmentComparison(154.2, 'city');
        expect(efficient.penaltyPct).toBeGreaterThan(10);

        // A thirstier vehicle gets the better of the regression.
        const thirsty = adjustmentComparison(50, 'city');
        expect(thirsty.penaltyPct).toBeLessThan(0);
    });

    it('caps adjusted economy at 1/intercept however efficient the vehicle', () => {
        // The ceiling is the whole mechanism: no vehicle, at any efficiency,
        // can be adjusted above it. The flat factor has no such ceiling.
        const ceiling = 1 / 0.003259;
        expect(derived5CycleFe(1e9, 'city')).toBeLessThan(ceiling);
        expect(derived5CycleFe(1e9, 'city')).toBeGreaterThan(ceiling * 0.999);
        expect(derived5CycleFe(500, 'city')).toBeLessThan(500 * 0.7);
    });

    it('guards bad input', () => {
        expect(derived5CycleFe(0, 'city')).toBeNull();
        expect(derived5CycleFe(100, 'nope')).toBeNull();
        expect(adjustmentComparison(-5, 'city')).toBeNull();
    });
});


describe('incomplete bags (#222)', () => {
    // The 2026 Model Y Performance highway bags, exactly as the record reports
    // them. The third is 9.96 mi against the HWFET's fixed 10.26 — the depletion
    // run ended mid-cycle — and reads 29% higher because the pack is flat by
    // then and the bag's fixed costs spread over fewer miles.
    const MODEL_Y_HWY = [
        { cycle: 'HWY', distanceMi: 10.265, wh: 2055.6, whPerMi: 2055.6 / 10.265 },
        { cycle: 'HWY', distanceMi: 10.266, wh: 1998.6, whPerMi: 1998.6 / 10.266 },
        { cycle: 'HWY', distanceMi: 9.960,  wh: 2506.5, whPerMi: 2506.5 / 9.960 },
    ];
    const TOTAL_DC_WH = 81528;
    const STATED_HWY_MI = 412.88;

    it('reproduces the range the record states, which averaging all three does not', () => {
        // The whole case for the exclusion: 412.87 against a stated 412.88.
        const ec = highwayConsumptionFromPhases(MODEL_Y_HWY);
        expect(TOTAL_DC_WH / ec).toBeCloseTo(STATED_HWY_MI, 1);

        // What it used to do, for contrast — 34 miles short.
        const naive = MODEL_Y_HWY.reduce((a, p) => a + p.whPerMi, 0) / MODEL_Y_HWY.length;
        expect(TOTAL_DC_WH / naive).toBeLessThan(380);
    });

    it('is not explained by a transcription error in the short bag', () => {
        // The alternative reading was a typo, 2.5065 kWh for 2.0565. That lands
        // 6 miles short of the stated range; exclusion lands within 0.01.
        const corrected = [...MODEL_Y_HWY.slice(0, 2),
            { cycle: 'HWY', distanceMi: 9.96, wh: 2056.5, whPerMi: 2056.5 / 9.96 }];
        const ec = corrected.reduce((a, p) => a + p.whPerMi, 0) / 3;
        expect(Math.abs(TOTAL_DC_WH / ec - STATED_HWY_MI)).toBeGreaterThan(5);
    });

    it('keeps bags that landed on their cycle', () => {
        expect(isCompleteCycle({ cycle: 'HWY', distanceMi: 10.265 })).toBe(true);
        expect(isCompleteCycle({ cycle: 'HWY', distanceMi: 10.266 })).toBe(true);
        expect(isCompleteCycle({ cycle: 'UDDS', distanceMi: 7.45 })).toBe(true);
    });

    it('drops one that stopped short', () => {
        expect(isCompleteCycle({ cycle: 'HWY', distanceMi: 9.96 })).toBe(false);
        expect(isCompleteCycle({ cycle: 'UDDS', distanceMi: 6.9 })).toBe(false);
    });

    it('treats an unmeasured bag as complete rather than discarding it', () => {
        // A record that never reported distances cannot be judged, and excluding
        // everything would be worse than including it. This is also why the
        // existing fixtures, which carry no distances, are unaffected.
        for (const d of [null, undefined, 0, 'x']) {
            expect(isCompleteCycle({ cycle: 'HWY', distanceMi: d }), String(d)).toBe(true);
        }
        expect(isCompleteCycle({ cycle: 'SS', distanceMi: 200 })).toBe(true);
    });

    it('leaves a record whose bags all completed exactly as it was', () => {
        // The regression guard: this correction must move only the records with
        // a partial bag. The R2 reconciled before and must still.
        const m = buildMethodologyModel(R2_MCT);
        expect(Math.round(m.cycles.hwy.rangeUnadjMi)).toBe(392);
    });
});
