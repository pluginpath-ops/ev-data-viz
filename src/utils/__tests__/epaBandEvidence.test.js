import { describe, it, expect } from 'vitest';
import {
    bandEvidence, bandVerdict, allBandEvidence, BAND_EVIDENCE, BAND_EVIDENCE_MIN_N,
} from '../epaBandEvidence';

/**
 * Observations are the shape `certObservations` produces — one object per
 * certification group with the measured quantities on it. Built directly rather
 * than through a group fixture, because what is under test is the summarising
 * and the verdict, not the derivation that feeds them.
 */
const obs = (etas) => etas.map(eta => ({ eta, charger_eff: null, usable_kwh: null }));

/** n evenly spread across [lo, hi], so the quantiles are predictable. */
const spread = (n, lo, hi) =>
    obs(Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1)));

describe('bandEvidence', () => {
    it('summarises the measured spread, and says how much of the corpus that is', () => {
        // "median 0.87 (n=61 of 204)" says something a bare median does not.
        const e = bandEvidence(spread(101, 0.80, 0.90), 'ETA_BAND');
        expect(e.enough).toBe(true);
        expect(e.n).toBe(101);
        expect(e.total).toBe(101);
        expect(e.median).toBeCloseTo(0.85, 3);
        expect(e.min).toBeCloseTo(0.80, 3);
        expect(e.max).toBeCloseTo(0.90, 3);
        expect(e.p5).toBeGreaterThan(e.min);
        expect(e.p95).toBeLessThan(e.max);
    });

    it('counts only the records carrying a measured value', () => {
        // A value that fell back to a default is not evidence about anything —
        // and a band derived partly from its own default would be circular.
        const mixed = [...spread(60, 0.80, 0.90), ...obs([null, null, undefined])];
        const e = bandEvidence(mixed, 'ETA_BAND');
        expect(e.n).toBe(60);
        expect(e.total).toBe(63);
    });

    it('declines rather than describing a handful of cars', () => {
        // Quantiles over a few records would be narrower than the truth, and
        // nothing in the output would reveal that.
        const e = bandEvidence(spread(BAND_EVIDENCE_MIN_N - 1, 0.80, 0.90), 'ETA_BAND');
        expect(e.enough).toBe(false);
        expect(e.median).toBeUndefined();
    });

    it('returns nothing for a knob that is not a band', () => {
        expect(bandEvidence(spread(50, 0.8, 0.9), 'CURVE_SPEED_RANGE')).toBeNull();
    });

    it('maps every band to a measure that exists', () => {
        // A band shown against the WRONG distribution is worse than none,
        // because it looks like evidence.
        for (const [, spec] of Object.entries(BAND_EVIDENCE)) {
            expect(spec.measure).toBeTruthy();
            expect(spec.label).toBeTruthy();
        }
    });
});

describe('bandVerdict — is this bound doing what I think', () => {
    const e = bandEvidence(spread(101, 0.80, 0.90), 'ETA_BAND');

    it('calls a band that cuts into real records tight', () => {
        // The failure that matters: the flag fires on data rather than faults.
        expect(bandVerdict([0.84, 0.86], e).key).toBe('tight');
    });

    it('calls a band nothing can trip loose', () => {
        expect(bandVerdict([0.1, 0.99], e).key).toBe('loose');
    });

    it('calls a band that clips only the tails a fit', () => {
        expect(bandVerdict([0.80, 0.90], e).key).toBe('fits');
    });

    it('says nothing when there is not enough to say it from', () => {
        const thin = bandEvidence(spread(5, 0.80, 0.90), 'ETA_BAND');
        expect(bandVerdict([0.75, 0.92], thin)).toBeNull();
        expect(bandVerdict(null, e)).toBeNull();
        expect(bandVerdict([0.75], e)).toBeNull();
    });

    it('judges the CURRENT value, not the default', () => {
        // The panel passes the live value, so a curator narrowing a band sees
        // the verdict change as they type rather than after a reload. The two
        // here are the shipped ETA_BAND and a hand-narrowed one.
        expect(bandVerdict([0.75, 0.92], e).key).toBe('loose');
        expect(bandVerdict([0.84, 0.86], e).key).toBe('tight');
    });

    it('does not call a band tight for clipping only the extreme tails', () => {
        // That is what a band is FOR. 'tight' has to mean it cuts into the
        // p5-p95 body, or the verdict fires on every sensible bound.
        expect(bandVerdict([0.801, 0.899], e).key).toBe('fits');
    });
});

describe('allBandEvidence', () => {
    it('covers every band from one pass', () => {
        const all = allBandEvidence([], null);
        expect(Object.keys(all).sort()).toEqual(Object.keys(BAND_EVIDENCE).sort());
    });

    it('survives an empty corpus without inventing a bound', () => {
        for (const e of Object.values(allBandEvidence([], null))) {
            expect(e.enough).toBe(false);
        }
    });
});
