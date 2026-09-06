import MenuButton from '../../shell/MenuButton';

/**
 * The statistics controls, as one strip (#236, re-skin phase 6).
 *
 * It was five stacked chip walls — unit, year, group-by, class, drivetrain,
 * measure — each a label above a wrapping row of every value. With 10 measures,
 * 9 classes, 6 years and 5 drivetrains that is most of a screen spent on the
 * controls before the first number, and the same diagnosis Browse's filter wall
 * got in phase 5a. Same answer: a button per question, stating its own answer.
 *
 * ── The unit is a segmented control, not a menu ─────────────────────────────
 *
 * `ONE OBSERVATION PER Configuration | Test group | Make` is the guard against a
 * make with 24 trim rows dominating a distribution, and it changes every number
 * on the screen. It stays open, in words, at the left of the strip: a reader who
 * does not know which one they are looking at cannot use any of the figures, and
 * behind a caret it would be the one question nobody thinks to ask.
 */
const segmentLabel = (label) => {
    const bare = label.replace(/^Per /, '');
    return bare.charAt(0).toUpperCase() + bare.slice(1);
};

function Segmented({ label, options, value, onChange }) {
    return (
        <div className="stats-segmented-group">
            <span className="text-nano">{label}</span>
            <div className="stats-segmented">
                {options.map(o => (
                    <button
                        key={o.key}
                        type="button"
                        className={value === o.key ? 'active' : ''}
                        aria-pressed={value === o.key}
                        onClick={() => onChange(o.key)}
                        title={o.answers}
                    >
                        {/* "Per test group" is the sentence the caption writes;
                            in a segment beside two others the "Per" is noise —
                            and what is left has to start a label, not continue
                            a sentence, so it takes the capital with it. */}
                        {segmentLabel(o.label)}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** One of a set — picking closes the menu, because the question is answered. */
function PickOne({ label, options, value, onChange, isDefault }) {
    const current = options.find(o => o.key === value);
    return (
        <MenuButton label={label} value={current?.label} active={!isDefault}>
            {({ close }) => (
                <div className="guide-facet-panel-list">
                    {options.map(o => (
                        <button
                            key={o.key}
                            type="button"
                            className={`guide-facet-option${o.key === value ? ' selected' : ''}`}
                            aria-current={o.key === value ? 'true' : undefined}
                            title={o.hint}
                            onClick={() => { onChange(o.key); close(); }}
                        >
                            <span className="guide-facet-option-name">{o.label}</span>
                            {o.unit && <span className="guide-facet-option-count">{o.unit}</span>}
                        </button>
                    ))}
                </div>
            )}
        </MenuButton>
    );
}

/**
 * Any of a set, and the menu stays open — you are building a selection rather
 * than answering a question, so closing after each click would mean reopening
 * to pick the second one.
 */
function PickMany({ label, values, selected, onToggle, onClear, allLabel, summary }) {
    if (!values.length) return null;
    return (
        <MenuButton label={label} value={summary} active={selected.length > 0}>
            <>
                <div className="guide-facet-panel-head">
                    <span className="text-nano">{selected.length} of {values.length}</span>
                    {selected.length > 0 && (
                        <button type="button" className="section-action" onClick={onClear}>
                            {allLabel ?? 'clear'}
                        </button>
                    )}
                </div>
                <div className="guide-facet-panel-list">
                    {values.map(v => (
                        <label
                            key={String(v)}
                            className={`guide-facet-option${selected.includes(v) ? ' selected' : ''}`}
                        >
                            <input
                                type="checkbox"
                                checked={selected.includes(v)}
                                onChange={() => onToggle(v)}
                            />
                            <span className="guide-facet-option-name">{String(v)}</span>
                        </label>
                    ))}
                </div>
            </>
        </MenuButton>
    );
}

export default function StatsControls({
    units, unit, onUnit, hasUnitChoice,
    measures, measure, onMeasure, defaultMeasure,
    dimensions, dimension, onDimension,
    allYears, selectedYears, onToggleYear, onAllYears,
    allClasses, classes, onToggleClass, onClearClasses, showClassFilter,
    allDrives, drives, onToggleDrive, onClearDrives, showDriveFilter,
}) {
    /**
     * Years read as a range rather than a list once there are several — "2024–26"
     * is the fact; "2024, 2025, 2026" is the same fact, wider, in a button that
     * has to sit beside four others.
     */
    const yearSummary = selectedYears.length === 0 ? 'All'
        : selectedYears.length === 1 ? String(selectedYears[0])
            : `${Math.min(...selectedYears)}–${String(Math.max(...selectedYears)).slice(2)}`;

    const listSummary = (list) => (
        list.length === 0 ? null : list.length === 1 ? list[0] : String(list.length)
    );

    return (
        <div className="stats-controls">
            {hasUnitChoice && (
                <>
                    <Segmented
                        label="One observation per"
                        options={units}
                        value={unit}
                        onChange={onUnit}
                    />
                    <span className="stats-controls-divider" aria-hidden="true" />
                </>
            )}

            <PickOne
                label="Measure"
                options={measures}
                value={measure}
                onChange={onMeasure}
                isDefault={measure === defaultMeasure}
            />
            <PickOne
                label="Group by"
                options={dimensions}
                value={dimension}
                onChange={onDimension}
                isDefault={dimension === 'body_class'}
            />

            {/* Not a PickMany: `All` is a real choice here rather than the
                absence of one, and it needs a row of its own that no year
                checkbox can express. */}
            <MenuButton label="Year" value={yearSummary} active={selectedYears.length !== 1}>
                <>
                    <div className="guide-facet-panel-list">
                        {allYears.map(y => (
                            <label
                                key={y}
                                className={`guide-facet-option${selectedYears.includes(y) ? ' selected' : ''}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedYears.includes(y)}
                                    onChange={() => onToggleYear(y)}
                                />
                                <span className="guide-facet-option-name">{y}</span>
                            </label>
                        ))}
                        <button
                            type="button"
                            className={`guide-facet-option${selectedYears.length === 0 ? ' selected' : ''}`}
                            onClick={onAllYears}
                        >
                            <span className="guide-facet-option-name">All years</span>
                        </button>
                    </div>
                    {/* Stated rather than prevented. Comparing two years is a
                        real question; counting one car twice while asking what
                        is typical is a different one, and the reader should be
                        told which they are looking at. */}
                    {selectedYears.length !== 1 && (
                        <div className="text-note">
                            A configuration in several years is counted once per year.
                        </div>
                    )}
                </>
            </MenuButton>

            {/* A filter on the dimension being grouped by is deliberately not
                offered — it would only remove rows from a table of that same
                field, which the eye does better than a control. */}
            {showClassFilter && (
                <PickMany
                    label="Class"
                    values={allClasses}
                    selected={classes}
                    summary={listSummary(classes)}
                    onToggle={onToggleClass}
                    onClear={onClearClasses}
                />
            )}
            {showDriveFilter && (
                <PickMany
                    label="Drive"
                    values={allDrives}
                    selected={drives}
                    summary={listSummary(drives)}
                    onToggle={onToggleDrive}
                    onClear={onClearDrives}
                />
            )}
        </div>
    );
}
