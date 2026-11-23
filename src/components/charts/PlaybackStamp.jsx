import { useEffect, useState } from 'react';

/**
 * The playback clock in the figure's title — " · after 12 min" — so a
 * screenshot or exported image of a chart caught mid-playback says when. Its
 * own component, subscribed to the clock, so only it re-renders each frame,
 * not the view. `text(now)` words it; nothing shows until playback starts.
 * The PNG export asks the same `text` at copy time (useChartPng `stamp`).
 */
export default function PlaybackStamp({ playback, text }) {
    const { stateRef } = playback;
    const [, setTick] = useState(0);
    useEffect(() => {
        const listeners = stateRef.current.listeners;
        const fn = () => setTick(n => n + 1);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
    }, [stateRef]);
    const st = stateRef.current;
    // Read from the ref on purpose: it changes every frame, and the listener
    // re-renders this when it does.
    // eslint-disable-next-line react-hooks/refs
    if (!st.active) return null;
    // eslint-disable-next-line react-hooks/refs
    return <> · {text(st.now)}</>;
}

/** The stamp's text now, or null — for the PNG export. */
export function playbackStampText(playback, text) {
    const st = playback.stateRef.current;
    return st.active ? text(st.now) : null;
}
