import ledger from '../facts.json';

/**
 * INL's steady-state charger efficiency against charging power, one panel per
 * car, a series per voltage: the curves from its fact sheets' page-2 charts,
 * read into the ledger (each fact's `value.curve`). Every panel shares one
 * scale, so the cars compare at a glance. It shows the charger alone: the rest
 * of the car's draw while charging is not in these numbers.
 */
const fact = (id) => ledger.facts.find(f => f.id === id).value;

const VOLTS = [
    { key: 'level1_120v', name: '120 V', shape: 'circle' },
    { key: 'level2_208v', name: '208 V', shape: 'square' },
    { key: 'level2_240v', name: '240 V', shape: 'square' },
];
const CARS = [
    { id: 'inl-steady-state-i3-2014', name: '2014 BMW i3' },
    { id: 'inl-steady-state-leaf-2012', name: '2012 Nissan Leaf' },
    { id: 'inl-steady-state-leaf-2015', name: '2015 Nissan Leaf' },
    { id: 'inl-steady-state-b-class-2015', name: '2015 Mercedes B-Class' },
].map(c => ({ ...c, curve: fact(c.id).curve }));

const W = 360;
const H = 210;
const PAD = { left: 40, right: 12, top: 10, bottom: 34 };
const X_MAX = 8;
const Y_MIN = 60;
const Y_MAX = 95;
const px = (kw) => PAD.left + (kw / X_MAX) * (W - PAD.left - PAD.right);
const py = (eff) => PAD.top + (1 - (100 * eff - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD.top - PAD.bottom);
const X_TICKS = [0, 2, 4, 6, 8];
const Y_TICKS = [60, 70, 80, 90];
const pct = (eff) => `${(100 * eff).toFixed(1)}%`;

function Marker({ shape, x, y, className, r = 2.75 }) {
    if (shape === 'square') return <rect className={className} x={x - r} y={y - r} width={2 * r} height={2 * r} />;
    return <circle className={className} cx={x} cy={y} r={r} />;
}

function Swatch({ i, shape }) {
    return (
        <svg viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true">
            <Marker shape={shape} x={0} y={0} r={4} className={`explainer-loss-point is-s${i}`} />
        </svg>
    );
}

function Panel({ car }) {
    const series = VOLTS.map((v, i) => ({ ...v, i, pts: car.curve[v.key] })).filter(s => s.pts);
    const describe = series.map(s => `${s.name}: ${pct(s.pts[0][1])} at ${s.pts[0][0]} kW to ${pct(s.pts.at(-1)[1])} at ${s.pts.at(-1)[0]} kW`).join('; ');
    return (
        <div className="explainer-loss-panel">
            <span className="text-micro">{car.name}</span>
            <svg className="explainer-diagram explainer-cycle-svg" viewBox={`0 0 ${W} ${H}`} role="img"
                aria-label={`${car.name}, onboard charger efficiency against charging power. ${describe}.`}>
                {Y_TICKS.map(v => (
                    <g key={v}>
                        <line className="explainer-cycle-grid" x1={PAD.left} x2={W - PAD.right} y1={py(v / 100)} y2={py(v / 100)} />
                        <text className="explainer-diagram-tick" x={PAD.left - 6} y={py(v / 100) + 4} textAnchor="end">{v}%</text>
                    </g>
                ))}
                {X_TICKS.map(v => (
                    <text key={v} className="explainer-diagram-tick" x={px(v)} y={H - PAD.bottom + 16} textAnchor="middle">{v}</text>
                ))}
                <text className="explainer-diagram-label" x={(PAD.left + W - PAD.right) / 2} y={H - 4} textAnchor="middle">
                    Charging power (kW)
                </text>
                {series.map(s => (
                    <g key={s.key}>
                        <polyline className={`explainer-eff-curve explainer-loss-line is-thin is-s${s.i}`}
                            points={s.pts.map(([kw, eff]) => `${px(kw)},${py(eff)}`).join(' ')} />
                        {s.pts.map(([kw, eff]) => (
                            <g key={kw}>
                                <title>{`${s.name}, ${kw} kW: ${pct(eff)}`}</title>
                                <Marker shape={s.shape} x={px(kw)} y={py(eff)} className={`explainer-loss-point is-s${s.i}`} />
                            </g>
                        ))}
                    </g>
                ))}
            </svg>
        </div>
    );
}

export default function InlEfficiencyFigure() {
    return (
        <figure className="explainer-lab">
            <div className="explainer-lab-head">
                <span className="text-micro">Onboard charger efficiency, by power and voltage</span>
                <span className="explainer-model-badge">measured · INL</span>
            </div>
            <div className="explainer-eff-grid">
                {CARS.map(c => <Panel key={c.id} car={c} />)}
            </div>
            <div className="explainer-loss-legend text-note">
                {VOLTS.map((v, i) => <span key={v.key} className="explainer-loss-key"><Swatch i={i} shape={v.shape} />{v.name}</span>)}
            </div>
            <figcaption className="explainer-lab-caption text-note">
                <span>
                    Idaho National Laboratory held each car at a steady charging current and measured its onboard
                    charger alone. Every panel uses the same scale. Three of the four chargers lose efficiency as the
                    power drops; the 2012 Leaf’s stays flat. At about the same power, 120 V does a little worse than
                    208 or 240 V on three cars, and better on the B-Class. INL notes a step in the i3’s charger at
                    13 A, about 3 kW; the B-Class has one near 3.5 kW. These numbers leave out the rest of the car’s draw while it
                    charges, which a slow charge pays for longer. On the i3, 2015 Leaf and B-Class, the output
                    includes the car’s 12 V supply. The points are read from INL’s charts, to within about
                    0.3 points.
                </span>
            </figcaption>
        </figure>
    );
}
