/**
 * One reported performance result — a published set of figures from a single
 * source, with its speed-window rows.
 *
 * This is the sparse path: most sources supply only a couple of these fields
 * and a link, with no backing test data, so every field is independently
 * optional and saved on blur.
 */
import { useState } from 'react';
import CuratorField from '../epa/CuratorField';
import PerformanceIntervals from './PerformanceIntervals';

export default function PerformanceSummaryCard({
    summary,
    canEdit,
    onSaveField,
    onDelete,
    onSaveInterval,
    onDeleteInterval,
}) {
    const [deleting, setDeleting] = useState(false);

    const save = (field) => (value) => onSaveField(summary.id, field, value);

    const handleDelete = async () => {
        const who = summary.source_name || 'this source';
        if (!window.confirm(`Delete the reported result from ${who}?`)) return;
        setDeleting(true);
        try { await onDelete(summary.id); } finally { setDeleting(false); }
    };

    return (
        <div className="card p-3 mb-2">
            <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">
                        {summary.source_name || <span className="text-faint italic">Unattributed source</span>}
                    </div>
                    {summary.trim_label && (
                        <div className="text-xs text-muted mt-0.5">{summary.trim_label}</div>
                    )}
                </div>
                {canEdit && (
                    <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="btn btn-danger text-xs py-0.5 px-2 disabled:opacity-40"
                    >
                        {deleting ? '…' : 'Delete'}
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">
                <div>
                    <CuratorField
                        label="0–60 mph" unit="s" type="number" step="0.001"
                        tooltip="Clock starts at 0 mph — the figure usually published as “no rollout”."
                        value={summary.zero_to_60_sec} canEdit={canEdit}
                        onSave={save('zero_to_60_sec')}
                    />
                    <CuratorField
                        label="0–60 (1ft)" unit="s" type="number" step="0.001"
                        tooltip="1-foot-rollout figure, the drag-strip convention. Typically ~0.3 s quicker than the no-rollout time — the two are not interchangeable."
                        value={summary.zero_to_60_rollout_sec} canEdit={canEdit}
                        onSave={save('zero_to_60_rollout_sec')}
                    />
                </div>
                <div>
                    <CuratorField
                        label="¼ mile" unit="s" type="number" step="0.001"
                        value={summary.quarter_mile_sec} canEdit={canEdit}
                        onSave={save('quarter_mile_sec')}
                    />
                    <CuratorField
                        label="¼ mile trap" unit="mph" type="number" step="0.01"
                        value={summary.quarter_mile_trap_mph} canEdit={canEdit}
                        onSave={save('quarter_mile_trap_mph')}
                    />
                </div>
            </div>

            <PerformanceIntervals
                intervals={summary.performance_intervals || []}
                canEdit={canEdit}
                onSave={(row) => onSaveInterval({ ...row, summary_id: summary.id })}
                onDelete={onDeleteInterval}
            />

            {/* Source links — the provenance for figures with no backing data */}
            <div className="mt-2 pt-2 border-t border-[var(--color-border)] grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">
                <CuratorField
                    label="Video" value={summary.youtube_url} canEdit={canEdit}
                    placeholder="https://youtu.be/…" onSave={save('youtube_url')}
                />
                <CuratorField
                    label="Spreadsheet" value={summary.spreadsheet_url} canEdit={canEdit}
                    placeholder="https://docs.google.com/…" onSave={save('spreadsheet_url')}
                />
            </div>
            {(summary.youtube_url || summary.spreadsheet_url) && (
                <div className="flex gap-3 mt-1">
                    {summary.youtube_url && (
                        <a href={summary.youtube_url} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline">
                            Watch ↗
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
        </div>
    );
}
