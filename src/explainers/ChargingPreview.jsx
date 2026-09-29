import { PREVIEW_AXES, DEFAULT_AXES, axisPoints, niceScale } from './previewAxes';

/**
 * A small preview of some EVBench charging tests, for an explainer's tests
 * card, on the axes the tag names (previewAxes.js; SoC against charge rate by
 * default). Drawn in SVG from theme tokens, so it follows the theme and needs
 * nothing from the chart views; the card links through to Charging Curves for
 * the real thing. The card loads the tests (useChargingTests) and passes them
 * in, so its link and this chart are built from the same data.
 */
const W = 600;
const H = 240;
const PAD = { left: 48, right: 12, top: 14, bottom: 30 };

export default function ChargingPreview({ tests: { data, loading, error }, x = DEFAULT_AXES.x, y = DEFAULT_AXES.y }) {
    if (loading) return <div className="explainer-preview is-empty text-note">Loading the tests…</div>;
    if (error) return <div className="explainer-preview is-empty text-note">The tests could not be loaded.</div>;

    const drawable = PREVIEW_AXES[x] && PREVIEW_AXES[y];
    const xKey = drawable ? x : DEFAULT_AXES.x;
    const yKey = drawable ? y : DEFAULT_AXES.y;
    const xAxis = PREVIEW_AXES[xKey];
    const yAxis = PREVIEW_AXES[yKey];

    const series = (data ?? [])
        .map(t => ({ ...t, xy: axisPoints(t.points, xKey, yKey) }))
        .filter(t => t.xy.length > 1);
    if (series.length === 0) {
        return <div className="explainer-preview is-empty text-note">No data points for these tests on these axes.</div>;
    }

    const xs = series.flatMap(t => t.xy.map(p => p[0]));
    const ys = series.flatMap(t => t.xy.map(p => p[1]));
    const xScale = xAxis.fixed ? { max: xAxis.fixed[1], step: 20 } : niceScale(Math.max(...xs));
    const yScale = niceScale(Math.max(...ys));
    const ticks = (s) => Array.from({ length: Math.round(s.max / s.step) + 1 }, (_, n) => +(n * s.step).toFixed(6));
    const px = (v) => PAD.left + (v / xScale.max) * (W - PAD.left - PAD.right);
    const py = (v) => H - PAD.bottom - (v / yScale.max) * (H - PAD.top - PAD.bottom);
    const peakY = (t) => Math.max(...t.xy.map(p => p[1]));

    return (
        <div className="explainer-preview">
            <svg viewBox={`0 0 ${W} ${H}`} role="img"
                aria-label={`${yAxis.label} against ${xAxis.label.toLowerCase()} for ${series.map(t => t.name).join(' and ')}`}>
                {ticks(yScale).map(v => (
                    <g key={`y${v}`}>
                        <line className="explainer-preview-grid" x1={PAD.left} x2={W - PAD.right} y1={py(v)} y2={py(v)} />
                        <text className="explainer-preview-tick" x={PAD.left - 6} y={py(v) + 4} textAnchor="end">{v}</text>
                    </g>
                ))}
                {ticks(xScale).map(v => (
                    <text key={`x${v}`} className="explainer-preview-tick" x={px(v)} y={H - 10} textAnchor="middle">{v}</text>
                ))}
                <text className="explainer-preview-tick" x={PAD.left - 6} y={PAD.top - 3} textAnchor="end">{yAxis.unit}</text>
                <text className="explainer-preview-tick" x={W - PAD.right} y={H - 10} textAnchor="end">{xAxis.unit}</text>
                {series.map((t, n) => (
                    <polyline key={t.id} className={`explainer-preview-line is-series-${n % 3}`}
                        points={t.xy.map(([a, b]) => `${px(a).toFixed(1)},${py(b).toFixed(1)}`).join(' ')} />
                ))}
            </svg>
            <p className="explainer-preview-axes text-meta">
                {yAxis.label} ({yAxis.unit}) against {xAxis.label.toLowerCase()} ({xAxis.unit})
                {!drawable && ` · the preview cannot draw ${x} × ${y}; the link opens it in Charging Curves`}
            </p>
            <ul className="explainer-preview-legend">
                {series.map((t, n) => (
                    <li key={t.id}>
                        <span className={`explainer-preview-swatch is-series-${n % 3}`} aria-hidden="true" />
                        {t.vehicleName ? `${t.vehicleName} · ` : ''}{t.name}
                        {yKey === 'chargeRate' && <span className="text-meta"> · peak {Math.round(peakY(t))} kW</span>}
                    </li>
                ))}
            </ul>
        </div>
    );
}
