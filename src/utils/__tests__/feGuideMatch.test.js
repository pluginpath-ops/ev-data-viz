import { describe, it, expect } from 'vitest';
import {
    normaliseMake, sameMake, carlineScore, rankFeCandidates, bestFeCandidate, MATCH_FLOOR,
} from '../feGuideMatch';

/** Shapes taken from the staged MY2025 rows. */
const fe = (division, carline, model_year = 2025, extra = {}) =>
    ({ id: `${division}-${carline}`, division, carline, model_year, ...extra });

describe('sameMake', () => {
    it('matches our short names to the guide\'s corporate ones', () => {
        // Ours are marketing names, the guide's are legal entities. 13 of our 16
        // makes match a division exactly; all 16 match once case and
        // punctuation go and containment is allowed either way.
        expect(sameMake('Tesla', 'Tesla Motors')).toBe(true);
        expect(sameMake('Lucid', 'Lucid USA Inc.')).toBe(true);
        expect(sameMake('Volvo', 'Volvo Cars of North America, LLC')).toBe(true);
        expect(sameMake('Hyundai', 'HYUNDAI MOTOR COMPANY')).toBe(true);
        expect(sameMake('BMW', 'BMW')).toBe(true);
    });

    it('does not match different manufacturers', () => {
        expect(sameMake('Rivian', 'Ford')).toBe(false);
        expect(sameMake('Audi', 'Cadillac')).toBe(false);
    });

    it('is false when either side is missing', () => {
        expect(sameMake('', 'Ford')).toBe(false);
        expect(sameMake('Ford', null)).toBe(false);
    });

    it('normalises to comparable text', () => {
        expect(normaliseMake('Mercedes-Benz')).toBe('mercedesbenz');
        expect(normaliseMake(null)).toBe('');
    });
});

describe('carlineScore', () => {
    it('scores an exact restatement 1', () => {
        expect(carlineScore('R1T Performance Dual Max (22in)', 'R1T Performance Dual Max (22in)')).toBe(1);
    });

    it('scores our shorter form against their fuller one', () => {
        // The measured case: `Ioniq 5` against `Ioniq 5 RWD`.
        expect(carlineScore('Ioniq 5', 'Ioniq 5 RWD')).toBeCloseTo(0.67, 2);
    });

    it('is token overlap, not edit distance', () => {
        // iX3 and iX1 are one character apart and are different cars. Edit
        // distance rewards that; token overlap does not.
        expect(carlineScore('iX3 50 xDrive', 'iX1 50 xDrive')).toBeLessThan(0.7);
        expect(carlineScore('iX3 50 xDrive', 'iX3 50 xDrive')).toBe(1);
    });

    it('scores unrelated names at zero', () => {
        expect(carlineScore('Ioniq 5', 'Mustang Mach-E')).toBe(0);
        expect(carlineScore('', 'Ioniq 5')).toBe(0);
    });
});

describe('rankFeCandidates', () => {
    const rows = [
        fe('Rivian', 'R1S Dual Large (21in)'),
        fe('Rivian', 'R1T Performance Dual Max (22in)'),
        fe('Rivian', 'R1T All-Terrain Dual Large (20in)'),
        fe('Ford',   'Mustang Mach-E GT'),
        fe('Rivian', 'R1T Performance Dual Max (22in)', 2026),   // right car, wrong year
    ];
    const group = { make: 'Rivian', model_year: 2025, epa_carline_name: 'R1T Performance Dual Max (22in)' };

    it('puts the correct row first', () => {
        const [top] = rankFeCandidates(group, rows);
        expect(top.row.carline).toBe('R1T Performance Dual Max (22in)');
        expect(top.score).toBe(1);
    });

    it('excludes other makes', () => {
        expect(rankFeCandidates(group, rows).some(c => c.row.division === 'Ford')).toBe(false);
    });

    it('keeps other model years but sorts them below', () => {
        // Excluding them told a 2026 Model Y group there were "no staged rows
        // for Tesla in 2026" while sixteen Tesla rows sat in the 2025 guide.
        // A vehicle that carries over spans two guide years.
        const ranked = rankFeCandidates(group, rows);
        expect(ranked.some(c => c.row.model_year === 2026)).toBe(true);
        expect(ranked[0].exactYear).toBe(true);
        expect(ranked[ranked.length - 1].exactYear).toBe(false);
    });

    it('never proposes a cross-year row on its own', () => {
        // EPA figures move between years, so borrowing one is a decision the
        // curator makes with the year in front of them.
        const only2025 = [fe('Tesla Motors', 'Model Y Long Range AWD', 2025)];
        const group2026 = { make: 'Tesla', model_year: 2026, epa_carline_name: 'Model Y Long Range AWD' };
        expect(rankFeCandidates(group2026, only2025)).toHaveLength(1);
        expect(bestFeCandidate(group2026, only2025)).toBeNull();
    });

    it('breaks a score tie toward the shorter name', () => {
        const tie = [
            fe('Rivian', 'R1T Performance Dual Max (22in) with the long qualifier'),
            fe('Rivian', 'R1T Performance Dual Max (22in)'),
        ];
        expect(rankFeCandidates(group, tie)[0].row.carline).toBe('R1T Performance Dual Max (22in)');
    });

    it('returns nothing for a group with no make', () => {
        expect(rankFeCandidates({ model_year: 2025 }, rows)).toEqual([]);
        expect(rankFeCandidates(null, rows)).toEqual([]);
    });

    it('ranks every candidate when the group states no year', () => {
        const undated = { make: 'Rivian', epa_carline_name: 'R1T Performance Dual Max (22in)' };
        expect(rankFeCandidates(undated, rows).length).toBe(4);
    });
});

describe('bestFeCandidate', () => {
    const rows = [fe('Rivian', 'R1S Dual Large (21in)'), fe('Rivian', 'R1T Performance Dual Max (22in)')];

    it('proposes the top row when it is close enough', () => {
        const group = { make: 'Rivian', model_year: 2025, epa_carline_name: 'R1T Performance Dual Max (22in)' };
        expect(bestFeCandidate(group, rows).row.carline).toBe('R1T Performance Dual Max (22in)');
    });

    it('proposes nothing when the make matches but the car does not', () => {
        // Otherwise a group arrives pre-filled with a confident-looking wrong
        // answer, which is worse than an empty picker.
        const group = { make: 'Rivian', model_year: 2025, epa_carline_name: 'Something Else Entirely' };
        expect(bestFeCandidate(group, rows)).toBeNull();
    });

    it('has a floor low enough for the real short-form case', () => {
        // `Ioniq 5` -> `Ioniq 5 RWD` is 0.67 and must pass on score.
        expect(MATCH_FLOOR).toBeLessThan(0.67);
    });

    it('proposes nothing when the top candidates tie', () => {
        // Real case: our carline is often just `Ioniq 5`, which scores
        // identically against every variant — and those are 221 and ~300 miles
        // apart. Any tie-break is arbitrary dressed as a judgement, and the
        // first version proposed the 221-mile N purely for having a short name.
        const ambiguous = { make: 'Hyundai', model_year: 2025, epa_carline_name: 'Ioniq 5' };
        const variants = [
            fe('HYUNDAI MOTOR COMPANY', 'Ioniq 5 N',   2025, { label_comb_range_mi: 221 }),
            fe('HYUNDAI MOTOR COMPANY', 'Ioniq 5 RWD', 2025, { label_comb_range_mi: 303 }),
        ];
        expect(carlineScore('Ioniq 5', 'Ioniq 5 N'))
            .toBeCloseTo(carlineScore('Ioniq 5', 'Ioniq 5 RWD'), 6);
        expect(bestFeCandidate(ambiguous, variants)).toBeNull();
        // The curator still gets both, ranked.
        expect(rankFeCandidates(ambiguous, variants)).toHaveLength(2);
    });

    it('still proposes when the winner is strictly better', () => {
        const group = { make: 'Hyundai', model_year: 2025, epa_carline_name: 'Ioniq 5 RWD' };
        const variants = [
            fe('HYUNDAI MOTOR COMPANY', 'Ioniq 5 N',   2025),
            fe('HYUNDAI MOTOR COMPANY', 'Ioniq 5 RWD', 2025),
        ];
        expect(bestFeCandidate(group, variants).row.carline).toBe('Ioniq 5 RWD');
    });
});
