/**
 * "Compare for": a table's presets as one always-visible row (#335).
 *
 * A preset is a named set of columns and a sort that answers one question —
 * Road trips, Value, Efficiency. The row reads as a purpose rather than a
 * configuration, so the word "preset" appears only in the tooltip, which is
 * where a reader who wonders what these are will look.
 *
 * Shared by design: the vehicle table uses it now, and the FE Guide table can
 * adopt it with only a list of its own presets.
 *
 * Three states for a button:
 *   active     the columns shown are exactly this preset's
 *   modified   the columns started as this preset and have since been changed;
 *              clicking it restores the preset
 *   neither
 *
 * @param {Array}  presets       { key, label, description }
 * @param {string} [activeKey]   the preset the columns exactly are
 * @param {string} [modifiedKey] the preset the columns were changed from
 * @param {Function} onPick      (key) => void
 */
export default function PresetPicker({ presets, activeKey = null, modifiedKey = null, onPick }) {
    return (
        <div className="preset-picker">
            <span
                className="preset-picker-label text-nano"
                title="Presets: each is a set of columns and a sort for one question. Change a column and the table is yours — the preset it started from stays marked, and clicking it restores it."
            >
                Compare for
            </span>
            <div className="stats-segmented" role="group" aria-label="Compare for (presets)">
                {presets.map(p => {
                    const state = p.key === activeKey ? 'active' : p.key === modifiedKey ? 'modified' : '';
                    return (
                        <button
                            key={p.key}
                            type="button"
                            className={state}
                            aria-pressed={state === 'active'}
                            onClick={() => onPick(p.key)}
                            title={state === 'modified'
                                ? `${p.description}\nModified — click to restore the ${p.label} preset`
                                : p.description}
                        >
                            {p.label}
                            {state === 'modified' && <span className="preset-picker-modified"> · modified</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
