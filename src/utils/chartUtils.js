// ── Chart PNG export helpers ──────────────────────────────────────────────────
//
// An exported chart used to be the canvas and nothing else: a reader who pasted
// one into a thread got unlabelled curves with no title, no conditions, no units
// and no source. Everything a reader needs is in the frame around the canvas, so
// the export draws that frame too.
//
// Drawn onto the export canvas rather than rasterised from the DOM. An
// html-to-image dependency would capture the real markup and would also pull in
// a library, inherit its font and CSS-support quirks, and make the output depend
// on how the page happened to be laid out at that moment. Six draw calls are
// deterministic and cost nothing.

import { chartTheme, chartFonts } from './chartTheme';

/** Frame metrics, in CSS pixels — scaled by the canvas's device ratio below. */
const PAD = 16;
const GAP = 10;


/**
 * Render a Chart.js instance onto an offscreen canvas and return a PNG data URL.
 *
 * @param {object} chartInstance
 * @param {object|string} options  Legacy callers pass a background colour string.
 * @param {string} [options.background]  Flat fill. Defaults to the panel token.
 * @param {string} [options.title]       Drawn above the plot, as in the frame.
 * @param {string} [options.subtitle]    The conditions the plot was drawn under.
 * @param {boolean} [options.wordmark]   Source mark, top-right. Default true.
 */
export function chartToPngDataUrl(chartInstance, options = {}) {
    const opts = typeof options === 'string' ? { background: options } : options;
    const theme = chartTheme();
    const {
        background = theme.background,
        title = null,
        subtitle = null,
        wordmark = true,
    } = opts;

    const src = chartInstance.canvas;
    // The canvas is sized in device pixels; everything drawn here is specified
    // in CSS pixels, so it has to be scaled to match or the chrome renders
    // half-size beside the plot on a HiDPI screen.
    const dpr = src.width / (src.clientWidth || src.width) || 1;
    const px = (n) => n * dpr;

    // Derived rather than typed, so the export chrome follows --fs-body and the
    // --ui-scale knob like the rest of the site's type. The ratios reproduce
    // 17 / 11 / 12 at the default 14px body, so no exported image moves today.
    // Read HERE and not at module load: a value captured at import pins the
    // chrome to whatever the scale was when the module first loaded, which in a
    // test environment is before any stylesheet exists.
    const { frame: TITLE_SIZE, badge: SUB_SIZE, label: MARK_SIZE,
            display: DISPLAY, mono: MONO } = chartFonts();

    const hasChrome = Boolean(title || subtitle || wordmark);
    const headerH = hasChrome
        ? px((title ? TITLE_SIZE + 4 : 0) + (subtitle ? SUB_SIZE + 5 : 0) + GAP)
        : 0;
    const pad = hasChrome ? px(PAD) : 0;

    const offscreen = document.createElement('canvas');
    offscreen.width = src.width + pad * 2;
    offscreen.height = src.height + headerH + pad * 2;

    const ctx = offscreen.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    if (hasChrome) {
        let y = pad;
        if (title) {
            y += px(TITLE_SIZE);
            ctx.font = `600 ${px(TITLE_SIZE)}px ${DISPLAY}`;
            ctx.fillStyle = theme.legend;
            ctx.textAlign = 'left';
            ctx.fillText(title, pad, y);
            y += px(4);
        }
        if (subtitle) {
            y += px(SUB_SIZE);
            ctx.font = `400 ${px(SUB_SIZE)}px ${MONO}`;
            ctx.fillStyle = theme.tick;
            ctx.textAlign = 'left';
            ctx.fillText(subtitle, pad, y);
        }
        if (wordmark) {
            // Two fills, not one. On screen the mark is an element with an
            // inner span — `EV` faint, `BENCH` accent (.plot-frame-mark) — and
            // canvas has no span, so a single fillText silently flattened the
            // accent half to grey. Drawn right-to-left: BENCH sits against the
            // padding and EV is offset by its measured width, so the pair lands
            // exactly where the one string used to.
            ctx.font = `700 ${px(MARK_SIZE)}px ${DISPLAY}`;
            ctx.textAlign = 'right';
            const right = offscreen.width - pad;
            const markY = pad + px(MARK_SIZE);
            ctx.fillStyle = theme.accent;
            ctx.fillText('BENCH', right, markY);
            // theme.axis is --color-chart-axis, which carries the same value as
            // the --color-text-faint the frame uses, in both themes.
            ctx.fillStyle = theme.axis;
            ctx.fillText('EV', right - ctx.measureText('BENCH').width, markY);
        }
    }

    ctx.drawImage(src, pad, pad + headerH);
    return offscreen.toDataURL('image/png');
}

/**
 * Copy a Chart.js chart to the clipboard as a PNG, frame and all.
 *
 * Returns the data URL so callers can also display it inline — which they all
 * do, because the clipboard write fails silently on most mobile browsers and an
 * image the reader can long-press is the fallback.
 *
 * Throws if the Clipboard API is unavailable.
 */
export async function copyChartAsPng(chartInstance, options = {}) {
    const dataUrl = chartToPngDataUrl(chartInstance, options);
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return dataUrl;
}
