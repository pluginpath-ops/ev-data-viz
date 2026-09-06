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
                                {/* Names the picture, not the marks. It tried
                                    `MEDIAN · IQR · RANGE` and that put the word
                                    "median" in two headings a few columns apart
                                    meaning two different things — a legend and
                                    a column. The five columns to the right name
                                    the marks; this only has to say what the
                                    drawing IS, and in what unit. */}
                                <span className="stats-dist-legend">Distribution</span>
                                {(m?.unit || m?.axisLabel) && (
                                    <span className="stats-dist-unit">{m.unit || m.axisLabel}</span>
                                )}
                            </th>
                        )}
                        {/* The bar's own order, left to right. Written in any
                            other order they would have to be re-mapped onto the
                            picture by eye every time. The quartiles are the two
                            that most need naming: the band is the middle half
                            of the data and nothing else on the row says so. */}
                        <SortTh label="Min" sortKey="min" sort={sort} onSort={onSort} />
                        <SortTh label="Lower Q" sortKey="q1" sort={sort} onSort={onSort} />
                        <SortTh label="Median" sortKey="median" sort={sort} onSort={onSort}
                            className="guide-th numeric stats-th-median" />
                        <SortTh label="Upper Q" sortKey="q3" sort={sort} onSort={onSort} />
                        <SortTh label="Max" sortKey="max" sort={sort} onSort={onSort} />
                    </tr>
                </thead>
                <tbody>
                    {/* The corpus FIRST. It is the frame every row below is read
                        against — it sets the domain each bar is drawn on — and a
                        reference belongs where the eye starts rather than under
                        a ranking it is not competing in. */}
                    {overall.n > 0 && (
                        <tr className="stats-row stats-row-overall">
                            <td className="guide-td stats-td-name">All {plural(dimensionLabel)}</td>
                            <td className="guide-td numeric">{overall.n}</td>
                            {usable && (
                                <td className="guide-td">
                                    <Bar stats={overall} scale={scale} digits={digits} corpus />
                                </td>
                            )}
                            <td className="guide-td numeric">{fmt(overall.min)}</td>
                            <td className="guide-td numeric">{fmt(overall.q1)}</td>
                            <td className="guide-td numeric stats-td-median">{fmt(overall.median)}</td>
                            <td className="guide-td numeric">{fmt(overall.q3)}</td>
                            <td className="guide-td numeric">{fmt(overall.max)}</td>
                        </tr>
                    )}

                    {rows.map(r => (
                        <tr key={String(r.bucket)} className={`stats-row ${r.suppressed ? 'suppressed' : ''}`}>
                            <td className="guide-td stats-td-name">
                                {String(r.bucket)}
                                {/* Shown, not hidden: a bucket that vanishes from a
                                    ranking reads as a bug, where one marked
                                    too-small is an answer. */}
                                {/* The row is muted and flagged rather than
                                    given a sentence in place of its figures. A
                                    paragraph per thin bucket was five paragraphs
                                    down one table, each saying the same thing at
                                    length; the badge and the muting say it at a
                                    glance, and the numbers stay readable for
                                    anyone who wants them. */}
                                {r.suppressed && (
                                    <span className="stats-suppressed-flag">too few observations</span>
                                )}
                            </td>
                            <td className="guide-td numeric">{r.n}</td>
                            {usable && (
                                <td className="guide-td">
                                    <Bar stats={r} scale={scale} digits={digits} />
                                </td>
                            )}
                            <td className="guide-td numeric">{fmt(r.min)}</td>
                            <td className="guide-td numeric">{fmt(r.q1)}</td>
                            <td className="guide-td numeric stats-td-median">{fmt(r.median)}</td>
                            <td className="guide-td numeric">{fmt(r.q3)}</td>
                            <td className="guide-td numeric">{fmt(r.max)}</td>
                        </tr>
                    ))}

                </tbody>
            </table>
            {rows.length === 0 && <div className="empty-state">Nothing to summarise for this selection.</div>}
        </div>
    );
}
