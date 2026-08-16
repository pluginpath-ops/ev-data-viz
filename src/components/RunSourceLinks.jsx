/**
 * ↗ links to the sources behind a test — the reviewer's video, article or
 * spreadsheet.
 *
 * A component rather than another copy of the same `<a>`, because the copies
 * drifted. `RunSelector` grew a second row renderer for pair mode (#150) and
 * that one rendered no link at all, so the Charging, Charge Compare and Road
 * Trip selectors credited nobody (#205). These links are the attribution owed
 * to the people who did the work of collecting the data, so there is now one
 * renderer and a row can only omit a link by not calling it.
 *
 * A run carries at most ONE url since migration 046: `url` on a range row,
 * `charging_url` on a charging row, enforced by CHECK constraints. So the two
 * halves of one outing hold one source each, and a pair row has to render this
 * for BOTH halves to credit both.
 *
 * Renders nothing for a run with no source, and nothing for a synthetic row
 * (the EPA range option) — there is no test behind it to credit.
 */
export default function RunSourceLinks({ run, className = '' }) {
    if (!run) return null;

    const links = [
        [run.url,          'Range test source'],
        [run.charging_url, 'Charging test source'],
        // Performance sessions keep their attribution under a different name.
        [run.sourceUrl,    'Source'],
    ].filter(([href]) => href);

    return (
        <>
            {links.map(([href, what]) => (
                <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={run.name ? `${what} — ${run.name}` : what}
                    // Selector rows are <label>s wrapping a checkbox: without
                    // this, opening a source also toggles the run's selection.
                    onClick={e => e.stopPropagation()}
                    className={`run-source-link ${className}`.trim()}
                >
                    ↗
                </a>
            ))}
        </>
    );
}
