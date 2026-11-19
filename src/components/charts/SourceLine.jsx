/**
 * The source line: who the plotted data came from, small, along the bottom of
 * a plot frame. Names link to the source's home page where it lists one; the
 * PNG export draws the same words without links (chartToPngDataUrl).
 *
 * `line` is what useSourceLine returns. Renders nothing when there is nothing
 * to say, so a chart with no known sources has no empty strip. A chart that
 * draws photos (the Size chart) adds `photos`, the same shape as `entries`,
 * credited after the data.
 */
export default function SourceLine({ line }) {
    if (!line) return null;
    const { entries = [], unattributed = 0, showGaps = false, photos = [] } = line;
    const gaps = showGaps && unattributed > 0;
    if (!entries.length && !gaps && !photos.length) return null;
    const named = (e) => (e.url
        ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.name}</a>
        : e.name);
    return (
        <p className="plot-frame-sources">
            {(entries.length > 0 || gaps) && <span className="plot-frame-sources-label">Data:</span>}
            {/* Each name in its own span: the separator dot belongs to the span,
                so a link's underline stops at the name. */}
            {entries.map(e => <span key={e.name}>{named(e)}</span>)}
            {gaps && (
                <span className="plot-frame-sources-gap"
                      title="Plotted runs with no source set. Data Checks → Test attribution lists them.">
                    ⚠ {unattributed} unattributed
                </span>
            )}
            {photos.length > 0 && <span className="plot-frame-sources-label">Photos:</span>}
            {photos.map(e => <span key={`photo:${e.name}`}>{named(e)}</span>)}
        </p>
    );
}
