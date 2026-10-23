import { useEffect, useMemo, useState } from 'react';
import {
    addChart, removeChart, moveChart, renameChart, uniqueSlug,
    comparisonProblems, chartModeOf, defaultChartTitle,
} from '../../utils/featuredComparisons';
import { buildVehicleLabels } from '../../utils/seriesLabel';

const NEW = 'new';

/**
 * Make or change a featured comparison (#448).
 *
 * Opened two ways, both by a curator:
 *   - from a chart's toolbar ("Save as featured comparison"), with that chart
 *     in hand: it becomes the first chart of a new comparison, or is added to
 *     one that exists;
 *   - from Home ("Edit"), to rename it, reorder or drop its charts, change its
 *     vehicles, list or unlist it, or delete it (admin).
 *
 * Deliberately plain: it will change as the feature is used. A comparison has
 * one vehicle set shared by all its charts, so adding a chart adds that chart's
 * vehicles to the set.
 *
 * @param {object} request  { comparison } to edit, or { add: { title, params }, vehicleIds }
 */
export default function FeaturedComparisonEditor({ request, comparisons, vehicles, canDelete, onSave, onDelete, onClose }) {
    const adding = request.add ?? null;
    const [target, setTarget] = useState(adding ? NEW : String(request.comparison.id));
    const [slugTouched, setSlugTouched] = useState(!!request.comparison);
    const [draft, setDraft] = useState(() => request.comparison
        ? request.comparison
        : { id: null, slug: '', title: '', blurb: '', vehicleIds: request.vehicleIds ?? [], charts: [adding], isListed: false });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const isNew = draft.id == null;
    const otherSlugs = useMemo(() => comparisons.filter(c => c.id !== draft.id).map(c => c.slug), [comparisons, draft.id]);
    const names = useMemo(() => buildVehicleLabels(vehicles.filter(v => draft.vehicleIds.some(id => String(id) === String(v.id)))), [vehicles, draft.vehicleIds]);
    const problems = comparisonProblems(draft);
    const slugTaken = otherSlugs.includes(draft.slug);

    const set = (patch) => { setDraft(d => ({ ...d, ...patch })); setError(null); };
    const setTitle = (title) => set({ title, ...(slugTouched ? {} : { slug: uniqueSlug(title, otherSlugs) }) });

    // Choosing where a chart goes: a new comparison, or one that exists.
    const chooseTarget = (value) => {
        setTarget(value);
        setError(null);
        if (value === NEW) {
            setSlugTouched(false);
            setDraft({ id: null, slug: '', title: '', blurb: '', vehicleIds: request.vehicleIds ?? [], charts: [adding], isListed: false });
        } else {
            const existing = comparisons.find(c => String(c.id) === value);
            setSlugTouched(true);
            setDraft(addChart(existing, adding, request.vehicleIds ?? []));
        }
    };

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            await onSave(draft);
            onClose();
        } catch (e) {
            setError(e.message || String(e));
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        setSaving(true);
        try { await onDelete(draft); onClose(); }
        catch (e) { setError(e.message || String(e)); setConfirmDelete(false); }
        finally { setSaving(false); }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-panel rounded-xl shadow-2xl mx-4 flex flex-col"
                style={{ maxWidth: 'min(92vw, 640px)', maxHeight: '85vh' }}
                role="dialog"
                aria-labelledby="featured-editor-title"
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header px-6 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <h3 id="featured-editor-title" className="section-title">
                        {isNew ? 'New featured comparison' : 'Edit featured comparison'}
                    </h3>
                    <button type="button" onClick={onClose} className="modal-close" aria-label="Close">×</button>
                </div>

                <div className="modal-body">
                    <div className="featured-editor-grid">
                        {adding && comparisons.length > 0 && (
                            <label className="featured-editor-field is-wide">
                                <span className="text-label">Put this chart in</span>
                                <select className="form-input" value={target} onChange={e => chooseTarget(e.target.value)}>
                                    <option value={NEW}>A new featured comparison</option>
                                    {comparisons.map(c => <option key={c.id} value={String(c.id)}>{c.title}</option>)}
                                </select>
                            </label>
                        )}

                        <label className="featured-editor-field is-wide">
                            <span className="text-label">Title</span>
                            <input className="form-input" value={draft.title} onChange={e => setTitle(e.target.value)}
                                placeholder="e.g. Cheap EVs on a ski trip" />
                        </label>
                        <label className="featured-editor-field is-wide">
                            <span className="text-label">What it shows</span>
                            <textarea className="form-input" rows={3} value={draft.blurb}
                                onChange={e => set({ blurb: e.target.value })}
                                placeholder="A sentence or two for the top of Home" />
                        </label>
                        <label className="featured-editor-field">
                            <span className="text-label">Link name</span>
                            <input className="form-input" value={draft.slug}
                                aria-invalid={slugTaken || undefined}
                                onChange={e => { setSlugTouched(true); set({ slug: e.target.value }); }} />
                            <span className="text-meta">?tab=home&amp;fc={draft.slug || '…'}</span>
                        </label>
                        <label className="featured-editor-field featured-editor-listed">
                            <input type="checkbox" checked={draft.isListed} onChange={e => set({ isListed: e.target.checked })} />
                            <span className="text-body">Listed — Home shows the newest listed one</span>
                        </label>
                    </div>

                    <p className="text-label mt-4 mb-1">Vehicles (shared by every chart)</p>
                    <ul className="home-vehicles">
                        {draft.vehicleIds.map(id => {
                            const v = vehicles.find(x => String(x.id) === String(id));
                            return (
                                <li key={id} className="featured-vehicle-chip" style={{ '--chip-accent': v?.color || undefined }}>
                                    {v ? (names.get(v.id)?.short ?? v.name) : `Unavailable (#${id})`}
                                    <button type="button" className="featured-chip-remove" aria-label="Remove vehicle"
                                        onClick={() => set({ vehicleIds: draft.vehicleIds.filter(x => x !== id) })}>×</button>
                                </li>
                            );
                        })}
                    </ul>

                    <p className="text-label mt-4 mb-1">Charts</p>
                    <div className="featured-editor-charts">
                        {draft.charts.map((chart, i) => (
                            <div key={i} className="featured-editor-chart">
                                <input className="form-input" value={chart.title} aria-label={`Chart ${i + 1} title`}
                                    onChange={e => set(renameChart(draft, i, e.target.value))} />
                                <span className="text-meta">{defaultChartTitle(chartModeOf(chart.params))}</span>
                                <button type="button" className="btn btn-secondary" disabled={i === 0} aria-label="Move up"
                                    onClick={() => set(moveChart(draft, i, i - 1))}>↑</button>
                                <button type="button" className="btn btn-secondary" disabled={i === draft.charts.length - 1} aria-label="Move down"
                                    onClick={() => set(moveChart(draft, i, i + 1))}>↓</button>
                                <button type="button" className="btn btn-secondary" aria-label="Remove chart"
                                    onClick={() => set(removeChart(draft, i))}>×</button>
                            </div>
                        ))}
                    </div>
                    <p className="text-note mt-2">
                        A chart is saved as you have it now: its settings, correction and plotted tests.
                        To add another, set it up on its tab and use Save as featured comparison there.
                    </p>

                    {slugTaken && <p className="text-note mt-3" role="alert">Another featured comparison already uses this link name.</p>}
                    {error && <p className="text-note mt-3" role="alert">{error}</p>}
                </div>

                <div className="modal-footer">
                    {!isNew && canDelete && (
                        confirmDelete ? (
                            <>
                                <span className="text-note mr-auto self-center">Delete this featured comparison for good?</span>
                                <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-secondary">Keep</button>
                                <button type="button" onClick={remove} disabled={saving} className="btn btn-danger">Delete</button>
                            </>
                        ) : (
                            <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-danger mr-auto">Delete</button>
                        )
                    )}
                    {!confirmDelete && (
                        <>
                            <span className="text-meta mr-auto self-center">{problems[0]}</span>
                            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
                            <button type="button" onClick={save} disabled={saving || problems.length > 0 || slugTaken} className="btn btn-primary">
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
