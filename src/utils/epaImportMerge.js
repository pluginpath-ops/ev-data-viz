/**
 * What a CSI re-import may overwrite, and what it must leave alone.
 *
 * importEpaTestVehicleFull used to CLEAN-REPLACE a test vehicle's coefficient sets, tests and
 * phases — delete them all, insert the parse — and to write the test vehicle row with
 * `overrides` rebuilt from scratch. That made a re-import destroy three things
 * a curator had put there:
 *
 *   1. hand-entered values (a DC energy the PDF does not carry, a corrected
 *      phase distance), because the delete took the whole row;
 *   2. the audit trail, because every replaced row got a new id and audit rows
 *      are found by id; and
 *   3. the record of WHO set a field, because `overrides` was overwritten with
 *      "everything is from the PDF".
 *
 * So the import updates in place instead, matching rows on the identity the
 * certificate itself gives them — coefficient CATEGORY, EPA TEST NUMBER, phase
 * INDEX — which is the same reason migration 061 stores `preferred_test_number`
 * rather than a test id. Ids then survive a re-import and nothing orphans.
 *
 * A field is HELD when its `overrides` tag names a source that is not one of the
 * machine ingests: 'manual' is what the curator form writes, 'fe_guide' is a
 * Fuel Economy Guide promotion someone chose to apply (and unlink restores from
 * its tag). A held field keeps its value and its tag. Everything else — 'pdf'
 * and also 'csv' / 'j1634', which a certificate PDF supersedes — is written from
 * the PDF as before, so "upload is truth" still holds for everything nobody has
 * touched. (114 test vehicles in the live data were created from the CSV; treating
 * their tags as held would have stopped a PDF ever correcting them.)
 *
 * One more thing is held, and it is not a curator's: a NEWER certification's
 * identity. A carryover certification reuses its test vehicle, so one
 * epa_test_vehicles row (keyed by Vehicle ID) is the target of several model years'
 * files, and the row has room for only one certification's identity. Importing
 * oldest → newest left the newest on the record; importing backwards left the
 * OLDEST and quietly replaced the newer certification's test family, source
 * file and covered-models list. So an older file no longer
 * overwrites those (IDENTITY_FIELDS, plus the covered models the executor
 * handles via `plan.holdIdentity`), and fills only what is empty everywhere
 * else: it adds the tests it lists that are not stored and fills blank fields,
 * but a value the newer file wrote stands. Rehearsing the 2021–2025 corpus
 * re-import on the 2026-10-10 backup, merging lab data as before replaced
 * values on 50 test vehicles and 59 tests: Ioniq 6 test comments went back
 * from the revised filing to the original, a Cybertruck's pack voltage went from
 * 710 to 816. Owner decision, 2026-10-11: an older file fills blanks only.
 * Each certification itself, carryover pair included, is recorded in
 * epa_certifications (#374), so nothing is lost.
 *
 * Pure — no database — so the rules can be tested without one.
 */

/** Fields the PDF never carries, so a null in the parse means "not read", not "cleared". */
const NEVER_NULLED = ['useable_kwh'];

/** Sources written by an automatic ingest — a later PDF import may replace these. */
const MACHINE_SOURCES = ['pdf', 'csv', 'j1634'];

/** Test vehicle columns that name WHICH certification the row stands for. */
const IDENTITY_FIELDS = ['model_year', 'test_group', 'source_file'];

/**
 * True when the incoming certification is strictly OLDER than the stored one.
 * A missing year on either side is not evidence of age, so it never blocks: the
 * import proceeds as it always did (a null stored year has nothing to protect;
 * a null incoming year cannot be shown to be older).
 */
export function isOlderCertification(storedTestVehicle, incomingTestVehicle) {
    if (storedTestVehicle?.model_year == null || incomingTestVehicle?.model_year == null) return false;
    const a = Number(storedTestVehicle.model_year);
    const b = Number(incomingTestVehicle.model_year);
    return Number.isFinite(a) && Number.isFinite(b) && b < a;
}

/** True when a person (or a deliberate promotion), not an ingest, last set this field. */
export function isHeld(overrides, field) {
    const source = overrides?.[field]?.source;
    return source != null && !MACHINE_SOURCES.includes(source);
}

const sameValue = (a, b) => {
    if (a == null || b == null) return a == b;
    return String(a) === String(b) || (Number.isFinite(Number(a)) && Number(a) === Number(b));
};

/**
 * Merge one incoming parsed row onto the row already stored.
 *
 * @param {Object|null} existing   the stored row, or null for a new one
 * @param {Object}      incoming   the parsed row (no `overrides`)
 * @param {{ neverNull?: string[], fillOnly?: boolean }} [opts]
 *   fillOnly — write only fields the stored row has empty (an older file)
 * @returns {{ payload: Object, overrides: Object, kept: Array<{field, kept, pdf}>, older: Array<{field, kept, pdf}> }}
 *   payload    — the columns to write (held fields are absent, so they are untouched)
 *   overrides  — the full map to store: existing tags preserved, PDF tags added
 *   kept       — held fields where the PDF disagreed, for reporting
 *   older      — with fillOnly, stored values the file disagreed with and left
 */
export function mergeRow(existing, incoming, { neverNull = [], fillOnly = false } = {}) {
    const stored = existing?.overrides || {};
    const payload = {};
    const overrides = { ...stored };
    const kept = [];
    const older = [];

    for (const [field, value] of Object.entries(incoming)) {
        if (field === 'overrides') continue;
        if (existing && fillOnly && (existing[field] != null || value == null)) {
            if (value != null && !sameValue(existing[field], value)) {
                older.push({ field, kept: existing[field], pdf: value });
            }
            continue;
        }
        if (existing && isHeld(stored, field)) {
            if (value != null && !sameValue(existing[field], value)) {
                kept.push({ field, kept: existing[field], pdf: value });
            }
            continue;
        }
        if (value == null && neverNull.includes(field)) continue;
        payload[field] = value;
        if (value != null) overrides[field] = { source: 'pdf' };
    }
    return { payload, overrides, kept, older };
}

/**
 * Diff stored child rows against incoming ones, by natural key.
 *
 * @returns {{ update: Array<{id, existing, incoming}>, insert: Array, unlisted: Array<id> }}
 *   `unlisted` is every stored row the incoming list does not name. An import
 *   keeps them all (see planTestVehicleImport); they are only counted.
 */
export function planChildren(existingRows, incomingRows, keyOf) {
    const byKey = new Map();
    (existingRows || []).forEach((row, i) => byKey.set(keyOf(row, i), row));

    const update = [];
    const insert = [];
    const matched = new Set();
    (incomingRows || []).forEach((incoming, i) => {
        const key = keyOf(incoming, i);
        const existing = byKey.get(key);
        if (existing && !matched.has(key)) {
            matched.add(key);
            update.push({ id: existing.id, existing, incoming });
        } else {
            insert.push(incoming);
        }
    });
    const unlisted = (existingRows || [])
        .filter((row, i) => !matched.has(keyOf(row, i)))
        .map(row => row.id);
    return { update, insert, unlisted };
}

export const coefficientKey = (row) => row.category;
// A test without a number (rare) falls back to its position, which is stable
// enough within one certificate's parse order.
export const testKey = (row, i) => row.test_number || `#${i}`;
export const phaseKey = (row) => row.phase_index;

/**
 * Plan a whole test vehicle's import.
 *
 * @param {{ testVehicle: Object|null, coefficient_sets: Array, tests: Array }} stored
 *        what the database holds now; tests carry `epa_test_phases`.
 * @param {{ testVehicle: Object, coefficient_sets: Array, tests: Array }} incoming
 *        the parse, tests carrying `phases`.
 * @returns {{ testVehicle, coefficients, tests, kept, guarded, holdIdentity, spared }} — `kept` is every
 *   held value the PDF disagreed with; `guarded` the identity fields, and the
 *   stored values, an older certification was stopped from overwriting; `holdIdentity` tells the executor
 *   to leave the certificate-wide covered-models list alone too; `spared` counts
 *   the stored tests, phases and coefficient sets this file does not list, all
 *   of which are kept.
 *
 * An import never removes a test, a phase or a coefficient set; it only adds
 * and updates. A test vehicle can be in several certifications' files, and
 * each lists only the tests behind its own certification: a carryover's older
 * tests are listed in the older years' files and nowhere else. The rows carry
 * no file of their own, so no file can tell its own rows from another's.
 *
 * The rule before this one let the record's own file (`source_file`, the
 * newest certification's) remove what it did not list. That held only while
 * the newest file was imported last: re-importing the corpus oldest year first
 * made each newer file delete the older years' tests — 73 tests on the
 * 2026-11-02 backup, among them a 2025 file removing two 2021 tests.
 *
 * The cost: a refiled certification that drops a test leaves the old one
 * standing, for a curator to remove by hand. The 2021–2027 corpus never asks
 * for that — every stored test, phase and coefficient set on a record from one
 * of its files is listed by at least one file — and phase lists do differ
 * between files (101 tests have phases in a newer file and none in an older
 * one), so not even phases are safe for one file to prune.
 *
 * The other cost shows only oldest-first: where a Vehicle ID was reused, an
 * older file can put a test on the record a newer file later splits off
 * (FE-Y1ASCUV-25's SPRX10086180, before the MY2027 file names
 * FE-Y1ASCUV-25-1). The old rule deleted the stray copy by luck; now it
 * stays, and epa_test_vehicle_duplicates lists the pair for a curator.
 */
export function planTestVehicleImport(stored, incoming) {
    const kept = [];
    const note = (where, list) => list.forEach(k => kept.push({ where, ...k }));

    // An older certification must not displace a newer one's identity.
    const holdIdentity = !!stored.testVehicle && isOlderCertification(stored.testVehicle, incoming.testVehicle);
    const guarded = [];
    let incomingTestVehicle = incoming.testVehicle;
    if (holdIdentity) {
        incomingTestVehicle = { ...incoming.testVehicle };
        for (const field of IDENTITY_FIELDS) {
            if (field in incomingTestVehicle) {
                if (!sameValue(stored.testVehicle[field], incomingTestVehicle[field])) {
                    guarded.push({ where: 'test-vehicle', field, kept: stored.testVehicle[field], pdf: incomingTestVehicle[field] });
                }
                delete incomingTestVehicle[field];
            }
        }
    }

    // An older file fills blanks only (see above); what it disagreed with is
    // reported beside the identity it was stopped from replacing.
    const fillOnly = holdIdentity;
    const merge = (where, existing, row, opts = {}) => {
        const m = mergeRow(existing, row, { ...opts, fillOnly });
        note(where, m.kept);
        m.older.forEach(o => guarded.push({ where, ...o }));
        return m;
    };

    const testVehicleMerge = merge('test-vehicle', stored.testVehicle, incomingTestVehicle, { neverNull: NEVER_NULLED });

    const coefPlan = planChildren(stored.coefficient_sets, incoming.coefficient_sets, coefficientKey);
    let spared = coefPlan.unlisted.length;
    const coefficients = {
        update: coefPlan.update.map(u => {
            const m = merge(`coefficients ${u.existing.category}`, u.existing, u.incoming);
            return { id: u.id, payload: m.payload, overrides: m.overrides };
        }),
        insert: coefPlan.insert.map(row => {
            const m = mergeRow(null, row);
            return { ...m.payload, overrides: m.overrides };
        }),
    };

    const testPlan = planChildren(stored.tests, incoming.tests, testKey);
    spared += testPlan.unlisted.length;
    const tests = {
        update: testPlan.update.map(u => {
            const { phases = [], ...row } = u.incoming;
            const m = merge(`test ${u.existing.test_number ?? u.id}`, u.existing, row);
            const phasePlan = planChildren(u.existing.epa_test_phases, phases, phaseKey);
            spared += phasePlan.unlisted.length;
            return {
                id: u.id, payload: m.payload, overrides: m.overrides,
                phases: {
                    update: phasePlan.update.map(pu => {
                        const pm = merge(`test ${u.existing.test_number ?? u.id} phase ${pu.existing.phase_index}`, pu.existing, pu.incoming);
                        return { id: pu.id, payload: pm.payload, overrides: pm.overrides };
                    }),
                    insert: phasePlan.insert.map(p => {
                        const pm = mergeRow(null, p);
                        return { ...pm.payload, overrides: pm.overrides };
                    }),
                },
            };
        }),
        insert: testPlan.insert.map(t => {
            const { phases = [], ...row } = t;
            const m = mergeRow(null, row);
            return {
                row: { ...m.payload, overrides: m.overrides },
                phases: phases.map(p => {
                    const pm = mergeRow(null, p);
                    return { ...pm.payload, overrides: pm.overrides };
                }),
            };
        }),
    };

    return {
        testVehicle: { payload: testVehicleMerge.payload, overrides: testVehicleMerge.overrides },
        coefficients, tests, kept, guarded, holdIdentity, spared,
    };
}

/**
 * Collapse covered-model rows to the table's unique key.
 *
 * epa_covered_models is unique on (test_vehicle_id, carline_name,
 * certification_region), NULL region counting as a value (migration 059). A
 * certificate can legitimately list the same carline name more than once:
 * Rivian's RCV-Delivery (carlines 502 and 702, each twice) and Karsan's bus
 * (carlines 124 and 125) both do, and inserting them raised a duplicate-key
 * error that aborted the whole batch. The first row of each key is kept; the
 * rows are a reading aid, and the dropped ones differ only in carline number.
 */
export function uniqueCoveredModels(rows) {
    const seen = new Set();
    return (rows || []).filter(r => {
        const key = JSON.stringify([r.carline_name, r.certification_region ?? null]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
