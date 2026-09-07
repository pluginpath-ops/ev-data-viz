/**
 * What the compare table is showing, and the legend for how to read it (#277).
 *
 * The schema holds 65 rows. Four vehicles rarely fill more than a third of
 * them, and of those most agree — so the table's real problem was never how it
 * looked, it was that every question a reader arrives with ("what differs?",
 * "what is actually recorded?") had to be answered by scrolling.
 *
 * The count says what the filters did rather than leaving the reader to guess:
 * `27 of 65 rows · 4 vehicles · differences only`.
 */
function Toggle({ on, onToggle, children, title }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={on}
            title={title}
            className={`btn btn-toggle${on ? ' active' : ''}`}
        >
            {children}
        </button>
    );
}

export default function SpecsControls({
    filter, onFilter,
    diffOnly, onDiffOnly,
    hideEmpty, onHideEmpty,
    markBest, onMarkBest,
    shown, total, vehicles,
}) {
    const active = [
        diffOnly ? 'differences only' : null,
        hideEmpty ? 'recorded rows only' : null,
        filter.trim() ? `matching “${filter.trim()}”` : null,
    ].filter(Boolean);

    return (
        <div className="specs-controls">
            <input
                type="search"
                value={filter}
                onChange={e => onFilter(e.target.value)}
                placeholder="Filter specs…"
                aria-label="Filter specifications by name"
                className="form-input specs-filter"
            />

            <Toggle on={diffOnly} onToggle={onDiffOnly}
                title="Hide rows where every vehicle records the same value">
                Differences only
            </Toggle>
            <Toggle on={hideEmpty} onToggle={onHideEmpty}
                title="Hide rows no selected vehicle has a value for">
                Hide empty rows
            </Toggle>
            {/* Off by default, and it only marks rows whose field declares which
                way is an improvement — see the note on SPEC_CATEGORIES. */}
            <Toggle on={markBest} onToggle={onMarkBest}
                title="Wash the winning cell on rows that have an unambiguous better direction. Those rows show ↑ or ↓ beside their label while this is on; rows without a direction — more motors, more speakers, a bigger battery — stay neutral, because none of those is better without a use case.">
                Mark best in row
            </Toggle>

            <div className="specs-controls-count">
                <span className="text-data">{shown}</span>
                <span> of {total} rows · {vehicles} vehicle{vehicles === 1 ? '' : 's'}</span>
                {active.length > 0 && <span> · {active.join(' · ')}</span>}
            </div>
        </div>
    );
}
