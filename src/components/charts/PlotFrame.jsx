/**
 * The bordered frame a chart lives in — and the boundary a PNG export captures.
 *
 * That equivalence is the point. Before this, the export flattened the canvas
 * alone: a reader who pasted a chart into a thread got unlabelled curves with
 * no title, no conditions, no units and no source. Everything needed to read
 * the image has to be INSIDE the frame, so putting the frame and the export
 * boundary in one component is what stops the two drifting apart.
 *
 * The strip above it says so in as many words, because the alternative is a
 * reader finding out what an export does and does not include only after they
 * have already pasted it somewhere.
 */
export default function PlotFrame({ title, subtitle, exportControls, preview, onDismissPreview, children }) {
    return (
        <>
            {exportControls && (
                <div className="chart-export-strip">
                    <span className="text-micro">PNG / URL export captures the frame below</span>
                    <span className="chart-export-rule" />
                    {exportControls}
                </div>
            )}

            {/* What was just copied, under the button that copied it and above
                the chart it came from — small, because it is a receipt rather
                than a second copy of the chart. Right-click or long-press to
                save: the clipboard write fails silently on most mobile browsers,
                and is no use at all to someone who wants a FILE. */}
            {preview && (
                <div className="chart-png-preview">
                    <img src={preview} alt="Copied chart" />
                    <div className="chart-png-preview-note">
                        <span className="text-note">Right-click or long-press to save</span>
                        <button type="button" onClick={onDismissPreview} className="chart-copy-btn">
                            ✕ Dismiss
                        </button>
                    </div>
                </div>
            )}
            <div className="plot-frame">
                <div className="plot-frame-head">
                    <div>
                        <h3 className="plot-frame-title">{title}</h3>
                        {subtitle && <p className="plot-frame-subtitle">{subtitle}</p>}
                    </div>
                    {/* Wordmark inside the frame, so an exported image carries
                        its source without a caption having to. */}
                    <span className="plot-frame-mark" aria-hidden="true">EV<span>BENCH</span></span>
                </div>
                {children}
            </div>
        </>
    );
}
