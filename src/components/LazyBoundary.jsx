import { Suspense } from 'react';

/**
 * Suspense wrapper for the lazily-loaded utility components in lazyComponents.js.
 *
 * Every one of them is a modal or an edit form opened by an explicit click, so
 * the fallback is deliberately quiet: a spinner that flashes for the ~50ms a
 * cached chunk takes is worse than nothing, and the click has already given the
 * user feedback. On a cold chunk fetch the modal simply appears a beat later.
 *
 * Rendering the boundary *outside* the conditional that mounts the lazy child
 * would defeat the point — keep `{open && <LazyBoundary><Thing/></LazyBoundary>}`,
 * not `<LazyBoundary>{open && <Thing/>}</LazyBoundary>`.
 */
export default function LazyBoundary({ children, fallback = null }) {
    return <Suspense fallback={fallback}>{children}</Suspense>;
}
