import { useState, useEffect } from 'react';

/**
 * Publish the height of the sticky header as `--app-header-h`.
 *
 * The chart sidebar needs one number CSS cannot work out for itself: how much
 * of the viewport is already spoken for above it. `height: 100vh` on a sidebar
 * that starts below the header overhangs the fold by exactly the header's
 * height — which is what "the sidebar falls off the bottom" was.
 *
 * It has to be measured rather than written down as a constant. The header is
 * a 50px bar plus a sub-nav plus the chips row, and the last of those WRAPS:
 * select enough vehicles and it grows a second row. A hardcoded 131px would be
 * right until the day someone selected nine cars.
 *
 * ── Why a callback ref and not a ref object ─────────────────────────────────
 *
 * App renders a loading branch before it renders the header. An effect keyed on
 * a ref OBJECT runs once, on the mount where that branch is showing, finds
 * `.current` still null and gives up — and the ref object's identity never
 * changes, so it is never asked again. The variable stayed unset and the
 * sidebar silently fell back to the whole viewport. A callback ref fires when
 * the node actually attaches, which is the event we care about.
 *
 * See docs/vocabulary.md for header / sidebar / chrome.
 *
 * @returns {(node: HTMLElement|null) => void} ref callback for the sticky header
 */
export function useHeaderHeight() {
    const [node, setNode] = useState(null);

    useEffect(() => {
        if (!node) return;

        const publish = () => {
            document.documentElement.style.setProperty(
                '--app-header-h', `${Math.round(node.getBoundingClientRect().height)}px`,
            );
        };
        publish();

        // ResizeObserver rather than a window listener: the chips row changes
        // height when the SELECTION changes, which is not a window resize and
        // would otherwise leave the sidebar sized for the wrong header until
        // something else happened to trigger a re-measure.
        const observer = new ResizeObserver(publish);
        observer.observe(node);
        return () => {
            observer.disconnect();
            document.documentElement.style.removeProperty('--app-header-h');
        };
    }, [node]);

    return setNode;
}
