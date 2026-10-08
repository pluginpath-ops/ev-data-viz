import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    MODEL_YEAR_CODES, isTestGroup, testGroupIn, testGroupYear,
    compareFilings, planCertificationImport, guideLinkTarget,
    vehicleModelYears, certificationsOf, certifiedYears, sinceYear, formatYears,
    newestLinkedCertification, resolveCertification, viewForVehicle, viewForTestVehicle, fromYearNote,
} from '../epaCertifications';

describe('Test Groups and their years', () => {
    it('reads the year from the first letter, skipping the letters EPA skips', () => {
        expect(testGroupYear('RHYXV00.0301')).toBe(2024);
        expect(testGroupYear('SHYXV00.0301')).toBe(2025);
        expect(testGroupYear('VVVXT00.0ZVG')).toBe(2027);
        // Carryover Test Groups in the live data reach back to 2018 and 2019.
        expect(testGroupYear('JNSXV0000TLA')).toBe(2018);
        expect(testGroupYear('KNSXV0000TS3')).toBe(2019);
        expect(MODEL_YEAR_CODES).not.toMatch(/[IOQUZ]/);
    });

    it('knows Nissan\'s dotless form', () => {
        expect(isTestGroup('SNSXV0000TL2')).toBe(true);
        expect(testGroupYear('SNSXV0000TL2')).toBe(2025);
    });

    it('is not fooled by a Vehicle ID or a header word', () => {
        for (const v of ['R1S0054R20C', '202625-2', 'Fuel', '', null, 'NE-U568EA011A-0']) {
            expect(isTestGroup(v)).toBe(false);
            expect(testGroupYear(v)).toBeNull();
        }
    });

    it('finds the Test Group inside a downloaded file name', () => {
        expect(testGroupIn('53642_NJLXT00.0TZA.pdf')).toBe('NJLXT00.0TZA');
        expect(testGroupIn('CSI-THYXV00.0W00-1.PDF')).toBe('THYXV00.0W00');
        expect(testGroupIn('60161_SNSXV0000TL2.pdf')).toBe('SNSXV0000TL2');
        expect(testGroupIn('Selected_2024_2025.csv')).toBeNull();
    });

    it('states the same rules as migration 082\'s backfill', () => {
        // The backfill and the importer must agree on what a Test Group is and
        // which year it is for, or a re-import would make a second certification
        // for a Test Group the backfill already holds.
        const sql = readFileSync('supabase/migrations/082_epa_certifications.sql', 'utf8');
        expect(sql).toContain(`'${MODEL_YEAR_CODES}'`);
        expect(sql).toContain('[A-Z]{5}(?:[0-9]{2}\\.[0-9]|[0-9]{4})[0-9A-Z]{3}');
    });
});

describe('ordering two filings of one Test Group', () => {
    it('orders by the CSI submission timestamp', () => {
        expect(compareFilings({ csi_submitted_at: '2021-07-13T05:36:48' }, { csi_submitted_at: '2021-08-11T03:46:48' })).toBe(1);
        expect(compareFilings({ csi_submitted_at: '2021-08-11T03:46:48' }, { csi_submitted_at: '2021-07-13T05:36:48' })).toBe(-1);
    });
    it('orders a backfilled filing by document id before trusting a date', () => {
        // Found end to end: the backfill kept the LATER Jaguar filing (53644)
        // with no timestamp, and importing the earlier one (53642, dated)
        // replaced it while "dated beats undated" came first.
        expect(compareFilings({ source_file: '53644_NJLXT00.0TZA.pdf' },
            { source_file: '53642_NJLXT00.0TZA.pdf', csi_submitted_at: '2021-07-13T05:36:48' })).toBe(-1);
    });
    it('puts a dated filing after an undated one when there is nothing else to go on', () => {
        expect(compareFilings({ source_file: 'CSI-NJLXT00.0TZA.PDF' }, { source_file: 'CSI-NJLXT00.0TZA-2.PDF', csi_submitted_at: '2021-07-13T05:36:48' })).toBe(1);
    });
    it('falls back to EPA document ids when neither is dated', () => {
        expect(compareFilings({ source_file: '53642_NJLXT00.0TZA.pdf' }, { source_file: '53644_NJLXT00.0TZA.pdf' })).toBe(1);
        expect(compareFilings({ source_file: 'CSI-A.PDF' }, { source_file: 'CSI-B.PDF' })).toBe(0);
    });
});

describe('planCertificationImport', () => {
    // The Jaguar I-Pace MY2022 pair from the corpus: the same Test Group filed
    // twice, the second adding a configuration.
    const first = {
        test_group: 'NJLXT00.0TZA', model_year: 2022, source_file: '53642_NJLXT00.0TZA.pdf',
        certificate_issue_date: '2021-07-22', certificate_revision_date: null,
        csi_submitted_at: '2021-07-13T05:36:48',
    };
    const second = {
        ...first, source_file: '53644_NJLXT00.0TZA.pdf',
        certificate_revision_date: '2021-08-09', csi_submitted_at: '2021-08-11T03:46:48',
    };

    it('inserts a Test Group it has never seen', () => {
        const p = planCertificationImport(null, first);
        expect(p.action).toBe('insert');
        expect(p.payload).toMatchObject({ test_group: 'NJLXT00.0TZA', model_year: 2022, basis: 'csi' });
        expect(p.replaceCoveredModels).toBe(true);
    });

    it('takes the year from the Test Group, not from what the parse said', () => {
        expect(planCertificationImport(null, { ...first, model_year: 2021 }).payload.model_year).toBe(2022);
    });

    it('lets a later filing replace an earlier one, and calls it recertified', () => {
        const p = planCertificationImport({ id: 1, basis: 'csi', ...first }, second);
        expect(p.action).toBe('update');
        expect(p.payload.source_file).toBe('53644_NJLXT00.0TZA.pdf');
        expect(p.payload.superseded_source_file).toBe('53642_NJLXT00.0TZA.pdf');
        expect(p.recertified).toBe(true);
        expect(p.replaceCoveredModels).toBe(true);
    });

    it('never lets an earlier filing replace a later one, but records it', () => {
        const p = planCertificationImport({ id: 1, basis: 'csi', ...second, superseded_source_file: null }, first);
        expect(p.payload).toEqual({ superseded_source_file: '53642_NJLXT00.0TZA.pdf' });
        expect(p.replaceCoveredModels).toBe(false);
        expect(p.recertified).toBe(true);
    });

    it('holds when the earlier filing is already recorded', () => {
        const p = planCertificationImport({ id: 1, basis: 'csi', ...second, superseded_source_file: first.source_file }, first);
        expect(p.action).toBe('hold');
    });

    it('re-imports the same file in place', () => {
        const p = planCertificationImport({ id: 1, basis: 'csi', ...first }, first);
        expect(p.action).toBe('update');
        expect(p.payload.superseded_source_file).toBeNull();
        expect(p.recertified).toBe(false);
    });

    it('upgrades a certification no file stood behind', () => {
        for (const basis of ['guide', 'csv', 'manual']) {
            const p = planCertificationImport({ id: 1, test_group: 'NJLXT00.0TZA', model_year: 2022, basis }, first);
            expect(p.action).toBe('update');
            expect(p.payload).toMatchObject({ basis: 'csi', source_file: first.source_file });
        }
    });

    it('fills the dates on a certification the backfill made from the same file', () => {
        const backfilled = { id: 1, basis: 'csi', test_group: 'NJLXT00.0TZA', model_year: 2022, source_file: first.source_file };
        const p = planCertificationImport(backfilled, first);
        expect(p.action).toBe('update');
        expect(p.payload.csi_submitted_at).toBe(first.csi_submitted_at);
    });
});

describe('guideLinkTarget', () => {
    const link = (id, test_group, fe_guide_row_id = null) => ({
        id, fe_guide_row_id, certification: { test_group, model_year: testGroupYear(test_group) },
    });

    it('goes to the certification the Guide row names', () => {
        const links = [link(1, 'RHYXV00.0W41'), link(2, 'SHYXV00.0W41')];
        expect(guideLinkTarget(links, { id: 9, model_year: 2025, smog_test_group: 'SHYXV00.0W41' })).toEqual({ linkId: 2 });
    });

    it('else to that year\'s certification, the stated one first', () => {
        // Toyota: the Guide carries a sibling Test Group, D14 against D11.
        const links = [link(1, 'TTYXT00.0D11'), link(2, 'TTYXT00.0D1V')];
        expect(guideLinkTarget(links, { id: 9, model_year: 2026, smog_test_group: 'TTYXT00.0D14' }, 'TTYXT00.0D1V'))
            .toEqual({ linkId: 2 });
    });

    it('does not take a year whose row is already linked to another Guide row', () => {
        const links = [link(1, 'TTYXT00.0D11', 77)];
        expect(guideLinkTarget(links, { id: 9, model_year: 2026, smog_test_group: 'TTYXT00.0D14' }))
            .toEqual({ create: { test_group: 'TTYXT00.0D14', model_year: 2026 } });
    });

    it('else makes the certification from the Guide row', () => {
        // A 2026 Guide row for a test vehicle whose newest file is 2025: the
        // carryover certification exists, we just never imported its CSI.
        const links = [link(1, 'SRIVT00.0193')];
        expect(guideLinkTarget(links, { id: 9, model_year: 2026, smog_test_group: 'TRIVT00.0193' }))
            .toEqual({ create: { test_group: 'TRIVT00.0193', model_year: 2026 } });
    });

    it('has nowhere to go when the Guide row names no Test Group', () => {
        expect(guideLinkTarget([link(1, 'SRIVT00.0193')], { id: 9, model_year: 2026, smog_test_group: null })).toBeNull();
    });
});

// ── Reading ─────────────────────────────────────────────────────────────────

/** One certification as the certifications embed returns it. */
const cert = (id, test_group, { guide = null, carryover = null, issued = null } = {}) => ({
    id: id * 10,
    fe_guide_row_id: guide?.id ?? null,
    fe_guide_skipped_at: null,
    carryover_test_group: carryover?.test_group ?? null,
    carryover_model_year: carryover?.model_year ?? null,
    certification: { id, test_group, model_year: testGroupYear(test_group), basis: 'csi', certificate_issue_date: issued },
    guide,
});
const guideRow = (id, model_year, label_comb_range_mi) => ({ id, model_year, label_comb_range_mi, smog_test_group: null });

// The Ioniq 5 RWD test vehicle NE-U168EA135R: certified 2022, 2023, 2024, with
// only 2023 linked to the Guide in this fixture.
const ioniq = {
    test_vehicle_id: 'NE-U168EA135R',
    model_year: 2024,                     // the stored year: whichever file came last
    label_range_published: 220,           // the certificate's own figure
    overrides: {},
    certifications: [
        cert(3, 'RHYXV00.0W51', { carryover: { test_group: 'NHYXV00.0W51', model_year: 2022 } }),
        cert(1, 'NHYXV00.0W51'),
        cert(2, 'PHYXV00.0W51', { guide: guideRow(501, 2023, 303) }),
    ],
};

describe('a vehicle\'s years and a test vehicle\'s certifications', () => {
    it('reads a single year and a range', () => {
        expect(vehicleModelYears('2025')).toEqual([2025]);
        expect(vehicleModelYears('2022-2024')).toEqual([2022, 2023, 2024]);
        expect(vehicleModelYears('2023–2026')).toEqual([2023, 2024, 2025, 2026]);
        expect(vehicleModelYears('')).toEqual([]);
        expect(vehicleModelYears(null)).toEqual([]);
    });

    it('lists certifications oldest first, each with its own link row', () => {
        expect(certificationsOf(ioniq).map(c => [c.model_year, c.linkId])).toEqual([[2022, 10], [2023, 20], [2024, 30]]);
        expect(certifiedYears(ioniq)).toEqual([2022, 2023, 2024]);
    });

    it('anchors the test vehicle on its first certified year — Since', () => {
        expect(sinceYear(ioniq)).toBe(2022);
        expect(sinceYear({ model_year: 2025 })).toBe(2025);
    });

    it('writes the years as a range, and a gap out loud', () => {
        expect(formatYears([2023, 2024, 2025])).toBe('MY2023 to MY2025');
        expect(formatYears([2022, 2024, 2025])).toBe('MY2022, MY2024 to MY2025');
        expect(formatYears([2025])).toBe('MY2025');
        expect(formatYears([])).toBe('');
    });

    it('takes lab-side readers\' Guide row from the newest linked year', () => {
        const twice = { ...ioniq, certifications: [...ioniq.certifications.slice(0, 2), cert(2, 'PHYXV00.0W51', { guide: guideRow(501, 2023, 303) }),
            cert(3, 'RHYXV00.0W51', { guide: guideRow(502, 2024, 310) })] };
        expect(newestLinkedCertification(twice).model_year).toBe(2024);
        expect(newestLinkedCertification({ certifications: [cert(1, 'NHYXV00.0W51')] })).toBeNull();
    });
});

describe('resolveCertification — automatic, and never silent (#374)', () => {
    it('takes the vehicle\'s own year', () => {
        const r = resolveCertification('2023', ioniq);
        expect(r).toMatchObject({ match: 'exact', fromYear: null, yearsOff: 0 });
        expect(r.certification.model_year).toBe(2023);
        expect(r.guideCertification.model_year).toBe(2023);
    });

    it('takes the newest of a range\'s years, and says when the range runs past them', () => {
        const r = resolveCertification('2024-2025', ioniq);
        expect(r.certification.model_year).toBe(2024);
        expect(r.partly).toBe(true);
    });

    it('borrows the nearest linked year\'s Guide figures, and says From MY…', () => {
        // 2024 is certified but unlinked: its figures come from the 2023 row.
        const r = resolveCertification('2024', ioniq);
        expect(r.certification.model_year).toBe(2024);
        expect(r.guideCertification.model_year).toBe(2023);
        expect(r.fromYear).toBe(2023);
    });

    it('lets a carryover stand in for a year with no certification of its own', () => {
        // NE-U568EA011A-0: the MY2026 certification carries over MY2025 lab work,
        // and no MY2025 file is held.
        const tv = { certifications: [cert(7, 'THYXV00.0W00', { carryover: { test_group: 'SHYXV00.0W00', model_year: 2025 }, guide: guideRow(9, 2026, 280) })] };
        const r = resolveCertification('2025', tv);
        expect(r).toMatchObject({ match: 'carryover', fromYear: 2026, yearsOff: 1 });
    });

    it('takes the nearest year otherwise, a tie to the newer, and measures how far', () => {
        const tv = { certifications: [cert(1, 'RFMXV00.0G4A'), cert(2, 'TFMXV00.0B4A')] };
        const r = resolveCertification('2025', tv);       // 2024 and 2026 are both one year off
        expect(r).toMatchObject({ match: 'other-year', fromYear: 2026, yearsOff: 1 });
        // The 2022 Mach-E mapped to a MY2024 configuration: two years is a finding.
        expect(resolveCertification('2022', { certifications: [cert(1, 'RFMXV00.0G4A')] }).yearsOff).toBe(2);
    });

    it('settles two certifications in one year without a picker, and marks it', () => {
        // One Ford Vehicle ID backs seven Test Groups in 2024. The linked one wins.
        const tv = { certifications: [cert(1, 'RFMXV00.0B4R'), cert(2, 'RFMXV00.0BLR', { guide: guideRow(5, 2024, 290) })] };
        const r = resolveCertification('2024', tv);
        expect(r.certification.test_group).toBe('RFMXV00.0BLR');
        expect(r.ambiguous).toBe(true);
    });

    it('has nothing to resolve when the test vehicle holds no certification', () => {
        expect(resolveCertification('2025', { certifications: [] }).match).toBe('none');
    });
});

describe('the view a reader gets', () => {
    it('lays the chosen year\'s Guide figures over the record, under the certification\'s identity', () => {
        const v = viewForVehicle('2023', ioniq);
        expect(v.label_range_published).toBe(303);
        expect(v.model_year).toBe(2023);
        expect(v.test_group).toBe('PHYXV00.0W51');
        expect(v.fe_guide_row_id).toBe(501);
        expect(v._certification).toMatchObject({ linkId: 20, ownGuideRowId: 501, fromYear: null, years: [2022, 2023, 2024] });
    });

    it('keeps the carryover origin the chosen certification names', () => {
        expect(viewForVehicle('2024', ioniq).carryover_model_year).toBe(2022);
        expect(viewForVehicle('2023', ioniq).carryover_model_year).toBeNull();
    });

    it('never lets the Guide replace a value set by hand', () => {
        const held = { ...ioniq, label_range_published: 299, overrides: { label_range_published: { source: 'manual' } } };
        expect(viewForVehicle('2023', held).label_range_published).toBe(299);
    });

    it('shows a test vehicle on its own by Since, with its newest linked figures', () => {
        const v = viewForTestVehicle(ioniq);
        expect(v.model_year).toBe(2022);
        expect(v.label_range_published).toBe(303);
    });

    it('leaves the record\'s own values when no year is linked', () => {
        const bare = { ...ioniq, certifications: [cert(1, 'NHYXV00.0W51')] };
        expect(viewForTestVehicle(bare).label_range_published).toBe(220);
        expect(viewForTestVehicle(bare).fe_guide_row_id).toBeNull();
    });

    it('words the mark as the owner chose: From MY…', () => {
        expect(fromYearNote(viewForVehicle('2024', ioniq)._certification).short).toBe('From MY2023');
        expect(fromYearNote(viewForVehicle('2023', ioniq)._certification)).toBeNull();
    });
});
