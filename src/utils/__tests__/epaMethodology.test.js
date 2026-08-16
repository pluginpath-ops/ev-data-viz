import { describe, it, expect } from 'vitest';
import {
    buildMethodologyModel, cityConsumptionFromPhases,
    derived5CycleFe, derived5CycleCrossoverFe, adjustmentComparison,
} from '../epaMethodology';
import { R2_MCT, LIGHTNING_SCT } from '../epaMethodologyFixtures';

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
