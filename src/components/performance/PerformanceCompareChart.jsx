/**
 * One bar chart in the Compare stack — a single metric across the selected
 * vehicles, with its own metric picker scoped to one category.
 *
 * Extracted so the Compare view can show acceleration, drag, passing and
 * braking side by side. Comparing cars means looking at several of those at
 * once, and a single chart behind a dropdown made that a sequence of clicks and
 * a memory test.
 */
import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import ChartExportButtons from '../ChartExportButtons';

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

    useEffect(() => {
        if (!canvasRef.current || withData.length === 0) {
            chartRef.current?.destroy();
            chartRef.current = null;
            return;
        }
        chartRef.current?.destroy();

        const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const tick = isDark ? '#cbd5e1' : '#475569';

        const labelPlugin = {
            id: 'perfBarLabels',
            afterDatasetsDraw(chart) {
                const ctx = chart.ctx;
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
                        ctx.font = idx === 0 ? 'bold 11px sans-serif' : '10px sans-serif';
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
        <div className="card mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h3 className="text-lg font-semibold">{title}</h3>
                <div className="flex flex-wrap items-center gap-2">
                    {!presentationMode && valueModes && (
                        <select
                            value={valueMode}
                            onChange={e => onValueModeChange(e.target.value)}
                            className="border p-1.5 rounded text-sm"
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
                            className="border p-1.5 rounded text-sm"
                        >
                            {metricOptions.map(m => (
                                <option key={m.key} value={m.key}>{m.label}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            {withData.length === 0 ? (
                <p className="text-sm text-muted py-6 text-center">
                    No tested figure for this among the selected vehicles.
                </p>
            ) : (
                <div style={{ height: Math.max(140, withData.length * 42) }}>
                    <canvas ref={canvasRef} />
                </div>
            )}

            {note && <p className="text-xs text-faint mt-2">{note}</p>}

            {withoutData.length > 0 && withData.length > 0 && (
                <p className="text-xs text-faint mt-2">
                    {withoutData.length <= 5
                        ? `No figure for: ${withoutData.map(r => r.name).join(', ')}`
                        : `${withoutData.length} other selected vehicles have no figure here.`}
                </p>
            )}

            {!presentationMode && withData.length > 0 && (
                <ChartExportButtons
                    chartRef={chartRef}
                    isDark={isDark}
                    buildParams={p => { p.set('tab', 'performance'); p.set('m', 'perfcompare'); }}
                />
            )}
        </div>
    );
}
