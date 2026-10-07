import { useMemo, useState } from 'react';
import snapshot from './rangeSpreadSnapshot.json';
import { coversPracticalPack, socWindow, reportedRangeRun } from '../../utils/testedRange';
import { miPerKwhFrom } from '../../utils/rangeSource';
import { correctionFactor, correctionNote } from '../../utils/conditionCorrection';
import { speedBasisNote } from '../../utils/unitConversions';
import { OKABE_ITO } from '../../utils/colorUtils';

/**
 * PROTOTYPE — four ways to draw the spread of a vehicle's range tests, side by
 * side, on real tests. Nothing here is wired into the Range & Efficiency chart.
 *
 * The question came out of #313: the composite curve shades a "test spread"
 * around a charging curve, and the owner asked for the range equivalent — "I
 * don't really want the average as much as I want to be able to show the
 * spread". A range test is one figure, not a series, so the answer is a mark
 * per vehicle rather than a shaded region, and the four panels are the
 * candidates for that mark.
 *
 * ── Why a snapshot ─────────────────────────────────────────────────────────
 *
 * The playground reads no application data (playground.test.js), so this draws
 * a frozen copy of the range tests written by scripts/rangeSpreadSnapshot.mjs
 * from a LocalDev dump. The derivations are the real ones — coversPracticalPack,
 * miPerKwhFrom, correctionFactor, reportedRangeRun — so what is drawn is what
 * the site would compute, on the data as it stood on the snapshot date.
 *
 * ── Which tests count ──────────────────────────────────────────────────────
 *
 * A range figure only from a test that saw the pack (coversPracticalPack),
 * scaled to 100%. The live bar chart projects ANY window and falls back to the
 * raw distance, so a 23-mile speed-sweep segment draws as a 23-mile "range" —
 * harmless as one labelled bar, ruinous as the bottom of a spread. Efficiency
 * from measured energy only: the SoC-priced estimate would put a capacity
 * guess inside an observed spread. Each column says how many tests it left out.
 */

const METRICS = {
    range: { label: 'Range', unit: 'mi', digits: 0 },
    eff:   { label: 'Efficiency', unit: 'mi/kWh', digits: 2 },
};

const CONDITIONS = [
    { key: 'none', label: 'As tested' },
    { key: 'aero', label: 'Corrected' },
    { key: 'both', label: 'Both' },
];

/** The default set: every vehicle with two or more range figures, plus one
 *  with a single test, so n = 1 is always on screen. */
const SINGLES_SHOWN = 1;

/** One test's figure for a metric, as tested. Null when the test cannot give one. */
function figureOf(run, metric) {
    if (metric === 'range') {
        if (!coversPracticalPack(run)) return null;
        return run.distance_miles * 100 / socWindow(run);
    }
    const { miPerKwh, method } = miPerKwhFrom(run);
    return method === 'measured-energy' ? miPerKwh : null;
}

function correctionOf(run) {
    return correctionFactor({
        speedMph: run.speed_mph,
        speedBasis: run.speed_basis,
        altitudeFt: run.altitude_ft,
        temperatureF: run.temperature_f,
    }, { mode: 'aero' });
}

/** Every vehicle's tests for one metric, in one correction mode. */
function buildColumns(vehicles, metric, corrected) {
    return vehicles.map((v, i) => {
        const tests = [];
        let leftOut = 0;
        for (const run of v.runs) {
            const raw = figureOf(run, metric);
            if (raw == null || !Number.isFinite(raw)) { leftOut++; continue; }
            const c = correctionOf(run);
            tests.push({
                run,
                raw,
                value: corrected ? raw * c.factor : raw,
                note: corrected ? correctionNote(c) : null,
            });
        }
        tests.sort((a, b) => a.value - b.value);
        // Sideways offset so tied tests stay visible; the ghosts share it.
        const k = tests.length;
        tests.forEach((t, j) => { t.dx = k > 1 ? (j - (k - 1) / 2) * Math.min(7, 36 / (k - 1)) : 0; });
        const values = tests.map(t => t.value);
        const n = values.length;
        const mean = n ? values.reduce((a, b) => a + b, 0) / n : null;
        // Sample SD, as testSpread uses: two tests give |a − b| / √2.
        const sd = n >= 2 ? Math.sqrt(values.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : null;
        const reported = reportedRangeRun(v);
        return {
            vehicle: v,
            color: v.color || OKABE_ITO[i % OKABE_ITO.length],
            tests,
            leftOut,
            n,
            min: n ? values[0] : null,
            max: n ? values[n - 1] : null,
            mean,
            sd,
            reported: tests.find(t => t.run.id === reported?.id) ?? null,
        };
    });
}

/** Round numbers for the value axis, from zero. */
function ticksFor(max) {
    const raw = max / 5;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw);
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);
    return { top, ticks };
}

function fmt(x, metric) {
    return x.toFixed(METRICS[metric].digits);
}

function testTitle(t, metric) {
    const r = t.run;
    const parts = [r.name, `${fmt(t.value, metric)} ${METRICS[metric].unit}`];
    if (r.speed_mph != null) parts.push(`${r.speed_mph} mph${speedBasisNote(r) ? ` (${speedBasisNote(r)})` : ''}`);
    if (r.temperature_f != null) parts.push(`${r.temperature_f}°F`);
    if (r.altitude_ft != null) parts.push(`${r.altitude_ft} ft`);
    if (r.start_soc != null) parts.push(`${r.start_soc}→${r.end_soc}%`);
    if (t.note) parts.push(t.note);
    else if (t.value !== t.raw) parts.push(`as tested ${fmt(t.raw, metric)}`);
    return parts.join(' · ');
}

/** Year and make on one line, the rest on the next — names are long. */
function nameLines(name) {
    const words = name.split(' ');
    return [words.slice(0, 2).join(' '), words.slice(2).join(' ')];
}

const COL_W = 60;
const AXIS_W = 44;
const PLOT_H = 220;
const TOP = 14;
const FOOT = 52;

/**
 * The frame every treatment shares: axis, gridlines, names and counts. The
 * treatment draws one column's marks through `mark`.
 */
function SpreadPlot({ columns, metric, top, ticks, showRaw, mark }) {
    const width = AXIS_W + columns.length * COL_W + 8;
    const height = TOP + PLOT_H + FOOT;
    const y = v => TOP + PLOT_H - (v / top) * PLOT_H;
    return (
        <div className="pg-spread-scroll">
            <svg className="pg-spread-svg" width={width} height={height} role="img"
                aria-label={`${METRICS[metric].label} by vehicle`}>
                {ticks.map(t => (
                    <g key={t}>
                        <line className="pg-spread-gridline" x1={AXIS_W} x2={width - 4} y1={y(t)} y2={y(t)} />
                        <text className="pg-spread-tick" x={AXIS_W - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                            {metric === 'eff' ? t.toFixed(1) : t}
                        </text>
                    </g>
                ))}
                <line className="pg-spread-axis" x1={AXIS_W} x2={width - 4} y1={y(0)} y2={y(0)} />
                {columns.map((col, i) => {
                    const cx = AXIS_W + i * COL_W + COL_W / 2;
                    const [l1, l2] = nameLines(col.vehicle.name);
                    return (
                        <g key={col.vehicle.id}>
                            {showRaw && col.tests.map(t => t.value !== t.raw && (
                                <line key={`raw-${t.run.id}`} className="pg-spread-moved"
                                    x1={cx + t.dx} x2={cx + t.dx} y1={y(t.raw)} y2={y(t.value)} />
                            ))}
                            {mark(col, cx, y)}
                            {showRaw && col.tests.map(t => t.value !== t.raw && (
                                <circle key={`ghost-${t.run.id}`} className="pg-spread-ghost"
                                    cx={cx + t.dx} cy={y(t.raw)} r={3}>
                                    <title>{`${t.run.name} · as tested ${fmt(t.raw, metric)} ${METRICS[metric].unit}`}</title>
                                </circle>
                            ))}
                            <text className="pg-spread-name" x={cx} y={TOP + PLOT_H + 14} textAnchor="middle">{l1}</text>
                            <text className="pg-spread-name" x={cx} y={TOP + PLOT_H + 26} textAnchor="middle">{l2}</text>
                            <text className="pg-spread-count" x={cx} y={TOP + PLOT_H + 42} textAnchor="middle">
                                {`n=${col.n}`}{col.leftOut ? ` · ${col.leftOut} out` : ''}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

/** A dot per test, spread sideways so ties stay visible. */
function TestDots({ col, cx, y, metric, ringReported = false, hollow = false }) {
    return col.tests.map(t => {
        const dx = t.dx;
        const isReported = ringReported && col.reported?.run.id === t.run.id;
        return (
            <g key={t.run.id}>
                {isReported && <circle className="pg-spread-reported" cx={cx + dx} cy={y(t.value)} r={7} />}
                <circle className={hollow ? 'pg-spread-dot-hollow' : 'pg-spread-dot'}
                    cx={cx + dx} cy={y(t.value)} r={hollow ? 3 : 4.5}
                    style={hollow ? undefined : { fill: col.color }}>
                    <title>{testTitle(t, metric)}</title>
                </circle>
            </g>
        );
    });
}

function Whisker({ cx, y1, y2, cap = 7 }) {
    return (
        <g className="pg-spread-whisker">
            <line x1={cx} x2={cx} y1={y1} y2={y2} />
            {cap > 0 && <line x1={cx - cap} x2={cx + cap} y1={y1} y2={y1} />}
            {cap > 0 && <line x1={cx - cap} x2={cx + cap} y1={y2} y2={y2} />}
        </g>
    );
}

const BAR_W = 28;

const TREATMENTS = [
    {
        id: 'dots',
        title: 'Every test as a dot',
        blurb: 'No bar, no summary. Each test is a dot; the reported test (the one cards and the vehicle table quote) is ringed. The spread is simply where the dots fall. n = 1 is one dot and cannot be mistaken for anything else.',
        mark: (col, cx, y, metric) => <TestDots col={col} cx={cx} y={y} metric={metric} ringReported />,
    },
    {
        id: 'reported-span',
        title: 'Reported test, with every test on it',
        blurb: 'Today’s bar — one test, the reported one — with every test as a dot on a thin uncapped line from lowest to highest. Keeps the chart’s shape and the figure cards quote. No caps, so it does not read as an error bar. At n = 1 the bar stands alone; at n = 2 the line is exactly the two tests.',
        mark: (col, cx, y, metric) => (
            <>
                {col.reported && (
                    <rect className="pg-spread-bar" x={cx - BAR_W / 2} width={BAR_W}
                        y={y(col.reported.value)} height={y(0) - y(col.reported.value)}
                        style={{ fill: col.color }}>
                        <title>{`Reported: ${testTitle(col.reported, metric)}`}</title>
                    </rect>
                )}
                {col.n >= 2 && <Whisker cx={cx} y1={y(col.max)} y2={y(col.min)} cap={0} />}
                {col.n >= 2 && <TestDots col={col} cx={cx} y={y} metric={metric} hollow />}
            </>
        ),
    },
    {
        id: 'span-only',
        title: 'Span only, floating',
        blurb: 'A box from the lowest test to the highest, not anchored at zero, with a line per test and the span printed above. Nothing is a single value, so nothing reads as “the” range. n = 1 is a lone line.',
        mark: (col, cx, y, metric) => (
            <>
                {col.n >= 2 && (
                    <rect className="pg-spread-span" x={cx - BAR_W / 2} width={BAR_W}
                        y={y(col.max)} height={Math.max(1, y(col.min) - y(col.max))}
                        style={{ fill: col.color, stroke: col.color }} />
                )}
                {col.tests.map(t => (
                    <line key={t.run.id} className="pg-spread-tick-mark"
                        x1={cx - BAR_W / 2 - 3} x2={cx + BAR_W / 2 + 3} y1={y(t.value)} y2={y(t.value)}
                        style={{ stroke: col.color }}>
                        <title>{testTitle(t, metric)}</title>
                    </line>
                ))}
                {col.n >= 1 && (
                    <text className="pg-spread-value" x={cx} y={y(col.max) - 6} textAnchor="middle">
                        {col.n >= 2 ? `${fmt(col.min, metric)}–${fmt(col.max, metric)}` : fmt(col.min, metric)}
                    </text>
                )}
            </>
        ),
    },
    {
        id: 'mean-sd',
        title: 'Mean ± 1 SD — for comparison',
        blurb: 'The textbook mark, shown so its failure is visible: the bar is an average no test produced, and at n = 2 the SD is |a − b| / √2 — one difference dressed as a statistic. It also looks exactly like the error bar #314 reserves for where a repeat would land.',
        mark: (col, cx, y, metric) => col.n >= 1 && (
            <>
                <rect className="pg-spread-bar" x={cx - BAR_W / 2} width={BAR_W}
                    y={y(col.mean)} height={y(0) - y(col.mean)} style={{ fill: col.color }}>
                    <title>{`Mean of ${col.n}: ${fmt(col.mean, metric)}${col.sd != null ? ` ± ${fmt(col.sd, metric)}` : ''}`}</title>
                </rect>
                {col.sd != null && <Whisker cx={cx} y1={y(col.mean + col.sd)} y2={y(Math.max(0, col.mean - col.sd))} />}
            </>
        ),
    },
];

export default function RangeSpreadPrototype() {
    const [metric, setMetric] = useState('range');
    const [conditions, setConditions] = useState('none');

    const all = snapshot.vehicles;
    const [chosen, setChosen] = useState(() => {
        const cols = buildColumns(all, 'range', false);
        const multi = cols.filter(c => c.n >= 2).map(c => c.vehicle.id);
        const singles = cols.filter(c => c.vehicle.runs.length === 1 && c.n === 1)
            .slice(0, SINGLES_SHOWN).map(c => c.vehicle.id);
        return new Set([...multi, ...singles]);
    });
    const toggle = id => setChosen(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const corrected = conditions !== 'none';
    const showRaw = conditions === 'both';
    const columns = useMemo(
        () => buildColumns(all.filter(v => chosen.has(v.id)), metric, corrected)
            // A vehicle with no figure for this metric has nothing to draw.
            .filter(c => c.n > 0),
        [all, chosen, metric, corrected],
    );
    const { top, ticks } = useMemo(() => {
        const vals = columns.flatMap(c => [
            ...c.tests.map(t => t.value), ...(showRaw ? c.tests.map(t => t.raw) : []),
            c.mean != null && c.sd != null ? c.mean + c.sd : 0,
        ]);
        return ticksFor(Math.max(1, ...vals) * 1.08);
    }, [columns, showRaw]);

    return (
        <div className="pg-spread">
            <p className="text-note pg-blurb">
                Prototype for the range half of the spread question (#313, #314). Real range tests,
                frozen from <code>{snapshot.source}</code>; hover a mark for the test and its
                conditions. Every panel shares one zero-based scale. Corrected means the chart’s aero
                correction to standard conditions; “Both” draws each test as tested as a hollow
                ring, joined to where correction moved it.
            </p>
            <div className="pg-spread-controls">
                <div className="pg-spread-control-group">
                    {Object.entries(METRICS).map(([k, m]) => (
                        <button key={k} type="button" className={`btn btn-toggle ${metric === k ? 'active' : ''}`}
                            onClick={() => setMetric(k)}>{m.label}</button>
                    ))}
                </div>
                <div className="pg-spread-control-group">
                    {CONDITIONS.map(c => (
                        <button key={c.key} type="button" className={`btn btn-toggle ${conditions === c.key ? 'active' : ''}`}
                            onClick={() => setConditions(c.key)}>{c.label}</button>
                    ))}
                </div>
            </div>
            <div className="pg-spread-control-group">
                {all.map(v => (
                    <button key={v.id} type="button" className={`guide-chip ${chosen.has(v.id) ? 'active' : ''}`}
                        onClick={() => toggle(v.id)}>
                        {v.name} <span className="pg-spread-test-count">{v.runs.length}</span>
                    </button>
                ))}
            </div>
            <div className="pg-spread-grid">
                {TREATMENTS.map(t => (
                    <section key={t.id} className="plot-frame">
                        <div className="plot-frame-head">
                            <div>
                                <h4 className="plot-frame-title">{t.title}</h4>
                                <p className="plot-frame-subtitle">
                                    {METRICS[metric].label} ({METRICS[metric].unit}) · {CONDITIONS.find(c => c.key === conditions).label.toLowerCase()}
                                </p>
                            </div>
                        </div>
                        <p className="text-note">{t.blurb}</p>
                        <SpreadPlot columns={columns} metric={metric} top={top} ticks={ticks} showRaw={showRaw}
                            mark={(col, cx, y) => t.mark(col, cx, y, metric)} />
                    </section>
                ))}
            </div>
        </div>
    );
}
