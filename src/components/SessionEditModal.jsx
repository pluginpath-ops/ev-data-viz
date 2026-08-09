import { useState, useEffect } from 'react';
import { vehiclesInSession, runsInSession } from '../utils/testSessions';
import { vehicleLabel } from '../utils/specHelpers';

/**
 * Edit a session's own fields.
 *
 * Reachable from anywhere a session is named — the run's picker, the group
 * header, the browser — because the moment you notice a session is called
 * "Theoretical" and dated wrongly is the moment you are looking at a run, not
 * hunting for a management screen.
 *
 * Every field here already existed in migration 044 and had never been written
 * to, `url` included. The environmental columns are the session-level reading:
 * a run's own temperature stays authoritative for its row, and #154's congruence
 * tiers prefer the session's when present.
 */
const FIELDS = [
    { key: 'name',         label: 'Name',        type: 'text',   placeholder: 'e.g. OoS R2 & Model Y side-by-side', wide: true },
    { key: 'testedAt',     label: 'Date',        type: 'date' },
    { key: 'tester',       label: 'Tester',      type: 'text',   placeholder: 'e.g. Out of Spec' },
    { key: 'locationName', label: 'Location',    type: 'text',   placeholder: 'e.g. I-70 loop, Denver' },
    { key: 'temperatureF', label: 'Temp (°F)',   type: 'number', placeholder: 'Session-level reading' },
    { key: 'sourceName',   label: 'Source',      type: 'text',   placeholder: 'Who published it' },
    { key: 'url',          label: 'URL',         type: 'url',    placeholder: 'https://…', wide: true },
];

/** DB row → the camelCase draft the form edits. */
function toDraft(session) {
    return {
        name:         session?.name ?? '',
        testedAt:     session?.tested_at ? String(session.tested_at).slice(0, 10) : '',
        tester:       session?.tester ?? '',
        locationName: session?.location_name ?? '',
        temperatureF: session?.temperature_f ?? '',
        sourceName:   session?.source_name ?? '',
        url:          session?.url ?? '',
        notes:        session?.notes ?? '',
    };
}

export default function SessionEditModal({ session, vehicles, onSave, onDelete, onClose }) {
    const [draft, setDraft] = useState(() => toDraft(session));
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => { setDraft(toDraft(session)); }, [session]);
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    if (!session) return null;

    const members  = runsInSession(vehicles, session.id);
    const cars     = vehiclesInSession(vehicles, session.id);
    const set = (key, value) => setDraft(d => ({ ...d, [key]: value }));

    const handleSave = async () => {
        setSaving(true);
        try { await onSave(session.id, draft); onClose(); }
        finally { setSaving(false); }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-panel rounded-xl shadow-2xl mx-4 flex flex-col"
                style={{ maxWidth: 'min(92vw, 640px)', maxHeight: '85vh' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                        <h3 className="text-lg font-semibold">Edit session</h3>
                        <p className="text-sm text-muted">
                            {members.length} run{members.length === 1 ? '' : 's'}
                            {cars.length > 0 && ` · ${cars.map(v => v.model || v.name).join(', ')}`}
                        </p>
                    </div>
                    <button onClick={onClose} className="btn btn-secondary text-sm">Close</button>
                </div>

                <div className="modal-body">
                    <div className="session-edit-grid">
                        {FIELDS.map(f => (
                            <label key={f.key} className={f.wide ? 'session-edit-field is-wide' : 'session-edit-field'}>
                                <span className="text-label">{f.label}</span>
                                <input
                                    type={f.type}
                                    value={draft[f.key]}
                                    placeholder={f.placeholder}
                                    onChange={e => set(f.key, e.target.value)}
                                    className="form-input text-sm"
                                />
                            </label>
                        ))}
                        <label className="session-edit-field is-wide">
                            <span className="text-label">Notes</span>
                            <textarea
                                value={draft.notes}
                                onChange={e => set('notes', e.target.value)}
                                rows={3}
                                placeholder="Conditions, anything the fields cannot say"
                                className="form-input text-sm"
                            />
                        </label>
                    </div>

                    {/* Changing the date can put the session at odds with its own
                        runs, so name them rather than letting the warning appear
                        later on each run in turn. */}
                    {members.length > 0 && (
                        <div className="mt-4">
                            <p className="text-label mb-1">Runs in this session</p>
                            <div className="flex flex-wrap gap-1">
                                {members.map(({ run, vehicle }) => (
                                    <span key={run.id} className="session-vehicle-chip" title={vehicleLabel(vehicle)}>
                                        {vehicle.model || vehicle.name} · {run.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    {onDelete && (
                        confirmDelete ? (
                            <>
                                <span className="text-xs text-secondary mr-auto self-center">
                                    Delete this session? Its {members.length} run{members.length === 1 ? '' : 's'} stay, unattached.
                                </span>
                                <button onClick={() => setConfirmDelete(false)} className="btn btn-secondary text-sm">Cancel</button>
                                <button onClick={() => { onDelete(session.id); onClose(); }} className="btn btn-danger text-sm">Delete</button>
                            </>
                        ) : (
                            <button onClick={() => setConfirmDelete(true)} className="btn btn-danger text-sm mr-auto">Delete</button>
                        )
                    )}
                    {!confirmDelete && (
                        <>
                            <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
                            <button onClick={handleSave} disabled={saving} className="btn btn-primary text-sm">
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
