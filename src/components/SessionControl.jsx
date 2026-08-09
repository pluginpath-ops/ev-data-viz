import { useState } from 'react';
import {
    sessionLabel, sessionsForPicker, vehiclesInSession,
    sessionDateMismatch, runsInSession,
} from '../utils/testSessions';
import { vehicleLabel } from '../utils/specHelpers';

/**
 * Assign a run to a testing session.
 *
 * Assignment runs from the RUN's side, like picking a manufacturer. That single
 * choice is what makes multi-vehicle sessions work without any multi-vehicle
 * UI: four cars round one loop become one session because four runs each picked
 * it, not because anything here knows how to select four cars.
 *
 * Sessions this vehicle already appears in are listed first — a curator adding
 * the fourth run of an outing should not hunt for the session the other three
 * are already in.
 */
export default function SessionControl({
    run, vehicle, vehicles, sessions,
    onAssign,          // (sessionId | null) => void
    onCreate,          // ({ name, testedAt }) => Promise<session | null>
}) {
    const [creating, setCreating] = useState(false);
    const [draftName, setDraftName] = useState('');
    const [saving, setSaving] = useState(false);

    const { used, others } = sessionsForPicker(sessions, vehicles, vehicle.id);
    const current  = (sessions || []).find(s => String(s.id) === String(run.session_id)) ?? null;
    const mismatch = sessionDateMismatch(run, current);

    // Who else was there. The point of a session is the shared outing, so the
    // other cars in it are the most useful thing to show once one is chosen.
    const others_in = current
        ? vehiclesInSession(vehicles, current.id).filter(v => String(v.id) !== String(vehicle.id))
        : [];
    const runCount = current ? runsInSession(vehicles, current.id).length : 0;

    const handleChange = (value) => {
        if (value === '__new__') { setCreating(true); setDraftName(''); return; }
        onAssign(value ? Number(value) : null);
    };

    const handleCreate = async () => {
        setSaving(true);
        try {
            // Seed the session's date from the run's own, since the run being
            // assigned is nearly always one of the outing's first.
            const created = await onCreate({ name: draftName.trim() || null, testedAt: run.date || null });
            if (created) onAssign(created.id);
            setCreating(false);
        } finally {
            setSaving(false);
        }
    };

    if (creating) {
        return (
            <div className="flex items-center gap-2 text-sm mt-1 flex-wrap">
                <span className="text-label shrink-0">New session:</span>
                <input
                    autoFocus
                    value={draftName}
                    onChange={e => setDraftName(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') handleCreate();
                        if (e.key === 'Escape') setCreating(false);
                    }}
                    placeholder="e.g. OoS 4-car loop"
                    className="form-input text-sm py-0.5 flex-1 min-w-40"
                />
                <button onClick={handleCreate} disabled={saving} className="btn btn-primary text-sm py-0.5">
                    {saving ? 'Creating…' : 'Create'}
                </button>
                <button onClick={() => setCreating(false)} className="btn btn-secondary text-sm py-0.5">Cancel</button>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 text-sm mt-1 flex-wrap">
            <span className="text-label shrink-0">Session:</span>
            <select
                value={run.session_id ?? ''}
                onChange={e => handleChange(e.target.value)}
                className="form-input text-sm py-0.5"
            >
                <option value="">— None —</option>
                {used.length > 0 && (
                    <optgroup label="This vehicle's sessions">
                        {used.map(s => <option key={s.id} value={s.id}>{sessionLabel(s)}</option>)}
                    </optgroup>
                )}
                {others.length > 0 && (
                    <optgroup label="Other sessions">
                        {others.map(s => <option key={s.id} value={s.id}>{sessionLabel(s)}</option>)}
                    </optgroup>
                )}
                <option value="__new__">+ New session…</option>
            </select>

            {current && runCount > 1 && (
                <span className="text-xs text-secondary" title={others_in.map(vehicleLabel).join(', ') || undefined}>
                    {runCount} runs
                    {others_in.length > 0 && ` · with ${others_in.map(v => v.model || v.name).join(', ')}`}
                </span>
            )}

            {/* Sessions are global, so the realistic mistake is attaching a run to
                an outing it was not part of. Say so; do not block it. */}
            {mismatch != null && (
                <span
                    className="text-xs text-amber-600"
                    title={`This run is dated ${run.date}, the session ${String(current.tested_at).slice(0, 10)}. Correct if they really were the same outing.`}
                >
                    ⚠ {mismatch} days from session date
                </span>
            )}
        </div>
    );
}
