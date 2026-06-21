import { useState } from 'react';
import {
    TYPO_GROUPS, WEIGHT_OPTIONS,
    getTypographyOverrides, setTypographyOverride, clearTypographyOverrides,
} from '../../styles/typographyKnobs';

/**
 * Admin panel for tuning the semantic type system live.
 *
 * Writes per-browser overrides (localStorage) and applies them as CSS variables
 * on :root instantly — changes are visible across the whole app as you type, no
 * reload. Pure local sandbox; never touches the DB or other users.
 */
export default function TypographyKnobs() {
    // bump forces a re-render after live writes so values/badges refresh
    const [, force] = useState(0);
    const ov = getTypographyOverrides();

    const valueOf = (k) => (k.var in ov ? ov[k.var] : k.default);
    const isModified = (k) => k.var in ov && ov[k.var] !== k.default;
    const anyModified = TYPO_GROUPS.some(g => g.knobs.some(isModified));

    function set(k, value) {
        setTypographyOverride(k.var, value == null || value === k.default ? null : value);
        force(n => n + 1);
    }
    function resetAll() {
        clearTypographyOverrides();
        force(n => n + 1);
    }

    return (
        <div className="card p-5">
            <div className="flex items-start justify-between gap-4 mb-1">
                <div>
                    <h3 className="section-title">Typography</h3>
                    <p className="text-sm text-secondary mt-0.5">
                        Tune the type system on <strong>this browser only</strong>, applied live.
                        Never affects the database or other users.
                    </p>
                </div>
                <button onClick={resetAll} disabled={!anyModified}
                    className="btn btn-secondary text-sm whitespace-nowrap disabled:opacity-40">
                    Reset all
                </button>
            </div>

            {/* Live preview */}
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 my-3 space-y-1">
                <p className="page-title">Page title</p>
                <p className="section-title">Section title</p>
                <p className="subsection-title">Subsection title</p>
                <p className="text-body">Body — the quick brown fox jumps over the lazy dog.</p>
                <p className="text-caption text-secondary">Caption — secondary supporting copy.</p>
                <p className="text-label">Field label</p>
                <p className="text-hint">Hint — helper text under a control.</p>
                <p className="text-data">Data 1,234.56 kWh · 3.1 mi/kWh</p>
            </div>

            {TYPO_GROUPS.map(group => (
                <div key={group.title} className="mt-4">
                    <h4 className="subsection-title">{group.title}</h4>
                    {group.blurb && <p className="text-xs text-faint mb-2">{group.blurb}</p>}
                    <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                        {group.knobs.map(k => (
                            <KnobRow key={k.var} knob={k} value={valueOf(k)}
                                modified={isModified(k)} onChange={(v) => set(k, v)} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

const unitFor = (kind) => (kind === 'size' ? 'px' : kind === 'scale' ? '×' : '');

function KnobRow({ knob, value, modified, onChange }) {
    const { label, kind, var: cssVar, min, max, step, default: def } = knob;
    return (
        <div className="py-2.5 flex items-center justify-between gap-4">
            <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{label}</span>
                    <code className="text-[11px] text-muted bg-[var(--color-surface-sunken)] px-1.5 py-0.5 rounded">{cssVar}</code>
                    {modified && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                            modified
                        </span>
                    )}
                </div>
                <p className="text-[11px] text-faint mt-0.5">
                    default: <code>{def}{unitFor(kind)}</code>
                </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {kind === 'weight' ? (
                    <select value={value} onChange={(e) => onChange(Number(e.target.value))}
                        className="form-input w-24 text-sm">
                        {WEIGHT_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                ) : (
                    <input type="number" min={min} max={max} step={step} value={value}
                        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                        className="form-input w-24 text-sm" />
                )}
                <span className="text-xs text-faint w-5">{unitFor(kind)}</span>
                <button onClick={() => onChange(null)} disabled={!modified} title="Reset to default"
                    className="text-xs text-faint hover:text-secondary disabled:opacity-30 px-1">
                    ↺
                </button>
            </div>
        </div>
    );
}
