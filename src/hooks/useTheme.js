import { useState, useEffect } from 'react';

// Resolve system preference to 'light' | 'dark'
function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Apply the effective theme to the document root as data-theme="light|dark".
// Always sets an explicit attribute so CSS only needs [data-theme="dark"].
function applyTheme(stored) {
    const effective = stored === 'system' ? getSystemTheme() : stored;
    document.documentElement.setAttribute('data-theme', effective);
    return effective;
}

/**
 * Theme management hook.
 *
 * Returns:
 *   theme    — stored preference: 'light' | 'dark' | 'system'
 *   setTheme — set one of the three values explicitly
 *   cycleTheme — cycle light → dark → system → light
 *   isDark   — boolean, effective resolved state (useful for JS-driven UI like Chart.js)
 */
export function useTheme() {
    const [stored, setStoredState] = useState(
        () => localStorage.getItem('evbench_theme') || 'system',
    );
    const [isDark, setIsDark] = useState(() => {
        const s = localStorage.getItem('evbench_theme') || 'system';
        return applyTheme(s) === 'dark';
    });

    // Re-apply when stored preference changes
    useEffect(() => {
        const effective = applyTheme(stored);
        setIsDark(effective === 'dark');
    }, [stored]);

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
        localStorage.setItem('evbench_theme', next);
        setStoredState(next);
    };

    const cycleTheme = () => {
        const next = stored === 'light' ? 'dark' : stored === 'dark' ? 'system' : 'light';
        setTheme(next);
    };

    return { theme: stored, setTheme, cycleTheme, isDark };
}
