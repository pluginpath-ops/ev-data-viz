import { measureByKey } from '../../../utils/epaGuideStats';

/**
 * Equal-width histogram of one measure across the current selection.
 *
 * Equal-width and not equal-count, because the shape is the finding. The
 * adjustment factor's pile at exactly 0.700 — 57% of rows declaring a 5-cycle
 * label — only reads as a spike against a linear axis; quantile bins would
 * spread it across several buckets and make a bimodal fleet look smooth.
 */
export default function StatsHistogram({ data, measure }) {
    const m = measureByKey(measure);
    const digits = m?.digits ?? 1;
    if (!data.n) return null;
    const peak = Math.max(...data.bins.map(b => b.count));

    return (
        <div className="stats-histogram">
            <div className="stats-histogram-bars">
                {data.bins.map((b, i) => (
                    <div
                        key={i}
                        className="stats-histogram-bar"
                        style={{ height: `${peak ? (b.count / peak) * 100 : 0}%` }}
                        title={`${b.from.toFixed(digits)} – ${b.to.toFixed(digits)} ${m?.unit ?? ''}: ${b.count}`}
                    />
                ))}
            </div>
            <div className="stats-histogram-axis text-hint">
                <span>{data.bins[0].from.toFixed(digits)}</span>
                <span>{m?.label} {m?.unit && `(${m.unit})`} · n={data.n}</span>
                <span>{data.bins[data.bins.length - 1].to.toFixed(digits)}</span>
            </div>
        </div>
    );
}
