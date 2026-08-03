/**
 * Copy URL / Copy PNG controls for a chart, with the PNG shown below the chart.
 *
 * Every chart view had grown its own copy of this — same buttons, same states,
 * subtly different behaviour. Notably only Road Trip rendered the PNG inline
 * afterwards, which is the only way to save a chart on mobile: the Clipboard
 * API is unavailable or useless there, so without a visible <img> to long-press
 * the button silently does nothing. That behaviour is the one worth keeping, so
 * it's the one implemented here.
 *
 * Props:
 *   chartRef     — ref holding the Chart.js instance
 *   isDark       — theme, for the exported background (a transparent PNG pasted
 *                  into a light document renders dark text on dark)
 *   buildParams  — optional (params: URLSearchParams) => void, to add
 *                  chart-specific keys to the copied link
 *   note         — optional hint line shown under the buttons
 */
import { useState } from 'react';

export default function ChartExportButtons({ chartRef, isDark, buildParams, note }) {
    const [urlCopied, setUrlCopied]     = useState(false);
    const [imageCopied, setImageCopied] = useState(false);
    const [chartImage, setChartImage]   = useState(null);

    const handleCopyUrl = () => {
        const p = new URLSearchParams(window.location.search);
        buildParams?.(p);
        const url = `${window.location.origin}${window.location.pathname}?${p.toString()}`;
        navigator.clipboard.writeText(url).then(() => {
            setUrlCopied(true);
            setTimeout(() => setUrlCopied(false), 2000);
        });
    };

    const handleCopyImage = async () => {
        const src = chartRef.current?.canvas;
        if (!src) return;
        // Chart.js canvases are transparent; flatten onto the theme background so
        // the PNG is readable wherever it's pasted.
        const off = document.createElement('canvas');
        off.width = src.width;
        off.height = src.height;
        const ctx = off.getContext('2d');
        ctx.fillStyle = isDark ? 'rgb(8,12,28)' : '#ffffff';
        ctx.fillRect(0, 0, off.width, off.height);
        ctx.drawImage(src, 0, 0);

        const dataUrl = off.toDataURL('image/png');
        // Shown regardless of whether the clipboard write succeeds — on mobile it
        // usually doesn't, and the image is the whole point.
        setChartImage(dataUrl);
        try {
            const blob = await (await fetch(dataUrl)).blob();
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setImageCopied(true);
            setTimeout(() => setImageCopied(false), 2500);
        } catch { /* no clipboard support — the inline image below still works */ }
    };

    return (
        <>
            <div className="mt-3 flex gap-2 flex-wrap items-center">
                <button
                    onClick={handleCopyUrl}
                    className={`chart-copy-btn ${urlCopied ? 'chart-copy-btn-active' : ''}`}
                    title="Copy a link to this chart"
                >
                    {urlCopied ? '✓ Copied!' : '🔗 Copy URL'}
                </button>
                <button
                    onClick={handleCopyImage}
                    className={`chart-copy-btn ${imageCopied ? 'chart-copy-btn-active' : ''}`}
                    title="Copy chart as PNG"
                >
                    {imageCopied ? '✓ Copied to clipboard!' : '📋 Copy Chart as PNG'}
                </button>
                {chartImage && (
                    <button onClick={() => setChartImage(null)} className="chart-copy-btn">
                        ✕ Dismiss preview
                    </button>
                )}
            </div>

            {note && <p className="text-xs text-faint mt-1">{note}</p>}

            {chartImage && (
                <div className="mt-3">
                    <p className="text-xs text-faint mb-1.5">Right-click or long-press to copy / save</p>
                    <img
                        src={chartImage}
                        alt="Chart export"
                        className="w-full rounded border border-[var(--color-border)]"
                    />
                </div>
            )}
        </>
    );
}
