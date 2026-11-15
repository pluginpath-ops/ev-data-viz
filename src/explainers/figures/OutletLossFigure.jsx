import ledger from '../facts.json';

/**
 * Measured charging losses against EVBench's rule, one panel per study:
 * ADAC 2026, ADAC 2022, DTU 2016, Argonne 2020 (points from its loss fits),
 * Sears et al. (Vermont, 2013), INL's
 * charger-only steady-state sheets (two panels, by where the output was
 * measured) and the owner's R1T. The axis is minutes to
 * draw each kWh from the wall, where a fixed draw is a straight line,
 * loss = P₀·t + k. Each line is the rule alone, started from one car's (or
 * Sears group's) fastest result, so its slower results either sit on the line
 * or they don't. One color per car within a panel, so cars
 * with the same reading (the CLA and the Zoe both lost 24.2% on a socket) no
 * longer cover each other.
 *
 * The rule's P₀ comes from the ledger (evbench-charging-loss-by-rate), so the
 * page, the figure and the site's constant say the same number. Sears gives no
 * charging power: its Level 2 results sit at the Volts' and Leafs' 3.3 kW
 * (sears-cars-level2-3-3-kw), its Level 1 results at the Volt's measured full
 * power on 120 V (INL). The caption says so.
 */
const fact = (id) => ledger.facts.find(f => f.id === id).value;
const ADAC26 = fact('ac-socket-vs-wallbox-adac-2026');
const ADAC22 = fact('ac-socket-vs-wallbox-adac-2022');
const SEARS = fact('ac-level1-vs-level2-sears-2014');
const SEARS_L2_KW = fact('sears-cars-level2-3-3-kw').level2_kw;
const INL = fact('volt-onboard-charger-inl-2012');
const R1T = fact('r1t-charging-systems-draw-roamer');
const DTU = fact('dtu-2016-car-reported-efficiency').method2_eff;
const INL_VOLT = fact('inl-steady-state-volt-2012');
const INL_LEAF12 = fact('inl-steady-state-leaf-2012');
const INL_I3 = fact('inl-steady-state-i3-2014');
const INL_LEAF15 = fact('inl-steady-state-leaf-2015');
const INL_BCLASS = fact('inl-steady-state-b-class-2015');
const ANL = fact('anl-charging-loss-fits-2020').fits;
const RULE = fact('evbench-charging-loss-by-rate');
const P0_KW = RULE.p0_w / 1000;

const WALLBOX_KW = 11;
const SOCKET_KW = 2.3;
const US_OUTLET_KW = 1.44;
const mid = ([lo, hi]) => (lo + hi) / 2;
const SEARS_L1_KW = mid(INL.full_power_kw.level1);
const lossPct = (eff) => 100 * (1 - eff);
const kwText = (kw) => `${Number(kw.toFixed(2))} kW`;

/** % lost at `kw` from one of Argonne's fits, loss (W) = b0 + b1·P + b2·P². */
const fitPct = ({ b0, b1, b2 }, kw) => { const w = kw * 1000; return (100 * (b0 + b1 * w + b2 * w * w)) / w; };
const fitPoint = (fit, kw, shape, volts) => ({ kw, pct: fitPct(fit, kw), shape, what: `${volts}, ${kwText(kw)}, from the fit` });

const minPerKwh = (kw) => 60 / kw;
/** The rule's loss at `kw`, % into the battery, for a car that lost `pct` at `kwRef`. */
const ruleAt = ({ kw: kwRef, pct }, kw) => pct + 100 * P0_KW * (1 / kw - 1 / kwRef);

const socket = (pct) => ({ kw: SOCKET_KW, pct, shape: 'circle', what: 'socket' });
const wallbox = (kw, pct) => ({ kw, pct, shape: 'square', what: `${kw} kW` });

/**
 * Each panel: its series (a car, or a Sears group) with every result, and the
 * power marks it needs. The rule's only input from a series is its fastest
 * result (`ref`), as on the site, where it is the car's EPA figure at its
 * fastest home charging; every other point is something the rule predicts.
 */
const withRef = (series) => series.map(s => ({ ...s, ref: s.points.reduce((a, b) => (b.kw > a.kw ? b : a)) }));
/** INL's sheets give each voltage's slowest and fastest steady-state reading. */
const inlSeries = (cars) => withRef(cars.map(([car, l1, l2, l2v]) => ({
    name: `${car}, 120 V and ${l2v}`,
    points: [
        ...[l1.min, l1.max].map(m => ({ kw: m.kw, pct: lossPct(m.eff), shape: 'circle', what: `120 V, ${kwText(m.kw)}` })),
        ...[l2.min, l2.max].map(m => ({ kw: m.kw, pct: lossPct(m.eff), shape: 'square', what: `${l2v}, ${kwText(m.kw)}` })),
    ],
})));
const PANELS = [
    {
        key: 'adac26', title: 'ADAC 2026, five cars',
        marks: [WALLBOX_KW, ADAC26.low_kw, SOCKET_KW, US_OUTLET_KW],
        series: withRef(ADAC26.cars.map(c => ({
            name: c.car,
            points: [socket(c.socket), wallbox(ADAC26.low_kw, c.low), wallbox(WALLBOX_KW, c.wallbox_11),
                ...(c.wallbox_22 != null ? [wallbox(22, c.wallbox_22)] : [])],
        }))),
    },
    {
        key: 'adac22', title: 'ADAC 2022, four cars',
        marks: [WALLBOX_KW, 5.5, 3.5, SOCKET_KW, US_OUTLET_KW],
        series: withRef(ADAC22.cars.map(c => ({
            name: c.car,
            points: [socket(c.socket), ...(c.reduced ? [wallbox(c.reduced.kw, c.reduced.loss)] : []), wallbox(WALLBOX_KW, c.wallbox_11)],
        }))),
    },
    {
        // The car's own reading of what reached the battery against a wall meter,
        // ADAC's basis; DTU calls it its least precise method.
        key: 'dtu', title: 'DTU 2016, two cars on 230 V, as each car reports what reached its battery',
        yMax: 33,
        marks: [3.7, SOCKET_KW, US_OUTLET_KW],
        series: withRef([['Nissan Leaf', DTU.leaf], ['Peugeot iOn', DTU.ion]].map(([name, e]) => ({
            name,
            points: [{ kw: SOCKET_KW, pct: lossPct(e['2.3_kw_1ph']), shape: 'circle', what: '10 A, 2.3 kW' },
                { kw: 3.7, pct: lossPct(e['3.7_kw_1ph']), shape: 'square', what: '16 A, 3.7 kW' }],
        }))),
    },
    {
        // Points come from Argonne's loss fits, inside each tested range, plug to
        // battery terminals with the car's own draw counted: ADAC's basis.
        key: 'anl', title: 'Argonne 2020, three cars, from its fitted losses (2017 Bolt on 120 V and 240 V, i3 and Leaf on 208 V)',
        yMax: 27, xMax: 75,
        marks: [7.2, 3, US_OUTLET_KW, 1],
        series: withRef([
            { name: '2017 Chevrolet Bolt, 120 V and 240 V', points: [
                ...[1, US_OUTLET_KW].map(kw => fitPoint(ANL.bolt_2017['120V'], kw, 'circle', '120 V')),
                ...[1.5, 3, 7.2].map(kw => fitPoint(ANL.bolt_2017['240V'], kw, 'square', '240 V'))] },
            { name: '2014 BMW i3, 208 V', points: [1.2, 3, 6].map(kw => fitPoint(ANL.i3_rex_2014['208V'], kw, 'square', '208 V')) },
            { name: '2012 Nissan Leaf, 208 V', points: [1.25, 3.77].map(kw => fitPoint(ANL.leaf_2012['208V'], kw, 'square', '208 V')) },
        ]),
    },
    {
        key: 'sears', title: 'Sears et al., Vermont 2013, two Volts and two Leafs',
        marks: [SEARS_L2_KW, US_OUTLET_KW, SEARS_L1_KW],
        series: withRef([
            ['All charges', SEARS.level1_eff, SEARS.level2_eff],
            ['8 kWh and up (read from its chart)', SEARS.from_8kwh_read_by_eye.level1_eff, SEARS.from_8kwh_read_by_eye.level2_eff],
            ['Under 4 kWh', SEARS.under_4kwh.level1_eff, SEARS.under_4kwh.level2_eff],
        ].map(([name, l1, l2]) => ({
            name,
            points: [{ kw: SEARS_L1_KW, pct: lossPct(l1), shape: 'circle', what: 'Level 1' },
                { kw: SEARS_L2_KW, pct: lossPct(l2), shape: 'square', what: 'Level 2' }],
        }))),
    },
    {
        // The charger alone at constant current: no fixed draw from the rest of the
        // car, which the rule adds, so its lines should run above these points.
        key: 'inl-charger', title: 'INL steady state, onboard charger only (no fixed draw), measured at the charger’s output: 2012 Volt and 2012 Leaf',
        yMax: 21, xMax: 100,
        marks: [3.71, US_OUTLET_KW, 0.65],
        series: inlSeries([
            ['2012 Chevrolet Volt', INL_VOLT.level1_120v, INL_VOLT.level2_208v, '208 V'],
            ['2012 Nissan Leaf', INL_LEAF12.level1_120v, INL_LEAF12.level2_208v, '208 V'],
        ]),
    },
    {
        // As above, but the output includes the car's 12 V supply, so what the car
        // runs on while charging still counts as output, not loss.
        key: 'inl-hv12', title: 'INL steady state, onboard charger only (no fixed draw), measured at the high-voltage and 12 V outputs: 2014 i3, 2015 Leaf, 2015 B-Class',
        yMax: 39, xMax: 100,
        marks: [7.22, US_OUTLET_KW, 0.69],
        series: inlSeries([
            ['2014 BMW i3', INL_I3.level1_120v, INL_I3.level2_240v, '240 V'],
            ['2015 Nissan Leaf', INL_LEAF15.level1_120v, INL_LEAF15.level2_208v, '208 V'],
            ['2015 Mercedes B-Class', INL_BCLASS.level1_120v, INL_BCLASS.level2_240v, '240 V'],
        ]),
    },
    {
        // A placeholder until the owner's truck has wall-metered charges: Rivian's
        // breakdown is after the onboard charger, so the charger's own loss is not
        // in these points, and battery warming is left out to match the rule.
        key: 'r1t', title: 'Owner’s 2022 R1T, example charges (placeholder: after the charger, battery warming left out)',
        yMax: 15,
        marks: [11.1, 7.4, US_OUTLET_KW],
        series: withRef([{
            name: 'Owner’s R1T, systems’ share of each charge',
            points: R1T.example_charges.map(c => ({
                kw: c.avg_kw, pct: 100 * c.systems_kwh / c.energy_kwh, shape: 'square',
                what: `${c.date}, ${c.avg_kw} kW, ${c.energy_kwh} kWh, warming ${c.thermal_kwh} kWh left out`,
            })),
        }]),
    },
];

const W = 720;
const H = 250;
const PAD = { left: 60, right: 24, top: 30, bottom: 26 };
const X_MAX = 50;
const Y_MAX = 30;
const pxAt = (min, xMax) => PAD.left + (Math.min(min, xMax) / xMax) * (W - PAD.left - PAD.right);
const py = (pct, yMax = Y_MAX) => PAD.top + (1 - Math.min(pct, yMax) / yMax) * (H - PAD.top - PAD.bottom);
/** The rule's line from `fromKw` down to `toKw`, stopped where it leaves the top of the panel. */
const ruleSeg = (ref, fromKw, toKw, xMax, yMax) => {
    const edgeKw = 1 / ((yMax - ref.pct) / (100 * P0_KW) + 1 / ref.kw);
    const endKw = ruleAt(ref, toKw) > yMax ? edgeKw : toKw;
    return {
        x1: pxAt(minPerKwh(fromKw), xMax), y1: py(ruleAt(ref, fromKw), yMax),
        x2: pxAt(minPerKwh(endKw), xMax), y2: py(ruleAt(ref, endKw), yMax),
    };
};

/** Lines closer than this, in points of loss, would hide one another. */
const SAME_LINE_PCT = 0.25;

const xTicks = (xMax) => [0, 1, 2, 3, 4, 5].map(i => (i * xMax) / 5);
const yTicks = (yMax) => [0, 1, 2, 3].map(i => (i * yMax) / 3);
const pct = (v) => `${v.toFixed(1)}%`;

function Marker({ shape, x, y, className, r = 4 }) {
    if (shape === 'square') return <rect className={className} x={x - r + 0.5} y={y - r + 0.5} width={2 * r - 1} height={2 * r - 1} />;
    return <circle className={className} cx={x} cy={y} r={r} />;
}

function Swatch({ i, shape = 'circle' }) {
    return (
        <svg viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true">
            <Marker shape={shape} x={0} y={0} className={`explainer-loss-point is-s${i}`} />
        </svg>
    );
}

/** One study: its results and the rule's line for each series. */
function Panel({ panel, last }) {
    const describe = panel.series.map(s => `${s.name}: ${s.points.map(p => `${pct(p.pct)} at ${kwText(p.kw)}`).join(', ')}`).join('; ');
    const yMax = panel.yMax ?? Y_MAX;
    const xMax = panel.xMax ?? X_MAX;
    const y = (v) => py(v, yMax);
    const px = (min) => pxAt(min, xMax);
    return (
        <div className="explainer-loss-panel">
            <span className="text-micro">{panel.title}</span>
            <svg className="explainer-diagram explainer-cycle-svg" viewBox={`0 0 ${W} ${H + (last ? 18 : 0)}`} role="img"
                aria-label={`${panel.title}. Charging loss against minutes per kWh: ${describe}. EVBench's rule, a ${RULE.p0_w} W fixed draw through each fastest result, reaches ${panel.series.map(s => `${pct(ruleAt(s.ref, US_OUTLET_KW))} (${s.name})`).join(', ')} at 1.44 kW.`}>
                {yTicks(yMax).map(v => (
                    <g key={v}>
                        <line className="explainer-cycle-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
                        <text className="explainer-diagram-tick" x={PAD.left - 6} y={y(v) + 4} textAnchor="end">{v}%</text>
                    </g>
                ))}
                {xTicks(xMax).map(v => (
                    <text key={v} className="explainer-diagram-tick" x={px(v)} y={H - PAD.bottom + 16} textAnchor="middle">{v}</text>
                ))}
                {last && (
                    <text className="explainer-diagram-label" x={(PAD.left + W - PAD.right) / 2} y={H + 12} textAnchor="middle">
                        Minutes to draw 1 kWh from the wall
                    </text>
                )}
                <text className="explainer-diagram-label" x={16} y={(PAD.top + H - PAD.bottom) / 2} textAnchor="middle"
                    transform={`rotate(-90 16 ${(PAD.top + H - PAD.bottom) / 2})`}>
                    % lost
                </text>

                {panel.marks.map((kw, i) => (
                    // Labels alternate between two heights, so close marks (1.3 and 1.44 kW) do not collide.
                    <g key={kw}>
                        <line className="explainer-loss-kw" x1={px(minPerKwh(kw))} x2={px(minPerKwh(kw))} y1={PAD.top} y2={H - PAD.bottom} />
                        <text className="explainer-diagram-tick explainer-loss-kw-label" x={px(minPerKwh(kw))}
                            y={PAD.top - (i % 2 ? 16 : 5)} textAnchor="middle">{kwText(kw)}</text>
                    </g>
                ))}

                {panel.series.map((s, i) => {
                    const slowest = Math.min(...s.points.map(p => p.kw));
                    // Cars with the same fastest result share a line (the CLA and ID.7 both
                    // 6.9% at 11 kW): draw the earlier ones wider, underneath, so each shows.
                    const cased = Math.min(2, panel.series.slice(i + 1)
                        .filter(o => o.ref.kw === s.ref.kw && Math.abs(o.ref.pct - s.ref.pct) < SAME_LINE_PCT).length);
                    return (
                        <g key={s.name} className={`explainer-loss-line is-thin is-s${i}${cased ? ` is-cased-${cased}` : ''}`}>
                            <title>{`EVBench's rule for ${s.name}: ${pct(s.ref.pct)} at ${kwText(s.ref.kw)}, ${pct(ruleAt(s.ref, US_OUTLET_KW))} at 1.44 kW`}</title>
                            <line {...ruleSeg(s.ref, s.ref.kw, Math.min(slowest, US_OUTLET_KW), xMax, yMax)} />
                        </g>
                    );
                })}

                {panel.series.flatMap((s, i) => s.points.map(p => (
                    <g key={`${s.name}-${p.what}`}>
                        <title>{`${s.name}, ${p.what}: ${pct(p.pct)} measured${p.kw < s.ref.kw ? `, rule ${pct(ruleAt(s.ref, p.kw))}` : ''}`}</title>
                        <Marker shape={p.shape} x={px(minPerKwh(p.kw))} y={y(p.pct)} className={`explainer-loss-point is-s${i}`} />
                    </g>
                )))}
            </svg>
            <div className="explainer-loss-legend text-note">
                {panel.series.map((s, i) => (
                    <span key={s.name} className="explainer-loss-key"><Swatch i={i} />{s.name}</span>
                ))}
            </div>
        </div>
    );
}

export default function OutletLossFigure() {
    return (
        <figure className="explainer-lab">
            <div className="explainer-lab-head">
                <span className="text-micro">Measurements against EVBench’s rule</span>
                <span className="explainer-model-badge">points are measurements · lines are the rule</span>
            </div>

            {PANELS.map((p, i) => <Panel key={p.key} panel={p} last={i === PANELS.length - 1} />)}

            <div className="explainer-loss-legend text-note">
                <span className="explainer-loss-key"><Swatch i={0} shape="circle" />slow: socket, 10 A, or Level 1 (120 V)</span>
                <span className="explainer-loss-key"><Swatch i={0} shape="square" />wallbox, 16 A, or Level 2 (208–240 V)</span>
            </div>

            <figcaption className="explainer-lab-caption text-note">
                <span>
                    Each line is EVBench’s rule, given only one car’s (or group’s) fastest result, as it is given a
                    car’s EPA figure at its fastest home charging; below that it adds a {RULE.p0_w} W fixed draw, the
                    same for every car. Every slower point is a prediction the rule did not see. Where the slower results sit on the line, the rule predicts them;
                    above it, the car draws more than {RULE.p0_w} W, below it less. Cars with the same fastest
                    result share a line, drawn one inside another. ADAC’s socket is single-phase 230 V
                    and its wallbox charges three-phase. Sears gives no charging power, so its Level 2 results sit at
                    the Volts’ and Leafs’ {kwText(SEARS_L2_KW)} and its Level 1 results at the Volt’s measured
                    {' '}{kwText(SEARS_L1_KW)}. DTU’s points are each car’s own reading of what reached its battery
                    against a meter at the wall, ADAC’s way of measuring; DTU calls them its least precise figures.
                    Argonne’s points are read off its fitted losses, plug to battery with the car’s own draw counted,
                    at powers inside the range it tested; the Bolt’s 120 V fit is the loosest of them.
                    INL’s points are its steady-state readings of the onboard charger alone, each voltage’s slowest
                    and fastest, without the rest of the car’s draw while charging; on the i3, 2015 Leaf and B-Class
                    the output includes the car’s 12 V supply. The rule includes that draw, so its lines should run
                    above those points, and they leave the panel before 120 V’s slowest settings; those panels run to
                    100 minutes, and the second to 39%. The R1T’s points are a placeholder: five of its charges, as Rivian
                    reports them, with what its own systems used as the loss. That is measured after the onboard
                    charger, so the charger’s loss is missing, and it is to 0.1 kWh, so each point is rough; its scale
                    runs to 15%, not 30%. Every source counts energy into the battery, not back out as EPA does.
                </span>
            </figcaption>
        </figure>
    );
}
