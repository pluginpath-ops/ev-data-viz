import { useCallback, useState } from 'react';
import { dataService } from '../services/DataService';
import { useAsyncResource } from './useAsyncResource';
import { normalizeSavedSelections, planMove } from '../utils/savedSelections';

const BROWSER_KEY = 'evbench_saved_selections';

function readBrowser() {
    try { return normalizeSavedSelections(JSON.parse(window.localStorage.getItem(BROWSER_KEY) || '[]')); }
    catch { return []; }
}

function writeBrowser(list) {
    try {
        if (list.length) window.localStorage.setItem(BROWSER_KEY, JSON.stringify(list));
        else window.localStorage.removeItem(BROWSER_KEY);
    } catch { /* not kept: private window or blocked storage */ }
}

const browserId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * One move per user per page. React runs a mount's effect twice in
 * development, and two moves racing would insert the browser's list twice.
 */
const moves = new Map();

async function moveBrowserToAccount(userId, account) {
    if (!moves.has(userId)) {
        moves.set(userId, (async () => {
            const local = readBrowser();
            if (!local.length) return 0;
            const plan = planMove(local, account);
            await dataService.addSavedSelections(plan);
            writeBrowser([]);
            return plan.length;
        })());
    }
    return moves.get(userId);
}

/**
 * The reader's saved selections (utils/savedSelections.js) and the writes the
 * Saved menu makes, wherever they are kept:
 *
 *   browser   signed out, or the table is missing (096 not applied) —
 *             localStorage, under BROWSER_KEY
 *   account   signed in — the reader's rows of `saved_selections`
 *
 * The first signed-in load moves any browser ones into the account and empties
 * the browser's list; `onMoved(count)` says how many went up.
 *
 * Every write reloads the list rather than patching it, so what the menu shows
 * is what was stored. A list this small makes the extra read cheap.
 *
 * @param {{ userId?: string|null, onMoved?: (count: number) => void }} options
 * @returns {{ saved: Array, where: 'browser'|'account', loading: boolean,
 *             loadedId: *, setLoadedId: Function,
 *             add: Function, update: Function, rename: Function, remove: Function }}
 */
export function useSavedSelections({ userId = null, onMoved } = {}) {
    // The one last loaded or saved, so the chips can say "modified from" it.
    // Not remembered across a reload: the selection is, and it still matches.
    const [loadedId, setLoadedId] = useState(null);

    const load = useCallback(async () => {
        if (userId && dataService.useSupabase) {
            const account = await dataService.getSavedSelections();
            if (account) {
                const moved = await moveBrowserToAccount(userId, normalizeSavedSelections(account));
                if (moved > 0) {
                    onMoved?.(moved);
                    return { where: 'account', list: normalizeSavedSelections(await dataService.getSavedSelections()) };
                }
                return { where: 'account', list: normalizeSavedSelections(account) };
            }
        }
        return { where: 'browser', list: readBrowser() };
        // onMoved is a notice, not an input: a new callback must not reload.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);
    const { data, loading, reload } = useAsyncResource(load, [load]);
    const where = data?.where ?? 'browser';
    const saved = data?.list ?? [];

    /** Save `{ name, vehicleIds }` as new; resolves to its id. */
    const add = useCallback(async (entry) => {
        let id;
        if (where === 'account') {
            [{ id }] = await dataService.addSavedSelections([entry]);
        } else {
            id = browserId();
            writeBrowser([...readBrowser(), { id, ...entry }]);
        }
        reload();
        return id;
    }, [where, reload]);

    const change = useCallback(async (id, fields) => {
        if (where === 'account') await dataService.updateSavedSelection(id, fields);
        else writeBrowser(readBrowser().map(s => (s.id === id ? { ...s, ...fields } : s)));
        reload();
    }, [where, reload]);

    const update = useCallback((id, vehicleIds) => change(id, { vehicleIds }), [change]);
    const rename = useCallback((id, name) => change(id, { name }), [change]);

    const remove = useCallback(async (id) => {
        if (where === 'account') await dataService.deleteSavedSelection(id);
        else writeBrowser(readBrowser().filter(s => s.id !== id));
        reload();
    }, [where, reload]);

    return { saved, where, loading, loadedId, setLoadedId, add, update, rename, remove };
}
