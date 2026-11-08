/**
 * Saved selections: a reader's named vehicle sets, one click from the chips.
 *
 * A saved selection is a name and an ordered list of vehicle ids — nothing
 * else. Charts keep their own settings; a featured comparison or a link is the
 * tool for "these vehicles, shown this way". Hand-set colors are never saved.
 *
 * Kept in the browser while signed out, and in the reader's own rows of
 * `saved_selections` (migration 096) once signed in. The first signed-in load
 * moves the browser's ones up (`planMove`) and empties the browser's list.
 *
 * ── Which one is showing ───────────────────────────────────────────────────
 *
 * Like a table preset: the selection IS a saved one when it holds exactly
 * that saved one's vehicles. Order is not compared — dragging a chip is using
 * the set, not leaving it. Adding or dropping a vehicle after loading one makes
 * the selection "modified from" it, so the menu can offer Update.
 *
 * Pure module — no React, no `window`. useSavedSelections holds the storage.
 */

/** Longest name a saved selection may have; the migration's check agrees. */
export const SAVED_SELECTION_NAME_MAX = 60;

/** Trimmed, inner runs of space collapsed, capped. '' when nothing is left. */
export function cleanName(name) {
    return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, SAVED_SELECTION_NAME_MAX).trim();
}

/**
 * A row (account) or a stored entry (browser) as { id, name, vehicleIds }.
 * Tolerant of a hand-edited entry: ids are kept only when they are numbers,
 * and repeats are dropped. Returns null for something with no usable name.
 */
export function normalizeSavedSelection(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = cleanName(raw.name);
    if (!name) return null;
    const ids = Array.isArray(raw.vehicle_ids) ? raw.vehicle_ids
        : Array.isArray(raw.vehicleIds) ? raw.vehicleIds : [];
    const vehicleIds = [...new Set(ids.map(Number).filter(Number.isFinite))];
    return { id: raw.id ?? null, name, vehicleIds };
}

/** Normalize a list and sort it by name, as the menu shows it. */
export function normalizeSavedSelections(list) {
    return (Array.isArray(list) ? list : [])
        .map(normalizeSavedSelection)
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The same vehicles, in any order. */
export function sameVehicles(a = [], b = []) {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return set.size === new Set(b).size && b.every(id => set.has(id));
}

/** The saved selection with this name, ignoring case, or null. */
export function findByName(saved, name) {
    const key = cleanName(name).toLowerCase();
    return saved.find(s => s.name.toLowerCase() === key) ?? null;
}

/** `name`, or "name (2)", "name (3)"… — the first no entry of `taken` has. */
export function uniqueName(name, taken) {
    const base = cleanName(name);
    const used = new Set(taken.map(t => t.toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
        const suffix = ` (${n})`;
        const candidate = base.slice(0, SAVED_SELECTION_NAME_MAX - suffix.length).trim() + suffix;
        if (!used.has(candidate.toLowerCase())) return candidate;
    }
}

/**
 * What the chips label shows.
 *
 *   current       the saved selection the selection exactly is — the last
 *                 loaded one if it still matches, else any that does
 *   modifiedFrom  the last loaded one, when the selection no longer matches it
 *
 * @param {number[]} selection   the selected vehicle ids
 * @param {Array}    saved       normalized saved selections
 * @param {*}        loadedId    id of the one last loaded or saved, or null
 */
export function matchSavedSelection(selection, saved, loadedId = null) {
    if (!selection.length) return { current: null, modifiedFrom: null };
    const loaded = loadedId != null ? saved.find(s => s.id === loadedId) ?? null : null;
    if (loaded && sameVehicles(loaded.vehicleIds, selection)) return { current: loaded, modifiedFrom: null };
    const current = saved.find(s => sameVehicles(s.vehicleIds, selection)) ?? null;
    return { current, modifiedFrom: current ? null : loaded };
}

/**
 * The ids of a saved selection that still name a vehicle the reader can see,
 * in saved order. A vehicle deleted or unlisted since is skipped, the rule
 * featured comparisons follow.
 */
export function resolvableIds(vehicleIds, vehicles) {
    const known = new Set(vehicles.map(v => v.id));
    return vehicleIds.filter(id => known.has(id));
}

/**
 * Moving the browser's saved selections into an account: what to insert.
 * One the account already holds (same name, same vehicles) is skipped; a name
 * the account already uses for other vehicles gets " (2)".
 *
 * @returns {Array<{ name, vehicleIds }>}
 */
export function planMove(local, account) {
    const taken = account.map(s => s.name);
    const out = [];
    for (const s of local) {
        const same = findByName(account, s.name);
        if (same && sameVehicles(same.vehicleIds, s.vehicleIds)) continue;
        const name = uniqueName(s.name, taken);
        taken.push(name);
        out.push({ name, vehicleIds: s.vehicleIds });
    }
    return out;
}
