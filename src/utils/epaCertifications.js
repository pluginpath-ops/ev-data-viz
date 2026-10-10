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

import { guideOverlay } from './feGuidePromotion';

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

// ── Reading: a test vehicle's certifications, and the one a vehicle reads ────

/**
 * An EVBench vehicle's model years, from its `year` text: "2025", or a range
 * "2022-2024" (all 109 vehicles parse today). Empty when it says nothing usable.
 */
export function vehicleModelYears(yearText) {
    const m = String(yearText ?? '').trim().match(/^(\d{4})(?:\s*[-–]\s*(\d{4}))?$/);
    if (!m) return [];
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (b < a || b - a > 20) return [a];
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/**
 * A test vehicle's certifications, flattened from the embed DataService reads
 * (`certifications: epa_certification_test_vehicles(…, certification, guide)`),
 * oldest first. Each is one certification as THIS test vehicle is in it: the
 * link row's id, its Guide link and skip, and its carryover origin.
 */
export function certificationsOf(testVehicle) {
    return (testVehicle?.certifications ?? [])
        .filter(l => l?.certification)
        .map(l => ({
            linkId:               l.id,
            id:                   l.certification.id ?? null,
            test_group:           l.certification.test_group,
            model_year:           Number(l.certification.model_year),
            basis:                l.certification.basis ?? null,
            certificate_issue_date:    l.certification.certificate_issue_date ?? null,
            certificate_revision_date: l.certification.certificate_revision_date ?? null,
            carryover_test_group: l.carryover_test_group ?? null,
            carryover_model_year: l.carryover_model_year ?? null,
            fe_guide_row_id:      l.fe_guide_row_id ?? null,
            fe_guide_skipped_at:  l.fe_guide_skipped_at ?? null,
            fe_guide_skip_note:   l.fe_guide_skip_note ?? null,
            guide:                l.guide ?? null,
        }))
        .sort((a, b) => a.model_year - b.model_year || String(a.test_group).localeCompare(String(b.test_group)));
}

/** The distinct years a test vehicle is certified for, ascending. */
export function certifiedYears(testVehicle) {
    return [...new Set(certificationsOf(testVehicle).map(c => c.model_year))].sort((a, b) => a - b);
}

/**
 * "Since MY2023": the first year the test vehicle appears in a certification
 * we hold — the year it is anchored on (owner, #374). The corpus starts at
 * MY2021, so it is the first year in the data, not necessarily the first year
 * EPA certified it. Falls back to the record's stored year when no
 * certification is held (none, after migration 082's backfill).
 */
export function sinceYear(testVehicle) {
    const years = certifiedYears(testVehicle);
    if (years.length) return years[0];
    const y = Number(testVehicle?.model_year);
    return Number.isFinite(y) && y > 0 ? y : null;
}

/**
 * The years line: "MY2023 to MY2025", and a gap written out rather than
 * hidden inside a range — "MY2022, MY2024 to MY2025" (4 Vehicle IDs skip a
 * year in the corpus).
 */
export function formatYears(years = []) {
    const ys = [...new Set(years.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
    if (!ys.length) return '';
    const runs = [];
    for (const y of ys) {
        const last = runs[runs.length - 1];
        if (last && y === last[1] + 1) last[1] = y; else runs.push([y, y]);
    }
    return runs.map(([a, b]) => (a === b ? `MY${a}` : `MY${a} to MY${b}`)).join(', ');
}

const yearDistance = (year, years) => Math.min(...years.map(y => Math.abs(y - year)));

/** Nearest to the vehicle's years; a tie goes to the newer certification. */
function nearest(certs, years) {
    return [...certs].sort((a, b) => yearDistance(a.model_year, years) - yearDistance(b.model_year, years)
        || b.model_year - a.model_year)[0] ?? null;
}

/** Within one year: a linked certification first, then the latest issued. */
const withinYear = (a, b) => (b.fe_guide_row_id != null) - (a.fe_guide_row_id != null)
    || String(b.certificate_issue_date ?? '').localeCompare(String(a.certificate_issue_date ?? ''))
    || (b.id ?? 0) - (a.id ?? 0);

/**
 * The test vehicle's newest certification carrying a Guide link — the one
 * lab-side readers (statistics, curves, the audit, the Guide browser's links)
 * take their Guide row from (owner, D3). Null when none is linked.
 */
export function newestLinkedCertification(testVehicle) {
    return certificationsOf(testVehicle)
        .filter(c => c.fe_guide_row_id != null && c.guide)
        .sort((a, b) => b.model_year - a.model_year || withinYear(a, b))[0] ?? null;
}

/**
 * Which certification a vehicle reads, chosen automatically — never a picker,
 * never silent (owner, #374):
 *
 *   exact          a certification in one of the vehicle's years; several, the
 *                  newest. `partly` when the vehicle's years run past what is
 *                  certified ("2025-2026" with only MY2025 held).
 *   carryover      none in its years, but a certification carries over lab
 *                  work from one of them
 *   other-year     else the nearest year; a tie goes to the newer
 *   none           the test vehicle holds no certification
 *
 * `ambiguous` when one test vehicle holds two certifications in the chosen
 * year (2 test vehicles in the corpus, none mapped); the linked one, then the
 * latest issued, is taken.
 *
 * Then the Guide figures: the chosen certification's own link, else the
 * nearest LINKED certification of the same test vehicle. `fromYear` is the
 * year the figures come from whenever that is not one of the vehicle's years —
 * what "From MY2024" says on screen. `yearsOff` is how far that is; 2 or more
 * is a Data Checks finding.
 *
 * @param {string} vehicleYearText  vehicles.year
 * @param {Object} testVehicle      with the `certifications` embed
 */
export function resolveCertification(vehicleYearText, testVehicle) {
    const certs = certificationsOf(testVehicle);
    const years = vehicleModelYears(vehicleYearText);
    const none = { certification: null, guideCertification: null, match: 'none', partly: false, ambiguous: false, fromYear: null, yearsOff: 0, vehicleYears: years };
    if (!certs.length) return none;

    let certification, match, partly = false;
    const inYears = years.length ? certs.filter(c => years.includes(c.model_year)) : [];
    if (inYears.length) {
        const top = Math.max(...inYears.map(c => c.model_year));
        certification = inYears.filter(c => c.model_year === top).sort(withinYear)[0];
        match = 'exact';
        const held = new Set(inYears.map(c => c.model_year));
        partly = years.some(y => !held.has(y));
    } else if (years.length && certs.some(c => years.includes(Number(c.carryover_model_year)))) {
        const carrying = certs.filter(c => years.includes(Number(c.carryover_model_year)));
        certification = nearest(carrying, years);
        match = 'carryover';
    } else {
        certification = years.length ? nearest(certs, years) : certs[certs.length - 1];
        match = years.length ? 'other-year' : 'none';
    }
    const ambiguous = certs.filter(c => c.model_year === certification.model_year).length > 1;

    const linked = certs.filter(c => c.fe_guide_row_id != null && c.guide);
    const guideCertification = certification.fe_guide_row_id != null && certification.guide
        ? certification
        : (linked.length ? (years.length ? nearest(linked, years) : linked[linked.length - 1]) : null);

    const figuresYear = (guideCertification ?? certification).model_year;
    const off = years.length ? yearDistance(figuresYear, years) : 0;
    return {
        certification, guideCertification, match, partly, ambiguous,
        fromYear: off > 0 ? figuresYear : null,
        yearsOff: off,
        vehicleYears: years,
    };
}

// ── The view of a test vehicle a reader gets ────────────────────────────────

/**
 * A test vehicle as one certification shows it: the stored record with that
 * year's identity and that year's Guide figures laid over it.
 *
 * Every reader of the record — the curve, η, the methodology card, the vehicle
 * figures, the audit — keeps reading the same field names. What changes is
 * which year's Guide row filled them, and that is now chosen per reader:
 * a vehicle's own year (`viewForVehicle`), or for lab-side readers the newest
 * linked year (`viewForTestVehicle`).
 *
 *   model_year       the certification's year (for a test-vehicle view, Since)
 *   test_group       that certification's Test Group
 *   fe_guide_row_id, epa_fe_guide   the Guide row the figures came from
 *   carryover_*      as that certification names them
 *   _certification   what was chosen and why — see resolveCertification
 */
export function testVehicleView(testVehicle, { certification = null, guideCertification = null, year = null, resolution = null } = {}) {
    if (!testVehicle) return testVehicle;
    const guide = guideCertification?.guide ?? null;
    const { values, overrides } = guideOverlay(testVehicle, guide);
    return {
        ...testVehicle,
        ...values,
        overrides,
        model_year:           year ?? certification?.model_year ?? testVehicle.model_year ?? null,
        test_group:           certification?.test_group ?? testVehicle.test_group ?? null,
        carryover_test_group: certification ? certification.carryover_test_group : (testVehicle.carryover_test_group ?? null),
        carryover_model_year: certification ? certification.carryover_model_year : (testVehicle.carryover_model_year ?? null),
        fe_guide_row_id:      guide?.id ?? null,
        epa_fe_guide:         guide,
        _certification: {
            linkId:          certification?.linkId ?? null,
            test_group:      certification?.test_group ?? null,
            model_year:      certification?.model_year ?? null,
            ownGuideRowId:   certification?.fe_guide_row_id ?? null,
            skipped:         certification?.fe_guide_skipped_at != null,
            guideYear:       guideCertification?.model_year ?? null,
            match:           resolution?.match ?? null,
            partly:          resolution?.partly ?? false,
            ambiguous:       resolution?.ambiguous ?? false,
            fromYear:        resolution?.fromYear ?? null,
            yearsOff:        resolution?.yearsOff ?? 0,
            years:           certifiedYears(testVehicle),
        },
    };
}

/** The test vehicle as a vehicle of this `year` reads it. */
export function viewForVehicle(vehicleYearText, testVehicle) {
    if (!testVehicle) return testVehicle;
    const resolution = resolveCertification(vehicleYearText, testVehicle);
    return testVehicleView(testVehicle, { ...resolution, resolution });
}

/** The test vehicle on its own: Since as its year, the newest linked year's Guide row. */
export function viewForTestVehicle(testVehicle) {
    if (!testVehicle) return testVehicle;
    const guideCertification = newestLinkedCertification(testVehicle);
    return testVehicleView(testVehicle, {
        certification: guideCertification,
        guideCertification,
        year: sinceYear(testVehicle),
    });
}

/**
 * "From MY2024" — the words for a figure from another year, or null when the
 * figures are the vehicle's own year's. The longer sentence goes in a title.
 */
export function fromYearNote(cert) {
    if (!cert?.fromYear) return null;
    return {
        short: `From MY${cert.fromYear}`,
        long: cert.match === 'carryover'
            ? `From MY${cert.fromYear}: the MY${cert.model_year} certification carries over this vehicle's year's lab work, and its EPA figures are that certification's.`
            : `From MY${cert.fromYear}: no certification of this test vehicle is held for the vehicle's year, so its EPA figures are the MY${cert.fromYear} ones.`,
    };
}
