/**
 * The source line: who the plotted data came from, small, along the bottom of
 * a plot frame. Names link to the source's home page where it lists one; the
 * PNG export draws the same words without links (chartToPngDataUrl).
 *
 * `line` is what useSourceLine returns. Renders nothing when there is nothing
 * to say, so a chart with no known sources has no empty strip.
 */
export default function SourceLine({ line }) {
    if (!line) return null;
    const { entries = [], unattributed = 0, showGaps = false } = line;
    const gaps = showGaps && unattributed > 0;
    if (!entries.length && !gaps) return null;
    return (
        <p className="plot-frame-sources">
            <span>Data:</span>
            {/* Each name in its own span: the separator dot belongs to the span,
                so a link's underline stops at the name. */}
            {entries.map(e => (
                <span key={e.name}>
                    {e.url
                        ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.name}</a>
                        : e.name}
                </span>
            ))}
            {gaps && (
                <span className="plot-frame-sources-gap"
                      title="Plotted runs with no source set. Data Checks → Test attribution lists them.">
                    ⚠ {unattributed} unattributed
                </span>
            )}
        </p>
    );
}
