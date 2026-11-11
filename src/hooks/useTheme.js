import { useSyncExternalStore } from 'react';
import { storedTheme, setStoredTheme, subscribeStoredTheme } from '../styles/themeBootstrap';

/**
 * The theme, for React.
 *
 * `isDark` is for code that paints in JS. CSS follows `data-theme` by itself;
 * a canvas does not: a chart reads its colors from the tokens while it is
 * built (`chartTheme()`), so it has to be rebuilt when the theme flips.
 * `isDark` is that trigger. Put it in the build effect's dependencies; do not
 * branch on it to pick a color.
 *
 * `theme` is the reader's choice ('light', 'dark' or 'system') and `setTheme`
 * changes it; the account menu's picker is their one caller.
 *
 * One observer on the document root serves every caller. Choosing, storing
 * and applying the theme is `styles/themeBootstrap`, which runs before React
 * exists.
 */
const listeners = new Set();
let observer = null;

function subscribe(onChange) {
    listeners.add(onChange);
    if (!observer) {
        observer = new MutationObserver(() => listeners.forEach(notify => notify()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    return () => {
        listeners.delete(onChange);
        if (!listeners.size) {
            observer.disconnect();
            observer = null;
        }
    };
}

const isDarkNow = () => document.documentElement.getAttribute('data-theme') === 'dark';

export function useTheme() {
    return {
        isDark: useSyncExternalStore(subscribe, isDarkNow),
        theme: useSyncExternalStore(subscribeStoredTheme, storedTheme),
        setTheme: setStoredTheme,
    };
}
