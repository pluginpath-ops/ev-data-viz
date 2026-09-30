import { useId, useMemo } from 'react';
import cycleData from '../data/driveCycles.json';
import { usePlayback } from './usePlayback';

/**
 * The three routes an EV's range test takes in EPA's certification records,
 * run on one clock: the Multi-Cycle Test (procedure 77), the city cycle
 * repeated to empty (81), and the highway cycle repeated to empty (84). The
 * point is the clock: the multi-cycle test empties the car in about a third of
 * the time the city cycle alone would take, because most of its miles are one
 * long steady stretch.
 *
 * UDDS and HWFET are EPA's second-by-second schedules (data/driveCycles.json).
 * The distances are one typical car from EVBench's copy of EPA's records
 * (ROUTE_FACTS): the median steady stretches of 273 multi-cycle tests, and how
 * far that same car would go on each cycle alone, from its own measured city and
 * highway consumption. Lanes 2 and 3 are that what-if, not a record of anyone
 * driving it: the single-cycle records don't read like separate runs to empty
 * (evbench-single-cycle-records). The steady stretches are drawn flat at
 * 65 mph, with no ramps, and the short pauses between cycles are left out.
 */
export const STEADY_MPH = 65;
export const MCT_STEADY_MI = { mid: 237.5, end: 30.0 };
export const CITY_TO_EMPTY_MI = 442.5;
export const HWY_TO_EMPTY_MI = 385.0;

/** The ledger facts behind the distances and the steady speed, shown on screen. */
export const ROUTE_FACTS = ['evbench-mct-phase-lengths', 'evbench-same-car-to-empty', 'j1634-css-65mph'];

const schedule = Object.fromEntries(cycleData.cycles.map(c => [c.id, c.mph]));
const CYCLE = {
    udds:  { mph: schedule.udds,  short: 'U', name: 'City (UDDS)' },
    hwfet: { mph: schedule.hwfet, short: 'H', name: 'Highway (HWFET)' },
};

/** A whole cycle, or a steady stretch of `miles` at 65 mph, as per-second speeds. */
const cycleSegment = (kind, name) => ({ kind, name, mph: CYCLE[kind].mph.slice(1) });
const steadySegment = (miles, name) => ({ kind: 'steady', name,
    mph: new Array(Math.round((miles / STEADY_MPH) * 3600)).fill(STEADY_MPH) });

/** One cycle repeated until `miles`, the last lap cut where the distance runs out. */
function repeatToEmpty(kind, miles) {
    const out = [];
    let mi = 0;
    for (let lap = 1; mi < miles; lap++) {
        const seg = cycleSegment(kind, `${CYCLE[kind].name}, lap ${lap}`);
        const mph = [];
        for (const v of seg.mph) {
            if (mi >= miles) break;
            mph.push(v);
            mi += v / 3600;
        }
        out.push({ ...seg, mph });
    }
    return out;
}

/** Flatten segments into per-second speed, distance so far, and each second's segment. */
function build(route) {
    const mph = [0];
    const miles = [0];
    const segAt = [0];
    const spans = [];
    route.segments.forEach((seg, n) => {
        const start = mph.length - 1;
        for (const v of seg.mph) {
            miles.push(miles[miles.length - 1] + (mph[mph.length - 1] + v) / 2 / 3600);
            mph.push(v);
            segAt.push(n);
        }
        spans.push({ ...seg, start, end: mph.length - 1 });
    });
    return { ...route, mph, miles, segAt, spans, seconds: mph.length - 1, totalMi: miles[miles.length - 1] };
}

const ROUTES = [
    { id: 'mct', label: '1. Multi-Cycle Test', note: 'procedure 77', segments: [
        cycleSegment('udds', 'UDDS (warm-up)'), cycleSegment('hwfet', 'HWFET'), cycleSegment('udds', 'UDDS'),
        steadySegment(MCT_STEADY_MI.mid, `Steady ${STEADY_MPH} mph`),
        cycleSegment('udds', 'UDDS'), cycleSegment('hwfet', 'HWFET'), cycleSegment('udds', 'UDDS'),
        steadySegment(MCT_STEADY_MI.end, `Steady ${STEADY_MPH} mph, to empty`),
    ] },
    { id: 'city', label: '2. City to empty', note: 'the same car, if it did', segments: repeatToEmpty('udds', CITY_TO_EMPTY_MI) },
    { id: 'hwy', label: '3. Highway to empty', note: 'the same car, if it did', segments: repeatToEmpty('hwfet', HWY_TO_EMPTY_MI) },
].map(build);

const LONGEST = Math.max(...ROUTES.map(r => r.seconds));
const W = 720;
const LANE_H = 64;
const STRIP_H = 14;
const LANE_GAP = 34;
const PAD = { left: 34, right: 12, top: 22, bottom: 26 };
const MAX_MPH = 80;
const RATES = [1000, 3000, 6000];
const DEFAULT_RATE = 3000;

const laneHeight = (r) => LANE_H + (r.id === 'mct' ? STRIP_H + 4 : 0);
const laneTops = ROUTES.reduce((tops, r, n) => [...tops, n ? tops[n - 1] + laneHeight(ROUTES[n - 1]) + LANE_GAP : PAD.top], []);
const H = laneTops[ROUTES.length - 1] + laneHeight(ROUTES[ROUTES.length - 1]) + PAD.bottom;
const px = (s) => PAD.left + (s / LONGEST) * (W - PAD.left - PAD.right);
const py = (n, mph) => laneTops[n] + LANE_H - (mph / MAX_MPH) * LANE_H;
const hours = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

/**
 * A route's speed as a filled envelope, one column per pixel: at this scale a
 * city cycle is 12 px wide, so its stops read as texture and the steady
 * stretches as solid blocks, which is the comparison the lab is for.
 */
function envelope(r, n) {
    const cols = W - PAD.left - PAD.right;
    const pts = [];
    for (let c = 0; c <= cols; c++) {
        const from = Math.floor((c / cols) * LONGEST);
        const to = Math.min(Math.floor(((c + 1) / cols) * LONGEST), r.seconds);
        if (from > r.seconds) break;
        let top = 0;
        for (let s = from; s <= to; s++) top = Math.max(top, r.mph[s]);
        pts.push(`${(PAD.left + c).toFixed(1)},${py(n, top).toFixed(1)}`);
    }
    const base = py(n, 0).toFixed(1);
    return `M${PAD.left},${base} L${pts.join(' L')} L${px(r.seconds).toFixed(1)},${base} Z`;
}

export default function TestRoutesLab() {
    const { ref, t, playing, rate, setRate, toggle, label } = usePlayback(LONGEST, DEFAULT_RATE);
    const clipId = `routes-played-${useId().replace(/:/g, '')}`;
    const shapes = useMemo(() => ROUTES.map(envelope), []);
    const shown = t ?? LONGEST;
    const hourTicks = Array.from({ length: Math.floor(LONGEST / 7200) + 1 }, (_, n) => n * 7200);

    return (
        <figure className="explainer-lab" ref={ref}>
            <div className="explainer-lab-head">
                <span className="text-micro">Test Routes Lab</span>
                <span className="explainer-model-badge">EPA schedules · typical distances</span>
            </div>

            <div className="explainer-cycle-controls">
                <button type="button" className="explainer-chip" aria-pressed={playing} onClick={toggle}>{label}</button>
                <span className="explainer-lab-presets" role="group" aria-label="Playback speed">
                    {RATES.map(r => (
                        <button key={r} type="button" className="explainer-chip" aria-pressed={rate === r}
                            onClick={() => setRate(r)}>{r.toLocaleString()}×</button>
                    ))}
                </span>
                <span className="explainer-cycle-clock text-data">{t == null ? 'Test time' : `${hours(shown)} h`}</span>
            </div>

            <svg className="explainer-diagram explainer-cycle-svg" viewBox={`0 0 ${W} ${H}`} role="img"
                aria-label={ROUTES.map(r => `${r.label}: ${r.totalMi.toFixed(0)} miles in ${hours(r.seconds)} hours`).join('; ')}>
                <defs>
                    <clipPath id={clipId}><rect x="0" y="0" width={px(shown)} height={H} /></clipPath>
                </defs>
                {ROUTES.map((r, n) => {
                    const s = Math.min(Math.floor(shown), r.seconds);
                    const done = shown >= r.seconds;
                    const seg = r.spans[r.segAt[s]];
                    return (
                        <g key={r.id}>
                            {[0, 40, 80].map(v => (
                                <g key={v}>
                                    <line className="explainer-cycle-grid" x1={PAD.left} x2={W - PAD.right} y1={py(n, v)} y2={py(n, v)} />
                                    <text className="explainer-diagram-tick" x={PAD.left - 5} y={py(n, v) + 3} textAnchor="end">{v}</text>
                                </g>
                            ))}
                            <text className="explainer-diagram-label" x={PAD.left} y={laneTops[n] - 8}>
                                {r.label} <tspan className="explainer-diagram-tick">({r.note})</tspan>
                            </text>
                            <text className="explainer-diagram-tick" x={W - PAD.right} y={laneTops[n] - 8} textAnchor="end">
                                {done
                                    ? `${r.totalMi.toFixed(0)} mi in ${hours(r.seconds)} h`
                                    : `${seg.name} · ${r.miles[s].toFixed(0)} of ${r.totalMi.toFixed(0)} mi`}
                            </text>
                            <path className="explainer-route-area is-ahead" d={shapes[n]} />
                            <path className="explainer-route-area" d={shapes[n]} clipPath={`url(#${clipId})`} />
                            {r.id === 'mct' && r.spans.map((sp, k) => {
                                const x = px(sp.start);
                                const w = px(sp.end) - x;
                                return (
                                    <g key={k}>
                                        <rect className={`explainer-route-seg is-${sp.kind}`} x={x} y={laneTops[n] + LANE_H + 4}
                                            width={Math.max(w - 1, 1)} height={STRIP_H}><title>{sp.name}</title></rect>
                                        {w >= 9 && (
                                            <text className="explainer-diagram-seg-label" x={x + w / 2} y={laneTops[n] + LANE_H + 4 + STRIP_H - 4}
                                                textAnchor="middle">{sp.kind === 'steady' ? (w > 90 ? sp.name : 'S') : CYCLE[sp.kind].short}</text>
                                        )}
                                    </g>
                                );
                            })}
                            {t != null && !done && <circle className="explainer-cycle-dot" cx={px(s)} cy={py(n, r.mph[s])} r="4.5" />}
                        </g>
                    );
                })}
                {t != null && t < LONGEST && (
                    <line className="explainer-cycle-playhead" x1={px(shown)} x2={px(shown)} y1={PAD.top - 4} y2={H - PAD.bottom} />
                )}
                {hourTicks.map(s => (
                    <text key={s} className="explainer-diagram-tick" x={px(s)} y={H - 8} textAnchor="middle">{s / 3600}</text>
                ))}
                <text className="explainer-diagram-tick" x={W - PAD.right} y={H - 8} textAnchor="end">hours</text>
            </svg>

            <figcaption className="explainer-lab-caption text-note">
                One typical car from EPA’s records, on one clock: speed (mph) against test time, back to back
                without the short pauses between cycles. U is the city cycle and H the highway cycle, from EPA’s
                published schedules. Lane 1 uses the median steady stretches of 273 real multi-cycle tests; lanes 2
                and 3 are how long that same car would take on each cycle alone, from its own measured consumption.
                <span className="explainer-lab-caveat">The steady stretches are drawn at 65 mph, the speed SAE J1634 is
                    understood to set; that is still waiting on a primary source.</span>
            </figcaption>
        </figure>
    );
}
