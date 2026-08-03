/**
 * One reported performance result — a published set of figures from a single
 * source, with its speed-window rows.
 *
 * This is the sparse path: most sources supply only a couple of these fields
 * and a link, with no backing test data, so every field is independently
 * optional.
 *
 * Edits are BUFFERED and committed with Save, rather than written on every
 * field exit. Entering a published result means typing six or seven numbers off
 * one page in a row, and a write per blur turns that into a burst of saves —
 * noisy, and each one a chance to half-commit a result. Same buffered pattern
 * the EPA curator form uses; CuratorField already renders a pending marker for it.
 */
import { useState, useEffect } from 'react';
import CuratorField from '../epa/CuratorField';
import PerformanceIntervals from './PerformanceIntervals';

/** Scalar fields, in entry order. Speed windows are handled separately. */
const FIELDS = [
    {
        key: 'zero_to_60_sec', label: '0–60 mph', unit: 's', step: '0.001',
        tooltip: 'Clock starts at 0 mph, with no rollout allowance. Sources differ on which of the two 0–60 figures they headline — check the source’s own footnote before entering.',
    },
    {
        key: 'zero_to_60_rollout_sec', label: '0–60 (1ft)', unit: 's', step: '0.001',
        tooltip: 'The 1-foot-rollout figure, drag-strip convention — about 0.3 s quicker than the no-rollout time. The two are not interchangeable.',
    },
    {
        key: 'zero_to_100_sec', label: '0–100 mph', unit: 's', step: '0.001',
        tooltip: 'Time to 100 mph, on whichever rollout convention the source uses for its 0–60.',
    },
    { key: 'quarter_mile_sec',      label: '¼ mile',       unit: 's',   step: '0.001' },
    { key: 'quarter_mile_trap_mph', label: '¼ mile trap',  unit: 'mph', step: '0.01'  },
    {
        key: 'top_speed_mph', label: 'Top speed', unit: 'mph', step: '0.1',
        tooltip: 'Measured top speed. Often governor-limited rather than aerodynamically limited.',
    },
    {
        key: 'skidpad_g', label: 'Skidpad', unit: 'g', step: '0.001',
        tooltip: 'Lateral grip, conventionally measured on a 300 ft skidpad.',
    },
];

export default function PerformanceSummaryCard({
    summary,
    canEdit,
    onSaveFields,
    onDelete,
    onSaveInterval,
    onDeleteInterval,
}) {
    const [edits, setEdits]       = useState({});
    const [saving, setSaving]     = useState(false);
    const [deleting, setDeleting] = useState(false);

    const dirty = Object.keys(edits).length > 0;

    // A published result is several numbers typed in one sitting; losing them to
    // a stray refresh would mean re-reading the source.
    useEffect(() => {
        if (!dirty) return;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty]);

    /** DB truth with buffered edits laid over it. */
    const shown  = (field) => (field in edits ? edits[field] : summary[field]);
    const mark   = (field) => (field in edits ? 'pending' : undefined);
    const buffer = (field) => (value) => setEdits(e => ({ ...e, [field]: value }));

    const handleSave = async () => {
        setSaving(true);
        try {
            await onSaveFields(summary.id, edits);
            setEdits({});
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        const who = summary.source_name || 'this source';
        if (!window.confirm(`Delete the reported result from ${who}?`)) return;
        setDeleting(true);
        try { await onDelete(summary.id); } finally { setDeleting(false); }
    };

    const changeCount = Object.keys(edits).length;

    return (
        <div className="card p-3 mb-2">
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">
                        {shown('source_name') || <span className="text-faint italic">Unattributed source</span>}
                        {dirty && (
                            <span className="ml-2 text-amber-500 text-[10px] font-normal" title="Unsaved edits">
                                ● unsaved
                            </span>
                        )}
                    </div>
                    {shown('trim_label') && (
                        <div className="text-xs text-muted mt-0.5">{shown('trim_label')}</div>
                    )}
                </div>
                {canEdit && (
                    <button
                        type="button" onClick={handleDelete} disabled={deleting || saving}
                        className="btn btn-danger text-xs py-0.5 px-2 disabled:opacity-40"
                    >
                        {deleting ? '…' : 'Delete'}
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">
                {FIELDS.map(f => (
                    <CuratorField
                        key={f.key}
                        label={f.label} unit={f.unit} type="number" step={f.step}
                        tooltip={f.tooltip}
                        value={shown(f.key)}
                        overrideSource={mark(f.key)}
                        canEdit={canEdit}
                        onSave={buffer(f.key)}
                    />
                ))}
            </div>

            {/* Speed windows write immediately — each is a whole row added or
                removed in one action, not a field in a form being filled in. */}
            <PerformanceIntervals
                intervals={summary.performance_intervals || []}
                canEdit={canEdit}
                onSave={(row) => onSaveInterval({ ...row, summary_id: summary.id })}
                onDelete={onDeleteInterval}
            />

            {/* Attribution and links. Editable here rather than only at creation —
                a name typed wrong once was otherwise permanent. */}
            <div className="mt-2 pt-2 border-t border-[var(--color-border)] grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">
                <CuratorField
                    label="Source" value={shown('source_name')} canEdit={canEdit}
                    overrideSource={mark('source_name')}
                    placeholder="e.g. Car and Driver" onSave={buffer('source_name')}
                />
                <CuratorField
                    label="Trim / config" value={shown('trim_label')} canEdit={canEdit}
                    overrideSource={mark('trim_label')}
                    placeholder="e.g. Dual Standard LFP" onSave={buffer('trim_label')}
                />
                <CuratorField
                    label="Source link" value={shown('source_url')} canEdit={canEdit}
                    overrideSource={mark('source_url')}
                    tooltip="Article, video or post the figures came from."
                    placeholder="https://…" onSave={buffer('source_url')}
                />
                <CuratorField
                    label="Spreadsheet" value={shown('spreadsheet_url')} canEdit={canEdit}
                    overrideSource={mark('spreadsheet_url')}
                    placeholder="https://docs.google.com/…" onSave={buffer('spreadsheet_url')}
                />
            </div>
            {(summary.source_url || summary.spreadsheet_url) && (
                <div className="flex gap-3 mt-1">
                    {summary.source_url && (
                        <a href={summary.source_url} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                            Open source ↗
                        </a>
                    )}
                    {summary.spreadsheet_url && (
                        <a href={summary.spreadsheet_url} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                            Source data ↗
                        </a>
                    )}
                </div>
            )}

            {canEdit && dirty && (
                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--color-border)]">
                    <button
                        type="button" onClick={handleSave} disabled={saving}
                        className="btn btn-primary text-xs py-1 px-3 disabled:opacity-50"
                    >
                        {saving ? 'Saving…' : `Save ${changeCount} change${changeCount === 1 ? '' : 's'}`}
                    </button>
                    <button
                        type="button" onClick={() => setEdits({})} disabled={saving}
                        className="btn btn-secondary text-xs py-1 px-3"
                    >
                        Discard
                    </button>
                </div>
            )}
        </div>
    );
}
