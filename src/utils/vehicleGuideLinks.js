/**
 * A vehicle's EPA Label and the configurations it brings (EPA identity,
 * layer 3; migration 095).
 *
 * A curator links a vehicle to the Guide rows that are the car — its carline,
 * wheels and year, which a curator can judge. The test vehicles come through
 * each row's Tested via (guideTestedVia), which a curator cannot judge from a
 * name: the MY2025 Blazer EV AWD row names three test vehicles that differ
 * only in their lab figures.
 *
 * Owner rules, 2026-10-31:
 *   • A blend's nearest member stands for the vehicle (its coefficients and
 *     test weight are the ones read).
 *   • An untested row links nothing. The nearest tested trim is a suggestion.
 *   • A configuration already linked stays unless a row's Tested via
 *     contradicts it — names other test vehicles from a pool it belongs to,
 *     and no row of that certification names it. One behind a sibling row,
 *     or one the rows say nothing about (untested, no lab data, another
 *     year), stays for a curator.
 *
 * Pure: the caller supplies the rows' Tested via and pools.
 */
import { testVehiclePoints } from './guideTestedVia';

/** Verdicts that name the test vehicles behind a row. */
export const TESTED = new Set(['exact', 'near', 'blend']);

const pointKey = (p) => (p ? `${p.city.toFixed(4)}|${p.hwy.toFixed(4)}` : null);
const dist = (p, q) => Math.hypot(p.city - q.city, p.hwy - q.hwy);

/**
 * The configurations a Guide row's Tested via links, the one that stands for
 * the vehicle first.
 *
 *   exact  its one test vehicle — verified, or likely when another explains
 *          the row as well (ambiguous)
 *   near   its one test vehicle, likely
 *   blend  every member, likely; the nearest to the row is primary
 *
 * @param {Object} via  testedVia's result
 * @returns {Array<{ test_vehicle_id, primary: boolean, confidence }>}
 */
export function configurationsFromTestedVia(via) {
    if (!via || !TESTED.has(via.verdict) || !via.members?.length) return [];
    if (via.verdict !== 'blend') {
        const confidence = via.verdict === 'exact' && !via.ambiguous ? 'verified' : 'likely';
        return [{ test_vehicle_id: via.members[0].test_vehicle_id, primary: true, confidence }];
    }
    const g = via.guide;
    const ranked = g ? [...via.members].sort((a, b) => dist(a, g) - dist(b, g)) : via.members;
    return ranked.map((m, i) => ({ test_vehicle_id: m.test_vehicle_id, primary: i === 0, confidence: 'likely' }));
}

/**
 * Does a row's Tested via name this test vehicle? By id, or by the same lab
 * point — a test vehicle stored twice is one car, and testedVia keeps only one
 * copy.
 *
 * Not an ambiguous row's alternatives: an alternative explains the row only as
 * well as the test vehicles it named, and may be another car altogether — the
 * Blazer EV AWD row lists an Equinox EV test vehicle among its alternatives.
 * isAlternative says that apart, so a linked alternative is neither confirmed
 * nor contradicted.
 */
export function namesTestVehicle(via, testVehicle) {
    if (!via || !TESTED.has(via.verdict)) return false;
    const id = testVehicle?.test_vehicle_id;
    if (via.members.some(m => m.test_vehicle_id === id)) return true;
    const keys = new Set(testVehiclePoints(testVehicle).map(pointKey));
    return via.members.some(m => keys.has(pointKey(m)));
}

/** One of an ambiguous row's alternatives, which the row does not name. */
export function isAlternative(via, testVehicle) {
    return TESTED.has(via?.verdict) && (via.alternatives ?? []).includes(testVehicle?.test_vehicle_id);
}

/**
 * How a linked configuration stands against the vehicle's Guide rows.
 *
 *   confirmed     a row's Tested via names it         { status, rowId }
 *   elsewhere     the vehicle's rows do not, but
 *                 another row of the same
 *                 certification does — a wheel or
 *                 trim the vehicle has no row for     { status, rowId }  (that other row)
 *   contradicted  a row whose pool it is in names
 *                 other test vehicles, and no row of
 *                 the certification names it          { status, rowId }
 *   unconfirmed   no row says either way: untested,
 *                 no lab data, an ambiguous row's
 *                 alternative, or it is in no linked
 *                 row's pool                          { status, rowId: null }
 *
 * "Elsewhere" is kept apart from "contradicted" because of the data
 * (2026-10-31, on the mirror): of 17 configurations a vehicle's own rows did
 * not name, 7 stood behind a sibling row — the Gravity GT on 21/22in wheels
 * where the vehicle had linked the 20/21in row — and were the right car.
 *
 * @param {Object} testVehicle  the configuration's test vehicle (id + tests)
 * @param {Array<{ rowId, via, poolIds: Set<string> }>} rows  the vehicle's Guide rows
 * @param {Array<{ rowId, via }>} [others]  the other rows of those rows'
 *        certifications; without them nothing reads as elsewhere
 */
export function configurationStanding(testVehicle, rows = [], others = []) {
    const id = testVehicle?.test_vehicle_id;
    const named = rows.find(r => namesTestVehicle(r.via, testVehicle));
    if (named) return { status: 'confirmed', rowId: named.rowId };
    if (rows.some(r => isAlternative(r.via, testVehicle))) return { status: 'unconfirmed', rowId: null };
    const against = rows.find(r => r.poolIds?.has(id) && TESTED.has(r.via?.verdict));
    if (against) {
        const sibling = others.find(r => namesTestVehicle(r.via, testVehicle));
        if (sibling) return { status: 'elsewhere', rowId: sibling.rowId };
        return { status: 'contradicted', rowId: against.rowId };
    }
    return { status: 'unconfirmed', rowId: null };
}

/**
 * The one-time move to the vehicle → Guide row model, for one vehicle.
 *
 * Its rows are the Guide rows its configurations' certifications already
 * point at, where the row's Tested via names that configuration — a curator
 * linked both halves, and the lab data agrees. Then every configuration is
 * judged against them: contradicted ones go, confirmed and unconfirmed stay,
 * and each row's Tested via adds the members the vehicle lacks (a blend's
 * other members).
 *
 * @param {Object} input
 * @param {Array<{ id, test_vehicle_id, is_primary, testVehicle }>} input.mappings
 * @param {Object<string, number[]>} input.guideRowsOf  test_vehicle_id → Guide row ids its certifications link
 * @param {Object<number, { via, poolIds: Set<string> }>} input.rows  Guide row id → Tested via + pool
 * @param {Array<{ rowId, via }>} [input.others]  every Guide row of the certifications involved, for "elsewhere"
 * @param {number[]} [input.linkedRowIds]  rows the vehicle already links (a second run)
 * @returns {{
 *   linkRows: number[],
 *   drop: Array<{ mappingId, test_vehicle_id, rowId }>,
 *   add: Array<{ test_vehicle_id, rowId, confidence, primary }>,
 *   elsewhere: Array<{ mappingId, test_vehicle_id, rowId }>,
 *   unconfirmed: Array<{ mappingId, test_vehicle_id }>,
 *   primary: string | null,
 * }}
 *   primary  the test vehicle to make primary, when the current primary is
 *            dropped (or there is none) and a row names one; null to leave it
 */
export function planVehicleGuideLinks({ mappings = [], guideRowsOf = {}, rows = {}, others = [], linkedRowIds = [] }) {
    // A row a configuration's certification links to, AND whose Tested via
    // names that configuration. Either alone is not enough (2026-10-31, on
    // the mirror): certification links carry old mistakes — the Ioniq 5 XRT's
    // AWD test vehicles point at the "Ioniq 5 RWD" row — and Tested via alone
    // names too many rows — a Taycan test vehicle is a blend member of a dozen
    // Taycan rows, and the R1S's stand behind the R1T's.
    const rowIds = [...new Set([
        ...linkedRowIds,
        ...mappings.flatMap(m => (guideRowsOf[m.test_vehicle_id] ?? [])
            .filter(id => namesTestVehicle(rows[id]?.via, m.testVehicle ?? { test_vehicle_id: m.test_vehicle_id }))),
    ])].filter(id => rows[id]);
    const judged = rowIds.map(rowId => ({ rowId, ...rows[rowId] }));

    const drop = [];
    const elsewhere = [];
    const unconfirmed = [];
    const kept = new Set();
    for (const m of mappings) {
        const tv = m.testVehicle ?? { test_vehicle_id: m.test_vehicle_id };
        const s = configurationStanding(tv, judged, others);
        const entry = { mappingId: m.id, test_vehicle_id: m.test_vehicle_id };
        if (s.status === 'contradicted') { drop.push({ ...entry, rowId: s.rowId }); continue; }
        kept.add(m.test_vehicle_id);
        if (s.status === 'elsewhere') elsewhere.push({ ...entry, rowId: s.rowId });
        if (s.status === 'unconfirmed') unconfirmed.push(entry);
    }

    const add = [];
    for (const { rowId, via } of judged) {
        for (const c of configurationsFromTestedVia(via)) {
            if (kept.has(c.test_vehicle_id) || add.some(a => a.test_vehicle_id === c.test_vehicle_id)) continue;
            add.push({ ...c, rowId });
        }
    }

    // The primary: kept if it survives. Otherwise the first row's own primary
    // member — the rows are in the order the vehicle's configurations named
    // them, and the old primary's comes first when it had one.
    const oldPrimary = mappings.find(m => m.is_primary);
    let primary = null;
    if (!oldPrimary || drop.some(d => d.mappingId === oldPrimary.id)) {
        const firstRows = oldPrimary ? (guideRowsOf[oldPrimary.test_vehicle_id] ?? []) : [];
        const order = [...firstRows.filter(id => rowIds.includes(id)), ...rowIds];
        for (const rowId of order) {
            const c = configurationsFromTestedVia(rows[rowId].via).find(x => x.primary);
            if (c) { primary = c.test_vehicle_id; break; }
        }
    }

    return { linkRows: rowIds.filter(id => !linkedRowIds.includes(id)), drop, add, elsewhere, unconfirmed, primary };
}
