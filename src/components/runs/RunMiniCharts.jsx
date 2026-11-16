import { useEffect, useState } from 'react';
import { dataService } from '../../services/DataService';
import { useInView } from '../../hooks/useInView';
import { pointsKnownEmpty } from '../../utils/runPoints';
import { miniPlotSeries } from '../../utils/miniPlot';

const W = 180, H = 100;                     // viewBox; the SVG scales to its cell
const PAD = { l: 30, r: 6, t: 6, b: 18 };

/**
 * One small plot: every point as a dot, joined in time order, so a typo in
 * data entry (a 15 where 150 was meant, a time out of order) stands out.
 * Min and max on each axis, no gridlines — it is a spot check, not a chart.
 */
function MiniPlot({ series, xLabel, yLabel, color }) {
    if (!series) return <div className="run-mini-plot is-empty">No {yLabel} × {xLabel} points</div>;
    const { pts, x0, x1, y0, y1 } = series;
    const sx = x => PAD.l + (x - x0) / (x1 - x0 || 1) * (W - PAD.l - PAD.r);
    const sy = y => H - PAD.b - (y - y0) / (y1 - y0 || 1) * (H - PAD.t - PAD.b);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
    return (
        <figure className="run-mini-plot">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}, ${pts.length} points`}>
                <path className="run-mini-axis" d={`M${PAD.l},${PAD.t}V${H - PAD.b}H${W - PAD.r}`} />
                <path d={path} fill="none" stroke={color} strokeWidth="1" opacity="0.6" />
                {pts.map((p, i) => (
                    <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="1.6" fill={color}>
                        <title>{`${xLabel} ${p.x}, ${yLabel} ${p.y}`}</title>
                    </circle>
                ))}
                <text className="run-mini-tick" x={PAD.l - 3} y={PAD.t + 6} textAnchor="end">{y1}</text>
                <text className="run-mini-tick" x={PAD.l - 3} y={H - PAD.b} textAnchor="end">{y0}</text>
                <text className="run-mini-tick" x={PAD.l} y={H - 4}>{x0}</text>
                <text className="run-mini-tick" x={W - PAD.r} y={H - 4} textAnchor="end">{x1}</text>
            </svg>
            <figcaption className="text-micro">{yLabel} × {xLabel}</figcaption>
        </figure>
    );
}

/**
 * A charging test's own points, small: SoC → kW and time → SoC. Every point,
 * not a sample, since the point is to see a bad one. Read when the card nears
 * the viewport, through the charts' shared cache, and again when the test's
 * point count changes (a merge, an edit).
 */
export default function RunMiniCharts({ run, color }) {
    const [ref, near] = useInView();
    const [points, setPoints] = useState(null);
    const empty = pointsKnownEmpty(run);

    useEffect(() => {
        if (!near || empty) return undefined;
        let live = true;
        dataService.getRunDataCached(run.id)
            .then(rows => { if (live) setPoints(rows); })
            .catch(() => { if (live) setPoints([]); });
        return () => { live = false; };
    }, [near, empty, run.id, run.dataPointCount]);

    if (empty) return null;
    const stroke = color || 'var(--color-primary)';
    return (
        <div ref={ref} className="run-mini-charts">
            {points == null ? (
                <div className="run-mini-plot is-empty">Loading points…</div>
            ) : (
                <>
                    <MiniPlot series={miniPlotSeries(points, 'soc', 'chargeRate')} xLabel="SoC %" yLabel="kW" color={stroke} />
                    <MiniPlot series={miniPlotSeries(points, 'time', 'soc')} xLabel="min" yLabel="SoC %" color={stroke} />
                </>
            )}
        </div>
    );
}
