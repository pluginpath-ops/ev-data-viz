import { useEffect, useState } from 'react';

// How near the bottom edge a panel may start and still count as in view.
const EDGE = 48;

const blockBelow = (target) => [...document.querySelectorAll(target)]
    .find(p => p.getBoundingClientRect().top > window.innerHeight - EDGE) ?? null;

/**
 * A pill floating at the bottom of the window — "▾ MORE" — while another
 * block of the page waits below the edge of what is on screen (#448).
 *
 * For a page that is a column of blocks (`target`, a selector): Home's chart
 * panels, the Explainers landing's subjects. A block that ends neatly at the
 * bottom of the window reads as the end of the page, more so when the fold
 * lands on a dark gap between blocks. The pill says there is more, and takes
 * the reader to the next block when pressed. It goes away once nothing is
 * below the edge, so it never sits over the last block for no reason.
 *
 * Blocks grow as they draw (Home's charts), so the check runs on scroll, on
 * resize and whenever the page changes height.
 */
export default function ScrollMoreHint({ target, label }) {
    const [more, setMore] = useState(false);

    useEffect(() => {
        let frame = 0;
        const check = () => { frame = 0; setMore(blockBelow(target) !== null); };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };

        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        observer?.observe(document.body);
        schedule();
        return () => {
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            observer?.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [target]);

    if (!more) return null;

    const goNext = () => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        blockBelow(target)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    };

    return (
        <button type="button" className="scroll-more" onClick={goNext} aria-label={label}>
            <span aria-hidden="true">▾</span> More
        </button>
    );
}
