/**
 * The reader's theme: which one, where it is kept, and putting it on the page.
 *
 * `useTheme` cannot do this alone. It cannot run until React has mounted, and
 * until then `<html>` carries no `data-theme`, so `:root` (light) wins and a
 * reader in dark gets a white flash on every cold load. So the choice is
 * resolved and applied here, before first paint.
 *
 * This module is imported statically by `main.jsx`, so it must stay a LEAF: no
 * React, no context, and above all nothing that can reach `constants/epa.js`,
 * which resolves every tunable at module load and must not be evaluated before
 * the site constants are seeded. See the header of `main.jsx`.
 *
 * The choice is 'light', 'dark' or 'system' (follow the device), kept per
 * browser like the unit system. The default is 'system'.
 */

export const THEMES = ['light', 'dark', 'system'];
export const DEFAULT_THEME = 'system';
export const THEME_KEY = 'evbench_theme';

/** The stored choice: 'light' | 'dark' | 'system'. */
export function storedTheme() {
    // Private-mode browsers and blocked site data throw on access rather than
    // returning null, and a theme is not worth a blank page.
    let stored = null;
    try {
        stored = localStorage.getItem(THEME_KEY);
    } catch {
        // Fall through to the default.
    }
    return THEMES.includes(stored) ? stored : DEFAULT_THEME;
}

const systemQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

/**
 * Write the effective theme to the document root as data-theme="light|dark".
 * Always explicit, so CSS never has to ask the device itself.
 */
function applyTheme(choice) {
    const effective = choice === 'system' ? (systemQuery().matches ? 'dark' : 'light') : choice;
    // Unchanged is a no-op, so observers of the attribute are not woken.
    if (document.documentElement.getAttribute('data-theme') !== effective) {
        document.documentElement.setAttribute('data-theme', effective);
    }
    return effective;
}

const listeners = new Set();

/** Hear about a change of the stored choice, from this window or another. */
export function subscribeStoredTheme(onChange) {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
}

const reapply = () => {
    applyTheme(storedTheme());
    listeners.forEach(notify => notify());
};

/** Keep the choice and put it on the page. */
export function setStoredTheme(choice) {
    try {
        localStorage.setItem(THEME_KEY, choice);
    } catch {
        // Not kept; it still applies to this page.
        applyTheme(choice);
        return;
    }
    reapply();
}

/**
 * Apply the stored choice and keep the page in step with it. Called once from
 * main.jsx, before first paint.
 *
 * Two things can change the theme from outside this page: the device flipping
 * while the choice is 'system', and the reader choosing in another window. The
 * second is what carries a flip to an open pop-out, which shares this
 * browser's storage and hears the `storage` event.
 */
export function startTheme() {
    applyTheme(storedTheme());
    systemQuery().addEventListener('change', reapply);
    window.addEventListener('storage', (e) => {
        if (e.key === THEME_KEY || e.key === null) reapply();
    });
}
