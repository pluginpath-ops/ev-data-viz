/**
 * One curator-editable field: EPA label + tooltip, an input, an override flag,
 * and save-on-blur. Reused across every section of the EPA curator form.
 *
 * Override flag (spec cross-cutting requirement): distinguishes
 *   • CSV-imported values (subtle grey "csv")
 *   • curator-overridden values (amber "edited")
 * so curators can see at a glance what came from the spreadsheet vs. by hand.
 */
import { useState } from 'react';
import InfoIcon from '../InfoIcon';

export default function CuratorField({
    label,
    tooltip,
    value,
    type = 'text',
    unit,
    step,
    placeholder,
    overrideSource,        // 'csv' | 'manual' | undefined
    canEdit = true,
    onSave,                // (newValue) => Promise|void
}) {
    const [draft, setDraft]   = useState(null); // null = not editing
    const [saving, setSaving] = useState(false);

    const display = draft !== null ? draft : (value ?? '');

    const commit = async () => {
        if (draft === null) return;
        const raw = draft.trim();
        setDraft(null);
        // Normalise to the stored representation for comparison.
        const next = raw === '' ? null : (type === 'number' ? Number(raw) : raw);
        if (type === 'number' && next !== null && Number.isNaN(next)) return;
        const current = value ?? null;
        if (next === current) return;
        setSaving(true);
        try { await onSave?.(next); } finally { setSaving(false); }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter')  e.target.blur();
        if (e.key === 'Escape') setDraft(null);
    };

    return (
        <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-gray-500 dark:text-slate-400 shrink-0 flex items-center gap-1">
                {label}
                {tooltip && <InfoIcon text={tooltip} position="right" />}
                {overrideSource === 'manual' && (
                    <span title="Curator-overridden value" className="text-amber-500 text-[9px] font-bold">●</span>
                )}
                {overrideSource === 'csv' && (
                    <span title="Imported from CSV" className="text-gray-300 dark:text-slate-600 text-[9px]">csv</span>
                )}
            </span>
            <span className="flex items-center gap-1 min-w-0">
                {canEdit ? (
                    <input
                        type={type === 'number' ? 'number' : 'text'}
                        step={step}
                        value={display}
                        placeholder={placeholder}
                        disabled={saving}
                        onFocus={() => setDraft(value != null ? String(value) : '')}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={onKeyDown}
                        className="form-input text-xs py-0.5 px-1.5 w-28 text-right font-mono disabled:opacity-50"
                    />
                ) : (
                    <span className="font-mono text-xs text-right">{value ?? '—'}</span>
                )}
                {unit && <span className="text-gray-400 text-[10px] w-12 shrink-0">{unit}</span>}
            </span>
        </div>
    );
}
