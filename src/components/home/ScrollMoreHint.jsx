import { useEffect, useState } from 'react';

// How near the bottom edge a panel may start and still count as in view.
const EDGE = 48;

const panelBelow = () => [...document.querySelectorAll('.home-panel')]
    .find(p => p.getBoundingClientRect().top > window.innerHeight - EDGE) ?? null;

/**
 * A pill floating at the bottom of the window — "▾ MORE" — while another
 * chart waits below the edge of what is on screen (#448).
 *
 * Home is a column of panels, and a chart that ends neatly at the bottom of the
 * window reads as the end of the page. The pill says there is more, and takes
 * the reader to the next panel when pressed. It goes away once nothing is below
 * the edge, so it never sits over the last chart for no reason.
 *
 * Panels grow as their charts draw, so the check runs on scroll, on resize and
 * whenever the page changes height.
 */
export default function ScrollMoreHint() {
    const [more, setMore] = useState(false);

    useEffect(() => {
        let frame = 0;
        const check = () => { frame = 0; setMore(panelBelow() !== null); };
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
    }, []);

    if (!more) return null;

    const goNext = () => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        panelBelow()?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    };

    return (
        <button type="button" className="scroll-more" onClick={goNext} aria-label="Scroll to the next chart">
            <span aria-hidden="true">▾</span> More
        </button>
    );
}
