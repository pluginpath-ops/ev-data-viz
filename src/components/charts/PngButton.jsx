/**
 * The PNG button alone, for a chart with no readout to fix (a bar chart, the
 * Cost to Drive charts). `png` is what useChartPng returns. A chart with a
 * readout uses CopyPngButton, which adds "Side readout" beside it.
 */
export default function PngButton({ png, disabled = false }) {
    return (
        <button type="button" onClick={png.copyPng} disabled={disabled}
                className={`chart-copy-btn ${png.copied ? 'chart-copy-btn-active' : ''}`}
                title="Copy the framed chart as a PNG">
            {png.copied ? '✓ Copied' : 'PNG'}
        </button>
    );
}
