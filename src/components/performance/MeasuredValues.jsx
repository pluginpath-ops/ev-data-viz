/**
 * Read-only panel of values derived from this vehicle's own test sessions,
 * shown beside the reported figures so measured and published numbers stay
 * visually distinct.
 *
 * Nothing here is stored — every value is recomputed from the session data by
 * performanceDerivations, so it can never drift from the runs behind it. The
 * badges expose the provenance record's own confidence rather than presenting
 * one confident number.
 */
import { PERFORMANCE_METRICS, resolveAll } from '../../utils/performanceDerivations';

const FLAG_NOTES = {
    'single-run': 'Backed by a single run — could be a fluke.',
    'steep-grade': 'Best run was on a noticeable grade, which flatters or penalises the time.',
    'multiple-sources': 'Sources disagree on this figure.',
    'rollout-convention-unknown': 'The manufacturer does not state whether this uses rollout.',
};

function SourceBadge({ record }) {
    if (!record?.source) return null;
    const style = record.source === 'measured'
        ? (record.certain
            ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-700'
            : 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700')
        : 'text-muted bg-[var(--color-surface-muted)] border-[var(--color-border)]';
    return (
        <span className={`text-[9px] px-1 py-0.5 rounded border font-medium ${style}`}>
            {record.source}
        </span>
    );
}

export default function MeasuredValues({ vehicle, sessions = [], summaries = [] }) {
    const resolved = resolveAll(vehicle, sessions, summaries);
    const rows = PERFORMANCE_METRICS
        .map(m => ({ ...m, r: resolved[m.field] }))
        .filter(({ r }) => r.measured.value != null);

    if (rows.length === 0) return null;

    return (
        <div className="card p-3 mb-3">
            <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Measured from test sessions
            </div>
            {rows.map(({ field, label, unit, note, r }) => {
                const m = r.measured;
                const flagText = m.flags.map(f => FLAG_NOTES[f]).filter(Boolean).join(' ');
                return (
                    <div key={field} className="flex items-center justify-between gap-3 py-0.5 text-xs">
                        <span className="text-muted flex items-center gap-1 min-w-0">
                            <span className="truncate">{label}</span>
                            {note && <span className="text-faint text-[10px]">({note})</span>}
                            <SourceBadge record={m} />
                            {flagText && (
                                <span className="text-amber-500 text-[9px]" title={flagText}>⚠</span>
                            )}
                        </span>
                        <span className="font-mono shrink-0" title={
                            m.basis?.drive_mode
                                ? `Best of ${m.basis.comparable_run_count} run(s) in "${m.basis.drive_mode}"`
                                : undefined
                        }>
                            {m.value.toFixed(3)} {unit}
                            {m.basis?.spread && (
                                <span className="text-faint ml-1">
                                    ({m.basis.spread.min.toFixed(3)}–{m.basis.spread.max.toFixed(3)})
                                </span>
                            )}
                        </span>
                    </div>
                );
            })}
            <p className="text-[10px] text-faint mt-1">
                Best run, with the spread across comparable runs in the same drive mode.
                Recomputed from the session data — never stored.
            </p>
        </div>
    );
}
