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
    checkStatedRanges, checkLabelInvariant, LABEL_INVARIANT_TOLERANCE_MI,
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


describe('checkStatedRanges — a record against itself', () => {
    const model = buildMethodologyModel(R2_MCT);

    it('agrees when the bags reproduce the stated ranges', () => {
        const out = checkStatedRanges(model, {
            cityMi: model.cycles.city.rangeUnadjMi,
            hwyMi:  model.cycles.hwy.rangeUnadjMi,
        });
        expect(out.checked).toBe(true);
        expect(out.worst).toBe('agrees');
    });

    it('localises the real Model Y Performance fault to one cycle', () => {
        // The record states 457.261 city and 412.88 highway. Its bags derive
        // city correctly and highway around 378 — an 8% gap that took working
        // backwards from MPGe to find. This check names it directly.
        const faulty = { cycles: { city: { rangeUnadjMi: 457.3 }, hwy: { rangeUnadjMi: 378.4 } } };
        const out = checkStatedRanges(faulty, { cityMi: 457.261, hwyMi: 412.88 });

        expect(out.worst).toBe('disagrees');
        expect(out.cycles.map(c => c.status)).toEqual(['agrees', 'disagrees']);
        expect(out.cycles[1].deltaPct).toBeLessThan(-8);
    });

    it('needs no Fuel Economy Guide link', () => {
        // The point of it: the MPGe check only covers linked groups and compares
        // against a different document. This works on every imported record.
        const out = checkStatedRanges(model, { cityMi: 100, hwyMi: 100 });
        expect(out.checked).toBe(true);
    });

    it('reports unchecked when the record states no ranges', () => {
        for (const stated of [{}, undefined, { cityMi: null, hwyMi: 0 }]) {
            expect(checkStatedRanges(model, stated).checked, JSON.stringify(stated)).toBe(false);
        }
    });
});

describe('checkLabelInvariant — a label may never exceed the computed range', () => {
    it('flags the record whose computed range sits below its label', () => {
        // The live YD226-00180 case: 295.2 computed against a 306 label. Not a
        // disagreement — proof our derivation is too low, since the alternative
        // is that EPA certified an illegal label.
        const out = checkLabelInvariant({ combinedMi: 295.2, labeledMi: 306 });
        expect(out.violated).toBe(true);
        expect(out.shortfallMi).toBeCloseTo(10.8, 1);
    });

    it('flags the smaller live violation too', () => {
        expect(checkLabelInvariant({ combinedMi: 431.0, labeledMi: 434.0 }).violated).toBe(true);
    });

    it('accepts labelling below the computed value, which is the normal case', () => {
        // A 2.7% derate is permitted and common — the Model Y Premium does it.
        expect(checkLabelInvariant({ combinedMi: 329.9, labeledMi: 321 }).violated).toBe(false);
    });

    it('tolerates the label being a whole number', () => {
        expect(checkLabelInvariant({ combinedMi: 306.9, labeledMi: 307 }).violated).toBe(false);
        expect(checkLabelInvariant({ combinedMi: 307.0, labeledMi: 307 + LABEL_INVARIANT_TOLERANCE_MI }).violated)
            .toBe(false);
    });

    it('tests the arithmetic blend, the larger of the two', () => {
        // Conservative on purpose: the arithmetic mean is always at least the
        // harmonic, so a violation here holds on either blend. Testing the
        // smaller would flag records merely blended the other way.
        const model = buildMethodologyModel({ ...R2_MCT, labeledRangeMi: 307 });
        expect(model.combinedHarmMi).toBeLessThan(model.combinedMi);
        expect(checkLabelInvariant(model).computedMi).toBe(model.combinedMi);
    });

    it('blames the adjustment factor when the bags already reconcile', () => {
        // A live record: bags match its own stated ranges to 0.01%, yet the
        // label exceeds the computed range by 3 mi because the flat 0.700 was
        // applied to a vehicle EPA adjusted by 0.7048. Sending a curator to
        // check phase data here would waste their time on correct data.
        const out = checkLabelInvariant(
            { combinedMi: 431.0, labeledMi: 434.0, adjustment: 0.7 },
            { bagsReconcile: true },
        );
        expect(out.violated).toBe(true);
        expect(out.cause).toBe('adjustment');
        expect(out.impliedAdjustment).toBeCloseTo(0.7049, 3);
    });

    it('blames the phase data when the bags do not reconcile either', () => {
        const out = checkLabelInvariant(
            { combinedMi: 295.2, labeledMi: 306, adjustment: 0.7 },
            { bagsReconcile: false },
        );
        expect(out.cause).toBe('phases');
    });

    it('names no cause without bag evidence', () => {
        expect(checkLabelInvariant({ combinedMi: 295.2, labeledMi: 306, adjustment: 0.7 }).cause)
            .toBeNull();
    });

    it('reports unchecked without both figures', () => {
        expect(checkLabelInvariant({ combinedMi: 300 }).checked).toBe(false);
        expect(checkLabelInvariant({ labeledMi: 300 }).checked).toBe(false);
        expect(checkLabelInvariant(null).checked).toBe(false);
    });
});
