import ledger from '../facts.json';

/**
 * Measured charging losses against the time it takes to draw each kWh from
 * the wall. On that axis the fixed-draw model, loss = P₀/P + k, is a straight
 * line, loss = P₀·t + k: the slope is the car's fixed draw, the intercept its
 * charger's share. Each source gets a line through its slow and fast results;
 * ADAC's runs through its medians and, dashed, past its data to a US outlet.
 *
 * Sears et al. give no charging power: their Level 2 results sit at the
 * Volts' and Leafs' 3.3 kW (sears-cars-level2-3-3-kw), their Level 1 results
 * at the Volt's measured full power on 120 V (INL). The caption says so. Tessie gives no power at all and stays in the page's table.
 * Data comes from the facts ledger, so the page and the figure cannot drift.
 */
const fact = (id) => ledger.facts.find(f => f.id === id).value;
const ADAC = fact('ac-socket-vs-wallbox-adac-2026');
const SEARS = fact('ac-level1-vs-level2-sears-2014');
const INL = fact('volt-onboard-charger-inl-2012');
const RATIO = fact('evbench-wall-outlet-charger-eff').ratio;
const SEARS_L2_KW = fact('sears-cars-level2-3-3-kw').level2_kw;

const US_OUTLET_KW = 1.44;
const SLOWEST_KW = 1.2;
const mid = ([lo, hi]) => (lo + hi) / 2;
const VOLT_L1_KW = mid(INL.full_power_kw.level1);
const VOLT_L2_KW = mid(INL.full_power_kw.level2);

const minPerKwh = (kw) => 60 / kw;
const lossPct = (eff) => 100 * (1 - eff);

/** A line through two (kW, loss %) results, in minutes per kWh. */
const lineThrough = ([kwA, pctA], [kwB, pctB]) => {
    const slope = (pctA - pctB) / (minPerKwh(kwA) - minPerKwh(kwB));
    return { slope, intercept: pctB - slope * minPerKwh(kwB) };
};
const at = (line, kw) => line.slope * minPerKwh(kw) + line.intercept;

const ADAC_LINE = lineThrough([ADAC.socket_kw, ADAC.median.socket], [ADAC.wallbox_kw, ADAC.median.wallbox_11]);
// EVBench's assumption on ADAC's basis: the 11 kW median efficiency × the ratio.
const EVBENCH_PCT = 100 * (1 - (1 - ADAC.median.wallbox_11 / 100) * RATIO);

const SEARS_ALL = [[VOLT_L1_KW, lossPct(SEARS.level1_eff)], [SEARS_L2_KW, lossPct(SEARS.level2_eff)]];
const SEARS_FULL = [[VOLT_L1_KW, lossPct(SEARS.from_8kwh_read_by_eye.level1_eff)], [SEARS_L2_KW, lossPct(SEARS.from_8kwh_read_by_eye.level2_eff)]];
const SEARS_SHORT = [[VOLT_L1_KW, lossPct(SEARS.under_4kwh.level1_eff)], [SEARS_L2_KW, lossPct(SEARS.under_4kwh.level2_eff)]];
const INL_PAIR = [[INL.obcm_120v_kw, lossPct(INL.overall_l1)], [VOLT_L2_KW, lossPct(INL.overall_l2)]];

/** Lines: each source through its slow and fast results. */
const LINES = [
    { src: 'sears', pair: SEARS_ALL, label: 'Sears, all charges' },
    { src: 'sears', pair: SEARS_FULL, label: 'Sears, 8 kWh and up', thin: true },
    { src: 'sears', pair: SEARS_SHORT, label: 'Sears, under 4 kWh', thin: true },
    { src: 'inl', pair: INL_PAIR, label: 'INL Volt' },
];

/** Points: source, shape, power, loss %. */
const POINTS = [
    ...ADAC.cars.flatMap(c => [
        { src: 'adac', shape: 'circle', kw: ADAC.socket_kw, pct: c.socket, label: `${c.car}, socket` },
        { src: 'adac', shape: 'square', kw: ADAC.low_kw, pct: c.low, label: `${c.car}, ${ADAC.low_kw} kW` },
        { src: 'adac', shape: 'square', kw: ADAC.wallbox_kw, pct: c.wallbox_11, label: `${c.car}, 11 kW` },
        ...(c.wallbox_22 != null ? [{ src: 'adac', shape: 'square', kw: 22, pct: c.wallbox_22, label: `${c.car}, 22 kW` }] : []),
    ]),
    ...INL_PAIR.map(([kw, pct], i) => ({ src: 'inl', shape: 'triangle', kw, pct, label: `Chevrolet Volt, ${i ? '208' : '120'} V` })),
    ...SEARS_ALL.map(([kw, pct], i) => ({ src: 'sears', shape: 'ring', kw, pct, label: `Sears, Level ${i + 1}, all charges` })),
    ...SEARS_FULL.map(([kw, pct], i) => ({ src: 'sears', shape: 'ring', kw, pct, small: true, label: `Sears, Level ${i + 1}, 8 kWh and up (read from its chart)` })),
    ...SEARS_SHORT.map(([kw, pct], i) => ({ src: 'sears', shape: 'ring', kw, pct, small: true, label: `Sears, Level ${i + 1}, under 4 kWh` })),
];

const W = 720;
const H = 380;
const PAD = { left: 44, right: 16, top: 30, bottom: 40 };
const X_MAX = 55;
const Y_MAX = 30;
const px = (min) => PAD.left + (Math.min(min, X_MAX) / X_MAX) * (W - PAD.left - PAD.right);
const py = (pct) => PAD.top + (1 - pct / Y_MAX) * (H - PAD.top - PAD.bottom);
const seg = (line, fromKw, toKw) => ({
    x1: px(minPerKwh(fromKw)), y1: py(at(line, fromKw)),
    x2: px(minPerKwh(toKw)), y2: py(at(line, toKw)),
});
const pairSeg = ([[kwA, pctA], [kwB, pctB]]) => ({
    x1: px(minPerKwh(kwA)), y1: py(pctA), x2: px(minPerKwh(kwB)), y2: py(pctB),
});

const X_TICKS = [0, 10, 20, 30, 40, 50];
const Y_TICKS = [0, 10, 20, 30];
const KW_MARKS = [ADAC.wallbox_kw, ADAC.low_kw, SEARS_L2_KW, ADAC.socket_kw, US_OUTLET_KW];
const pct = (v) => `${v.toFixed(1)}%`;
const kwText = (kw) => `${Number(kw.toFixed(2))} kW`;

function Marker({ shape, x, y, className, r = 4 }) {
    if (shape === 'square') return <rect className={className} x={x - r + 0.5} y={y - r + 0.5} width={2 * r - 1} height={2 * r - 1} />;
    if (shape === 'triangle') return <path className={className} d={`M${x},${y - r - 1}l${r + 1},${2 * r}h${-2 * (r + 1)}z`} />;
    if (shape === 'ring') return <circle className={`${className} is-ring`} cx={x} cy={y} r={r} />;
    if (shape === 'diamond') return <path className={className} d={`M${x},${y - r - 2}l${r + 2},${r + 2}l${-r - 2},${r + 2}l${-r - 2},${-r - 2}z`} />;
    return <circle className={className} cx={x} cy={y} r={r} />;
}

function Key({ shape, src, children }) {
    return (
        <span className="explainer-loss-key">
            <svg viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true">
                <Marker shape={shape} x={0} y={0} className={`explainer-loss-point is-${src}`} />
            </svg>
            {children}
        </span>
    );
}

export default function OutletLossFigure() {
    return (
        <figure className="explainer-lab">
            <div className="explainer-lab-head">
                <span className="text-micro">Charging loss against charging time</span>
                <span className="explainer-model-badge">measurements · dashed line is a model</span>
            </div>

            <svg className="explainer-diagram explainer-cycle-svg" viewBox={`0 0 ${W} ${H}`} role="img"
                aria-label={`Charging loss against minutes per kWh: ${POINTS.map(p => `${p.label} ${pct(p.pct)}`).join('; ')}. ADAC's median line, extended, reaches ${pct(at(ADAC_LINE, US_OUTLET_KW))} at 1.44 kW; EVBench's assumption on the same basis is ${pct(EVBENCH_PCT)}.`}>
                {Y_TICKS.map(v => (
                    <g key={v}>
                        <line className="explainer-cycle-grid" x1={PAD.left} x2={W - PAD.right} y1={py(v)} y2={py(v)} />
                        <text className="explainer-diagram-tick" x={PAD.left - 6} y={py(v) + 4} textAnchor="end">{v}%</text>
                    </g>
                ))}
                {X_TICKS.map(v => (
                    <text key={v} className="explainer-diagram-tick" x={px(v)} y={H - PAD.bottom + 16} textAnchor="middle">{v}</text>
                ))}
                <text className="explainer-diagram-label" x={(PAD.left + W - PAD.right) / 2} y={H - 6} textAnchor="middle">
                    Minutes to draw 1 kWh from the wall
                </text>
                <text className="explainer-diagram-label" x={PAD.left} y={PAD.top - 16}>% lost before the battery</text>

                {KW_MARKS.map(kw => (
                    <g key={kw}>
                        <line className="explainer-loss-kw" x1={px(minPerKwh(kw))} x2={px(minPerKwh(kw))} y1={PAD.top} y2={H - PAD.bottom} />
                        <text className="explainer-diagram-tick" x={px(minPerKwh(kw))} y={PAD.top - 4} textAnchor="middle">{kwText(kw)}</text>
                    </g>
                ))}

                <g className="explainer-loss-line is-adac">
                    <line {...seg(ADAC_LINE, 22, ADAC.socket_kw)} />
                    <line className="is-extended" {...seg(ADAC_LINE, ADAC.socket_kw, SLOWEST_KW)} />
                </g>
                {LINES.map(l => (
                    <line key={l.label} className={`explainer-loss-line is-${l.src}${l.thin ? ' is-thin' : ''}`} {...pairSeg(l.pair)}>
                        <title>{l.label}</title>
                    </line>
                ))}

                {POINTS.map(p => (
                    <g key={p.label}>
                        <title>{`${p.label}: ${pct(p.pct)} lost at ${kwText(p.kw)}`}</title>
                        <Marker shape={p.shape} x={px(minPerKwh(p.kw))} y={py(p.pct)} r={p.small ? 3 : 4}
                            className={`explainer-loss-point is-${p.src}`} />
                    </g>
                ))}

                <g>
                    <title>{`EVBench's assumption on ADAC's basis: ${pct(EVBENCH_PCT)}`}</title>
                    <Marker shape="diamond" x={px(minPerKwh(US_OUTLET_KW))} y={py(EVBENCH_PCT)} r={5} className="explainer-loss-point is-evbench" />
                </g>
                <text className="explainer-diagram-text" x={px(minPerKwh(US_OUTLET_KW)) - 12} y={py(EVBENCH_PCT) + 4} textAnchor="end">
                    EVBench, {pct(EVBENCH_PCT)}
                </text>
            </svg>

            <div className="explainer-loss-legend text-note">
                <Key shape="circle" src="adac">ADAC 2026, socket (230 V, one phase)</Key>
                <Key shape="square" src="adac">ADAC 2026, wallbox (three-phase)</Key>
                <Key shape="triangle" src="inl">INL 2012, Volt charger + EVSE</Key>
                <Key shape="ring" src="sears">Sears 2013, Volts and Leafs</Key>
                <Key shape="diamond" src="evbench">EVBench’s assumption</Key>
            </div>

            <figcaption className="explainer-lab-caption text-note">
                <span>
                    Each source’s line joins its slow and fast results; ADAC’s runs through its five cars’ medians. Sears’
                    three pairs are all charges (large rings), charges of 8 kWh and up, read from its chart, and charges
                    under 4 kWh (small rings, top). Sears gives no charging power, so its Level 2 results sit at the
                    Volts’ and Leafs’ {kwText(SEARS_L2_KW)} and its Level 1 results at the Volt’s measured
                    {kwText(VOLT_L1_KW)}; INL measured only the Volt’s charger and EVSE. Every source counts energy into the battery, not back out as EPA does.
                </span>
                <span className="explainer-lab-caveat">
                    ADAC’s line is a model, not a measurement, where it is dashed: past its single-phase 230 V socket,
                    out to a US 120 V outlet. EVBench’s assumption is shown on ADAC’s basis: its 11 kW median × 0.80 ÷ 0.885.
                </span>
            </figcaption>
        </figure>
    );
}
