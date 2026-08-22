import { measureByKey } from '../../../utils/epaGuideStats';

/**
 * One row per bucket: n, and the five-number summary drawn as a box.
 *
 * The box is the point. Three numbers in columns invite a reader to compare
 * medians and stop; a box across a shared axis shows that Small SUVs and
 * Standard SUVs overlap almost entirely, which is a different — and truer —
 * story than "110 beats 98".
 *
 * Drawn with positioned divs against a shared scale rather than a chart
 * library: it is two rectangles and a line per row, and the axis has to match
 * the corpus range exactly for rows to be comparable.
 */
function Box({ stats, scale, digits }) {
    if (stats.n === 0 || stats.median == null) return null;
    const pct = (v) => `${((v - scale.min) / (scale.max - scale.min)) * 100}%`;
    return (
        <div className="stats-box-track" title={`min ${stats.min.toFixed(digits)} · q1 ${stats.q1.toFixed(digits)} · median ${stats.median.toFixed(digits)} · q3 ${stats.q3.toFixed(digits)} · max ${stats.max.toFixed(digits)}`}>
            {/* Whiskers first so the box paints over them. */}
            <div className="stats-box-whisker" style={{ left: pct(stats.min), right: `calc(100% - ${pct(stats.max)})` }} />
            <div className="stats-box-iqr" style={{ left: pct(stats.q1), right: `calc(100% - ${pct(stats.q3)})` }} />
            <div className="stats-box-median" style={{ left: pct(stats.median) }} />
        </div>
    );
}

export default function StatsTable({ rows, measure, overall, dimensionLabel }) {
    const m = measureByKey(measure);
    const digits = m?.digits ?? 1;

    // One scale across every row, including the corpus line, or the boxes are
    // not comparable to each other — which is the only reason to draw them.
    const all = rows.filter(r => r.n > 0);
    const scale = {
        min: Math.min(...all.map(r => r.min), overall.min ?? Infinity),
        max: Math.max(...all.map(r => r.max), overall.max ?? -Infinity),
    };
    const usable = Number.isFinite(scale.min) && Number.isFinite(scale.max) && scale.max > scale.min;

    const fmt = (v) => (v == null ? '—' : v.toFixed(digits));

    return (
        <div className="guide-table-container">
            <table className="guide-table stats-table">
                <thead>
                    <tr>
                        <th className="guide-th">{dimensionLabel}</th>
                        <th className="guide-th numeric">n</th>
                        <th className="guide-th numeric">Median</th>
                        <th className="guide-th numeric">IQR</th>
                        {usable && (
                            <th className="guide-th stats-th-dist">
                                {/* A drawn axis, not a range written out. The boxes below
                                    are positioned against exactly this scale, so the ends
                                    have to sit where the data ends — labels above the rule
                                    rather than beside it, or the line would be inset from
                                    the plot area and every box would read shifted. */}
                                <div className="stats-axis">
                                    <div className="stats-axis-labels">
                                        <span>{fmt(scale.min)}</span>
                                        <span className="stats-axis-unit">{m?.unit || m?.axisLabel || ''}</span>
                                        <span>{fmt(scale.max)}</span>
                                    </div>
                                    <div className="stats-axis-rule" />
                                </div>
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {overall.n > 0 && (
                        <tr className="stats-row stats-row-overall">
                            <td className="guide-td">All</td>
                            <td className="guide-td numeric">{overall.n}</td>
                            <td className="guide-td numeric">{fmt(overall.median)}</td>
                            <td className="guide-td numeric">{fmt(overall.q1)}–{fmt(overall.q3)}</td>
                            {usable && <td className="guide-td"><Box stats={overall} scale={scale} digits={digits} /></td>}
                        </tr>
                    )}
                    {rows.map(r => (
                        <tr key={String(r.bucket)} className={`stats-row ${r.suppressed ? 'suppressed' : ''}`}>
                            <td className="guide-td">
                                {String(r.bucket)}
                                {/* Shown, not hidden: a bucket that vanishes from a
                                    ranking reads as a bug, where one marked too-small
                                    is an answer. */}
                                {r.suppressed && <span className="stats-suppressed-flag">n too small</span>}
                            </td>
                            <td className="guide-td numeric">{r.n}</td>
                            <td className="guide-td numeric">{fmt(r.median)}</td>
                            <td className="guide-td numeric">{fmt(r.q1)}–{fmt(r.q3)}</td>
                            {usable && <td className="guide-td"><Box stats={r} scale={scale} digits={digits} /></td>}
                        </tr>
                    ))}
                </tbody>
            </table>
            {rows.length === 0 && <div className="empty-state">Nothing to summarise for this selection.</div>}
        </div>
    );
}
