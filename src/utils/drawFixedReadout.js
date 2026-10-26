import { chartTheme, chartFonts } from './chartTheme';
import {
    layoutReadoutBox, placeReadoutBox, sampleObstacles,
    BOX_MAX_HEIGHT_FRACTION, BOX_MAX_WIDTH_FRACTION,
} from './readoutBox';

/** Space between the plot and a side panel, in CSS px. */
export const SIDE_PANEL_GAP = 16;
const SIDE_PANEL_MAX_WIDTH = 340;

/**
 * Prepare a fixed readout for the PNG export (#456): the guide line, a dot on
 * each series, and a compact box of their values.
 *
 * Only the export calls this. On screen the readout is DOM, because its rows
 * carry links a canvas cannot; the export is a picture, so it gets the same
 * reading redrawn here. Text is the label tier of the type scale (chartFonts),
 * colors are the chart theme's, and the layout is readoutBox's.
 *
 * Two layouts. OVER the plot (the default) the box sits beside the guide line
 * where it covers the least data. BESIDE (`side`) the plot is left untouched
 * and the box is a panel to its right: the export canvas grows by `sideWidth`
 * and nothing is hidden, which is the layout for a crowded chart.
 *
 * Measuring has to happen before the export canvas exists (its width depends
 * on the panel), so this returns the width and a `draw` to call afterwards.
 *
 * @param {object} chart   the Chart.js instance (for the drawn lines)
 * @param {object} reading the store's fixed state: { x, xPx, rows, dots, area, config }
 * @param {{side?: boolean}} [options]
 * @returns {{sideWidth: number, draw: (ctx: CanvasRenderingContext2D, origin: {x: number, y: number, dpr: number}) => void}}
 */
export function prepareFixedReadout(chart, reading, { side = false } = {}) {
    const theme = chartTheme();
    const { label: SIZE, badge: SMALL, mono, sans } = chartFonts();
    const { area, xPx, dots, config } = reading;

    const entries = reading.rows.map(row => ({ row, d: config.describe(row, { nearest: false, x: reading.x }) }));
    const lines = entries.map(({ row, d }) => ({
        name: d.name,
        value: `${row.interpolated ? '≈ ' : ''}${d.value}${d.companion ? ` · ${d.companion}` : ''}`,
    }));
    const title = config.title(reading.x);
    const bodyFont = `400 ${SIZE}px ${mono}`;
    const boldFont = `600 ${SIZE}px ${sans}`;
    const scratch = document.createElement('canvas').getContext('2d');
    const measure = (text, bold) => { scratch.font = bold ? boldFont : bodyFont; return scratch.measureText(text).width; };

    const lh = Math.round(SIZE * 1.35);
    const areaW = area.right - area.left, areaH = area.bottom - area.top;
    const box = layoutReadoutBox({
        rows: lines, title, subtitle: config.subtitle, measure,
        lineHeight: lh, padding: 8, swatch: SIZE, gap: 8,
        ...(side
            ? { maxHeight: areaH, maxWidth: SIDE_PANEL_MAX_WIDTH, maxColumns: 1 }
            : { maxHeight: areaH * BOX_MAX_HEIGHT_FRACTION, maxWidth: areaW * BOX_MAX_WIDTH_FRACTION }),
    });

    const draw = (ctx, origin) => {
        ctx.save();
        ctx.translate(origin.x, origin.y);
        ctx.scale(origin.dpr, origin.dpr);

        // Guide line.
        ctx.strokeStyle = theme.tick;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(xPx + 0.5, area.top);
        ctx.lineTo(xPx + 0.5, area.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // A dot per series: solid on a real sample, a ring where read off the line.
        for (const d of dots) {
            ctx.beginPath();
            ctx.arc(d.px, d.py, 4, 0, Math.PI * 2);
            ctx.fillStyle = d.interpolated ? theme.background : (d.color ?? theme.ink);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = d.interpolated ? (d.color ?? theme.ink) : theme.background;
            ctx.stroke();
        }

        let at;
        if (side) {
            at = { left: chart.width + SIDE_PANEL_GAP, top: area.top };
        } else {
            const polylines = [];
            chart.data.datasets.forEach((_, i) => {
                if (!chart.isDatasetVisible(i)) return;
                const els = chart.getDatasetMeta(i).data ?? [];
                polylines.push(els.filter(e => !e.skip).map(e => ({ x: e.x, y: e.y })));
            });
            at = placeReadoutBox({ size: box, area, xPx, obstacles: sampleObstacles(polylines) });
            ctx.fillStyle = theme.background;
            ctx.globalAlpha = 0.94;
            ctx.fillRect(at.left, at.top, box.width, box.height);
            ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = theme.grid;
        ctx.lineWidth = 1;
        ctx.strokeRect(at.left + 0.5, at.top + 0.5, box.width - 1, box.height - 1);

        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = boldFont;
        ctx.fillStyle = theme.ink;
        ctx.fillText(title, at.left + 8, at.top + 8 + lh / 2);
        if (config.subtitle) {
            ctx.font = `400 ${SMALL}px ${mono}`;
            ctx.fillStyle = theme.tick;
            ctx.fillText(config.subtitle, at.left + 8, at.top + 8 + lh * 1.5);
        }

        box.columns.forEach(col => {
            col.indices.forEach((idx, k) => {
                const cy = at.top + box.headHeight + k * lh + lh / 2;
                const left = at.left + col.x;
                ctx.fillStyle = reading.rows[idx].color ?? theme.ink;
                ctx.fillRect(left, cy - SIZE / 4, SIZE * 0.6, SIZE / 2);
                ctx.font = bodyFont;
                ctx.fillStyle = theme.legend;
                ctx.textAlign = 'left';
                ctx.fillText(box.names[idx], left + SIZE, cy);
                ctx.fillStyle = theme.ink;
                ctx.textAlign = 'right';
                ctx.fillText(lines[idx].value, left + SIZE + col.nameWidth + 8 + col.valueWidth, cy);
            });
        });
        if (box.moreY != null) {
            ctx.font = `400 ${SMALL}px ${mono}`;
            ctx.fillStyle = theme.tick;
            ctx.textAlign = 'left';
            ctx.fillText(`+${box.hidden} more`, at.left + 8, at.top + box.moreY + lh / 2);
        }
        ctx.restore();
    };

    return { sideWidth: side ? SIDE_PANEL_GAP + box.width : 0, draw };
}
