import { useId, useMemo } from 'react';
import cycleData from '../data/driveCycles.json';
import { usePlayback } from './usePlayback';

/**
 * The EPA drive cycles, drawn from EPA's own second-by-second schedules
 * (data/driveCycles.json), one lane each on a shared clock, with a playhead
 * that drives them all at once. Played, it shows what the table on the cycles
 * page can't: how long the city cycle idles, how steady the highway one is,
 * and that none of the label's cycles ever reaches a 65–75 mph cruise.
 *
 * Plays once on its own when it first scrolls into view, unless the reader
 * prefers reduced motion; until then, and after, every trace is drawn whole.
 */
const W = 720;
const LANE_H = 78;
const LANE_GAP = 26;
const PAD = { left: 34, right: 12, top: 22, bottom: 26 };
const MAX_MPH = 80;
const CRUISE_BAND = [65, 75];
const RATES = [20, 60, 120];
const DEFAULT_RATE = 60;

const CYCLES = cycleData.cycles.map(c => {
    // Distance so far at each second, integrating 1 Hz speeds (mph × 1 s).
    const miles = [0];
    for (let s = 1; s < c.mph.length; s++) miles.push(miles[s - 1] + (c.mph[s - 1] + c.mph[s]) / 2 / 3600);
    const seconds = c.mph.length - 1;
    const totalMi = miles[seconds];
    return { ...c, miles, seconds, totalMi, avgMph: totalMi / (seconds / 3600) };
});
const LONGEST = Math.max(...CYCLES.map(c => c.seconds));
const H = PAD.top + CYCLES.length * LANE_H + (CYCLES.length - 1) * LANE_GAP + PAD.bottom;

const px = (s) => PAD.left + (s / LONGEST) * (W - PAD.left - PAD.right);
const laneTop = (n) => PAD.top + n * (LANE_H + LANE_GAP);
const py = (n, mph) => laneTop(n) + LANE_H - (mph / MAX_MPH) * LANE_H;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function DriveCycleLab() {
    // t is null until the first play: every trace drawn whole.
    const { ref: figRef, t, playing, rate, setRate, toggle: play, label } = usePlayback(LONGEST, DEFAULT_RATE);
    const clipId = `cycle-played-${useId().replace(/:/g, '')}`;

    const paths = useMemo(() => CYCLES.map((c, n) =>
        c.mph.map((v, s) => `${s ? 'L' : 'M'}${px(s).toFixed(1)},${py(n, v).toFixed(1)}`).join('')), []);

    const shown = t ?? LONGEST;
    const minutes = Array.from({ length: Math.floor(LONGEST / 120) + 1 }, (_, n) => n * 120);

    return (
        <figure className="explainer-lab" ref={figRef}>
            <div className="explainer-lab-head">
                <span className="text-micro">Drive Cycle Lab</span>
                <span className="explainer-model-badge">EPA schedule data</span>
            </div>

            <div className="explainer-cycle-controls">
                <button type="button" className="explainer-chip" aria-pressed={playing} onClick={play}>
                    {label}
                </button>
                <span className="explainer-lab-presets" role="group" aria-label="Playback speed">
                    {RATES.map(r => (
                        <button key={r} type="button" className="explainer-chip" aria-pressed={rate === r}
                            onClick={() => setRate(r)}>{r}×</button>
                    ))}
                </span>
                <span className="explainer-cycle-clock text-data">
                    {t == null ? 'Test time' : clock(shown)}
                </span>
            </div>

            <svg className="explainer-diagram explainer-cycle-svg" viewBox={`0 0 ${W} ${H}`} role="img"
                aria-label={CYCLES.map(c => `${c.name}: ${clock(c.seconds)}, ${c.totalMi.toFixed(2)} miles, average ${c.avgMph.toFixed(1)} mph`).join('; ')}>
                <defs>
                    <clipPath id={clipId}>
                        <rect x="0" y="0" width={px(shown)} height={H} />
                    </clipPath>
                </defs>
                {CYCLES.map((c, n) => {
                    const s = Math.min(Math.floor(shown), c.seconds);
                    const done = shown >= c.seconds;
                    return (
                        <g key={c.id}>
                            <rect className="explainer-cycle-band" x={PAD.left} width={W - PAD.left - PAD.right}
                                y={py(n, CRUISE_BAND[1])} height={py(n, CRUISE_BAND[0]) - py(n, CRUISE_BAND[1])} />
                            {[0, 40, 80].map(v => (
                                <g key={v}>
                                    <line className="explainer-cycle-grid" x1={PAD.left} x2={W - PAD.right} y1={py(n, v)} y2={py(n, v)} />
                                    <text className="explainer-diagram-tick" x={PAD.left - 5} y={py(n, v) + 3} textAnchor="end">{v}</text>
                                </g>
                            ))}
                            <text className="explainer-diagram-label" x={PAD.left} y={laneTop(n) - 7}>{c.name}</text>
                            <text className="explainer-diagram-tick" x={W - PAD.right} y={laneTop(n) - 7} textAnchor="end">
                                {done
                                    ? `${c.totalMi.toFixed(2)} mi in ${clock(c.seconds)} · avg ${c.avgMph.toFixed(1)} mph`
                                    : `${Math.round(c.mph[s])} mph · ${c.miles[s].toFixed(2)} of ${c.totalMi.toFixed(2)} mi`}
                            </text>
                            <line className="explainer-cycle-avg" x1={PAD.left} x2={px(c.seconds)} y1={py(n, c.avgMph)} y2={py(n, c.avgMph)} />
                            <path className="explainer-cycle-trace is-ahead" d={paths[n]} />
                            <path className="explainer-cycle-trace" d={paths[n]} clipPath={`url(#${clipId})`} />
                            {t != null && !done && <circle className="explainer-cycle-dot" cx={px(s)} cy={py(n, c.mph[s])} r="4.5" />}
                        </g>
                    );
                })}
                {t != null && t < LONGEST && (
                    <line className="explainer-cycle-playhead" x1={px(shown)} x2={px(shown)} y1={PAD.top - 4} y2={H - PAD.bottom} />
                )}
                {minutes.map(s => (
                    <text key={s} className="explainer-diagram-tick" x={px(s)} y={H - 8} textAnchor="middle">{s / 60}</text>
                ))}
                <text className="explainer-diagram-tick" x={W - PAD.right} y={H - 8} textAnchor="end">min</text>
            </svg>

            <figcaption className="explainer-lab-caption text-note">
                Target speed (mph) for every second of each cycle, from EPA’s published schedules. The shaded strip in
                each lane is 65–75 mph, the highway band EVBench’s efficiency charts mark; the dashed line is the
                cycle’s average.
            </figcaption>
        </figure>
    );
}
