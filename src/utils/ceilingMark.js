/**
 * The home ceiling's mark on a Chart.js plot, for every chart that draws one
 * (Home Charger: the most a month of home charging could cost; the Weekly
 * Charging Plan's day bars: the most a night could add). One look for all:
 * a dashed line across a bar, and a ceiling above the plot pinned to its top
 * edge with an up-arrow.
 *
 * Drawn by a plugin rather than as a dataset, so a ceiling never moves the
 * axis: the plot stays as tall as its tallest bar. docs/vocabulary.md has the
 * name — a **home ceiling**.
 */
import { chartTheme } from './chartTheme';

const DASH = [4, 3];

/**
 * @param {Object} chart  the Chart.js chart, its value axis `y`
 * @param {Array<{ x: number, half: number, value: number }>} marks
 *   a line across x ± half (pixels) at `value` on the y axis
 */
export function drawCeilingMarks(chart, marks) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    const { ink } = chartTheme();
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 2;
    for (const { x, half, value } of marks) {
        const top = y.getPixelForValue(value);
        const off = top < a.top;
        const py = Math.round(off ? a.top : top);
        ctx.setLineDash(DASH);
        ctx.beginPath();
        ctx.moveTo(x - half, py);
        ctx.lineTo(x + half, py);
        ctx.stroke();
        if (!off) continue;
        // Off the plot: an arrow over the line.
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x, py - 9);
        ctx.lineTo(x + 4, py - 3);
        ctx.lineTo(x - 4, py - 3);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

/**
 * The legend for a chart with a ceiling: the chart's own items (the ones
 * `keep` allows, as squares), then a key for the dashed line, which no dataset
 * stands for. With `text` null there is no key. Spread the result's two parts
 * into the legend options: `generateLabels` under `labels` (with
 * `usePointStyle: true`), and `onClick`, which leaves the key alone.
 *
 * @param {Function} Chart  chart.js's Chart
 * @param {{ keep: (item: Object, data: Object) => boolean, text: string|null,
 *           onClick?: Function }} opts   `onClick` is the chart's own (default: Chart.js's, hide a dataset)
 */
export function ceilingLegend(Chart, { keep, text, onClick = Chart.defaults.plugins.legend.onClick }) {
    return {
        generateLabels: (chart) => {
            const { ink, legend } = chartTheme();
            const items = Chart.defaults.plugins.legend.labels.generateLabels(chart)
                .filter(item => keep(item, chart.data))
                .map(item => ({ ...item, pointStyle: 'rect' }));
            if (!text) return items;
            return [...items, { text, pointStyle: 'line', lineDash: DASH, lineWidth: 2, strokeStyle: ink, fillStyle: ink, fontColor: legend, hidden: false }];
        },
        // The key stands for no dataset: nothing to hide.
        onClick: (e, item, legend) => { if (item.datasetIndex != null) onClick(e, item, legend); },
    };
}
