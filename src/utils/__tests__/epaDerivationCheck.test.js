/**
 * The check that validates our derivation against EPA's own numbers.
 *
 * The anchor is the R2: it reproduces EPA's published unadjusted MPGe to 0.03%,
 * so if this check ever reports anything but agreement there, the derivation has
 * regressed rather than the check being strict.
 */
import { describe, it, expect } from 'vitest';
import {
    checkUnadjustedMpge, CHECK_STATUS_LABELS, CHECK_SHAPE_ADVICE,
    AGREEMENT_TOLERANCE, DIVERGENCE_TOLERANCE,
} from '../epaDerivationCheck';
import { buildMethodologyModel } from '../epaMethodology';
import { R2_MCT, R2_GUIDE_ADJUSTMENT } from '../epaMethodologyFixtures';

// EPA's published unadjusted MPGe for the R2 20in AT.
const R2_PUBLISHED = { city: 154.2, hwy: 126.2 };

describe('checkUnadjustedMpge — against the one vehicle we verified by hand', () => {
    const model = buildMethodologyModel({ ...R2_MCT, adjustmentFactor: R2_GUIDE_ADJUSTMENT });

    it('agrees on both cycles', () => {
        const out = checkUnadjustedMpge(model, R2_PUBLISHED);
        expect(out.checked).toBe(true);
        expect(out.worst).toBe('agrees');
        expect(out.cycles.map(c => c.status)).toEqual(['agrees', 'agrees']);
    });

    it('reproduces EPA to a fraction of a percent', () => {
        const out = checkUnadjustedMpge(model, R2_PUBLISHED);
        for (const c of out.cycles) {
            expect(Math.abs(c.deltaPct), c.label).toBeLessThan(0.1);
        }
    });

    it('is independent of the adjustment factor', () => {
        // The whole reason for checking the UNADJUSTED figure: the factor must
        // not be able to move this result, or a wrong factor and a wrong
        // efficiency could cancel and pass.
        const flat = buildMethodologyModel(R2_MCT);
        const withGuide = checkUnadjustedMpge(model, R2_PUBLISHED);
        const withFlat  = checkUnadjustedMpge(flat, R2_PUBLISHED);
        expect(withFlat.cycles.map(c => c.ours))
            .toEqual(withGuide.cycles.map(c => c.ours));
    });
});

describe('checkUnadjustedMpge — banding', () => {
    const modelAt = (city, hwy) => ({ cycles: { city: { mpgeUnadj: city }, hwy: { mpgeUnadj: hwy } } });

    it('bands by distance from the published figure', () => {
        expect(checkUnadjustedMpge(modelAt(100, 100), { city: 100, hwy: 100 }).worst).toBe('agrees');
        expect(checkUnadjustedMpge(modelAt(103, 100), { city: 100, hwy: 100 }).worst).toBe('close');
        expect(checkUnadjustedMpge(modelAt(110, 100), { city: 100, hwy: 100 }).worst).toBe('disagrees');
    });

    it('bands the same in both directions', () => {
        // Deriving 9% low is exactly as wrong as deriving 9% high.
        expect(checkUnadjustedMpge(modelAt(91, 100), { city: 100, hwy: 100 }).worst).toBe('disagrees');
        expect(checkUnadjustedMpge(modelAt(109, 100), { city: 100, hwy: 100 }).worst).toBe('disagrees');
    });

    it('takes the worse of the two cycles', () => {
        // A model that nails city and misses highway by 9% does not agree.
        const out = checkUnadjustedMpge(modelAt(100, 109), { city: 100, hwy: 100 });
        expect(out.cycles.map(c => c.status)).toEqual(['agrees', 'disagrees']);
        expect(out.worst).toBe('disagrees');
    });

    it('catches a charging-efficiency error the size of the one in the data', () => {
        // Two groups for the same Model Y derive 76.8% and 83.7%. MPGe is
        // wall-to-wheels, so a ~9% error in efficiency moves MPGe by ~9% — this
        // is the discrepancy the check exists to surface.
        const out = checkUnadjustedMpge(modelAt(100 * (83.7 / 76.8), 100), { city: 100, hwy: 100 });
        expect(out.worst).toBe('disagrees');
    });

    it('places the boundaries where the constants say', () => {
        const justInside = 1 + AGREEMENT_TOLERANCE * 100 / 100 - 1e-9;
        expect(checkUnadjustedMpge(modelAt(100 * justInside, 100), { city: 100, hwy: 100 }).worst).toBe('agrees');
        const justOver = 1 + DIVERGENCE_TOLERANCE + 1e-6;
        expect(checkUnadjustedMpge(modelAt(100 * justOver, 100), { city: 100, hwy: 100 }).worst).toBe('disagrees');
    });
});

describe('checkUnadjustedMpge — which fault it points at', () => {
    const modelAt = (city, hwy) => ({ cycles: { city: { mpgeUnadj: city }, hwy: { mpgeUnadj: hwy } } });

    it('calls a matched shift on both cycles systematic', () => {
        // Charging efficiency is wall-side: it divides every cycle's
        // consumption alike. Two live Model Y groups do exactly this,
        // +1.03/+1.06% and +3.44/+4.02%.
        expect(checkUnadjustedMpge(modelAt(103.44, 104.02), { city: 100, hwy: 100 }).shape)
            .toBe('systematic');
        expect(checkUnadjustedMpge(modelAt(101.03, 101.06), { city: 100, hwy: 100 }).shape)
            .toBe('systematic');
    });

    it('calls one exact cycle and one wrong cycle-specific', () => {
        // The live YD226-00180 case: city -0.03%, highway -8.36%. No wall-side
        // quantity can produce that, so pointing at charging efficiency would
        // send someone to check the one thing that cannot be the cause.
        const out = checkUnadjustedMpge(modelAt(99.97, 91.64), { city: 100, hwy: 100 });
        expect(out.shape).toBe('cycle-specific');
        expect(CHECK_SHAPE_ADVICE[out.shape]).toMatch(/phases/);
    });

    it('calls opposite-direction errors cycle-specific', () => {
        // One high and one low cannot come from a single shared factor.
        expect(checkUnadjustedMpge(modelAt(108, 92), { city: 100, hwy: 100 }).shape)
            .toBe('cycle-specific');
    });

    it('has no shape to report from a single cycle', () => {
        expect(checkUnadjustedMpge(modelAt(108, null), { city: 100, hwy: 100 }).shape).toBeNull();
    });

    it('treats an uncomputable MPGe as unchecked, not as zero', () => {
        // Number(null) is 0 and 0 is finite. Left alone, a cycle the model could
        // not compute reports a -100% disagreement — a loud, confident, entirely
        // fictional finding.
        const out = checkUnadjustedMpge(modelAt(100, null), { city: 100, hwy: 100 });
        expect(out.cycles.map(c => c.cycle)).toEqual(['city']);
        expect(out.worst).toBe('agrees');
    });

    it('has advice for every shape it can emit', () => {
        for (const shape of ['systematic', 'cycle-specific']) {
            expect(CHECK_SHAPE_ADVICE[shape], shape).toBeTruthy();
        }
    });
});

describe('checkUnadjustedMpge — nothing to check is not a pass', () => {
    const model = buildMethodologyModel(R2_MCT);

    it('reports unchecked when no guide figures are linked', () => {
        // The distinction that matters: a group nobody has linked is UNVERIFIED,
        // and rendering it as agreeing would be a false assurance on most of the
        // fleet.
        for (const published of [{}, undefined, { city: null, hwy: null }, { city: 0, hwy: 0 }]) {
            const out = checkUnadjustedMpge(model, published);
            expect(out.checked, JSON.stringify(published)).toBe(false);
            expect(out.worst, JSON.stringify(published)).toBeNull();
            expect(out.cycles).toEqual([]);
        }
    });

    it('checks the cycle it can when only one figure is published', () => {
        const out = checkUnadjustedMpge(model, { city: 154.2 });
        expect(out.checked).toBe(true);
        expect(out.cycles.map(c => c.cycle)).toEqual(['city']);
    });

    it('returns unchecked for a model that could not be built', () => {
        expect(checkUnadjustedMpge(null, R2_PUBLISHED).checked).toBe(false);
        expect(checkUnadjustedMpge({}, R2_PUBLISHED).checked).toBe(false);
    });

    it('has wording for every status it can emit', () => {
        for (const status of ['agrees', 'close', 'disagrees']) {
            expect(CHECK_STATUS_LABELS[status], status).toBeTruthy();
        }
    });
});
