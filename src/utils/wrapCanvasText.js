/**
 * Break `text` into at most `maxLines` lines that each fit `maxWidth` in the
 * context's CURRENT font (set ctx.font first). Breaks at spaces; a word wider
 * than the line is split by character. What still does not fit after the last
 * line is cut and ends in an ellipsis, so a name is shortened only as a last
 * resort rather than at the first line.
 */
export function wrapCanvasText(ctx, text, maxWidth, maxLines = 3) {
    const fits = s => ctx.measureText(s).width <= maxWidth;
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    const push = () => { if (line) lines.push(line); line = ''; };

    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (fits(next)) { line = next; continue; }
        push();
        // A single over-long word: carry it across lines a character at a time.
        let rest = word;
        while (!fits(rest) && rest.length > 1) {
            let n = rest.length - 1;
            while (n > 1 && !fits(rest.slice(0, n))) n--;
            lines.push(rest.slice(0, n));
            rest = rest.slice(n);
        }
        line = rest;
    }
    push();

    if (lines.length <= maxLines) return lines;
    let last = lines.slice(maxLines - 1).join(' ');
    while (last.length > 1 && !fits(last + '…')) last = last.slice(0, -1);
    return [...lines.slice(0, maxLines - 1), last + '…'];
}

/**
 * `wrapCanvasText` for a Chart.js tick label. A tick callback has no font set on
 * the context it can reach, so this sets `font` (a CSS font shorthand — the one
 * the axis draws in) for the measuring and puts the context back. Returns the
 * lines as an array, which Chart.js draws as a multi-line label and sizes the
 * axis to, so the axis grows to the widest wrapped line and no further.
 */
export function wrapAxisLabel(ctx, font, text, maxWidth, maxLines = 3) {
    ctx.save();
    try {
        ctx.font = font;
        const lines = wrapCanvasText(ctx, text, maxWidth, maxLines);
        return lines.length ? lines : '';
    } finally {
        ctx.restore();
    }
}

/** Room a lane-labelled Y axis leaves for the legend, the X axis and its title. */
const LANE_AXIS_CHROME_PX = 90;

/**
 * How wide and how many lines a label on a lane-labelled Y axis may take, from
 * the size of the chart rather than a fixed character count — so the same chart
 * wraps tighter at phone width and gives a crowded one fewer lines.
 *
 *   maxWidth — 30% of the chart, between 72 and 220px. The axis is as wide as
 *              its widest line, so this is also the most it can take of the plot.
 *   maxLines — as many lines as fit inside one lane (up to 3, the limit the
 *              other charts wrap to), never fewer than 1.
 */
export function laneLabelBudget({ chartWidth, chartHeight, lanes, lineHeight }) {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const laneHeight = Math.max(0, chartHeight - LANE_AXIS_CHROME_PX) / Math.max(1, lanes);
    return {
        maxWidth: clamp(Math.round(chartWidth * 0.3), 72, 220),
        maxLines: clamp(Math.floor(laneHeight / lineHeight), 1, 3),
    };
}
