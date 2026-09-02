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

import { chartTheme } from './chartTheme';

/** Frame metrics, in CSS pixels — scaled by the canvas's device ratio below. */
const PAD = 16;
const TITLE_SIZE = 17;
const SUB_SIZE = 11;
const MARK_SIZE = 12;
const GAP = 10;

const DISPLAY = "'Space Grotesk Variable', system-ui, sans-serif";
const MONO = "'JetBrains Mono Variable', ui-monospace, monospace";

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
            ctx.font = `700 ${px(MARK_SIZE)}px ${DISPLAY}`;
            ctx.textAlign = 'right';
            ctx.fillStyle = theme.axis;
            ctx.fillText('EVBENCH', offscreen.width - pad, pad + px(MARK_SIZE));
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
