/**
 * EPA Certifications: one per Test Group, many-to-many with EPA test vehicles
 * (#374, migration 082).
 *
 * An EPA Certification is one filing for ONE model year, named by EPA's Test
 * Group (`RHYXV00.0301`). An EPA test vehicle is the car in the lab, keyed by
 * its Vehicle ID. A carryover certification reuses an earlier year's test
 * vehicle, so one test vehicle appears in several years' certifications, and
 * one certificate can name several test vehicles.
 *
 * This module holds the rules both halves of the system must agree on — the
 * migration's backfill states the same ones in SQL, and the tests below pin
 * them — so the importer and the backfill cannot drift apart:
 *
 *   • what a Test Group looks like, and which year it is for
 *   • whether an incoming filing replaces the stored one (Recertified)
 *   • which of a test vehicle's certifications a Guide link belongs to
 *
 * Pure module: no data access.
 */

// ── Test Groups and their years ─────────────────────────────────────────────

/**
 * EPA's model-year code: the first character of a Test Group. It skips I, O,
 * Q, U and Z, so it is not contiguous. A = 2010 … Y = 2030. Carryover Test
 * Groups in the live data reach back to J (2018) and K (2019).
 */
export const MODEL_YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY';
const FIRST_CODE_YEAR = 2010;

/**
 * A Test Group: five letters (year, manufacturer, class), then `00.0` and three
 * characters, or — Nissan's form — `0000` and three (`SNSXV0000TL2`).
 * The dotless form is why the parser's old shape check, which required a dot,
 * never read a Nissan certificate's page 1.
 */
const TEST_GROUP_SOURCE = '[A-Z]{5}(?:\\d{2}\\.\\d|\\d{4})[0-9A-Z]{3}';
const TEST_GROUP_PATTERN = new RegExp(TEST_GROUP_SOURCE);
const WHOLE = new RegExp(`^${TEST_GROUP_SOURCE}$`);

/** True when `value` is exactly a Test Group. */
export function isTestGroup(value) {
    return WHOLE.test(String(value ?? '').trim());
}

/** The Test Group inside a longer string (a file name), or null. */
export function testGroupIn(text) {
    const m = String(text ?? '').match(TEST_GROUP_PATTERN);
    return m ? m[0] : null;
}

/**
 * The model year a Test Group certifies, from its first letter. The letter is
 * the authority: all 1,175 Fuel Economy Guide rows agree with it, and 104 of
 * our stored records' `model_year` did not (#374).
 */
export function testGroupYear(testGroup) {
    const tg = String(testGroup ?? '').trim();
    if (!isTestGroup(tg)) return null;
    const i = MODEL_YEAR_CODES.indexOf(tg[0].toUpperCase());
    return i < 0 ? null : FIRST_CODE_YEAR + i;
}

// ── A second filing of the same Test Group ──────────────────────────────────

/**
 * When the stored filing and an incoming one can be put in order.
 *
 *   1. The CSI Submission/Revision timestamp orders them exactly — 459 of 459
 *      corpus files carry one.
 *   2. Else EPA's document id, the number a downloaded file's name starts with
 *      (`53644_NJLXT00.0TZA.pdf`). A certification the backfill made has a file
 *      name but no timestamp, so this is what orders a re-import against it.
 *   3. Else a dated filing is taken as the later one, over an undated one with
 *      nothing to compare.
 *
 * The document id comes before "dated beats undated" on purpose: the Jaguar
 * I-Pace's backfilled row is the LATER filing (53644, undated), and importing
 * the earlier one (53642, dated) must not replace it. Found end to end.
 *
 * Returns 1 when `incoming` is the later filing, -1 when earlier, 0 when they
 * are the same filing or cannot be told apart.
 */
export function compareFilings(stored, incoming) {
    const a = stored?.csi_submitted_at ?? null;
    const b = incoming?.csi_submitted_at ?? null;
    if (a && b) return a === b ? 0 : (b > a ? 1 : -1);
    const docId = (f) => { const m = String(f ?? '').match(/^(\d+)_/); return m ? Number(m[1]) : null; };
    const da = docId(stored?.source_file), db = docId(incoming?.source_file);
    if (da != null && db != null && da !== db) return db > da ? 1 : -1;
    if (b && !a) return 1;
    if (a && !b) return -1;
    return 0;
}

const FILING_FIELDS = [
    'model_year', 'certificate_issue_date', 'certificate_revision_date',
    'csi_submitted_at', 'source_file',
];

/**
 * What importing one CSI's certification should do to the stored row.
 *
 *   insert   nothing stored for this Test Group
 *   update   the incoming filing is the one to keep: no stored row from a file
 *            (basis csv / guide / manual is upgraded to csi), the same filing
 *            re-imported, or a later one — EPA revised the certificate
 *            (Recertified), and the earlier file is kept as
 *            `superseded_source_file`
 *   hold     the incoming filing is the EARLIER one. The stored filing stays;
 *            the older file is still recorded as superseded, and the
 *            certificate's covered models are not replaced by an out-of-date
 *            list — the same rule #400 applies to a test vehicle's identity.
 *
 * @param {Object|null} stored    epa_certifications row
 * @param {Object}      incoming  the parser's `certification` (test_group,
 *                                model_year, certificate_*_date,
 *                                csi_submitted_at, source_file)
 * @returns {{ action, payload, replaceCoveredModels: boolean, recertified: boolean }}
 */
export function planCertificationImport(stored, incoming) {
    const pick = (o) => Object.fromEntries(FILING_FIELDS.map(f => [f, o?.[f] ?? null]));
    const year = testGroupYear(incoming?.test_group) ?? incoming?.model_year ?? null;
    const filing = { ...pick(incoming), model_year: year };

    if (!stored) {
        return {
            action: 'insert',
            payload: { test_group: incoming.test_group, ...filing, basis: 'csi' },
            replaceCoveredModels: true,
            recertified: incoming?.certificate_revision_date != null,
        };
    }

    // A row no file stood behind takes the file whole.
    if (stored.basis !== 'csi') {
        return {
            action: 'update',
            payload: { ...filing, basis: 'csi' },
            replaceCoveredModels: true,
            recertified: incoming?.certificate_revision_date != null,
        };
    }

    const sameFile = stored.source_file && stored.source_file === incoming?.source_file;
    const order = sameFile ? 0 : compareFilings(stored, incoming);

    if (order > 0 || sameFile || (order === 0 && !stored.source_file)) {
        const superseded = !sameFile && stored.source_file ? stored.source_file : (stored.superseded_source_file ?? null);
        return {
            action: 'update',
            payload: { ...filing, basis: 'csi', superseded_source_file: superseded },
            replaceCoveredModels: true,
            recertified: (incoming?.certificate_revision_date ?? null) != null || (!sameFile && !!stored.source_file),
        };
    }

    // Earlier, or two different files that cannot be ordered: keep what is
    // stored. Recording the other file means nothing is silently discarded.
    const note = incoming?.source_file && incoming.source_file !== stored.source_file
        && !stored.superseded_source_file
        ? { superseded_source_file: incoming.source_file }
        : {};
    return {
        action: Object.keys(note).length ? 'update' : 'hold',
        payload: note,
        replaceCoveredModels: false,
        recertified: (stored.certificate_revision_date ?? null) != null || Object.keys(note).length > 0,
    };
}

// ── Which certification a Guide link belongs to ─────────────────────────────

/**
 * Where a Fuel Economy Guide link lands among one test vehicle's
 * certifications. The Guide is published by year, keyed by EPA's Test Group, so
 * the link goes to the certification the Guide row names — migration 082 moved
 * every existing link by this rule, and linking keeps using it until the link
 * is made per certification (#374 layer 4).
 *
 *   1. the link row whose certification IS the Guide row's (year, Test Group)
 *   2. else the one in the Guide row's year (the Guide carries a sibling Test
 *      Group — Toyota `TTYXT00.0D14` against `D11`), preferring the
 *      certification the record states (`statedTestGroup`)
 *   3. else a new certification made from the Guide row — basis 'guide'
 *
 * @param {Array}  links  [{ id, fe_guide_row_id, certification: { test_group, model_year } }]
 * @param {Object} guideRow  epa_fe_guide row (model_year, smog_test_group)
 * @param {string} [statedTestGroup]  the test vehicle's own `test_group`
 * @returns {{ linkId: number } | { create: { test_group, model_year } } | null}
 *          null when the Guide row names no Test Group, so there is nowhere
 *          to put it
 */
export function guideLinkTarget(links = [], guideRow, statedTestGroup = null) {
    if (!guideRow) return null;
    const year = Number(guideRow.model_year);
    const tg = guideRow.smog_test_group ? String(guideRow.smog_test_group).trim() : null;

    const exact = links.find(l => l.certification?.test_group === tg
        && Number(l.certification?.model_year) === year);
    if (exact) return { linkId: exact.id };

    const sameYear = links
        .filter(l => Number(l.certification?.model_year) === year
            && (l.fe_guide_row_id == null || l.fe_guide_row_id === guideRow.id))
        .sort((a, b) => (b.certification?.test_group === statedTestGroup) - (a.certification?.test_group === statedTestGroup)
            || a.id - b.id);
    if (sameYear.length) return { linkId: sameYear[0].id };

    if (!tg || !isTestGroup(tg)) return null;
    return { create: { test_group: tg, model_year: testGroupYear(tg) ?? year } };
}
