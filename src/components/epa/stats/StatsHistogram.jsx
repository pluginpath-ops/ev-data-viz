// See StatsTable: the definition is passed in rather than looked up.

/**
 * Equal-width histogram of one measure across the current selection.
 *
 * Equal-width and not equal-count, because the shape is the finding. The
 * adjustment factor's pile at exactly 0.700 — 57% of rows declaring a 5-cycle
 * label — only reads as a spike against a linear axis; quantile bins would
 * spread it across several buckets and make a bimodal fleet look smooth.
 *
 * ── The median is drawn, not just printed ───────────────────────────────────
 *
 * The table above ranks by median, so the question this chart answers is where
 * that median sits in the shape — whether it is the peak, or a long tail is
 * dragging it off one. A number in the caption cannot answer that; a rule
 * through the bars can. Its caption rides on a chip ABOVE the plot area rather
 * than over the bars, because the one place a median label must not sit is on
 * top of the bars it is measuring.
 *
 * ── Four steps of one blue ──────────────────────────────────────────────────
 *
 * Bars step through four mixes of `--color-primary` by height rather than being
 * one flat fill. At 24 bins a flat fill reads as a solid mass and the shape has
 * to be traced along the top edge; stepping the fill makes the peak legible
 * peripherally. Mixed from the token rather than written as four blues, so the
 * ramp follows the theme instead of pinning it.
 */
export default function StatsHistogram({ data, measureDef, overall }) {
    const m = measureDef;
    const digits = m?.digits ?? 1;
    if (!data.n) return null;

    const peak = Math.max(...data.bins.map(b => b.count));
    const domain = { min: data.bins[0].from, max: data.bins[data.bins.length - 1].to };
    const width = domain.max - domain.min;

    /** Where a value falls across the plot, or null when it is off the domain. */
    const at = (v) => (v == null || width <= 0 ? null : ((v - domain.min) / width) * 100);
    const medianPct = at(overall?.median);

    const fmt = (v) => (v == null ? '—' : v.toFixed(digits));

    return (
        <div className="stats-histogram">
            <div className="stats-histogram-head">
                <span className="text-nano">Distribution · {data.bins.length} bins</span>
                {overall?.n > 0 && (
                    <span className="stats-histogram-summary">
                        median <span className="stats-histogram-median-value">{fmt(overall.median)}</span>
                        {' · '}IQR {fmt(overall.q1)}–{fmt(overall.q3)}
                        {' · '}n={data.n}
                    </span>
                )}
            </div>

            <div className="stats-histogram-plot">
                <div className="stats-histogram-bars">
                    {data.bins.map((b, i) => {
                        const share = peak ? b.count / peak : 0;
                        // Four steps, and an empty bin gets none of them — a
                        // faint bar where nothing was measured is a lie the eye
                        // reads before the axis.
                        const step = b.count === 0 ? 0 : Math.min(4, Math.ceil(share * 4));
                        return (
                            <div
                                key={i}
                                className={`stats-histogram-bar${step ? ` step-${step}` : ''}`}
                                style={{ height: `${share * 100}%` }}
                                title={`${b.from.toFixed(digits)} – ${b.to.toFixed(digits)} ${m?.unit ?? ''}: ${b.count}`}
                            />
                        );
                    })}
                </div>

                {medianPct != null && (
                    <div className="stats-histogram-median" style={{ left: `${medianPct}%` }}>
                        <span className="stats-histogram-median-chip">Median</span>
                    </div>
                )}
            </div>

            <div className="stats-histogram-axis">
                <span>{fmt(domain.min)}</span>
                <span>
                    {fmt(domain.max)}
                    {(m?.unit || m?.axisLabel) && ` ${m.unit || m.axisLabel}`}
                </span>
            </div>
        </div>
    );
}
