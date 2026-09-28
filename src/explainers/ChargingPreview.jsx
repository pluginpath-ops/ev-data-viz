/**
 * A small kW-against-SoC preview of some EVBench charging tests, for an
 * explainer's tests card. Drawn in SVG from theme tokens, so it follows the
 * theme and needs nothing from the chart views; the card links through to
 * Charging Curves for the real thing. The card loads the tests
 * (useChargingTests) and passes them in, so its link and this chart are built
 * from the same data.
 */
const W = 600;
const H = 240;
const PAD = { left: 44, right: 12, top: 12, bottom: 28 };
const SOC_TICKS = [0, 20, 40, 60, 80, 100];

export default function ChargingPreview({ tests: { data, loading, error } }) {
    if (loading) return <div className="explainer-preview is-empty text-note">Loading the tests…</div>;
    if (error) return <div className="explainer-preview is-empty text-note">The tests could not be loaded.</div>;
    const tests = (data ?? []).filter(t => t.points.length > 1);
    if (tests.length === 0) return <div className="explainer-preview is-empty text-note">No data points for these tests.</div>;

    const peak = Math.max(...tests.flatMap(t => t.points.map(p => p.kw)));
    const step = peak > 250 ? 100 : 50;
    const yMax = Math.ceil(peak / step) * step;
    const kwTicks = Array.from({ length: yMax / step + 1 }, (_, n) => n * step);
    const x = (soc) => PAD.left + (soc / 100) * (W - PAD.left - PAD.right);
    const y = (kw) => H - PAD.bottom - (kw / yMax) * (H - PAD.top - PAD.bottom);

    return (
        <div className="explainer-preview">
            <svg viewBox={`0 0 ${W} ${H}`} role="img"
                aria-label={`Charge rate against state of charge for ${tests.map(t => t.name).join(' and ')}`}>
                {kwTicks.map(kw => (
                    <g key={`y${kw}`}>
                        <line className="explainer-preview-grid" x1={PAD.left} x2={W - PAD.right} y1={y(kw)} y2={y(kw)} />
                        <text className="explainer-preview-tick" x={PAD.left - 6} y={y(kw) + 4} textAnchor="end">{kw}</text>
                    </g>
                ))}
                {SOC_TICKS.map(soc => (
                    <text key={`x${soc}`} className="explainer-preview-tick" x={x(soc)} y={H - 8} textAnchor="middle">{soc}%</text>
                ))}
                <text className="explainer-preview-tick" x={PAD.left - 6} y={PAD.top - 2} textAnchor="end">kW</text>
                {tests.map((t, n) => (
                    <polyline key={t.id} className={`explainer-preview-line is-series-${n % 3}`}
                        points={t.points.map(p => `${x(p.soc).toFixed(1)},${y(p.kw).toFixed(1)}`).join(' ')} />
                ))}
            </svg>
            <ul className="explainer-preview-legend">
                {tests.map((t, n) => (
                    <li key={t.id}>
                        <span className={`explainer-preview-swatch is-series-${n % 3}`} aria-hidden="true" />
                        {t.vehicleName ? `${t.vehicleName} · ` : ''}{t.name}
                        <span className="text-meta"> · peak {Math.round(Math.max(...t.points.map(p => p.kw)))} kW</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
