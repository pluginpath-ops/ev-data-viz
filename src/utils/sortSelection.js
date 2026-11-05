/**
 * Sorting the vehicle table reorders the selection too (#457).
 *
 * The selection's order is the chip order and the order the charts draw their
 * series, so a reader who sorts the table by range and watches the chips stay
 * where they were has sorted nothing they can use. The selected band at the top
 * of the table already shows the selection in chip order, so it follows the
 * reorder for free.
 *
 * Pure: it takes the selection and the table's rows and returns the selection
 * in the order the table would show those rows. Writing it is the caller's job,
 * and only through setVehicleSelection (wiring.test.js).
 */
import { sortVehicleRows } from './vehicleTable';

/**
 * The selection in the order sorting `rows` by `key` / `dir` would put it.
 *
 * - Every selected row takes part, shown or not: the band keeps a selected
 *   vehicle through filters, so a filter that hides one does not exempt it.
 * - Blanks go last (sortVehicleRows), in either direction.
 * - Ties and blanks keep their current relative order: the sort is stable and
 *   starts from the selection's own order, not the fleet's.
 * - A selected id with no row (a vehicle deleted since it was selected) goes
 *   after the sorted ones, in its current order, rather than being dropped.
 * - Returns `selectedIds` itself, unchanged, when the order would not change or
 *   there are fewer than two vehicles — so a caller can skip the write by
 *   comparing references.
 *
 * @param {Array<string|number>} selectedIds  the selection, in chip order
 * @param {Array<{id: string|number}>} rows    every row the table can build, not the filtered ones
 * @param {string} key                         a vehicle-table column key
 * @param {'asc'|'desc'} dir
 */
export function reorderSelectionBySort(selectedIds, rows, key, dir) {
    if (!Array.isArray(selectedIds) || selectedIds.length < 2) return selectedIds;
    const byId = new Map((rows ?? []).map(r => [r.id, r]));
    const present = selectedIds.map(id => byId.get(id)).filter(Boolean);
    const sortedIds = sortVehicleRows(present, key, dir).map(r => r.id);
    const missing = selectedIds.filter(id => !byId.has(id));
    const next = [...sortedIds, ...missing];
    return next.every((id, i) => id === selectedIds[i]) ? selectedIds : next;
}
