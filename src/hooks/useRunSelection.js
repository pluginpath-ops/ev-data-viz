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
 * ── Controlled mode ──────────────────────────────────────────────────────────
 *
 * Pass `value`/`onChange` and the selection lives outside the hook. The charting
 * view needs this: its selection is URL-synced through `chartConfig.selectedRuns`
 * in App, so the hook cannot be the owner without the URL and the chart keeping
 * two answers. Uncontrolled callers (Charge Compare, Road Trip) are unaffected —
 * their selection is local by design and does not survive a reload.
 *
 * @param {Array}  rows            [{ key, vehicleId, groupId }] every selectable row
 * @param {Array}  [initial]       keys to start selected, uncontrolled mode only
 * @param {Function} [shouldBootstrap] (vehicleId, rowsForVehicle) => keys to auto-select;
 *                                  defaults to all of them
 * @param {Array}  [value]         controlled selection — the hook stops owning state
 * @param {Function} [onChange]    (nextKeys) => void, required with `value`
 * @param {*}       [resetKey]     change it and every vehicle counts as unseen again,
 *                                 so BOOTSTRAP re-runs. For a view whose rows are a
 *                                 different population per mode — see below.
 */
export function useRunSelection(rows, {
    initial = [],
    shouldBootstrap = null,
    value = null,
    onChange = null,
    resetKey = null,
} = {}) {
    const [internal, setInternal] = useState(initial);
    const controlled = value != null;
    const selected   = controlled ? value : internal;

    // Controlled mode has to chain updaters the way `setState` does, and cannot
    // simply resolve them against this render's `value`.
    //
    // The run selector's per-vehicle "all / none" links are why: they call
    // `toggle` once PER ROW in a loop, all within one tick and all before the
    // parent re-renders. Resolved against the render value, every call in that
    // loop starts from the same base and the last one wins — clicking "none" on
    // a two-row vehicle switched off the second row and put the first back.
    //
    // So the pending value is threaded through a ref: each call reads what the
    // previous call in this tick decided, and the effect below resyncs it to the
    // authoritative value once the parent has actually re-rendered.
    const pending = useRef(selected);
    useEffect(() => { pending.current = selected; }, [selected]);

    const setSelected = (next) => {
        if (!controlled) { setInternal(next); return; }   // real updater semantics
        const resolved = typeof next === 'function' ? next(pending.current) : next;
        pending.current = resolved;
        onChange(resolved);
    };

    const seenVehicles = useRef(new Set());
    // key → groupId for every row ever seen, so a key that has since disappeared
    // can still be traced back to its group. Repinning depends on this.
    const knownGroups  = useRef(new Map());
    const lastResetKey = useRef(resetKey);

    useEffect(() => {
        const live = new Set(rows.map(r => r.key));
        const prev = selected;

        // 0a. RESET — the rows are a different population now, not the same rows
        //     changed. Charging ↔ Range is the case: a charging run has no
        //     counterpart in range mode, so PRUNE drops everything and BOOTSTRAP
        //     would decline to refill a vehicle it has already seen, leaving the
        //     chart empty. Forgetting them is the explicit answer to that.
        if (resetKey !== lastResetKey.current) {
            lastResetKey.current = resetKey;
            seenVehicles.current.clear();
        }

        // 0b. FORGET — a vehicle that has left the selection is unseen again, so
        //     re-adding it bootstraps rather than returning empty. Without this,
        //     removing a car and putting it back gives you a car with no series
        //     and no way to tell why.
        //
        //     Safe when `rows` is briefly empty (before vehicles load): everything
        //     is forgotten, but nothing is selected either, so the first real
        //     render is a genuine first sighting.
        const liveVehicles = new Set(rows.map(r => String(r.vehicleId)));
        for (const id of seenVehicles.current) {
            if (!liveVehicles.has(id)) seenVehicles.current.delete(id);
        }

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

        // 3. BOOTSTRAP — first sighting of a vehicle, and only when it arrives
        //    with nothing selected.
        //
        //    The second half carries over the `hasRun` check in the hand-rolled
        //    charting-view code this replaced, and is kept deliberately rather
        //    than dropped as redundant. "Seen" is a ref, so it does not survive a
        //    remount — leave the tab and come back and every vehicle is a first
        //    sighting again. A vehicle that arrives already holding a row (a URL
        //    restore, state that outlived the unmount) has been chosen for, and
        //    adding its default on top would override that choice.
        //
        //    Defensive rather than demonstrable today: App re-derives the chart
        //    config on view change, so the selection is currently rebuilt before
        //    this can bite. It stops that from becoming a bug if that changes.
        const byVehicle = new Map();
        for (const row of rows) {
            if (!byVehicle.has(row.vehicleId)) byVehicle.set(row.vehicleId, []);
            byVehicle.get(row.vehicleId).push(row);
        }
        const vehiclesWithSelection = new Set(
            rows.filter(r => keptSet.has(r.key)).map(r => String(r.vehicleId))
        );
        for (const [vehicleId, vehicleRows] of byVehicle) {
            if (seenVehicles.current.has(String(vehicleId))) continue;
            if (vehiclesWithSelection.has(String(vehicleId))) continue;
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
    }, [rows, selected, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
