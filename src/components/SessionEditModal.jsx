import { useState, useEffect } from 'react';
import { vehiclesInSession, runsInSession, SESSION_COPY_FIELDS, sessionCopyDown } from '../utils/testSessions';
import { vehicleLabel } from '../utils/specHelpers';
import { useAppContext } from '../context/AppContext';
import { useSources } from '../hooks/useSources';
import { pickedSource, runSourceText } from '../utils/sources';
import SourceField from './SourceField';

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
    { key: 'altitudeFt',   label: 'Altitude (ft)', type: 'number', placeholder: 'Session-level elevation' },
    { key: 'windSpeedMph', label: 'Avg wind (mph)', type: 'number', placeholder: 'Session-level reading' },
    { key: 'elevationGainFt', label: 'Elevation gain (ft)', type: 'number', placeholder: 'Net climb of the route' },
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
        altitudeFt:   session?.altitude_ft ?? '',
        windSpeedMph:    session?.wind_speed_mph ?? '',
        elevationGainFt: session?.elevation_gain_ft ?? '',
        // The source is chosen from the source list (#426): null until the
        // picker is touched, when the stored text stands in.
        sourcePick:   null,
        storedSource: session?.source_name ?? '',
        url:          session?.url ?? '',
        notes:        session?.notes ?? '',
    };
}

export default function SessionEditModal({ session, vehicles, onSave, onDelete, onClose }) {
    const { updateRun, isContributor, ensureSourceId } = useAppContext();
    const { sources, available: sourcesAvailable } = useSources();
    const [draft, setDraft] = useState(() => toDraft(session));
    const [saving, setSaving] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    // Result of the last copy-down, cleared whenever the session changes or a
    // field is edited so a stale count can't linger.
    const [copyResult, setCopyResult] = useState(null);
    // Which of the session's values to pass down. All, to start: filling
    // blanks is the safe default, and overwriting asks first.
    const [copyKeys, setCopyKeys] = useState(() => SESSION_COPY_FIELDS.map(f => f.key));
    const [copying, setCopying] = useState(false);

    useEffect(() => { setDraft(toDraft(session)); setCopyResult(null); }, [session]);
    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    if (!session) return null;

    const members  = runsInSession(vehicles, session.id);
    const cars     = vehiclesInSession(vehicles, session.id);
    const set = (key, value) => { setDraft(d => ({ ...d, [key]: value })); setCopyResult(null); };

    const handleSave = async () => {
        setSaving(true);
        try {
            const { sourcePick, storedSource, ...rest } = draft;
            // A source typed as new joins the list; what is written is the canonical name.
            if (sourcesAvailable && sourcePick) await ensureSourceId(pickedSource(sources, sourcePick, draft.url));
            await onSave(session.id, { ...rest, sourceName: runSourceText(sources, sourcePick, draft.url, storedSource) });
            onClose();
        }
        finally { setSaving(false); }
    };

    // Pass the session's values down to its tests — a one-click labor-saver
    // for an outing with several tests, rather than typing the same link and
    // conditions onto every row (#208). Reads the SAVED session, not the
    // unsaved draft: the session must be saved first, so this never writes a
    // value the session record doesn't actually have.
    const copyable   = SESSION_COPY_FIELDS.filter(f => session[f.from] != null && session[f.from] !== '');
    const fillWrites = sessionCopyDown(session, members, copyKeys, false);
    const allWrites  = sessionCopyDown(session, members, copyKeys, true);
    const fieldCount = writes => writes.reduce((n, w) => n + Object.keys(w.updates).length, 0);
    const handleCopyDown = async () => {
        let writes = fillWrites;
        // More fields change when overwriting: some test holds a different value.
        if (fieldCount(allWrites) > fieldCount(fillWrites)) {
            const overwrite = window.confirm(
                'Some tests already have a different value for a checked field. ' +
                'Overwrite those too? Cancel to only fill in the blanks.'
            );
            if (overwrite) writes = allWrites;
        }
        if (writes.length === 0) { setCopyResult({ copied: 0 }); return; }
        setCopying(true);
        try {
            for (const { run, vehicle, updates } of writes) {
                await updateRun(vehicle.id, run.id, updates);
            }
            setCopyResult({ copied: writes.length });
        } finally {
            setCopying(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-panel mx-4 flex flex-col"
                style={{ maxWidth: 'min(92vw, 640px)', maxHeight: '85vh' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div>
                        <h3 className="text-lg font-semibold">Edit session</h3>
                        <p className="text-sm text-secondary">
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
                                    className="form-input form-input"
                                />
                            </label>
                        ))}
                        <div className="session-edit-field">
                            <SourceField
                                sources={sources}
                                pick={draft.sourcePick}
                                onPick={pick => set('sourcePick', pick)}
                                url={draft.url}
                                stored={draft.storedSource}
                            />
                        </div>
                        {isContributor && members.length > 0 && (
                            <div className="session-edit-field is-wide">
                                <span className="text-label">Copy to tests</span>
                                {copyable.length === 0 ? (
                                    <span className="text-xs text-secondary">Save a value on this session first.</span>
                                ) : (
                                    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                        {copyable.map(f => (
                                            <label key={f.key} className="flex items-center gap-1 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={copyKeys.includes(f.key)}
                                                    onChange={e => {
                                                        setCopyResult(null);
                                                        setCopyKeys(k => e.target.checked ? [...k, f.key] : k.filter(x => x !== f.key));
                                                    }}
                                                />
                                                {f.label}
                                            </label>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={handleCopyDown}
                                            disabled={copying || allWrites.length === 0}
                                            className="btn btn-secondary text-sm disabled:opacity-40"
                                        >
                                            {copying ? 'Copying…' : 'Copy to all tests'}
                                        </button>
                                        <span className="text-xs text-secondary">
                                            {copyResult
                                                ? `Updated ${copyResult.copied} test${copyResult.copied === 1 ? '' : 's'}.`
                                                : allWrites.length === 0
                                                    ? 'Every test already matches.'
                                                    : `${fillWrites.length} of ${members.length} test${members.length === 1 ? '' : 's'} have blanks to fill`}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                        <label className="session-edit-field is-wide">
                            <span className="text-label">Notes</span>
                            <textarea
                                value={draft.notes}
                                onChange={e => set('notes', e.target.value)}
                                rows={3}
                                placeholder="Conditions, anything the fields cannot say"
                                className="form-input form-input"
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
                            <button onClick={handleSave} disabled={saving} className="btn btn-commit text-sm">
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
