import { useState } from 'react';
import { KNOB_GROUPS, knobDefault } from '../../constants/knobs';
import { getOverrides, setOverride, clearOverrides } from '../../constants/overrides';

/**
 * Admin panel for tuning the EPA model constants in real time.
 *
 * Writes per-browser overrides to localStorage (constants/overrides.js); the math
 * modules read them at load, so changes apply on the next page reload. Pure local
 * sandbox — never touches the DB or other users.
 */
const eq = (a, b) =>
    Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b;

const numOrNull = (s) => (s === '' || s == null ? null : Number(s));

export default function ConstantsKnobs() {
    const [overrides, setOverrides] = useState(getOverrides);
    const [dirty, setDirty] = useState(false);

    // Effective (live) value for a knob: override if set, else default.
    const valueOf = (key) => (key in overrides ? overrides[key] : knobDefault(key));
    const isModified = (key) => key in overrides && !eq(overrides[key], knobDefault(key));

    function commit(key, value) {
        const def = knobDefault(key);
        if (value == null || eq(value, def)) setOverride(key, null);
        else setOverride(key, value);
        setOverrides(getOverrides());
        setDirty(true);
    }

    function resetKey(key) {
        setOverride(key, null);
        setOverrides(getOverrides());
        setDirty(true);
    }

    function resetAll() {
        clearOverrides();
        setOverrides(getOverrides());
        setDirty(true);
    }

    const anyModified = KNOB_GROUPS.some(g => g.knobs.some(k => isModified(k.key)));

    return (
        <div className="card p-5">
            <div className="flex items-start justify-between gap-4 mb-1">
                <div>
                    <h3 className="section-title">Model Constants</h3>
                    <p className="text-sm text-secondary mt-0.5">
                        Tune the EPA math on <strong>this browser only</strong>. Changes are saved
                        instantly but apply on the next page reload. Never affects the database or
                        other users.
                    </p>
                </div>
                <button
                    onClick={resetAll}
                    disabled={!anyModified}
                    className="btn btn-secondary text-sm whitespace-nowrap disabled:opacity-40"
                >
                    Reset all
                </button>
            </div>

            {dirty && (
                <div className="notice-info my-3 flex items-center justify-between gap-3 p-3 rounded-lg">
                    <span className="text-sm">
                        Overrides saved — reload to apply them to the calculations.
                    </span>
                    <button onClick={() => window.location.reload()} className="btn btn-primary text-sm whitespace-nowrap">
                        ↻ Reload now
                    </button>
                </div>
            )}

            {KNOB_GROUPS.map(group => (
                <div key={group.title} className="mt-4">
                    <h4 className="subsection-title">{group.title}</h4>
                    {group.blurb && <p className="text-xs text-faint mb-2">{group.blurb}</p>}
                    <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                        {group.knobs.map(knob => (
                            <KnobRow
                                key={knob.key}
                                knob={knob}
                                value={valueOf(knob.key)}
                                def={knobDefault(knob.key)}
                                modified={isModified(knob.key)}
                                onChange={(v) => commit(knob.key, v)}
                                onReset={() => resetKey(knob.key)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function KnobRow({ knob, value, def, modified, onChange, onReset }) {
    const { key, label, help, kind, min, max, step, unit } = knob;

    return (
        <div className="py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{label}</span>
                    <code className="text-[11px] text-muted bg-[var(--color-surface-sunken)] px-1.5 py-0.5 rounded">
                        {key}
                    </code>
                    {modified && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                            modified
                        </span>
                    )}
                </div>
                {help && <p className="text-xs text-faint mt-0.5">{help}</p>}
                <p className="text-[11px] text-faint mt-0.5">
                    default: <code>{Array.isArray(def) ? `${def[0]}–${def[1]}` : String(def)}</code>
                    {unit ? ` ${unit}` : ''}
                </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {kind === 'range' ? (
                    <>
                        <input
                            type="number" min={min} max={max} step={step}
                            value={value[0]}
                            onChange={(e) => onChange([numOrNull(e.target.value) ?? def[0], value[1]])}
                            className="form-input w-20 text-sm"
                        />
                        <span className="text-faint text-sm">–</span>
                        <input
                            type="number" min={min} max={max} step={step}
                            value={value[1]}
                            onChange={(e) => onChange([value[0], numOrNull(e.target.value) ?? def[1]])}
                            className="form-input w-20 text-sm"
                        />
                    </>
                ) : (
                    <input
                        type="number" min={min} max={max} step={step}
                        value={value}
                        onChange={(e) => onChange(numOrNull(e.target.value))}
                        className="form-input w-24 text-sm"
                    />
                )}
                {unit && <span className="text-xs text-faint w-7">{unit}</span>}
                <button
                    onClick={onReset}
                    disabled={!modified}
                    title="Reset to default"
                    className="text-xs text-faint hover:text-secondary disabled:opacity-30 px-1"
                >
                    ↺
                </button>
            </div>
        </div>
    );
}
