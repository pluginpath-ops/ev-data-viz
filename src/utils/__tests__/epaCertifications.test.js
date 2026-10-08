import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    MODEL_YEAR_CODES, isTestGroup, testGroupIn, testGroupYear,
    compareFilings, planCertificationImport, guideLinkTarget,
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
