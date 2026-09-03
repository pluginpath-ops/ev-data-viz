/**
 * One bar chart in the Compare stack — a single metric across the selected
 * vehicles, with its own metric picker scoped to one category.
 *
 * Extracted so the Compare view can show acceleration, drag, passing and
 * braking side by side. Comparing cars means looking at several of those at
 * once, and a single chart behind a dropdown made that a sequence of clicks and
 * a memory test.
 */
import { useEffect, useRef, useMemo, useState } from 'react';
import Chart from 'chart.js/auto';
import { chartTheme, chartFonts, applyChartDefaults } from '../../utils/chartTheme';
import PlotFrame from '../charts/PlotFrame';
import { useChartPng } from '../../hooks/useChartPng';

export default function PerformanceCompareChart({
    title,
    metricOptions,       // [{ key, label }]
    metric,
    onMetricChange,
    valueModes,          // optional [{ key, label }] — e.g. braking distance vs g
    valueMode,
    onValueModeChange,
    rows,                // [{ id, name, value, display, badge, sub, fullData, flags, sourceCount }]
    axisLabel,
    barMode,
    isDark,
    presentationMode,
    note,
}) {
    const canvasRef = useRef(null);
    const chartRef  = useRef(null);

    const withData    = rows.filter(r => r.value != null);
    const withoutData = rows.filter(r => r.value == null);

    // The caption the export carries. `title` was an <h3> above the card and the
    // measure lived in a <select> beside it, so a pasted PNG was a row of bars
    // labelled with vehicle names and a bare axis — no statement of which
    // metric, in which mode, over how many vehicles.
    const plotSubtitle = useMemo(() => {
        const n = withData.length;
        const parts = [`${n} vehicle${n === 1 ? '' : 's'}`];
        // The mode is frequently the first word of the axis label ("Distance" /
        // "Distance (ft)"), and "distance · Distance (ft)" reads as a stutter
        // rather than as two facts.
        const mode = valueModes?.find(v => v.key === valueMode)?.label;
        const axis = axisLabel || '';
        if (mode && !axis.toLowerCase().startsWith(mode.toLowerCase())) {
            parts.push(mode.toLowerCase());
        }
        if (axis) parts.push(axis);
        return parts.join(' · ');
    }, [withData, valueModes, valueMode, axisLabel]);

    const [urlCopied, setUrlCopied] = useState(false);
    const { copyPng, copied, preview, dismissPreview } =
        useChartPng(chartRef, { title, subtitle: plotSubtitle });

    useEffect(() => {
        if (!canvasRef.current || withData.length === 0) {
            chartRef.current?.destroy();
            chartRef.current = null;
            return;
        }
        chartRef.current?.destroy();

        // From the stylesheet, not retyped here — see utils/chartTheme.
        const { grid, tick } = chartTheme();
        applyChartDefaults(Chart);

        const labelPlugin = {
            id: 'perfBarLabels',
            afterDatasetsDraw(chart) {
                const ctx = chart.ctx;
                const fonts = chartFonts();
                const meta = chart.getDatasetMeta(0);
                meta.data.forEach((bar, i) => {
                    const row = withData[i];
                    if (!row) return;
                    const pills = [row.display];
                    // The category's secondary measure — g for a timed window,
                    // trap speed for a drag distance.
                    if (row.badge) pills.push(row.badge);
                    if (row.sub) pills.push(row.fullData ? `${row.sub} ✦` : row.sub);

                    let x = bar.base + 8;
                    const y = bar.y - 7;
                    pills.forEach((text, idx) => {
                        ctx.save();
                        ctx.font = idx === 0
                            ? `600 ${fonts.badge}px ${fonts.sans}`
                            : `${fonts.micro}px ${fonts.sans}`;
                        const w = ctx.measureText(text).width + 10;
                        if (x + w > bar.x - 2) { ctx.restore(); return; }
                        ctx.fillStyle = 'rgba(0,0,0,0.28)';
                        ctx.beginPath();
                        ctx.roundRect(x, y, w, 15, 3);
                        ctx.fill();
                        ctx.fillStyle = '#fff';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(text, x + w / 2, y + 7.5);
                        ctx.restore();
                        x += w + 4;
                    });
                });
            },
        };

        chartRef.current = new Chart(canvasRef.current, {
            type: 'bar',
            data: {
                labels: withData.map(r => r.name),
                datasets: [{
                    data: withData.map(r => r.value),
                    backgroundColor: withData.map(r => r.color),
                    borderRadius: 4,
                }],
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => {
                                const r = withData[c.dataIndex];
                                const lines = [r.display];
                                if (r.badge) lines.push(r.badge);
                                if (r.sub) lines.push(r.sub);
                                if (r.windowLabel) lines.push(`Window: ${r.windowLabel}`);
                                if (r.flags?.includes('single-run')) lines.push('⚠ Single run only');
                                if (r.flags?.includes('steep-grade')) lines.push('⚠ Best run was on a grade');
                                if (r.fullData) lines.push('✦ Full run data held here');
                                if (r.flags?.includes('derived-from-launch')) {
                                    lines.push('Cut from a standing-start launch, not a roll-on —');
                                    lines.push('the car was already at full power, so this reads slightly quick');
                                }
                                if (r.flags?.includes('interpolated')) lines.push('⚠ Interpolated between recorded splits');
                                if (r.sourceCount > 1 && barMode !== 'source') {
                                    lines.push(`${r.sourceCount} sources tested this — switch Bars to "One per source"`);
                                }
                                return lines;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: grid },
                        ticks: { color: tick },
                        title: { display: true, color: tick, text: axisLabel },
                    },
                    y: { grid: { display: false }, ticks: { color: tick } },
                },
            },
            plugins: [labelPlugin],
        });

        return () => { chartRef.current?.destroy(); chartRef.current = null; };
    }, [withData, isDark, axisLabel, barMode]);

    return (
        <>
        <div className="card mb-4">
            {/* No heading here: PlotFrame below carries the title, and it has to
                — a title outside the frame is a title the PNG does not have.
                Repeating it made every Performance chart say its own name
                twice. */}
            <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    {!presentationMode && valueModes && (
                        <select
                            value={valueMode}
                            onChange={e => onValueModeChange(e.target.value)}
                            className="form-input p-1.5"
                        >
                            {valueModes.map(v => (
                                <option key={v.key} value={v.key}>{v.label}</option>
                            ))}
                        </select>
                    )}
                    {!presentationMode && metricOptions.length > 1 && (
                        <select
                            value={metric}
                            onChange={e => onMetricChange(e.target.value)}
                            className="form-input p-1.5"
                        >
                            {metricOptions.map(m => (
                                <option key={m.key} value={m.key}>{m.label}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            {withData.length === 0 && (
                <p className="text-sm text-secondary py-6 text-center">
                    No tested figure for this among the selected vehicles.
                </p>
            )}

        </div>

        {withData.length > 0 && (
            <PlotFrame
                title={title}
                subtitle={plotSubtitle}
                preview={preview}
                onDismissPreview={dismissPreview}
                exportControls={!presentationMode && (
                    <>
                    <button
                        onClick={() => {
                            const p = new URLSearchParams(window.location.search);
                            p.set('tab', 'performance');
                            p.set('m', 'perfcompare');
                            navigator.clipboard.writeText(
                                `${window.location.origin}${window.location.pathname}?${p}`
                            ).then(() => {
                                setUrlCopied(true);
                                setTimeout(() => setUrlCopied(false), 2000);
                            });
                        }}
                        className={`chart-copy-btn ${urlCopied ? 'chart-copy-btn-active' : ''}`}
                        title="Copy link to this chart view"
                    >
                        {urlCopied ? '✓ Copied' : '🔗 URL'}
                    </button>
                    <button
                        onClick={copyPng}
                        className={`chart-copy-btn ${copied ? 'chart-copy-btn-active' : ''}`}
                        title="Copy the framed chart as a PNG"
                    >
                        {copied ? '✓ Copied' : 'PNG'}
                    </button>
                    </>
                )}
            >
                <div style={{ height: Math.max(140, withData.length * 42) }}>
                    <canvas ref={canvasRef} />
                </div>
            </PlotFrame>
        )}

        {/* Under the figure, not above it: both lines are commentary on what the
            chart shows, and above the frame they read as belonging to the
            controls instead. */}
        {note && <p className="text-xs text-meta mt-2">{note}</p>}
        {withoutData.length > 0 && withData.length > 0 && (
            <p className="text-xs text-meta mt-2">
                {withoutData.length <= 5
                    ? `No figure for: ${withoutData.map(r => r.name).join(', ')}`
                    : `${withoutData.length} other selected vehicles have no figure here.`}
            </p>
        )}
        </>
    );
}
