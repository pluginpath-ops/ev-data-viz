import { useState, useMemo, useEffect, useRef } from 'react';
import { summariseSessions, filterSessions, sessionLabel } from '../utils/testSessions';
import { vehicleLabel } from '../utils/specHelpers';

/**
 * Browse every session and attach one to a run.
 *
 * The inline picker deliberately lists only the sessions a vehicle already
 * appears in — that list stays short and is right almost every time, since a
 * curator is usually adding another run to an outing this car was already on.
 * Everything else lives here, because a flat dropdown of every session was
 * already unreadable at 28 and only grows.
 *
 * Search matches the vehicles as well as the name, which matters more than it
 * sounds: sessions inherit their names from whoever published the test, so "OoS
 * 10% Challenge" appears eight times over and the name alone cannot tell two
 * outings apart. The cars on it always can.
 *
 * This is the intended home for session management — rename, merge, delete,
 * bulk assignment — so it is built as a list of rows with room to the right
 * rather than as a picker that happens to be big.
 */
export default function SessionBrowserModal({
    vehicles, sessions, currentSessionId, vehicleId,
    onPick,          // (sessionId | null) => void
    onEdit,          // (sessionId) => void
    onClose,
}) {
    const [query, setQuery] = useState('');
    const inputRef = useRef(null);

    useEffect(() => { inputRef.current?.focus(); }, []);
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const summaries = useMemo(() => summariseSessions(sessions, vehicles), [sessions, vehicles]);
    const shown     = useMemo(() => filterSessions(summaries, query), [summaries, query]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-panel rounded-xl shadow-2xl mx-4 flex flex-col"
                style={{ maxWidth: 'min(92vw, 760px)', maxHeight: '85vh' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                        <h3 className="text-lg font-semibold">All sessions</h3>
                        <p className="text-sm text-secondary">
                            {summaries.length} session{summaries.length === 1 ? '' : 's'} · search by name, vehicle, date, tester or location
                        </p>
                    </div>
                    <button onClick={onClose} className="btn btn-secondary text-sm">Close</button>
                </div>

                <div className="px-6 pt-4">
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="e.g. oos r1s"
                        className="form-input w-full"
                    />
                </div>

                <div className="modal-body">
                    {shown.length === 0 ? (
                        <p className="text-sm text-meta italic py-6 text-center">
                            No session matches “{query}”.
                        </p>
                    ) : (
                        <div className="session-browser-list">
                            {shown.map(({ session, runCount, vehicles: inSession, date }) => {
                                const isCurrent = String(session.id) === String(currentSessionId);
                                return (
                                    <div key={session.id} className={`session-browser-row${isCurrent ? ' is-current' : ''}`}>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium">{sessionLabel(session)}</span>
                                                <span className="text-xs text-secondary">
                                                    {runCount} run{runCount === 1 ? '' : 's'}
                                                </span>
                                                {session.location_name && (
                                                    <span className="text-xs text-meta">· {session.location_name}</span>
                                                )}
                                            </div>
                                            {inSession.length > 0 ? (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {inSession.map(v => (
                                                        <span
                                                            key={v.id}
                                                            className={`session-vehicle-chip${String(v.id) === String(vehicleId) ? ' is-self' : ''}`}
                                                        >
                                                            {v.model || v.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-xs text-meta italic mt-1">No runs attached yet</p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {onEdit && (
                                                <button
                                                    onClick={() => onEdit(session.id)}
                                                    className="session-group-edit"
                                                    title="Edit session"
                                                >✎</button>
                                            )}
                                            <button
                                                onClick={() => { onPick(isCurrent ? null : session.id); onClose(); }}
                                                className={`btn text-sm ${isCurrent ? 'btn-secondary' : 'btn-primary'}`}
                                            >
                                                {isCurrent ? 'Detach' : 'Use'}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Where rename, merge, delete and bulk assignment will go. */}
                <div className="modal-footer">
                    <span className="text-xs text-meta mr-auto self-center">
                        Showing {shown.length} of {summaries.length}
                    </span>
                    <button onClick={onClose} className="btn btn-secondary text-sm">Done</button>
                </div>
            </div>
        </div>
    );
}
