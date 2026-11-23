import { useEffect, useRef, useState } from 'react';
import { speedAt, positionOfSpeed, roundSpeed, formatClock, notifyPlayback } from '../../utils/chartPlayback';

const SPEED_STEPS = 1000;

// A chart the view has destroyed can still sit in its ref; it has no canvas.
const redraw = (chartRef) => { const c = chartRef.current; if (c?.canvas) c.update('none'); };

/**
 * Play, pause, reset, a scrubber and a speed slider for a chart's playback
 * (useChartPlayback). Speed is a log scale between `minSpeed` and `maxSpeed`:
 * 100× plays a minute of the clock in 0.6 s.
 *
 * Sits under the plot, outside the frame, so an exported image never carries
 * it; the frame's subtitle carries the clock instead (PlaybackStamp). Shown
 * in presentation too, where a race is most likely to be shown.
 */
export default function PlaybackControl({ playback, chartRef, minSpeed, maxSpeed, defaultSpeed }) {
    const { stateRef, setEngaged } = playback;
    const [phase, setPhase] = useState('idle');   // idle | playing | paused
    const [now, setNow] = useState(0);
    const [extent, setExtent] = useState({ start: 0, end: 0 });
    const [speed, setSpeed] = useState(defaultSpeed);
    const extentRef = useRef(extent);
    const speedRef = useRef(speed);
    useEffect(() => { speedRef.current = speed; }, [speed]);

    // The chart reports where its series start and end, each time it updates.
    useEffect(() => {
        const st = stateRef.current;
        st.onExtent = (e) => {
            const was = extentRef.current;
            if (e.start === was.start && e.end === was.end) return;
            extentRef.current = e;
            setExtent(e);
        };
        redraw(chartRef);
        return () => {
            st.onExtent = null;
            // Leaving: the chart is drawn whole again.
            if (st.active) { st.active = false; st.now = 0; setEngaged(false); redraw(chartRef); notifyPlayback(st); }
        };
    }, [stateRef, chartRef, setEngaged]);

    const seek = (t) => {
        stateRef.current.now = t;
        setNow(t);
        redraw(chartRef);
        notifyPlayback(stateRef.current);
    };

    // The frame loop, while playing.
    useEffect(() => {
        if (phase !== 'playing') return undefined;
        let raf, last = null;
        const tick = (ts) => {
            const dt = last == null ? 0 : ts - last;
            last = ts;
            const { start, end } = extentRef.current;
            const t = stateRef.current.now + dt * speedRef.current / 60000;
            // An empty extent is a chart still being built.
            if (end > start && t >= end) { seek(end); setPhase('paused'); return; }
            seek(end > start ? t : start);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    // seek reads only refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    const engage = () => {
        if (!stateRef.current.active) { stateRef.current.active = true; setEngaged(true); notifyPlayback(stateRef.current); }
    };
    const play = () => {
        engage();
        if (phase === 'idle' || now >= extentRef.current.end) seek(extentRef.current.start);
        setPhase('playing');
    };
    const reset = () => {
        setPhase('idle');
        stateRef.current.active = false;
        setEngaged(false);
        seek(0);
    };
    const scrub = (t) => {
        engage();
        if (phase === 'idle') setPhase('paused');
        seek(t);
    };

    const shownSpeed = roundSpeed(speed);
    // One unit for the clock and its end, whichever is longer.
    const hours = Math.max(-extent.start, extent.end) >= 60;
    return (
        <div className={`race-mode playback-control${phase !== 'idle' ? ' is-on' : ''}`}>
            <div className="flex items-center gap-2.5">
                <input type="range" className="playback-scrubber" aria-label="Playback time"
                    min={extent.start} max={extent.end > extent.start ? extent.end : extent.start + 1} step="any"
                    value={Math.min(Math.max(now, extent.start), extent.end)}
                    onChange={e => scrub(Number(e.target.value))} />
                <span className="playback-clock">
                    {formatClock(now, hours)}{extent.end > 0 && ` / ${formatClock(extent.end, hours)}`}
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
                <button type="button" className="btn btn-toggle playback-play"
                    onClick={phase === 'playing' ? () => setPhase('paused') : play}
                    aria-label={phase === 'playing' ? 'Pause' : 'Play'}>
                    {phase === 'playing' ? '❚❚ Pause' : '▶ Play'}
                </button>
                <button type="button" className="btn btn-toggle" onClick={reset} disabled={phase === 'idle'}
                    aria-label="Reset" title="Reset: show the whole chart again">
                    ↺
                </button>
                <label className="flex items-center gap-1.5 ml-auto" title={`How fast the clock runs: ${shownSpeed}× real time`}>
                    <span className="text-label">Speed</span>
                    <input type="range" className="playback-speed-slider"
                        min={0} max={SPEED_STEPS} step={1}
                        value={Math.round(positionOfSpeed(speed, minSpeed, maxSpeed) * SPEED_STEPS)}
                        onChange={e => setSpeed(roundSpeed(speedAt(Number(e.target.value) / SPEED_STEPS, minSpeed, maxSpeed)))} />
                    <span className="playback-clock">{shownSpeed.toLocaleString()}×</span>
                </label>
            </div>
        </div>
    );
}
