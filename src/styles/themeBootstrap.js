/**
 * Resolve and apply the theme BEFORE first paint.
 *
 * `useTheme` applies the theme too, but it cannot run until React has mounted,
 * and until then `<html>` carries no `data-theme` — so `:root` wins and the
 * page paints LIGHT before flipping. That was survivable while light was the
 * default. With dark the default it is a white flash on every cold load, which
 * is the most visible thing on the site.
 *
 * This module is imported statically by `main.jsx`, so it must stay a LEAF: no
 * React, no context, and above all nothing that can reach `constants/epa.js`,
 * which resolves every tunable at module load and must not be evaluated before
 * the site constants are seeded. See the header of `main.jsx`.
 *
 * ── Light is deferred, not deleted ──────────────────────────────────────────
 * The design handoff draws dark only. `evbench_theme` — the pre-re-skin
 * preference key — is deliberately not read: the nav toggle that would let
 * someone leave light is gone for the duration, so honouring an old preference
 * would strand a returning visitor on a half-migrated theme with no way out.
 * The escape hatch is a separate key, so clearing it restores shipped behaviour
 * exactly:
 *
 *     localStorage.setItem('evbench_theme_dev', 'light')
 */

export const DEFAULT_THEME = 'dark';
export const DEV_OVERRIDE_KEY = 'evbench_theme_dev';

/** The stored preference: 'light' | 'dark' | 'system'. */
export function storedTheme() {
    // Private-mode browsers and blocked site data throw on access rather than
    // returning null, and a theme is not worth a blank page.
    let dev = null;
    try {
        dev = localStorage.getItem(DEV_OVERRIDE_KEY);
    } catch {
        // Fall through to the default.
    }
    return dev === 'light' || dev === 'dark' || dev === 'system' ? dev : DEFAULT_THEME;
}

/** Resolve system preference to 'light' | 'dark'. */
export function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Write the effective theme to the document root as data-theme="light|dark".
 * Always explicit, so CSS only ever needs `[data-theme="dark"]`.
 */
export function applyTheme(stored) {
    const effective = stored === 'system' ? getSystemTheme() : stored;
    document.documentElement.setAttribute('data-theme', effective);
    return effective;
}

/** Apply whatever is stored. Called once from main.jsx, before first paint. */
export function applyStoredTheme() {
    return applyTheme(storedTheme());
}
