/**
 * One testing session — a single outing, with its individual runs collapsed
 * behind a disclosure.
 *
 * A session is typically eight launches inside ninety seconds, so the runs are
 * hidden by default and the card leads with the conditions they share. Per-run
 * grade and altitude are shown because they vary between runs in the same
 * session and materially affect the result.
 */
import { useState } from 'react';
import { groupByDriveMode } from '../../utils/performanceDerivations';

const fmt = (v, dp = 1, suffix = '') =>
    v == null ? null : `${Number(v).toFixed(dp)}${suffix}`;

/** "24 Jul 2026, 10:48" from a zone-less wall-clock string. */
function formatTestedAt(raw) {
    if (!raw) return null;
    const [date, time] = String(raw).split('T');
    if (!date) return raw;
    const [y, m, d] = date.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const day = `${d} ${months[(m || 1) - 1]} ${y}`;
    return time ? `${day}, ${time.slice(0, 5)}` : day;
}

/** Compass point for a meteorological bearing, e.g. 71° → ENE. */
function compass(deg) {
    if (deg == null) return '';
    const points = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return points[Math.round(((deg % 360) / 22.5)) % 16];
}

function Condition({ label, value }) {
    if (value == null) return null;
    return (
        <span className="text-xs text-muted">
            <span className="text-faint">{label}</span> {value}
        </span>
    );
}

export default function PerformanceSessionCard({ session, canEdit, onDelete }) {
    const [open, setOpen]         = useState(false);
    const [deleting, setDeleting] = useState(false);

    const runs = session.performance_runs || [];
    const isAccel = session.test_type === 'accel';
    // Grouping by drive mode is the point of an accel session — it's how you see
    // what the modes actually cost you.
    const groups = isAccel ? groupByDriveMode([session], 'zero_to_60_sec') : [];

    const handleDelete = async () => {
        if (!window.confirm(
            `Delete this ${session.test_type} session and all ${runs.length} of its runs?\n\nThis cannot be undone.`
        )) return;
        setDeleting(true);
        try { await onDelete(session.id); } finally { setDeleting(false); }
    };

    return (
        <div className="card p-3 mb-2">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                            {formatTestedAt(session.tested_at) || 'Undated session'}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium capitalize text-muted bg-[var(--color-surface-muted)] border-[var(--color-border)]">
                            {session.test_type}
                        </span>
                        <span className="text-xs text-faint">{runs.length} runs</span>
                    </div>
                    {session.location_name && (
                        <div className="text-xs text-muted mt-0.5">{session.location_name}</div>
                    )}
                    {/* Attribution. source_url was captured on import but never
                        shown until now — a session with no visible provenance is
                        just a number you have to take on trust. */}
                    {(session.source_name || session.source_url) && (
                        <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium text-muted bg-[var(--color-surface-muted)] border-[var(--color-border)]">
                                {session.source_name || 'Unattributed'}
                            </span>
                            {session.source_url && (
                                <a
                                    href={session.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                    source ↗
                                </a>
                            )}
                        </div>
                    )}
                </div>
                {canEdit && (
                    <button
                        type="button" onClick={handleDelete} disabled={deleting}
                        className="btn btn-danger text-xs py-0.5 px-2 disabled:opacity-40"
                    >
                        {deleting ? '…' : 'Delete'}
                    </button>
                )}
            </div>

            {/* Conditions shared by every run in the session */}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2">
                <Condition label="Temp" value={fmt(session.temperature_f, 0, '°F')} />
                <Condition label="Humidity" value={fmt(session.humidity_pct, 0, '%')} />
                <Condition label="Pressure" value={fmt(session.pressure_inhg, 2, ' inHg')} />
                <Condition
                    label="Wind"
                    value={session.wind_speed_mph == null ? null
                        : `${fmt(session.wind_speed_mph, 1, ' mph')}${
                            session.wind_bearing_deg != null
                                ? ` from ${Math.round(session.wind_bearing_deg)}° ${compass(session.wind_bearing_deg)}`
                                : ''}`}
                />
                <Condition label="Cloud" value={fmt(session.cloud_cover_pct, 0, '%')} />
            </div>

            {/* Best per drive mode — the headline comparison for an accel session */}
            {groups.length > 0 && (
                <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                    <div className="text-faint text-[10px] uppercase tracking-wide mb-1 font-semibold">
                        Best 0–60 by drive mode
                    </div>
                    {groups.map(g => (
                        <div key={g.driveMode} className="flex justify-between gap-4 text-xs py-0.5">
                            <span className="text-muted truncate">{g.driveMode}</span>
                            <span className="font-mono shrink-0">
                                {g.best.toFixed(3)} s
                                <span className="text-faint ml-1">({g.count})</span>
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="mt-2 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
                {open ? '▾ Hide individual runs' : `▸ Show all ${runs.length} runs`}
            </button>

            {open && (
                <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-faint text-[10px] uppercase tracking-wide">
                                <th className="text-left font-semibold py-1">#</th>
                                <th className="text-left font-semibold py-1">Mode</th>
                                <th className="text-right font-semibold py-1">
                                    {isAccel ? '0–60' : 'Distance'}
                                </th>
                                {isAccel && <th className="text-right font-semibold py-1">0–60 (1ft)</th>}
                                <th className="text-right font-semibold py-1">Max g</th>
                                <th className="text-right font-semibold py-1">Grade</th>
                                <th className="text-right font-semibold py-1">Alt</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(r => (
                                <tr key={r.id} className="border-t border-[var(--color-border)]">
                                    <td className="py-0.5 text-faint">{(r.sequence ?? 0) + 1}</td>
                                    <td className="py-0.5 text-muted truncate max-w-[10rem]">{r.drive_mode || '—'}</td>
                                    <td className="py-0.5 text-right font-mono">
                                        {isAccel ? fmt(r.zero_to_60_sec, 3, ' s') : fmt(r.braking_distance_ft, 1, ' ft')}
                                    </td>
                                    {isAccel && (
                                        <td className="py-0.5 text-right font-mono text-muted">
                                            {fmt(r.zero_to_60_rollout_sec, 3) ?? '—'}
                                        </td>
                                    )}
                                    <td className="py-0.5 text-right font-mono">{fmt(r.max_g_force, 3) ?? '—'}</td>
                                    <td className="py-0.5 text-right font-mono text-muted">
                                        {r.slope_pct == null ? '—' : `${r.slope_pct > 0 ? '+' : ''}${Number(r.slope_pct).toFixed(2)}%`}
                                    </td>
                                    <td className="py-0.5 text-right font-mono text-muted">
                                        {fmt(r.altitude_ft, 0) ?? '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="text-[10px] text-faint mt-1">
                        Grade is signed: + is uphill. Runs on a steeper grade flatter or penalise
                        the result and are flagged when used as a measured figure.
                    </p>
                </div>
            )}
        </div>
    );
}
