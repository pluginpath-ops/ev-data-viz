import { useState, useEffect } from 'react';
import { applyTheme, storedTheme, DEV_OVERRIDE_KEY } from '../styles/themeBootstrap';

/**
 * Theme management hook.
 *
 * The resolution and application logic lives in `styles/themeBootstrap`, not
 * here, because `main.jsx` has to apply the theme before React exists — see
 * that module's header for why light is deferred and why the stored preference
 * key changed.
 *
 * Returns:
 *   theme    — effective preference: 'light' | 'dark' | 'system'. 'dark' unless
 *              the developer escape hatch says otherwise.
 *   setTheme — set one of the three values explicitly
 *   cycleTheme — cycle light → dark → system → light
 *   isDark   — boolean, effective resolved state (useful for JS-driven UI like Chart.js)
 */
export function useTheme() {
    const [stored, setStoredState] = useState(storedTheme);
    const [isDark, setIsDark] = useState(() => applyTheme(storedTheme()) === 'dark');

    // Re-apply when stored preference changes
    useEffect(() => {
        const effective = applyTheme(stored);
        setIsDark(effective === 'dark');
    }, [stored]);

    // Watch the data-theme attribute so ALL hook instances update when ANY
    // component changes the theme. The nav toggle that used to drive this is
    // gone for the duration of the re-skin, but the observer stays: it is how
    // the chart components — each holding their own useTheme() — learn about a
    // flip made from the console, and it is what the light pass will need back.
    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
        return () => observer.disconnect();
    }, []);

    // Follow system changes when in 'system' mode
    useEffect(() => {
        if (stored !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e) => {
            document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            setIsDark(e.matches);
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [stored]);

    const setTheme = (next) => {
        localStorage.setItem(DEV_OVERRIDE_KEY, next);
        setStoredState(next);
    };

    const cycleTheme = () => {
        const next = stored === 'light' ? 'dark' : stored === 'dark' ? 'system' : 'light';
        setTheme(next);
    };

    return { theme: stored, setTheme, cycleTheme, isDark };
}
