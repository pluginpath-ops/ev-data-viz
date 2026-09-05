import { useCallback, useSyncExternalStore } from 'react';

/**
 * Is the window narrow enough that the chrome has to collapse?
 *
 * ONE breakpoint, in ONE place, expressed in JS rather than duplicated between
 * a media query and a component. The chrome switches between a row of tabs and
 * a menu — two different DOM shapes, not two skins of one shape — so a CSS
 * media query cannot make the call on its own: it would mean rendering both and
 * hiding one, which puts every tab in the accessibility tree twice and leaves
 * two menus holding open state.
 *
 * 1000px is the design handoff's own line ("Responsive behaviour", <1000px),
 * where the six top-level tabs stop fitting beside the wordmark and the account
 * control.
 *
 * `useSyncExternalStore` rather than a resize listener with `useState`: it
 * subscribes to the MediaQueryList itself, so it fires on the transition rather
 * than on every pixel of a drag, and React reads the value at render time
 * instead of one commit late.
 */
const COMPACT_QUERY = '(max-width: 999px)';

export function useIsCompact() {
    const subscribe = useCallback((onChange) => {
        const mql = window.matchMedia(COMPACT_QUERY);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(COMPACT_QUERY).matches,
        // No SSR here, but a getServerSnapshot is required and "wide" is the
        // safer default: it renders the tabs, which work at any width, rather
        // than a menu that would be wrong on a desktop first paint.
        () => false,
    );
}
