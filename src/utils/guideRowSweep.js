/**
 * The Guide-row link sweep: every Fuel Economy Guide row, with the test
 * vehicles of its certification placed against it, so a curator links a row's
 * test vehicles to it in one go (Admin → FE Guide).
 *
 * It replaced a sweep that went the other way — one test vehicle at a time,
 * ranked against the maker's Guide rows by name — and the reasons are the
 * design:
 *
 *   - Tested via already does the search, by figures, per row. The name ranker
 *     proposed the Model 3 Long Range RWD for a Model 3 Standard because the
 *     Standard's own row was a year later and eight weak same-year rows filled
 *     the list ahead of it.
 *   - Its "exact id" and "covered model" shortcuts were unique by absence: a
 *     front-drive Solterra took Toyota's bZ row because Subaru sells no
 *     front-drive Solterra, so the bZ was the only row carrying its Test Group.
 *     Here the Solterra sits under the bZ row as what it is: a test vehicle of
 *     the same certification.
 *   - A row is the unit people decide in. Several test vehicles behind one
 *     row are linked together; the old view asked about each separately.
 *
 * The link itself is unchanged: `fe_guide_row_id` on a certification
 * membership (epa_certification_test_vehicles), one Guide row per test vehicle
 * per certification. So a test vehicle behind two rows — the Lyriq AWD test
 * behind both charger rows — can be linked to one of them here; a vehicle's
 * EPA Label links both.
 *
 * Pure: the caller supplies every Guide row and every certification membership.
 */
import { guideTestedViaPool, testedVia } from './guideTestedVia';
import { guideRowMatches } from './guideRowMatches';
import { namesTestVehicle } from './vehicleGuideLinks';

const squash = (x) => String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const model = (x) => String(x ?? '').trim().split(/\s+/)[0]?.toUpperCase() ?? '';

/**
 * Of several rows that name one test vehicle, the one that is the car tested,
 * or null. Its own carline exactly first (Q6 e-tron quattro over the Q6
 * Sportback); failing that, the only row of its model (Rivian files the R1T
 * Performance Dual Large under the R1T Premium and R1S Premium rows alike, and
 * it is an R1T).
 */
function ownRow(rows, testCarline) {
    const exact = rows.filter(r => squash(r.carline) && squash(r.carline) === squash(testCarline));
    if (exact.length) return exact.length === 1 ? exact[0].rowId : null;
    const same = rows.filter(r => model(r.carline) && model(r.carline) === model(testCarline));
    return same.length === 1 ? same[0].rowId : null;
}

/** Verdicts a whole row can be queued on without a look: one test vehicle, reproduced. */
const SURE = new Set(['exact', 'near']);
/** Matches whose test vehicle the row's Tested via names. */
const NAMED = new Set(['exact', 'near', 'blend']);

/**
 * Where a membership stands, from this row's point of view.
 *
 *   here      linked to this row
 *   elsewhere linked to another row (`linkedRowId`)
 *   skipped   recorded as having no row
 *   awaiting  no decision yet
 *   none      the test vehicle is in the row's pool only through another
 *             year's certification, so there is nothing of this year to link:
 *             R1S0396R20-1 was tested for MY2024, which carries the MY2023
 *             group over. Its link goes on a row of that year (`homeYears`);
 *             this row's Tested via reads it either way.
 */
function membershipState(m, rowId) {
    if (!m) return 'none';
    if (m.fe_guide_row_id === rowId) return 'here';
    if (m.fe_guide_row_id != null) return 'elsewhere';
    if (m.fe_guide_skipped_at != null) return 'skipped';
    return 'awaiting';
}

/**
 * @param {Array} guideRows  epa_fe_guide rows with smog_test_group and the
 *        unadjusted kWh/100mi (or MPGe) lines
 * @param {Array} members  every certification membership, in the shape
 *        guideTestedViaPool reads plus `membershipId`, `fe_guide_row_id`,
 *        `fe_guide_skipped_at`
 * @returns {{
 *   items: Array<{ row, via, matches, status, awaiting: number }>,
 *   orphans: Array,
 * }}  items: one per Guide row, each match carrying its `membership` (this
 *     row's certification's) and `state`; status is 'ready' when the row's
 *     Tested via names an awaiting membership, 'judgment' when awaiting
 *     memberships remain but none is named, 'done' otherwise. orphans: the
 *     awaiting memberships whose certification has no Guide row at all.
 */
export function buildGuideRowSweep(guideRows = [], members = []) {
    const byGroup = new Map();
    for (const r of guideRows) {
        if (!r?.smog_test_group) continue;
        if (!byGroup.has(r.smog_test_group)) byGroup.set(r.smog_test_group, []);
        byGroup.get(r.smog_test_group).push(r);
    }
    const membersOf = new Map();
    const yearsOf = new Map();
    for (const m of members) {
        if (!yearsOf.has(m.test_vehicle_id)) yearsOf.set(m.test_vehicle_id, []);
        yearsOf.get(m.test_vehicle_id).push(m);
        const key = `${m.test_group}|${m.test_vehicle_id}`;
        if (!membersOf.has(key)) membersOf.set(key, m);
    }

    const judged = new Map();
    for (const [group, rows] of byGroup) {
        const pool = guideTestedViaPool(group, members);
        for (const row of rows) judged.set(row.id, { row, pool, via: testedVia(row, pool) });
    }

    const items = [];
    for (const { row, pool, via } of judged.values()) {
        const others = byGroup.get(row.smog_test_group)
            .filter(r => r.id !== row.id)
            .map(r => ({ rowId: r.id, guide: r, via: judged.get(r.id).via }));
        const matches = guideRowMatches({ guide: row, via, pool }, others).map(match => {
            const membership = membersOf.get(`${row.smog_test_group}|${match.test_vehicle_id}`) ?? null;
            // Other rows that name it too — identical figures under two
            // carlines (Q6 and Q6 Sportback), or wheel options EPA did not
            // separate. It can link one of them, so this is the choice to show.
            const alsoNamedBy = NAMED.has(match.match)
                ? others.filter(o => namesTestVehicle(o.via, match)).map(o => ({ rowId: o.rowId, carline: o.guide.carline }))
                : [];
            const homeYears = membership ? [] : [...new Set((yearsOf.get(match.test_vehicle_id) ?? [])
                .map(m => m.model_year).filter(y => y != null))].sort();
            return { ...match, membership, alsoNamedBy, homeYears, state: membershipState(membership, row.id) };
        });
        const awaiting = matches.filter(m => m.state === 'awaiting');
        const status = awaiting.some(m => NAMED.has(m.match)) ? 'ready'
            : awaiting.length ? 'judgment' : 'done';
        items.push({ row, via, others, matches, status, awaiting: awaiting.length });
    }

    const grouped = new Set(byGroup.keys());
    const orphans = members.filter(m =>
        m.fe_guide_row_id == null && m.fe_guide_skipped_at == null && !grouped.has(m.test_group));

    return { items, orphans };
}

/**
 * Links to queue in bulk, from the rows whose Tested via names a test vehicle
 * unambiguously. Each awaiting membership it names is queued for that row.
 * One another row of the certification names too goes to the row that is the
 * car tested (ownRow); where none is, it is a choice (one row per test vehicle
 * per certification) and stays with the curator.
 *
 *   sure   only rows one test vehicle reproduces, exactly or within rounding
 *   named  those and blends: every member of a blend is queued for the row,
 *          the EV3 Long Range FWD's two test vehicles together
 *
 * @param {'sure'|'named'} [scope]
 * @returns {Array<{ membershipId, testVehicleId, rowId }>}
 */
export function bulkLinks(items = [], scope = 'sure') {
    const verdicts = scope === 'named' ? NAMED : SURE;
    const out = [];
    for (const it of items) {
        if (!verdicts.has(it.via?.verdict) || it.via.ambiguous) continue;
        for (const m of it.matches) {
            if (m.state !== 'awaiting' || !NAMED.has(m.match)) continue;
            // Named by several rows: taken only where exactly one of them is
            // the test vehicle's own carline — the certification says which
            // car was tested. Otherwise it is the curator's pick.
            if (m.alsoNamedBy?.length
                && ownRow([{ rowId: it.row.id, carline: it.row.carline }, ...m.alsoNamedBy], m.carline) !== it.row.id) continue;
            out.push({ membershipId: m.membership.membershipId, testVehicleId: m.test_vehicle_id, rowId: it.row.id });
        }
    }
    return out;
}

/**
 * Members as they stand after these decisions were written — what the sweep
 * shows instead of reloading, so a curator's place in the list survives a
 * submit. Mirrors the write: linking a test vehicle to a row also unlinks any
 * other membership of it from that same row (DataService.linkFeGuideRow).
 *
 * @param {Array} members
 * @param {Array<{ membershipId, testVehicleId, rowId?: number, skip?: boolean, note?: string }>} done
 */
export function applyDecisions(members = [], done = []) {
    if (!done.length) return members;
    const byId = new Map(done.map(d => [d.membershipId, d]));
    const moved = new Set(done.filter(d => !d.skip).map(d => `${d.testVehicleId}|${d.rowId}`));
    return members.map(m => {
        const d = byId.get(m.membershipId);
        if (d?.skip) return { ...m, fe_guide_skipped_at: new Date().toISOString(), fe_guide_skip_note: d.note ?? null };
        if (d) return { ...m, fe_guide_row_id: d.rowId };
        if (moved.has(`${m.test_vehicle_id}|${m.fe_guide_row_id}`)) return { ...m, fe_guide_row_id: null };
        return m;
    });
}
