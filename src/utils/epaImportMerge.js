/**
 * What a CSI re-import may overwrite, and what it must leave alone.
 *
 * importEpaGroupFull used to CLEAN-REPLACE a group's coefficient sets, tests and
 * phases — delete them all, insert the parse — and to write the group row with
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
 * touched. (114 groups in the live data were created from the CSV; treating
 * their tags as held would have stopped a PDF ever correcting them.)
 *
 * Pure — no database — so the rules can be tested without one.
 */

/** Fields the PDF never carries, so a null in the parse means "not read", not "cleared". */
const NEVER_NULLED = ['useable_kwh'];

/** Sources written by an automatic ingest — a later PDF import may replace these. */
const MACHINE_SOURCES = ['pdf', 'csv', 'j1634'];

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
 * @param {{ neverNull?: string[] }} [opts]
 * @returns {{ payload: Object, overrides: Object, kept: Array<{field, kept, pdf}> }}
 *   payload    — the columns to write (held fields are absent, so they are untouched)
 *   overrides  — the full map to store: existing tags preserved, PDF tags added
 *   kept       — held fields where the PDF disagreed, for reporting
 */
export function mergeRow(existing, incoming, { neverNull = [] } = {}) {
    const stored = existing?.overrides || {};
    const payload = {};
    const overrides = { ...stored };
    const kept = [];

    for (const [field, value] of Object.entries(incoming)) {
        if (field === 'overrides') continue;
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
    return { payload, overrides, kept };
}

/** A row a curator has put something into by hand — never deleted by an import. */
const isCuratorRow = (row) =>
    row.source === 'manual' || Object.keys(row.overrides || {}).some(f => isHeld(row.overrides, f));

/**
 * Diff stored child rows against incoming ones, by natural key.
 *
 * @returns {{ update: Array<{id, existing, incoming}>, insert: Array, remove: Array<id> }}
 *   `remove` never includes a row a curator has edited or added by hand.
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
    const remove = (existingRows || [])
        .filter((row, i) => !matched.has(keyOf(row, i)) && !isCuratorRow(row))
        .map(row => row.id);
    return { update, insert, remove };
}

export const coefficientKey = (row) => row.category;
// A test without a number (rare) falls back to its position, which is stable
// enough within one certificate's parse order.
export const testKey = (row, i) => row.test_number || `#${i}`;
export const phaseKey = (row) => row.phase_index;

/**
 * Plan a whole group's import.
 *
 * @param {{ group: Object|null, coefficient_sets: Array, tests: Array }} stored
 *        what the database holds now; tests carry `epa_test_phases`.
 * @param {{ group: Object, coefficient_sets: Array, tests: Array }} incoming
 *        the parse, tests carrying `phases`.
 * @returns {{ group, coefficients, tests, kept }} — `kept` is every held value the PDF disagreed with.
 */
export function planGroupImport(stored, incoming) {
    const kept = [];
    const note = (where, list) => list.forEach(k => kept.push({ where, ...k }));

    const groupMerge = mergeRow(stored.group, incoming.group, { neverNull: NEVER_NULLED });
    note('group', groupMerge.kept);

    const coefPlan = planChildren(stored.coefficient_sets, incoming.coefficient_sets, coefficientKey);
    const coefficients = {
        remove: coefPlan.remove,
        update: coefPlan.update.map(u => {
            const m = mergeRow(u.existing, u.incoming);
            note(`coefficients ${u.existing.category}`, m.kept);
            return { id: u.id, payload: m.payload, overrides: m.overrides };
        }),
        insert: coefPlan.insert.map(row => {
            const m = mergeRow(null, row);
            return { ...m.payload, overrides: m.overrides };
        }),
    };

    const testPlan = planChildren(stored.tests, incoming.tests, testKey);
    const tests = {
        remove: testPlan.remove,
        update: testPlan.update.map(u => {
            const { phases = [], ...row } = u.incoming;
            const m = mergeRow(u.existing, row);
            note(`test ${u.existing.test_number ?? u.id}`, m.kept);
            const phasePlan = planChildren(u.existing.epa_test_phases, phases, phaseKey);
            return {
                id: u.id, payload: m.payload, overrides: m.overrides,
                phases: {
                    remove: phasePlan.remove,
                    update: phasePlan.update.map(pu => {
                        const pm = mergeRow(pu.existing, pu.incoming);
                        note(`test ${u.existing.test_number ?? u.id} phase ${pu.existing.phase_index}`, pm.kept);
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
        group: { payload: groupMerge.payload, overrides: groupMerge.overrides },
        coefficients, tests, kept,
    };
}

/**
 * Collapse covered-model rows to the table's unique key.
 *
 * epa_covered_models is unique on (test_group_id, carline_name,
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
