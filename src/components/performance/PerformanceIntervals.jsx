/**
 * Speed-window results for one reported result — braking distances, passing
 * times, and any acceleration window beyond the promoted 0-60.
 *
 * Windows vary by source (75-0 / 70-0 / 60-0; 50-80 / 50-90) and may be metric,
 * so each row carries its own from/to speeds and units rather than assuming a
 * fixed set. Values are stored exactly as reported; the average-rate column is
 * derived at read time so windows that aren't otherwise comparable can still be
 * read against each other.
 */
import { useState } from 'react';
import { normaliseInterval } from '../../utils/performanceDerivations';

const BLANK = {
    kind: 'braking',
    from_speed: '',
    to_speed: '0',
    speed_unit: 'mph',
    elapsed_s: '',
    distance: '',
    distance_unit: 'ft',
};

/** Rate cell — braking is trustworthy across windows, timed windows are not. */
function RateCell({ row }) {
    const n = normaliseInterval(row);
    if (n.rateG == null) return <span className="text-meta">—</span>;
    return (
        <span
            className={n.rateCertain ? 'font-mono' : 'font-mono text-secondary italic'}
            title={n.rateCertain
                ? 'Average deceleration. Braking is grip-limited, so this is comparable across different speed windows.'
                : 'Average acceleration — indicative only. The rate falls away at higher speeds, so windows covering different speed ranges are not directly comparable.'}
        >
            {n.rateG.toFixed(3)} g{!n.rateCertain && '*'}
        </span>
    );
}

export default function PerformanceIntervals({ intervals = [], canEdit, onSave, onDelete }) {
    const [draft, setDraft]   = useState(null);   // null = not adding
    const [saving, setSaving] = useState(false);
    const [error, setError]   = useState(null);

    const isBraking = draft?.kind === 'braking';

    const submit = async () => {
        setError(null);
        const from = Number(draft.from_speed);
        if (!Number.isFinite(from)) { setError('From speed is required.'); return; }
        const measure = isBraking ? Number(draft.distance) : Number(draft.elapsed_s);
        if (!Number.isFinite(measure)) {
            setError(isBraking ? 'Distance is required.' : 'Time is required.');
            return;
        }
        setSaving(true);
        try {
            await onSave({
                kind: draft.kind,
                from_speed: from,
                to_speed: Number(draft.to_speed) || 0,
                speed_unit: draft.speed_unit,
                elapsed_s: isBraking ? null : measure,
                distance: isBraking ? measure : null,
                distance_unit: draft.distance_unit,
            });
            setDraft(null);
        } catch (e) {
            setError(e?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mt-2">
            <div className="text-meta text-[10px] uppercase tracking-wide mb-1 font-semibold">
                Speed windows
            </div>

            {intervals.length === 0 && !draft && (
                <p className="text-meta text-[11px] italic">
                    No braking, passing or rolling-start figures yet. Fixed headline
                    figures like 0–60 and 0–100 have their own fields above.
                </p>
            )}

            {intervals.length > 0 && (
                <table className="w-full text-xs">
                    <tbody>
                        {intervals.map(iv => {
                            const n = normaliseInterval(iv);
                            return (
                                <tr key={iv.id} className="border-b border-[var(--color-border)] last:border-0">
                                    <td className="py-0.5 pr-2 text-secondary">{n.label}</td>
                                    <td className="py-0.5 pr-2 capitalize text-meta">{iv.kind}</td>
                                    <td className="py-0.5 pr-2 font-mono text-right">
                                        {n.value} {n.displayUnit}
                                    </td>
                                    <td className="py-0.5 pr-2 text-right"><RateCell row={iv} /></td>
                                    {canEdit && (
                                        <td className="py-0.5 text-right w-6">
                                            <button
                                                type="button"
                                                onClick={() => onDelete(iv.id)}
                                                className="text-meta hover:text-red-500"
                                                title="Remove this window"
                                            >
                                                ×
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {canEdit && !draft && (
                <button
                    type="button"
                    onClick={() => { setDraft({ ...BLANK }); setError(null); }}
                    className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
                >
                    + Add braking / passing / rolling-start figure
                </button>
            )}

            {draft && (
                <div className="mt-2 border rounded-lg p-2 border-[var(--color-border)]">
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="text-[11px]">
                            <span className="text-secondary block">Type</span>
                            <select
                                value={draft.kind}
                                onChange={e => setDraft(d => ({
                                    ...d,
                                    kind: e.target.value,
                                    // Braking runs to a stop; accel starts from one.
                                    to_speed: e.target.value === 'accel' ? d.to_speed : '0',
                                    from_speed: e.target.value === 'accel' ? '0' : d.from_speed,
                                }))}
                                className="form-input form-input w-24 mt-0.5"
                            >
                                <option value="braking">Braking</option>
                                <option value="passing">Passing</option>
                                <option value="accel">Accel</option>
                            </select>
                        </label>
                        <label className="text-[11px]">
                            <span className="text-secondary block">From</span>
                            <input
                                type="number" value={draft.from_speed} autoFocus
                                onChange={e => setDraft(d => ({ ...d, from_speed: e.target.value }))}
                                className="form-input form-input w-16 mt-0.5 font-mono"
                            />
                        </label>
                        <label className="text-[11px]">
                            <span className="text-secondary block">To</span>
                            <input
                                type="number" value={draft.to_speed}
                                onChange={e => setDraft(d => ({ ...d, to_speed: e.target.value }))}
                                className="form-input form-input w-16 mt-0.5 font-mono"
                            />
                        </label>
                        <label className="text-[11px]">
                            <span className="text-secondary block">Speed unit</span>
                            <select
                                value={draft.speed_unit}
                                onChange={e => setDraft(d => ({ ...d, speed_unit: e.target.value }))}
                                className="form-input form-input w-20 mt-0.5"
                            >
                                <option value="mph">mph</option>
                                <option value="kph">km/h</option>
                            </select>
                        </label>

                        {isBraking ? (
                            <>
                                <label className="text-[11px]">
                                    <span className="text-secondary block">Distance</span>
                                    <input
                                        type="number" step="0.1" value={draft.distance}
                                        onChange={e => setDraft(d => ({ ...d, distance: e.target.value }))}
                                        className="form-input form-input w-20 mt-0.5 font-mono"
                                    />
                                </label>
                                <label className="text-[11px]">
                                    <span className="text-secondary block">Unit</span>
                                    <select
                                        value={draft.distance_unit}
                                        onChange={e => setDraft(d => ({ ...d, distance_unit: e.target.value }))}
                                        className="form-input form-input w-16 mt-0.5"
                                    >
                                        <option value="ft">ft</option>
                                        <option value="m">m</option>
                                    </select>
                                </label>
                            </>
                        ) : (
                            <label className="text-[11px]">
                                <span className="text-secondary block">Time (s)</span>
                                <input
                                    type="number" step="0.001" value={draft.elapsed_s}
                                    onChange={e => setDraft(d => ({ ...d, elapsed_s: e.target.value }))}
                                    className="form-input form-input w-20 mt-0.5 font-mono"
                                />
                            </label>
                        )}
                    </div>

                    <p className="text-[10px] text-meta mt-1">
                        Entered as reported — a metric 100–0 km/h stays metric, and is converted
                        only when comparing.
                    </p>
                    {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}

                    <div className="flex gap-2 mt-2">
                        <button type="button" onClick={submit} disabled={saving}
                            className="btn btn-primary text-[11px] py-0.5 px-2 disabled:opacity-50">
                            {saving ? 'Saving…' : 'Add'}
                        </button>
                        <button type="button" onClick={() => setDraft(null)} disabled={saving}
                            className="btn btn-secondary text-[11px] py-0.5 px-2">
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
