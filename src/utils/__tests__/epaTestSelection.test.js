import { describe, it, expect } from 'vitest';
import {
    selectTestForGuide, scoreAgainstGuide, highwayUnadjustedMpge, chargeEfficiencyOf,
    SELECTION_MIN_MARGIN, SELECTION_MAX_SCORE,
    scoreAgainstGuideRanges, RANGE_SELECTION_MIN_MARGIN,
} from '../epaTestSelection';

/**
 * Mercedes' MY2027 CLA 350 (CSI-VMBXV00.0ED7) — two multi-cycle runs a month
 * apart, and the case this module exists for. EPA publishes 168.7 unadjusted
 * highway.
 *
 *   TMBX10091675 (Jul 22)   ->  168.66 MPGe   -0.03%
 *   TMBX10092210 (Aug 19)   ->  173.18 MPGe   +2.66%
 *
 * The most-recent default picks the second. EPA used the first.
 */
const JUL = {
    test_number: 'TMBX10091675', test_date: '2025-07-22', procedure_code: 77,
    total_dc_energy_kwh: 90.038, ac_recharge_kwh: 100.556,
    epa_test_phases: [
        { phase_type: 'HWY', distance_mi: 10.2743406, dc_energy_kwh: 2.0807097 },
        { phase_type: 'HWY', distance_mi: 10.2624932, dc_energy_kwh: 2.0233391 },
        { phase_type: 'UDDS', distance_mi: 7.49133, dc_energy_kwh: 1.4915767 },
    ],
};
const AUG = {
    test_number: 'TMBX10092210', test_date: '2025-08-19', procedure_code: 77,
    total_dc_energy_kwh: 89.595, ac_recharge_kwh: 99.4041,
    epa_test_phases: [
        { phase_type: 'HWY', distance_mi: 10.257,  dc_energy_kwh: 2.0355 },
        { phase_type: 'HWY', distance_mi: 10.2669, dc_energy_kwh: 1.9589 },
        { phase_type: 'UDDS', distance_mi: 7.4751, dc_energy_kwh: 1.4221 },
    ],
};
const PUBLISHED_HWY = 168.7;

/** The CLA's published label ranges, and the per-test ranges from #227. */
const RANGES = { labelCityRangeMi: 315, labelHwyRangeMi: 309 };
const withRanges = (t, city, hwy) =>
    ({ ...t, cd_range_combined_calc: city, cd_range_hwy_calc: hwy });
const JUL_R = withRanges(JUL, 461.373, 450.544);
const AUG_R = withRanges(AUG, 475.482, 460.354);

const close = (a, b, tol) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('the per-test figures the selection rests on', () => {
    it('derives highway unadjusted MPGe from a test\'s own phases', () => {
        // Wall-side, which is how MPGe is defined. Verified against the
        // certificate by hand before this was written.
        close(highwayUnadjustedMpge(JUL), 151.02, 0.05);
        close(highwayUnadjustedMpge(AUG), 156.09, 0.05);
    });

    it('measures each test\'s own charging efficiency', () => {
        // They differ between runs, which is why the score compares each test
        // against ITS own efficiency rather than one figure for the group.
        close(chargeEfficiencyOf(JUL), 0.8954, 0.0005);
        close(chargeEfficiencyOf(AUG), 0.9013, 0.0005);
    });

    it('declines a test with no highway phase rather than guessing', () => {
        expect(highwayUnadjustedMpge({ ...JUL, epa_test_phases: [] })).toBeNull();
    });

    it('declines when charging efficiency cannot be measured', () => {
        // Without it there is no way to get from the battery to the wall.
        expect(highwayUnadjustedMpge({ ...JUL, ac_recharge_kwh: null })).toBeNull();
    });
});

describe('selectTestForGuide — the CLA 350', () => {
    it('picks the run EPA actually used, not the most recent', () => {
        const s = selectTestForGuide([JUL, AUG], PUBLISHED_HWY);
        expect(s.testNumber).toBe('TMBX10091675');
        expect(s.reason).toBeNull();
    });

    it('picks it whichever order the tests arrive in', () => {
        expect(selectTestForGuide([AUG, JUL], PUBLISHED_HWY).testNumber).toBe('TMBX10091675');
    });

    it('wins by a wide margin, not a hair', () => {
        // 0.0002 against 0.0240 — two orders of magnitude. A selection worth
        // persisting has to be more than a coin toss.
        const s = selectTestForGuide([JUL, AUG], PUBLISHED_HWY);
        expect(s.score).toBeLessThan(0.001);
        expect(s.margin).toBeGreaterThan(50);
    });

    it('is not fooled by the label being battery-side', () => {
        // The trap. Our derivation is wall-side and this label is not, so plain
        // numeric distance picks the WRONG run: |151.02-168.7| = 17.7 against
        // |156.09-168.7| = 12.6. Scoring each test against its own charging
        // efficiency as well as against 1.0 is what fixes it.
        const naive = [JUL, AUG]
            .map(t => ({ n: t.test_number, d: Math.abs(highwayUnadjustedMpge(t) - PUBLISHED_HWY) }))
            .sort((a, b) => a.d - b.d)[0].n;
        expect(naive).toBe('TMBX10092210');                                   // what naive picks
        expect(selectTestForGuide([JUL, AUG], PUBLISHED_HWY).testNumber)
            .toBe('TMBX10091675');                                            // what this picks
    });
});

describe('selectTestForGuide — when it must decline', () => {
    it('declines a group with one test, because that is not a choice', () => {
        const s = selectTestForGuide([JUL], PUBLISHED_HWY);
        expect(s.testNumber).toBeNull();
        expect(s.reason).toBe('single-test');
    });

    it('declines two runs too alike to separate', () => {
        // Two runs of the same vehicle at the same laboratory can be
        // near-identical. Picking between them on the fourth decimal is
        // arbitrary dressed as a measurement, so the default stands.
        const twin = { ...JUL, test_number: 'TWIN' };
        const s = selectTestForGuide([JUL, twin], PUBLISHED_HWY);
        expect(s.testNumber).toBeNull();
        expect(s.reason).toBe('too-close-to-call');
    });

    it('declines when neither test is close to the published figure', () => {
        // A published figure nothing here explains means the guide row is
        // probably the wrong one — which is not something to answer by
        // choosing a test.
        const s = selectTestForGuide([JUL, AUG], 400);
        expect(s.testNumber).toBeNull();
        expect(s.reason).toBe('no-close-match');
    });

    it('declines with no published figure to compare against', () => {
        expect(selectTestForGuide([JUL, AUG], null).reason).toBe('not-scorable');
    });

    it('declines when the group holds no multi-cycle test', () => {
        const sct = { ...JUL, procedure_code: 84 };
        expect(selectTestForGuide([sct, { ...AUG, procedure_code: 81 }], PUBLISHED_HWY).reason)
            .toBe('no-mct');
    });

    it('names its thresholds so moving one is a deliberate edit', () => {
        expect(SELECTION_MIN_MARGIN).toBe(2);
        expect(SELECTION_MAX_SCORE).toBe(0.05);
    });
});

describe('scoreAgainstGuide', () => {
    it('scores the run EPA used far better than the other', () => {
        close(scoreAgainstGuide(JUL, PUBLISHED_HWY), 0.0002, 0.0005);
        close(scoreAgainstGuide(AUG, PUBLISHED_HWY), 0.0240, 0.002);
    });

    it('returns null rather than a number it cannot stand behind', () => {
        expect(scoreAgainstGuide(JUL, null)).toBeNull();
        expect(scoreAgainstGuide({ ...JUL, epa_test_phases: [] }, PUBLISHED_HWY)).toBeNull();
    });
});

describe('the range fallback, for guide rows with no unadjusted MPGe', () => {
    it('still picks the right run', () => {
        // Same answer as the primary signal, reached a different way.
        const s = selectTestForGuide([JUL_R, AUG_R], RANGES);
        expect(s.testNumber).toBe('TMBX10091675');
        expect(s.signal).toBe('label-range');
    });

    it('is used only when the primary signal cannot score', () => {
        // Blunter, so it never overrides a figure our derivation reproduces
        // exactly. With both available the MPGe path decides.
        const s = selectTestForGuide([JUL_R, AUG_R], { ...RANGES, unadjHwyMpge: PUBLISHED_HWY });
        expect(s.signal).toBe('unadjusted-mpge');
    });

    it('discriminates on the two implied factors agreeing, not on a distance', () => {
        // EPA applies one factor per configuration — measured across 112 rows,
        // median city-vs-highway difference 0.00000. So the right test is the
        // one whose city and highway factors agree.
        close(scoreAgainstGuideRanges(JUL_R, RANGES), 0.0031, 0.0005);
        close(scoreAgainstGuideRanges(AUG_R, RANGES), 0.0087, 0.0005);
    });

    it('refuses factors that are not plausible at all', () => {
        // Two absurd factors can agree with each other perfectly.
        expect(scoreAgainstGuideRanges(JUL_R, { labelCityRangeMi: 40, labelHwyRangeMi: 39 }))
            .toBeNull();
    });

    it('cannot score without the per-test ranges migration 060 added', () => {
        // Before those, every test in a group carried the group's single pair,
        // so this could not tell them apart at all.
        expect(scoreAgainstGuideRanges(JUL, RANGES)).toBeNull();
    });

    it('holds itself to a stricter margin than the primary signal', () => {
        // 2.6x here against 122x on MPGe. Published ranges are whole miles, and
        // +/-0.5 mi is about half the spread being measured.
        expect(RANGE_SELECTION_MIN_MARGIN).toBeGreaterThan(SELECTION_MIN_MARGIN);
        const s = selectTestForGuide([JUL_R, AUG_R], RANGES);
        expect(s.margin).toBeGreaterThan(RANGE_SELECTION_MIN_MARGIN);
    });

    it('declines when neither signal can score', () => {
        expect(selectTestForGuide([JUL, AUG], {}).reason).toBe('not-scorable');
    });
});
