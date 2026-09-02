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
export default function PlotFrame({ title, subtitle, exportControls, children }) {
    return (
        <>
            {exportControls && (
                <div className="chart-export-strip">
                    <span className="text-micro">PNG / URL export captures the frame below</span>
                    <span className="chart-export-rule" />
                    {exportControls}
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
