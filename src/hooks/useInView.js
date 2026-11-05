import { useEffect, useRef, useState } from 'react';

/**
 * Whether an element has come near the viewport, once, and stays true after.
 *
 * Home draws several charts, each a canvas that fetches and computes on mount;
 * the ones below the fold wait until the reader scrolls toward them. Without
 * IntersectionObserver (an old browser, a test) the answer is simply yes.
 *
 * @param {string} [margin]  how far outside the viewport counts as near
 * @returns {[React.RefObject, boolean]}
 */
export function useInView(margin = '300px') {
    const ref = useRef(null);
    const supported = typeof IntersectionObserver !== 'undefined';
    const [seen, setSeen] = useState(!supported);

    useEffect(() => {
        if (seen || !ref.current) return undefined;
        const observer = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) setSeen(true);
        }, { rootMargin: margin });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [seen, margin]);

    return [ref, seen];
}
