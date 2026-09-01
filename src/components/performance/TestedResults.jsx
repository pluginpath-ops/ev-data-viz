/**
 * Every tested figure for this vehicle, from every source, ranked together.
 *
 * A result derived from a session imported here and a result published by a
 * magazine are the same kind of claim, so they share one list. What differs is
 * how much is known about each: entries backed by run data we hold show the
 * drive mode, how many comparable runs, and the spread between them.
 *
 * Nothing here is stored — the session-backed entries are derived on the fly,
 * so they can't drift from the runs behind them.
 */
import { useState } from 'react';
import { PERFORMANCE_METRICS, deriveTestedResults } from '../../utils/performanceDerivations';

const FLAG_NOTES = {
    'single-run': 'Backed by a single run — could be a fluke.',
    'steep-grade': 'Best run was on a noticeable grade, which flatters or penalises the time.',
};

/** Marks entries EVBench holds the full run data for. */
function OriginBadge({ entry }) {
    if (entry.origin !== 'session') return null;
    const style = entry.certain
        ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/30 dark:border-green-700'
        : 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-900/30 dark:border-amber-700';
    return (
        <span
            className={`text-[9px] px-1 py-0.5 rounded border font-medium ${style}`}
            title="Full run data held here — this figure is derived from it, not quoted."
        >
            full data
        </span>
    );
}

function Entry({ entry, unit }) {
    const flagText = entry.flags.map(f => FLAG_NOTES[f]).filter(Boolean).join(' ');
    const detail = entry.origin === 'session' && entry.basis?.drive_mode
        ? `${entry.basis.drive_mode}${entry.basis.comparable_run_count > 1 ? ` · best of ${entry.basis.comparable_run_count}` : ''}`
        : null;

    return (
        <div className="flex items-center justify-between gap-3 py-0.5 text-xs">
            <span className="text-secondary flex items-center gap-1.5 min-w-0">
                {entry.url ? (
                    <a href={entry.url} target="_blank" rel="noopener noreferrer"
                        className="text-indigo-600 dark:text-indigo-400 hover:underline truncate">
                        {entry.sourceName} ↗
                    </a>
                ) : (
                    <span className="truncate">{entry.sourceName}</span>
                )}
                <OriginBadge entry={entry} />
                {detail && <span className="text-meta text-[10px] truncate">{detail}</span>}
                {flagText && <span className="text-amber-500 text-[9px]" title={flagText}>⚠</span>}
            </span>
            <span className="font-mono shrink-0">
                {entry.value.toFixed(3)} {unit}
                {entry.basis?.spread && (
                    <span className="text-meta ml-1">
                        ({entry.basis.spread.min.toFixed(3)}–{entry.basis.spread.max.toFixed(3)})
                    </span>
                )}
            </span>
        </div>
    );
}

export default function TestedResults({ sessions = [], summaries = [] }) {
    const [expanded, setExpanded] = useState({});

    const rows = PERFORMANCE_METRICS
        .map(m => ({ ...m, entries: deriveTestedResults(sessions, summaries, m.field) }))
        .filter(r => r.entries.length > 0);

    if (rows.length === 0) return null;

    return (
        <div className="card p-3 mb-3">
            <div className="text-meta text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Tested results
            </div>

            {rows.map(({ field, label, unit, note, entries }) => {
                const open = expanded[field];
                const others = entries.length - 1;
                return (
                    <div key={field} className="py-1 border-b border-[var(--color-border)] last:border-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-secondary font-medium">
                                {label}
                                {note && <span className="text-meta font-normal ml-1 text-[10px]">({note})</span>}
                            </span>
                            {others > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setExpanded(e => ({ ...e, [field]: !e[field] }))}
                                    className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                                >
                                    {open ? 'show best only' : `+${others} other source${others === 1 ? '' : 's'}`}
                                </button>
                            )}
                        </div>
                        {(open ? entries : entries.slice(0, 1)).map((e, i) => (
                            <Entry key={`${e.origin}-${e.sourceName}-${i}`} entry={e} unit={unit} />
                        ))}
                    </div>
                );
            })}

            <p className="text-[10px] text-meta mt-2">
                Best first. Figures from imported sessions are derived from the run data and
                marked “full data”; the rest are as published by their source.
            </p>
        </div>
    );
}
