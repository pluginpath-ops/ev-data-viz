// ── Chart PNG export helpers ──────────────────────────────────────────────────

/**
 * Render a Chart.js instance onto an offscreen canvas and return a PNG data URL.
 * bgColor defaults to white; pass the dark-mode card color when in dark theme.
 * Prevents the transparent-background problem from toBase64Image.
 */
export function chartToPngDataUrl(chartInstance, bgColor = '#ffffff') {
    const src = chartInstance.canvas;
    const offscreen = document.createElement('canvas');
    offscreen.width  = src.width;
    offscreen.height = src.height;
    const ctx = offscreen.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(src, 0, 0);
    return offscreen.toDataURL('image/png');
}

/**
 * Copy a Chart.js chart to the clipboard as a PNG.
 * bgColor defaults to white; pass the dark-mode card color when in dark theme.
 * Returns the data URL so callers can also display it inline.
 * Throws if the Clipboard API is unavailable.
 */
export async function copyChartAsPng(chartInstance, bgColor = '#ffffff') {
    const dataUrl = chartToPngDataUrl(chartInstance, bgColor);
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return dataUrl;
}
