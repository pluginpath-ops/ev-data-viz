import { useEffect, useRef, useState } from 'react';

/**
 * Which rows a chart is displaying, and how that survives the data changing
 * underneath it.
 *
 * Every chart had its own copy of this, and each one got a different part of it
 * wrong: rows springing back after being switched off, rows vanishing when
 * repinned, a whole vehicle refilling because another vehicle's dropdown moved.
 * They are the same problem, so this is the one implementation of it.
 *
 * ── The four rules ───────────────────────────────────────────────────────────
 *
 * 1. PRUNE      a selected row whose key no longer exists is dropped.
 * 2. CARRY      repinning a row changes its key ('70::' becomes '70::12'), so a
 *               new key inherits the selection of the row it replaced, matched
 *               on `groupId` — otherwise the row silently disappears.
 * 3. BOOTSTRAP  a vehicle seen for the first time gets its rows selected. Only
 *               the first time: a vehicle the user has emptied stays empty, or
 *               any unrelated change refills it.
 * 4. QUIET      when nothing actually changes, the previous array is returned
 *               unchanged, so dependent effects don't re-fire.
 *
 * ── Why a ref, and why it is written here ────────────────────────────────────
 *
 * "Seen" has to persist across renders without causing one, so it is a ref. It
 * is updated in the effect body and NEVER inside the state updater: React
 * invokes updaters more than once in development, and a mutation in there ran
 * twice — the second pass saw everything as already seen, added nothing, and
 * that empty result was the one kept, leaving the chart with no series at all.
 *
 * @param {Array}  rows            [{ key, vehicleId, groupId }] every selectable row
 * @param {Array}  [initial]       keys to start selected (e.g. restored from a URL)
 * @param {Function} [shouldBootstrap] (vehicleId, rowsForVehicle) => keys to auto-select;
 *                                  defaults to all of them
 */
export function useRunSelection(rows, { initial = [], shouldBootstrap = null } = {}) {
    const [selected, setSelected] = useState(initial);
    const seenVehicles = useRef(new Set());
    // key → groupId for every row ever seen, so a key that has since disappeared
    // can still be traced back to its group. Repinning depends on this.
    const knownGroups  = useRef(new Map());

    useEffect(() => {
        const live = new Set(rows.map(r => r.key));
        const prev = selected;

        // 1. PRUNE
        const kept = prev.filter(k => live.has(k));
        const keptSet = new Set(kept);

        // 2. CARRY — a row whose group still has a selection stays selected
        //    through a key change.
        //
        //    The departed key is looked up in the REMEMBERED index, not in the
        //    current rows: repinning is precisely the case where the old key no
        //    longer exists, so searching `rows` for it always missed and the
        //    replacement row was never carried.
        const prevGroups = new Set(
            prev.map(k => knownGroups.current.get(String(k)))
                .filter(g => g != null)
                .map(String)
        );
        for (const row of rows) {
            if (keptSet.has(row.key)) continue;
            if (prevGroups.has(String(row.groupId))) {
                kept.push(row.key);
                keptSet.add(row.key);
            }
        }

        // 3. BOOTSTRAP — first sighting of a vehicle only.
        const byVehicle = new Map();
        for (const row of rows) {
            if (!byVehicle.has(row.vehicleId)) byVehicle.set(row.vehicleId, []);
            byVehicle.get(row.vehicleId).push(row);
        }
        for (const [vehicleId, vehicleRows] of byVehicle) {
            if (seenVehicles.current.has(String(vehicleId))) continue;
            const auto = shouldBootstrap
                ? shouldBootstrap(vehicleId, vehicleRows)
                : vehicleRows.map(r => r.key);
            for (const key of auto) {
                if (keptSet.has(key)) continue;
                kept.push(key);
                keptSet.add(key);
            }
        }

        // Recorded AFTER deciding, and outside the updater. See the note above.
        for (const row of rows) {
            seenVehicles.current.add(String(row.vehicleId));
            knownGroups.current.set(String(row.key), row.groupId);
        }

        // 4. QUIET
        const unchanged = kept.length === prev.length && kept.every((k, i) => k === prev[i]);
        if (!unchanged) setSelected(kept);
    }, [rows, selected]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Toggle one row. */
    const toggle = (key) => setSelected(prev =>
        prev.some(k => String(k) === String(key))
            ? prev.filter(k => String(k) !== String(key))
            : [...prev, key]
    );

    /** Select or clear every row belonging to one vehicle. */
    const setVehicle = (vehicleId, wanted) => setSelected(prev => {
        const keys = rows.filter(r => String(r.vehicleId) === String(vehicleId)).map(r => r.key);
        if (!keys.length) return prev;
        if (!wanted) {
            const drop = new Set(keys.map(String));
            return prev.filter(k => !drop.has(String(k)));
        }
        const have = new Set(prev.map(String));
        const add = keys.filter(k => !have.has(String(k)));
        return add.length ? [...prev, ...add] : prev;
    });

    return { selected, setSelected, toggle, setVehicle };
}
