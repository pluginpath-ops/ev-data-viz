import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a disclosure is open, remembered in this browser across charts and
 * visits.
 *
 * Every chart's sidebar has a Display section, and a reader who opens it on one
 * chart expects it open on the next: six independent states would close it
 * again at every tab change. One key per kind of section, shared by every
 * instance through a tiny store, so the others follow at once.
 *
 * Browser storage is a convenience here and nothing depends on it: it can be
 * absent or throw (private windows, blocked site data), and then the section
 * simply starts at its default each visit.
 */
const STORAGE_PREFIX = 'evbench.open.';
const listeners = new Set();

function read(key, fallback) {
    try {
        const v = window.localStorage.getItem(STORAGE_PREFIX + key);
        return v == null ? fallback : v === '1';
    } catch {
        return fallback;
    }
}

export function useRememberedOpen(key, defaultOpen = false) {
    const subscribe = useCallback((onChange) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
    }, []);
    const open = useSyncExternalStore(subscribe, () => read(key, defaultOpen), () => defaultOpen);
    const setOpen = useCallback((next) => {
        const value = typeof next === 'function' ? next(read(key, defaultOpen)) : next;
        try { window.localStorage.setItem(STORAGE_PREFIX + key, value ? '1' : '0'); } catch { /* not remembered */ }
        for (const l of listeners) l();
    }, [key, defaultOpen]);
    return [open, setOpen];
}
