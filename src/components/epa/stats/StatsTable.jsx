// The definition is passed in, not looked up: measures come from two
// registries now — the guide's and the certification records' — and a lookup
// here would silently return null for half of them, rendering 0.0198 as 0.0.

/**
 * The ranked table: one row per bucket, each carrying its whole distribution.
 *
 * ── The bar is the column, and it took the middle ────────────────────────────
 *
 * It used to sit at the far right after five numeric columns — min, lower Q,
 * median, upper Q, max — so the reader met the numbers first and the picture
 * last, if at all. Numbers in columns invite a reader to compare medians and
 * stop; a bar across a shared axis shows that Small SUVs and Standard SUVs
 * overlap almost entirely, which is a different and truer story than "102 beats
 * 89". The bar now takes the slack in the middle of the row, and the columns
 * that remain — median, min, max — are for reading an exact figure off a row
 * once the bar has shown which row to look at.
 *
 * The quartiles lost their columns rather than their meaning: they ARE the
 * band, and a number for them beside the band said the same thing twice.
 *
 * ── One domain for every row ─────────────────────────────────────────────────
 *
 * Every bar is drawn against the corpus min–max, never its own. A row scaled to
 * itself fills the column whatever its spread, which is the one thing this
 * column exists to make visible. The pinned corpus row at the bottom is what
 * states that domain: its bar spans the full width by definition.
 *
 * Drawn with positioned divs rather than a chart library — it is a line, a band
 * and a tick per row, and the axis has to match the corpus range exactly.
 */
function Bar({ stats, scale, digits, corpus = false }) {
    if (stats.n === 0 || stats.median == null) return null;
    const pct = (v) => `${((v - scale.min) / (scale.max - scale.min)) * 100}%`;
    return (
        <div
            className={`stats-box-track${corpus ? ' is-corpus' : ''}`}
            title={`min ${stats.min.toFixed(digits)} · q1 ${stats.q1.toFixed(digits)} · median ${stats.median.toFixed(digits)} · q3 ${stats.q3.toFixed(digits)} · max ${stats.max.toFixed(digits)}`}
        >
            {/* The range first, so the band paints over it. */}
            <div className="stats-box-whisker" style={{ left: pct(stats.min), right: `calc(100% - ${pct(stats.max)})` }} />
            <div className="stats-box-iqr" style={{ left: pct(stats.q1), right: `calc(100% - ${pct(stats.q3)})` }} />
            <div className="stats-box-median" style={{ left: pct(stats.median) }} />
        </div>
    );
}

/**
 * A column heading that orders the table.
 *
 * The arrow marks the active column only. Showing a faint one on every heading
 * to advertise that they are all clickable makes six arrows compete with the
 * one that is actually telling you something.
 */
function SortTh({ label, sortKey, sort, onSort, className = 'guide-th numeric' }) {
    const active = sort?.key === sortKey;
    const dir = active ? sort.dir : null;
    // Names read naturally A–Z; a measure reads best biggest-first. Either way
    // clicking the column you are already on reverses it.
    const next = active ? (dir === 'desc' ? 'asc' : 'desc')
        : (sortKey === 'bucket' ? 'asc' : 'desc');
    return (
        <th className={`${className}${active ? ' active' : ''}`}
            aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
            <button type="button" className={`stats-sort ${active ? 'active' : ''}`}
                onClick={() => onSort({ key: sortKey, dir: next })}
                title={`Sort by ${label}`}>
                {label}{active && <span className="stats-sort-arrow">{dir === 'asc' ? '↑' : '↓'}</span>}
            </button>
        </th>
    );
}

/**
 * "Class" → "classes", "Make" → "makes".
 *
 * The corpus row names what it is the total OF, and `${label}s` gave "All
 * classs". The sibilant rule covers every dimension the app has — class, make,
 * corporate parent, drive — and is the standard English one rather than a
 * lookup that would go stale the day a dimension is added.
 */
function plural(label) {
    const lower = label.toLowerCase();
    return /(?:s|x|z|ch|sh)$/.test(lower) ? `${lower}es` : `${lower}s`;
}

export default function StatsTable({ rows, measureDef, overall, dimensionLabel, sort, onSort }) {
    const m = measureDef;
    const digits = m?.digits ?? 1;

    // One scale across every row, including the corpus line, or the bars are
    // not comparable to each other — which is the only reason to draw them.
    const all = rows.filter(r => r.n > 0);
    const scale = {
        min: Math.min(...all.map(r => r.min), overall.min ?? Infinity),
        max: Math.max(...all.map(r => r.max), overall.max ?? -Infinity),
    };
    const usable = Number.isFinite(scale.min) && Number.isFinite(scale.max) && scale.max > scale.min;

    const fmt = (v) => (v == null ? '—' : v.toFixed(digits));
    const span = usable ? 4 : 3;

    return (
        <div className="guide-table-container">
            <table className="guide-table stats-table">
                <thead>
                    <tr>
                        <SortTh label={dimensionLabel} sortKey="bucket" sort={sort} onSort={onSort}
                            className="guide-th stats-th-name" />
                        <SortTh label="n" sortKey="n" sort={sort} onSort={onSort}
                            className="guide-th numeric stats-th-n" />
                        {usable && (
                            <th className="guide-th stats-th-dist">
                                {/* Names the three marks in the order they are
                                    drawn, so the bar needs no legend of its own.
                                    The unit rides here because the median, min
                                    and max columns to the right are all in it. */}
                                <span className="stats-dist-legend">Median · IQR · Range</span>
                                {(m?.unit || m?.axisLabel) && (
                                    <span className="stats-dist-unit">{m.unit || m.axisLabel}</span>
                                )}
                            </th>
                        )}
                        <SortTh label="Median" sortKey="median" sort={sort} onSort={onSort}
                            className="guide-th numeric stats-th-median" />
                        <SortTh label="Min" sortKey="min" sort={sort} onSort={onSort}
                            className="guide-th numeric stats-th-end" />
                        <SortTh label="Max" sortKey="max" sort={sort} onSort={onSort}
                            className="guide-th numeric stats-th-end" />
                    </tr>
                </thead>
                <tbody>
                    {rows.map(r => (
                        <tr key={String(r.bucket)} className={`stats-row ${r.suppressed ? 'suppressed' : ''}`}>
                            <td className="guide-td stats-td-name">
                                {String(r.bucket)}
                                {/* Shown, not hidden: a bucket that vanishes from a
                                    ranking reads as a bug, where one marked
                                    too-small is an answer. */}
                                {r.suppressed && <span className="stats-suppressed-flag">suppressed</span>}
                            </td>
                            <td className="guide-td numeric">{r.n}</td>
                            {r.suppressed ? (
                                /* No median, no quartiles, no bar — a
                                   five-number summary of two observations is a
                                   picture of nothing, and printing one would
                                   make the row look like the rows above it. The
                                   sentence takes the space they would have. */
                                <td className="guide-td stats-suppressed-note" colSpan={span}>
                                    Fewer than 3 observations — shown rather than dropped, so the
                                    {' '}{dimensionLabel.toLowerCase()} does not silently vanish from the ranking.
                                </td>
                            ) : (
                                <>
                                    {usable && (
                                        <td className="guide-td">
                                            <Bar stats={r} scale={scale} digits={digits} />
                                        </td>
                                    )}
                                    <td className="guide-td numeric stats-td-median">{fmt(r.median)}</td>
                                    <td className="guide-td numeric">{fmt(r.min)}</td>
                                    <td className="guide-td numeric">{fmt(r.max)}</td>
                                </>
                            )}
                        </tr>
                    ))}

                    {/* The corpus LAST, and pinned there.
                        It used to render first, where it read as the best row of
                        a ranking rather than as the thing the ranking is measured
                        against — and it is also the row that states the shared
                        domain, which is a summary and belongs under what it
                        summarises. */}
                    {overall.n > 0 && (
                        <tr className="stats-row stats-row-overall">
                            <td className="guide-td stats-td-name">All {plural(dimensionLabel)}</td>
                            <td className="guide-td numeric">{overall.n}</td>
                            {usable && (
                                <td className="guide-td">
                                    <Bar stats={overall} scale={scale} digits={digits} corpus />
                                </td>
                            )}
                            <td className="guide-td numeric stats-td-median">{fmt(overall.median)}</td>
                            <td className="guide-td numeric">{fmt(overall.min)}</td>
                            <td className="guide-td numeric">{fmt(overall.max)}</td>
                        </tr>
                    )}
                </tbody>
            </table>
            {rows.length === 0 && <div className="empty-state">Nothing to summarise for this selection.</div>}
        </div>
    );
}
