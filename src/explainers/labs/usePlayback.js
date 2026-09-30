import { useEffect, useRef, useState } from 'react';

const reducedMotion = () => typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A clock for the drive-cycle labs: test time `t` in seconds, advanced at
 * `rate` × real time while playing, stopping at `duration`. `t` is null until
 * the first play, which a lab reads as "draw everything whole".
 *
 * It plays once on its own when `ref`'s element is first mostly on screen,
 * unless the reader prefers reduced motion.
 */
export function usePlayback(duration, defaultRate) {
    const [t, setTState] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [rate, setRate] = useState(defaultRate);
    const tRef = useRef(null);
    const ref = useRef(null);
    const autoplayed = useRef(false);
    const setT = (v) => { tRef.current = v; setTState(v); };

    useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === 'undefined' || reducedMotion()) return undefined;
        const io = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting && !autoplayed.current) {
                autoplayed.current = true;
                tRef.current = 0;
                setTState(0);
                setPlaying(true);
            }
        }, { threshold: 0.6 });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    useEffect(() => {
        if (!playing) return undefined;
        let frame;
        let last = performance.now();
        const tick = (now) => {
            const next = (tRef.current ?? 0) + ((now - last) / 1000) * rate;
            last = now;
            if (next >= duration) {
                tRef.current = duration;
                setTState(duration);
                setPlaying(false);
                return;
            }
            tRef.current = next;
            setTState(next);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, rate, duration]);

    const toggle = () => {
        if (tRef.current == null || tRef.current >= duration) setT(0);
        setPlaying(p => !p);
    };
    const label = playing ? 'Pause' : t != null && t < duration ? 'Resume' : 'Play';

    return { ref, t, playing, rate, setRate, toggle, label };
}
