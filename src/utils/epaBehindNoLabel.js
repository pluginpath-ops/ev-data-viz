/**
 * EPA test vehicles behind no EPA Label (EPA identity, layer 4).
 *
 * A certification lists every configuration the manufacturer tested; the Fuel
 * Economy Guide publishes the ones it sells. Where every Guide row of a
 * certification is reproduced by other test vehicles (Tested via), a test
 * vehicle that could not stand behind any of them — not even as one end of a
 * blend — is a retest or variant that never reached a label. On the mirror,
 * 2026-10-31: 71 of 910. Of them, 25 were linked to a Guide row they do not
 * reproduce (pairing one car's lab data with another's label in the
 * certification statistics), 60 sat in the Guide link sweep forever, and 15
 * were linked to vehicles.
 *
 * Marked, never deleted (owner, 2026-10-31): a re-import brings the record
 * back, a later Guide can add its row, and the lab data is still a real
 * measurement. The mark is the link sweep's own skip, with NO_LABEL_NOTE, so
 * every reader that already honors a skip honors this. It is recomputed on
 * every run, and lifted when a row appears that the test vehicle stands
 * behind.
 *
 * Pure: the caller supplies the rows and memberships.
 */
import { couldStandBehind, testVehiclePoint } from './guideTestedVia';
import { namesTestVehicle, TESTED } from './vehicleGuideLinks';

/** The skip note that marks one — and that the next run recognizes as its own. */
export const NO_LABEL_NOTE = 'Tested via: behind no EPA Label of its certification';

export const isNoLabelSkip = (membership) =>
    membership?.fe_guide_skipped_at != null && membership?.fe_guide_skip_note === NO_LABEL_NOTE;

/**
 * Where a test vehicle stands against the Guide rows whose pools hold it.
 *
 *   behind   a row's Tested via names it
 *   none     every row is reproduced by others and it could stand behind none
 *   unknown  it cannot be judged — no lab figures, no Guide row imported for
 *            its certification, a row nobody reproduces (it may be behind
 *            that one, derived), or it could be part of a blend
 *
 * @param {Object} testVehicle  test_vehicle_id + tests
 * @param {Array<{ guide, via, pool }>} rows  every Guide row whose pool holds it
 * @returns {{ status: 'behind'|'none'|'unknown', why: string, rowId?: number }}
 */
export function labelStanding(testVehicle, rows = []) {
    const named = rows.find(r => namesTestVehicle(r.via, testVehicle));
    if (named) return { status: 'behind', why: 'named by a Guide row', rowId: named.guide?.id };
    if (!testVehiclePoint(testVehicle)) return { status: 'unknown', why: 'no lab figures' };
    const judged = rows.filter(r => r.via?.verdict !== 'no-guide-figures');
    if (!judged.length) return { status: 'unknown', why: 'no Guide row imported for its certification' };
    if (judged.some(r => !TESTED.has(r.via?.verdict))) return { status: 'unknown', why: 'a row of its certification nobody reproduces' };
    const fits = judged.find(r => couldStandBehind(r.guide, testVehicle, r.pool, r.via));
    if (fits) return { status: 'unknown', why: 'could be part of a blend', rowId: fits.guide?.id };
    return { status: 'none', why: 'every row of its certification is reproduced by other test vehicles' };
}

/**
 * What marking them changes.
 *
 * @param {Array<{ test_vehicle_id, tests, memberships: Array, mappings: Array<{ id, vehicle }> }>} testVehicles
 *        memberships: { id, fe_guide_row_id, fe_guide_skipped_at, fe_guide_skip_note }
 * @param {(id: string) => Array} rowsOf  the rows whose pools hold a test vehicle
 * @returns {{
 *   mark: Array<{ test_vehicle_id, clearLinks: number[], skip: boolean, unlink: Array<{ id, vehicle }> }>,
 *   unmark: string[],
 *   counts: { none, behind, unknown, marked },
 * }}
 *   mark    the ones behind no label with something left to do: Guide links to
 *           clear, memberships to skip, vehicle links to remove
 *   unmark  ones this marked before that now stand behind a row (or may);
 *           only this mark's own skips are lifted
 */
export function planBehindNoLabel(testVehicles = [], rowsOf = () => []) {
    const mark = [];
    const unmark = [];
    const counts = { none: 0, behind: 0, unknown: 0, marked: 0 };
    for (const tv of testVehicles) {
        const { status } = labelStanding(tv, rowsOf(tv.test_vehicle_id));
        counts[status]++;
        const ms = tv.memberships ?? [];
        if (status !== 'none') {
            if (ms.some(isNoLabelSkip)) unmark.push(tv.test_vehicle_id);
            continue;
        }
        const clearLinks = ms.filter(m => m.fe_guide_row_id != null).map(m => m.id);
        // Never over a curator's own skip: its note says something this
        // cannot. A linked membership is unskipped (migration 082's trigger),
        // so clearing its link leaves it to skip.
        const skip = ms.some(m => m.fe_guide_skipped_at == null);
        const unlink = tv.mappings ?? [];
        if (clearLinks.length || skip || unlink.length) mark.push({ test_vehicle_id: tv.test_vehicle_id, clearLinks, skip, unlink });
        else counts.marked++;
    }
    return { mark, unmark, counts };
}
