/**
 * ↗ link to the source behind a test — the reviewer's video, article or
 * spreadsheet.
 *
 * A component rather than another copy of the same `<a>`, because the copies
 * drifted. `RunSelector` grew a second row renderer for pair mode (#150) and
 * that one rendered no link at all, so the Charging, Charge Compare and Road
 * Trip selectors credited nobody (#205). These links are the attribution owed
 * to the people who did the work of collecting the data, so there is one
 * renderer and a row can only omit a link by not calling it.
 *
 * One url per run, on both kinds, since migration 052 consolidated `url` and
 * `charging_url` into `source_url`. A pair row still renders this twice — once
 * per half — because the charging test and the range test are two runs with two
 * sources, not one run with two columns.
 *
 * Renders nothing for a run with no source, and nothing for a synthetic row
 * (the EPA range option) — there is no test behind it to credit.
 */

/** Performance sessions carry their attribution as a camelCase field. */
const sourceOf = (run) => run.source_url ?? run.sourceUrl ?? null;

/**
 * What the link points at. The column no longer says which kind of test it
 * documents, so `kind` — the discriminator that made the two columns redundant
 * in the first place — supplies it. A pair row shows two of these side by side,
 * and "Charging test source" beside "Range test source" is the difference
 * between a credit and a puzzle.
 */
const WHAT = { charging: 'Charging test source', range: 'Range test source' };

export default function RunSourceLinks({ run, className = '' }) {
    const href = run ? sourceOf(run) : null;
    if (!href) return null;

    const what = WHAT[run.kind] ?? 'Test source';

    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={run.name ? `${what} — ${run.name}` : what}
            // Selector rows are <label>s wrapping a checkbox: without this,
            // opening a source also toggles the run's selection. In a pair row
            // it matters more than that — .pair-range-control preventDefaults
            // the click, and a preventDefault anywhere on the path would cancel
            // this link's navigation.
            onClick={e => e.stopPropagation()}
            className={`run-source-link ${className}`.trim()}
        >
            ↗
        </a>
    );
}
