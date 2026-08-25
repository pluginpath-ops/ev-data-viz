import { describe, it, expect } from 'vitest';
import { EPA_DEFAULTS, HWFET_TO_SS_ETA_RATIO } from '../../constants/epa';
import { KNOB_KEYS, knobDefault } from '../../constants/knobs';

/**
 * The correction factor is a MEASUREMENT, not a chosen value, so what is worth
 * pinning is its provenance rather than its arithmetic.
 *
 * Fleet median of ss_eta / eta across 210 certification groups carrying both,
 * after the impossible values were excluded: median 1.1281, IQR 1.1162-1.1449,
 * full range 1.0647-1.2830.
 */
describe('HWFET_TO_SS_ETA_RATIO', () => {
    it('is the measured fleet median', () => {
        expect(EPA_DEFAULTS.HWFET_TO_SS_ETA_RATIO).toBe(1.1281);
    });

    it('sits inside the observed interquartile range', () => {
        // If a future edit moves it outside the spread it was derived from,
        // it has stopped being the measurement it claims to be.
        expect(HWFET_TO_SS_ETA_RATIO).toBeGreaterThan(1.1162);
        expect(HWFET_TO_SS_ETA_RATIO).toBeLessThan(1.1449);
    });

    it('corrects in the right direction, and by more than it can be wrong', () => {
        // A steady-state η runs HIGHER than the HWFET one, so the factor is
        // above 1. Uncorrected, a group with no constant-speed phase is 11.4%
        // low in one direction for certain; corrected, half the fleet lands
        // within 2.5% and the worst observed case is 13.7% out.
        expect(HWFET_TO_SS_ETA_RATIO).toBeGreaterThan(1);
        const uncorrectedError = Math.abs(1 / HWFET_TO_SS_ETA_RATIO - 1);
        const typicalCorrected = (1.1449 - 1.1162) / 2 / HWFET_TO_SS_ETA_RATIO;
        expect(typicalCorrected).toBeLessThan(uncorrectedError);
    });

    it('is a knob, because the corpus moves', () => {
        // It was derived from 210 groups and the next import changes that.
        // A measured default that cannot be re-set is a literal with a story.
        expect(KNOB_KEYS).toContain('HWFET_TO_SS_ETA_RATIO');
        expect(knobDefault('HWFET_TO_SS_ETA_RATIO')).toBe(1.1281);
    });

    it('is not yet applied to anything', () => {
        // Step 5. Adding the constant and using it are separate on purpose:
        // applying it changes every range figure for the groups with no
        // constant-speed phase, and that deserves its own review.
        expect(HWFET_TO_SS_ETA_RATIO).toBe(EPA_DEFAULTS.HWFET_TO_SS_ETA_RATIO);
    });
});
