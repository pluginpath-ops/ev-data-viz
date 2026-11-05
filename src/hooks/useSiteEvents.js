import { useCallback } from 'react';
import { dataService } from '../services/DataService';
import { useAppContext } from '../context/AppContext';
import { shouldRecord, onceKey } from '../utils/siteEvents';

/**
 * `record(event, { slug, detail, once })` — count something a reader did.
 *
 * Skips a curator's own clicks and the pop-out (utils/siteEvents.js
 * shouldRecord). `once` counts it at most once per browser tab, for an event
 * that would otherwise repeat on every render of the same view; the tab's
 * sessionStorage remembers, and an unavailable sessionStorage means it counts
 * again rather than not at all.
 */
export function useSiteEvents() {
    const { userRole } = useAppContext();
    const popout = new URLSearchParams(window.location.search).get('popout') === '1';
    const recordable = shouldRecord({ role: userRole, popout });

    return useCallback((event, { slug = null, detail = {}, once = false } = {}) => {
        if (!recordable) return;
        if (once) {
            const key = onceKey(event, slug);
            try {
                if (sessionStorage.getItem(key)) return;
                sessionStorage.setItem(key, '1');
            } catch { /* counts again */ }
        }
        dataService.logSiteEvent({ event, slug, detail });
    }, [recordable]);
}
