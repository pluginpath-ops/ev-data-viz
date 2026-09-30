import { niceScale } from './previewAxes';

/**
 * A small preview of EVBench's Modeled Efficiency for an explainer's
 * `::: modeled` card: each EPA link's curve against speed at standard
 * conditions, with its vehicle's range tests corrected to the same conditions
 * as dots. Drawn in SVG from theme tokens, like ChargingPreview; the numbers
 * come finished from useModeledEfficiency, so nothing here models anything.
 */
const W = 600;
const H = 240;
const PAD = { left: 48, right: 12, top: 14, bottom: 30 };
const X_RANGE = [20, 90];
const HIGHWAY_BAND = [65, 75];

/** The chart's y-axis keys (EpaCurvesView), read off a preview point. */
export const MODELED_Y = {
    mi_kwh:   { label: 'Efficiency', unit: 'mi/kWh',    read: p => p.miPerKwh },
    kwh100mi: { label: 'Consumption', unit: 'kWh/100mi', read: p => p.kwh100mi },
    wh_mi:    { label: 'Consumption', unit: 'Wh/mi',     read: p => p.whMi },
    mpge:     { label: 'Efficiency', unit: 'MPGe',      read: p => p.mpge },
    range_mi: { label: 'Range',      unit: 'mi',        read: p => p.rangeMi },
};
export const DEFAULT_MODELED_Y = 'mi_kwh';

const fmt = (v) => (v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2));

/** The curve at a test's speed. The curve is drawn a mile an hour apart, so the nearest point is exact enough to read. */
const modelAt = (curve, mph) => curve.reduce((best, p) => (Math.abs(p.mph - mph) < Math.abs(best.mph - mph) ? p : best), curve[0]);

export default function ModeledPreview({ curves: { data, loading, error }, y = DEFAULT_MODELED_Y }) {
    if (loading) return <div className="explainer-preview is-empty text-note">Loading the model…</div>;
    if (error) return <div className="explainer-preview is-empty text-note">The model could not be loaded.</div>;

    const yKey = MODELED_Y[y] ? y : DEFAULT_MODELED_Y;
    const axis = MODELED_Y[yKey];
    const inRange = (p) => p.mph >= X_RANGE[0] && p.mph <= X_RANGE[1] && axis.read(p) != null;
    const series = (data ?? [])
        .map(s => ({ ...s, line: s.curve.filter(inRange), dots: s.tests.filter(inRange) }))
        .filter(s => s.line.length > 1);
    if (series.length === 0) {
        return <div className="explainer-preview is-empty text-note">
            {yKey === 'range_mi' ? 'These records carry no usable energy, so there is no range to draw.' : 'Nothing to draw for these records.'}
        </div>;
    }

    const ys = series.flatMap(s => [...s.line, ...s.dots].map(axis.read));
    const yScale = niceScale(Math.max(...ys));
    const xStep = 10;
    const xTicks = Array.from({ length: (X_RANGE[1] - X_RANGE[0]) / xStep + 1 }, (_, n) => X_RANGE[0] + n * xStep);
    const yTicks = Array.from({ length: Math.round(yScale.max / yScale.step) + 1 }, (_, n) => +(n * yScale.step).toFixed(6));
    const px = (v) => PAD.left + ((v - X_RANGE[0]) / (X_RANGE[1] - X_RANGE[0])) * (W - PAD.left - PAD.right);
    const py = (v) => H - PAD.bottom - (v / yScale.max) * (H - PAD.top - PAD.bottom);

    return (
        <div className="explainer-preview">
            <svg viewBox={`0 0 ${W} ${H}`} role="img"
                aria-label={`${axis.label} (${axis.unit}) against speed for ${series.map(s => s.vehicleName ?? s.label).join(' and ')}`}>
                <rect className="explainer-preview-band" x={px(HIGHWAY_BAND[0])} y={PAD.top}
                    width={px(HIGHWAY_BAND[1]) - px(HIGHWAY_BAND[0])} height={H - PAD.top - PAD.bottom} />
                {yTicks.map(v => (
                    <g key={`y${v}`}>
                        <line className="explainer-preview-grid" x1={PAD.left} x2={W - PAD.right} y1={py(v)} y2={py(v)} />
                        <text className="explainer-preview-tick" x={PAD.left - 6} y={py(v) + 4} textAnchor="end">{v}</text>
                    </g>
                ))}
                {xTicks.map(v => (
                    <text key={`x${v}`} className="explainer-preview-tick" x={px(v)} y={H - 10} textAnchor="middle">{v}</text>
                ))}
                <text className="explainer-preview-tick" x={PAD.left - 6} y={PAD.top - 3} textAnchor="end">{axis.unit}</text>
                <text className="explainer-preview-tick" x={W - PAD.right} y={H - 10} textAnchor="end">mph</text>
                {series.map((s, n) => (
                    <g key={s.mappingId}>
                        <polyline className={`explainer-preview-line is-modeled is-series-${n % 3}`}
                            points={s.line.map(p => `${px(p.mph).toFixed(1)},${py(axis.read(p)).toFixed(1)}`).join(' ')} />
                        {s.dots.map(t => (
                            <circle key={t.id} className={`explainer-preview-dot is-series-${n % 3}`}
                                cx={px(t.mph)} cy={py(axis.read(t))} r="5" />
                        ))}
                    </g>
                ))}
            </svg>
            <p className="explainer-preview-axes text-meta">
                {axis.label} ({axis.unit}) against steady speed · model at standard conditions (still air, flat, mild), with
                range tests corrected to them · shaded: 65–75 mph
            </p>
            <ul className="explainer-preview-legend">
                {series.map((s, n) => (
                    <li key={s.mappingId}>
                        <span className={`explainer-preview-swatch is-series-${n % 3}`} aria-hidden="true" />
                        {s.vehicleName ? `${s.vehicleName} · ` : ''}{s.label}
                        {s.dots.map(t => (
                            <span key={t.id} className="text-meta">
                                {' '}· test at {Math.round(t.mph)} mph: {fmt(axis.read(t))} {axis.unit}
                                {' '}(model {fmt(axis.read(modelAt(s.curve, t.mph)))})
                            </span>
                        ))}
                    </li>
                ))}
            </ul>
        </div>
    );
}
